import writeXlsxFile from 'write-excel-file/browser';
import { formatTime, toPeruYmd } from './dateTime';

const TIPO_DOC = {
    factura: 'Factura', boleta: 'Boleta', ticket: 'Ticket', recibo_servicios: 'Recibo de servicios',
    recibo_honorarios: 'Recibo por honorarios', tributo: 'Tributo / licencia', sin_comprobante: 'Sin comprobante'
};
const METODO = { efectivo: 'Efectivo', yape: 'Yape', plin: 'Plin', tarjeta: 'Tarjeta', transferencia: 'Transferencia', deposito: 'Deposito' };
const ESTADO_PAGO = { pendiente: 'Pendiente', parcial: 'Parcial', pagado: 'Pagado', vencido: 'Vencido', anulado: 'Anulado' };
const AFECTACION = { gravado: 'Gravado', inafecto: 'Inafecto', exonerado: 'Exonerado', sin_comprobante: 'Sin comprobante' };

const FECHA = 'dd/mm/yyyy';
const MONEDA = '#,##0.00';
const HEADER = { fontWeight: 'bold', backgroundColor: '#F3F4F6' };

const ymdToDate = (ymd) => (ymd ? new Date(`${String(ymd).slice(0, 10)}T00:00:00Z`) : null);
const text = (value) => (value === null || value === undefined || value === '' ? null : String(value));
const num = (value) => (value === null || value === undefined || value === '' ? null : Number(value));

const header = (label) => ({ value: label, ...HEADER });
const cellText = (value) => ({ type: String, value: text(value) });
const cellNum = (value) => ({ type: Number, value: num(value), format: MONEDA });
const cellDate = (ymd) => ({ type: Date, value: ymdToDate(ymd), format: FECHA });

const sheet = (name, columns, rows) => ({
    sheet: name,
    data: [columns.map((c) => header(c.label)), ...rows.map((row) => columns.map((c) => c.cell(row)))],
    columns: columns.map((c) => ({ width: c.width })),
    stickyRowsCount: 1
});

const GASTO_COLUMNS = [
    { label: 'Codigo', width: 12, cell: (g) => cellText(g.codigo) },
    { label: 'Sede', width: 18, cell: (g) => cellText(g.sede_nombre) },
    { label: 'Fecha', width: 12, cell: (g) => cellDate(g.fecha) },
    { label: 'Categoria', width: 26, cell: (g) => cellText(g.categoria_nombre) },
    { label: 'Beneficiario', width: 30, cell: (g) => cellText(g.beneficiario) },
    { label: 'RUC / DNI', width: 14, cell: (g) => cellText(g.documento_identidad) },
    { label: 'Tipo de documento', width: 22, cell: (g) => cellText(TIPO_DOC[g.tipo_documento] || g.tipo_documento) },
    { label: 'Serie', width: 10, cell: (g) => cellText(g.serie) },
    { label: 'Numero', width: 14, cell: (g) => cellText(g.numero) },
    { label: 'Descripcion', width: 40, cell: (g) => cellText(g.descripcion) },
    { label: 'Afectacion', width: 14, cell: (g) => cellText(AFECTACION[g.afectacion] || g.afectacion) },
    { label: 'Valor (base)', width: 14, cell: (g) => cellNum(g.valor) },
    { label: 'IGV', width: 12, cell: (g) => cellNum(g.igv) },
    { label: 'Importe total', width: 14, cell: (g) => cellNum(g.importe) },
    { label: 'Condicion de pago', width: 16, cell: (g) => cellText(g.condicion_pago === 'credito' ? 'Credito' : 'Contado') },
    { label: 'Vencimiento', width: 12, cell: (g) => cellDate(g.fecha_vencimiento) },
    { label: 'Pagado', width: 14, cell: (g) => cellNum(g.monto_pagado) },
    { label: 'Saldo', width: 14, cell: (g) => cellNum(g.saldo) },
    { label: 'Estado de pago', width: 14, cell: (g) => cellText(ESTADO_PAGO[g.estado_pago] || g.estado_pago) },
    { label: 'Registrado por', width: 20, cell: (g) => cellText(g.usuario_nombre) },
    { label: 'Observacion', width: 30, cell: (g) => cellText(g.observacion) },
    { label: 'Motivo de anulacion', width: 30, cell: (g) => cellText(g.motivo_anulacion) }
];

const PAGO_COLUMNS = [
    { label: 'N° pago', width: 10, cell: (p) => cellText(p.id) },
    { label: 'Fecha', width: 12, cell: (p) => cellDate(toPeruYmd(new Date(p.fecha))) },
    { label: 'Hora', width: 8, cell: (p) => cellText(formatTime(p.fecha)) },
    { label: 'Sede', width: 18, cell: (p) => cellText(p.sede_nombre) },
    { label: 'Gasto', width: 12, cell: (p) => cellText(p.gasto_codigo) },
    { label: 'Beneficiario', width: 30, cell: (p) => cellText(p.beneficiario) },
    { label: 'Categoria', width: 26, cell: (p) => cellText(p.categoria_nombre) },
    { label: 'Descripcion del gasto', width: 40, cell: (p) => cellText(p.gasto_descripcion) },
    { label: 'Metodo de pago', width: 16, cell: (p) => cellText(METODO[p.metodo_pago] || p.metodo_pago) },
    { label: 'Referencia', width: 20, cell: (p) => cellText(p.referencia) },
    { label: 'Monto', width: 14, cell: (p) => cellNum(p.monto) },
    { label: 'Estado', width: 10, cell: (p) => cellText(p.estado === 'activo' ? 'Activo' : 'Anulado') },
    { label: 'Caja', width: 20, cell: (p) => cellText(p.caja_descripcion) },
    { label: 'Registrado por', width: 20, cell: (p) => cellText(p.usuario_nombre) },
    { label: 'Observacion', width: 30, cell: (p) => cellText(p.observacion) },
    { label: 'Motivo de anulacion', width: 30, cell: (p) => cellText(p.motivo_anulacion) }
];

const resumenSheet = ({ periodo, sedeNombre, gastos, pagos }) => {
    const activos = gastos.gastos.filter((g) => g.estado !== 'anulado');
    const pagosActivos = pagos.pagos.filter((p) => p.estado === 'activo');
    const sum = (rows, key) => Math.round(rows.reduce((acc, row) => acc + Number(row[key] || 0), 0) * 100) / 100;
    const group = (rows, keyFn, valueKey) => {
        const map = new Map();
        rows.forEach((row) => map.set(keyFn(row), (map.get(keyFn(row)) || 0) + Number(row[valueKey] || 0)));
        return [...map.entries()].sort((a, b) => b[1] - a[1]);
    };
    const title = (label) => [{ value: label, fontWeight: 'bold', backgroundColor: '#FDE7D6' }, { value: '' }];
    const line = (label, value) => [cellText(label), typeof value === 'number' ? cellNum(value) : cellText(value)];

    const data = [
        title('REPORTE DE GASTOS Y PAGOS'),
        line('Periodo', `${periodo.desde} al ${periodo.hasta}`),
        line('Sede', sedeNombre),
        line('Generado', new Date().toLocaleString('es-PE', { timeZone: 'America/Lima' })),
        [{ value: '' }],
        title('TOTALES (sin anulados)'),
        line('Gastos registrados', activos.length),
        line('Importe total', sum(activos, 'importe')),
        line('Base imponible (valor)', sum(activos, 'valor')),
        line('IGV', sum(activos, 'igv')),
        line('Pagado', sum(activos, 'monto_pagado')),
        line('Saldo pendiente', sum(activos, 'saldo')),
        line('Pagos realizados (cantidad)', pagosActivos.length),
        line('Pagos realizados (monto)', sum(pagosActivos, 'monto')),
        [{ value: '' }],
        title('IMPORTE POR CATEGORIA'),
        ...group(activos, (g) => g.categoria_nombre, 'importe').map(([k, v]) => line(k, Math.round(v * 100) / 100)),
        [{ value: '' }],
        title('PAGOS POR METODO'),
        ...group(pagosActivos, (p) => METODO[p.metodo_pago] || p.metodo_pago, 'monto').map(([k, v]) => line(k, Math.round(v * 100) / 100))
    ];
    // La cantidad de gastos y pagos es un conteo, no dinero.
    data[6][1] = { type: Number, value: activos.length };
    data[12][1] = { type: Number, value: pagosActivos.length };
    return { sheet: 'Resumen', data, columns: [{ width: 34 }, { width: 28 }] };
};

/** Genera y descarga un .xlsx con las hojas Resumen, Gastos y Pagos. */
export const descargarReporteGastos = async ({ periodo, sedeNombre, gastos, pagos }) => {
    const sheets = [
        resumenSheet({ periodo, sedeNombre, gastos, pagos }),
        sheet('Gastos', GASTO_COLUMNS, gastos.gastos),
        sheet('Pagos', PAGO_COLUMNS, pagos.pagos)
    ];
    const sede = String(sedeNombre).normalize('NFD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_');
    await writeXlsxFile(sheets).toFile(`Gastos_y_Pagos_${sede}_${periodo.desde}_a_${periodo.hasta}.xlsx`);
};
