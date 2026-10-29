import writeXlsxFile from 'write-excel-file/browser';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatDateTime } from './dateTime';

/**
 * Informe de movimientos del arqueo de caja (Excel y PDF), con la estructura del informe de cierre de caja de Cealka:
 * cabecera de la empresa, datos de la sesion, cuadro de resumen (efectivo / bancos), desglose por medio de pago y
 * una tabla por cada tipo de movimiento: caja ingreso, ingreso bancos y caja egreso.
 */

const SOLES = '"S/ "#,##0.00';
const money = (value) => `S/ ${Number(value || 0).toFixed(2)}`;
const MEDIOS_BANCO = ['YAPE', 'PLIN', 'TARJETA', 'TRANSFERENCIA', 'DEPOSITO'];
const MEDIO_NOMBRE = { EFECTIVO: 'Efectivo en caja (esperado)', YAPE: 'Yape', PLIN: 'Plin', TARJETA: 'Tarjeta crédito / débito', TRANSFERENCIA: 'Transferencia', DEPOSITO: 'Depósito' };
const COLUMNAS = ['#', 'T. Trans.', 'Tipo doc.', 'Documento', 'Fecha emisión', 'Medio de pago', 'Cliente / Proveedor', 'N° doc. cliente', 'Total', 'Referencia / Comentario'];


const origenLabel = (m) => (m.origen === 'venta' ? 'Venta' : m.origen === 'devolucion' ? 'Devolución' : m.origen === 'retiro' ? 'Retiro de caja' : m.origen === 'pago_gasto' ? 'Pago de gasto' : 'Movimiento');
const comentarioDe = (m) => [m.referencia && `Op. ${m.referencia}`, m.comentario].filter(Boolean).join(' · ');

/** Splits the movements in the tables of the report. */
const grupos = (informe) => {
    const lista = informe.movimientos;
    return [
        { clave: 'ingreso_caja', titulo: 'CAJA INGRESO', color: '#464646', items: lista.filter((m) => m.tipo === 'ingreso' && m.es_efectivo) },
        { clave: 'ingreso_bancos', titulo: 'INGRESO BANCOS', color: '#366092', items: lista.filter((m) => m.tipo === 'ingreso' && !m.es_efectivo) },
        { clave: 'egreso_caja', titulo: 'CAJA EGRESO', color: '#C62828', items: lista.filter((m) => m.tipo === 'egreso' && m.es_efectivo) },
        { clave: 'egreso_bancos', titulo: 'EGRESO BANCOS (devoluciones)', color: '#8E24AA', items: lista.filter((m) => m.tipo === 'egreso' && !m.es_efectivo) }
    ].filter((g) => g.items.length > 0);
};

/**
 * Resumen de caja chica: solo lo que mueve la caja. "Egresos manuales" agrupa los egresos a mano, los pagos de gastos de
 * sesiones anteriores y las devoluciones; los retiros / entregas de caja van en su propia fila.
 */
const filaResumen = (informe) => {
    const r = informe.resumen;
    const bancos = r.ingresos_bancos - r.egresos_bancos;
    const devBancos = r.egresos_bancos;
    const egresosEfectivo = r.egresos_manuales + r.pagos_gastos + r.devoluciones_efectivo;
    return [
        ['Saldo inicial', r.monto_inicial, r.monto_inicial, 0],
        ['Ingresos por ventas al contado', r.ventas_efectivo + r.ingresos_bancos, r.ventas_efectivo, r.ingresos_bancos],
        ['Ingresos manuales', r.ingresos_manuales, r.ingresos_manuales, 0],
        ['Egresos manuales', egresosEfectivo + devBancos, egresosEfectivo, devBancos],
        ['Retiros / entrega de caja', r.retiros || 0, r.retiros || 0, 0],
        ['Saldo final (esperado)', r.esperado + bancos, r.esperado, bancos],
        ['Saldo real (contado)', r.real, r.real, null],
        ['Diferencia de caja', r.diferencia, r.diferencia, null]
    ];
};

const nombreArchivo = (informe, extension) => `Informe_caja_${informe.sesion.id}.${extension}`;

// ---------------------------------------------------------------- Excel
const AZUL = '#366092';
const celda = (value, extra = {}) => ({ type: String, value: value === null || value === undefined || value === '' ? null : String(value), fontSize: 9, ...extra });
const num = (value, extra = {}) => (value === null || value === undefined ? celda('-', { align: 'right', ...extra }) : { type: Number, value: Number(value), format: SOLES, fontSize: 9, align: 'right', ...extra });
const borde = { borderStyle: 'thin', borderColor: '#D9D9D9' };
const cabecera = (texto, color = AZUL) => ({ type: String, value: texto, fontSize: 9, fontWeight: 'bold', textColor: '#FFFFFF', backgroundColor: color, align: 'center', borderStyle: 'thin', borderColor: '#000000' });

export const descargarInformeArqueoExcel = async (informe) => {
    const { empresa, sesion, resumen } = informe;
    const filas = [];
    const vacia = () => Array.from({ length: 10 }, () => null);
    const linea = (...celdas) => { const f = vacia(); celdas.forEach(([i, c]) => { f[i] = c; }); filas.push(f); };

    linea([0, { type: String, value: empresa.razon_social || empresa.sede, fontSize: 14, fontWeight: 'bold', textColor: '#1F497D' }]);
    linea([0, celda(empresa.direccion, { textColor: '#505050' })]);
    linea([0, celda(empresa.ruc ? `RUC: ${empresa.ruc}` : '', { textColor: '#505050' })]);
    filas.push(vacia());
    linea([0, { type: String, value: `Resumen ${sesion.id}`, fontSize: 12, fontWeight: 'bold' }]);
    linea([0, celda(`Sucursal: ${empresa.sede}`)], [5, celda(`Caja: ${sesion.caja}${sesion.turno ? ` · Turno ${sesion.turno}` : ''}`)]);
    linea([0, celda(`Vendedor: ${sesion.usuario_apertura || '—'}`)], [5, celda(`Estado: ${sesion.estado === 'cerrada' ? 'Cerrada' : 'Abierta'}`)]);
    linea([0, celda(`Apertura: ${formatDateTime(sesion.fecha_apertura)}`)], [5, celda(`Cierre: ${sesion.fecha_cierre ? formatDateTime(sesion.fecha_cierre) : '—'}`)]);
    filas.push(vacia());
    linea(...['DETALLE', 'MONTOS', 'EFECTIVO', 'BANCOS'].map((t, i) => [i, cabecera(t)]));
    filaResumen(informe).forEach(([detalle, total, efectivo, bancos], i) => {
        const negrita = i >= 5;
        linea([0, celda(detalle, { ...(negrita ? { fontWeight: 'bold' } : {}), ...borde })], [1, num(total, borde)], [2, num(efectivo, borde)], [3, num(bancos, borde)]);
    });
    filas.push(vacia());
    linea([0, celda('Desglose de medios de pago', { fontWeight: 'bold' })]);
    Object.entries(informe.por_medio).forEach(([medio, total]) => linea([0, celda(medio === 'EFECTIVO' ? MEDIO_NOMBRE.EFECTIVO : (MEDIO_NOMBRE[medio] || medio))], [1, num(medio === 'EFECTIVO' ? resumen.esperado : total)]));
    if (!informe.por_medio.EFECTIVO) linea([0, celda(MEDIO_NOMBRE.EFECTIVO)], [1, num(resumen.esperado)]);

    grupos(informe).forEach((g) => {
        filas.push(vacia(), vacia());
        const total = g.items.reduce((acc, m) => acc + m.monto, 0);
        linea([0, celda(`${g.titulo} (Total: ${money(total)})`, { fontWeight: 'bold', fontSize: 10 })]);
        linea(...COLUMNAS.map((t, i) => [i, cabecera(t, g.color)]));
        g.items.forEach((m, i) => {
            linea(
                [0, celda(i + 1, { align: 'center', ...borde })], [1, celda(origenLabel(m), borde)], [2, celda(m.doc_tipo, borde)], [3, celda(m.doc_numero, { align: 'center', ...borde })],
                [4, celda(formatDateTime(m.fecha), borde)], [5, celda(m.medio, { align: 'center', ...borde })], [6, celda(m.tercero || '—', borde)], [7, celda(m.tercero_doc || '—', { align: 'center', ...borde })],
                [8, num(m.monto, borde)], [9, celda(comentarioDe(m), borde)]
            );
        });
    });

    await writeXlsxFile(filas, {
        sheet: `Resumen ${sesion.id}`,
        columns: [30, 16, 16, 18, 18, 16, 28, 16, 14, 46].map((width) => ({ width })),
        showGridLines: false
    }).toFile(nombreArchivo(informe, 'xlsx'));
};

// ---------------------------------------------------------------- PDF
export const descargarInformeArqueoPdf = (informe) => {
    const { empresa, sesion, resumen } = informe;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(31, 73, 125);
    doc.text(empresa.razon_social || empresa.sede || '-', 14, 18);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(80, 80, 80);
    if (empresa.direccion) doc.text(empresa.direccion, 14, 23);
    if (empresa.ruc) doc.text(`RUC: ${empresa.ruc}`, 14, 27);
    doc.setDrawColor(31, 73, 125);
    doc.setLineWidth(0.5);
    doc.line(14, 30, 196, 30);

    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(`Resumen ${sesion.id}`, 14, 37);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Sucursal: ${empresa.sede}`, 14, 43);
    doc.text(`Vendedor: ${sesion.usuario_apertura || '—'}`, 14, 48);
    doc.text(`Apertura: ${formatDateTime(sesion.fecha_apertura)}`, 14, 53);
    doc.text(`Caja: ${sesion.caja}${sesion.turno ? ` · Turno ${sesion.turno}` : ''}`, 120, 43);
    doc.text(`Estado: ${sesion.estado === 'cerrada' ? 'Cerrada' : 'Abierta'}`, 120, 48);
    doc.text(`Cierre: ${sesion.fecha_cierre ? formatDateTime(sesion.fecha_cierre) : '—'}`, 120, 53);

    autoTable(doc, {
        startY: 58,
        head: [['DETALLE', 'MONTOS', 'EFECTIVO', 'BANCOS']],
        body: filaResumen(informe).map(([d, t, e, b]) => [d, t === null ? '-' : money(t), e === null ? '-' : money(e), b === null ? '-' : money(b)]),
        theme: 'grid',
        styles: { fontSize: 9 },
        headStyles: { fillColor: [54, 96, 146] },
        columnStyles: { 0: { fontStyle: 'bold' }, 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } }
    });

    let y = doc.lastAutoTable.finalY + 8;
    doc.setFont('helvetica', 'bold');
    doc.text('Desglose de medios de pago', 14, y);
    doc.setFont('helvetica', 'normal');
    const medios = [['EFECTIVO', resumen.esperado], ...MEDIOS_BANCO.filter((m) => informe.por_medio[m] !== undefined).map((m) => [m, informe.por_medio[m]])];
    medios.forEach(([medio, total], i) => doc.text(`${MEDIO_NOMBRE[medio]}: ${money(total)}`, 14 + (i % 3) * 62, y + 6 + Math.floor(i / 3) * 5));
    y += 8 + Math.ceil(medios.length / 3) * 5 + 4;

    grupos(informe).forEach((g) => {
        if (y > 245) { doc.addPage(); y = 20; }
        const total = g.items.reduce((acc, m) => acc + m.monto, 0);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.text(`${g.titulo} (Total: ${money(total)})`, 14, y);
        const color = [parseInt(g.color.slice(1, 3), 16), parseInt(g.color.slice(3, 5), 16), parseInt(g.color.slice(5, 7), 16)];
        autoTable(doc, {
            startY: y + 2,
            head: [COLUMNAS],
            body: g.items.map((m, i) => [i + 1, origenLabel(m), m.doc_tipo, m.doc_numero, formatDateTime(m.fecha), m.medio, m.tercero || '—', m.tercero_doc || '—', m.monto.toFixed(2), comentarioDe(m)]),
            theme: 'grid',
            styles: { fontSize: 7 },
            headStyles: { fillColor: color },
            columnStyles: { 8: { halign: 'right' } }
        });
        y = doc.lastAutoTable.finalY + 8;
    });

    doc.save(nombreArchivo(informe, 'pdf'));
};
