import writeXlsxFile from 'write-excel-file/browser';
import { toPeruYmd } from './dateTime';

/**
 * Control de cuentas por cobrar / por pagar con el formato "CUENTAS POR COBRAR Y PAGAR FORMATO BEBIDAS Y RESTAURANTE":
 * una fila por documento (importe, vencimiento, saldo y estado) seguida de una fila por cada pago o cobro.
 */

const COLS = 15; // A..O
const FECHA = 'dd/mm/yyyy';
const MONEDA = '#,##0.00';
const SHADE = '#EDEDED';
const INK = '#2C2C2C';

const COMPROBANTE = {
    factura: 'FACTURA', boleta: 'BOLETA', nota_venta: 'NOTA DE VENTA', ticket: 'TICKET', recibo_servicios: 'RECIBO DE SERVICIOS',
    recibo_honorarios: 'RECIBO POR HONORARIOS', tributo: 'TRIBUTO / LICENCIA', sin_comprobante: 'SIN COMPROBANTE'
};
const MEDIO = { efectivo: 'EFECTIVO', yape: 'YAPE', plin: 'PLIN', tarjeta: 'TARJETA', transferencia: 'TRANSFERENCIA', deposito: 'DEPOSITO' };
const ESTADO = { cobrado: 'PAGADO', pagado: 'PAGADO', parcial: 'PARCIAL', pendiente: 'PENDIENTE', vencido: 'VENCIDO', anulado: 'ANULADO' };

const ymdToDate = (ymd) => (ymd ? new Date(`${String(ymd).slice(0, 10)}T00:00:00Z`) : null);
const upper = (value) => (value === null || value === undefined || value === '' ? null : String(value).toUpperCase());

const border = { borderStyle: 'hair', borderColor: '#9CA3AF' };
const base = (shade) => ({ fontSize: 9, textColor: INK, ...border, ...(shade ? { backgroundColor: SHADE } : {}) });

const text = (value, shade, extra = {}) => ({ type: String, value: value === null || value === undefined || value === '' ? null : String(value), ...base(shade), ...extra });
const money = (value, shade, extra = {}) => ({ type: Number, value: Number(value), format: MONEDA, align: 'right', ...base(shade), ...extra });
const date = (ymd, shade) => ({ type: Date, value: ymdToDate(ymd), format: FECHA, ...base(shade) });
const formula = (value, shade, extra = {}) => ({ type: 'Formula', value, align: 'right', ...base(shade), ...extra });
const empty = (shade) => ({ type: String, value: null, ...base(shade) });

const HEAD = { fontSize: 10, fontWeight: 'bold', backgroundColor: SHADE, align: 'center', alignVertical: 'center', borderStyle: 'thin', borderColor: '#6B7280', wrap: true };
const head = (label) => ({ type: String, value: label, ...HEAD });

/**
 * @param {object} config
 * @param {string} config.sheet - sheet name
 * @param {string} config.titulo - report title
 * @param {string} config.empresa - company name
 * @param {{desde: string, hasta: string}} config.periodo
 * @param {string} config.terceroLabel - 'Cliente' | 'Proveedor'
 * @param {string} config.destinoLabel - 'Destino' | 'Procedencia'
 * @param {object[]} config.documentos - { tercero, comprobante, serie_numero, detalle, importe, fecha, vencimiento, estado, pagos: [{ fecha, medio, monto, destino, operacion, comentario }] }
 */
const buildSheet = ({ sheet, titulo, empresa, periodo, terceroLabel, destinoLabel, documentos }) => {
    const rows = [];
    const blank = () => Array.from({ length: COLS }, () => null);
    const bold = { fontWeight: 'bold' };

    rows.push([{ type: String, value: upper(empresa) || '', fontSize: 18, fontWeight: 'bold', align: 'center', columnSpan: COLS }, ...Array(COLS - 1).fill(null)]);
    rows.push(blank());
    rows.push([{ type: String, value: titulo, fontSize: 14, fontWeight: 'bold', align: 'center', backgroundColor: SHADE, columnSpan: COLS }, ...Array(COLS - 1).fill(null)]);
    const periodoRow = blank();
    periodoRow[5] = { type: String, value: 'DEL ', ...bold, align: 'right' };
    periodoRow[6] = { type: Date, value: ymdToDate(periodo.desde), format: FECHA, ...bold };
    periodoRow[8] = { type: String, value: 'AL ', ...bold, align: 'right' };
    periodoRow[9] = { type: Date, value: ymdToDate(periodo.hasta), format: FECHA, ...bold };
    rows.push(periodoRow);
    rows.push([terceroLabel, 'Comprobante', 'Serie y Nro comprobante', 'Detalle', 'Importe', 'Fecha de compra', 'Fecha vencimiento', 'Días', 'Medio de pago',
        'Pagos', 'Saldo', 'Estado', destinoLabel, 'Número de Operación', 'Comentario'].map(head));

    const firstDataRow = rows.length + 1; // 1-based row number in the sheet
    documentos.forEach((doc, index) => {
        const shade = index % 2 === 0;
        const r = rows.length + 1;
        const pagos = doc.pagos || [];
        const lastPago = r + pagos.length;

        rows.push([
            text(upper(doc.tercero), shade), text(doc.comprobante, shade), text(doc.serie_numero, shade), text(upper(doc.detalle), shade),
            money(doc.importe, shade), date(doc.fecha, shade), date(doc.vencimiento, shade),
            formula(`G${r}-F${r}`, shade, { format: '0' }),
            empty(shade), empty(shade),
            formula(pagos.length > 0 ? `E${r}+SUM(J${r + 1}:J${lastPago})` : `E${r}`, shade, { format: MONEDA }),
            text(doc.estado, shade, { fontWeight: 'bold' }),
            empty(shade), empty(shade), empty(shade)
        ]);

        pagos.forEach((pago) => {
            const pr = rows.length + 1;
            rows.push([
                empty(shade), empty(shade), empty(shade), empty(shade), empty(shade), empty(shade),
                date(pago.fecha, shade),
                formula(`G${pr}-F${r}`, shade, { format: '0' }),
                text(pago.medio, shade, { fontWeight: 'bold' }),
                money(-Math.abs(Number(pago.monto)), shade),
                empty(shade), empty(shade),
                text(pago.destino, shade, { fontWeight: 'bold' }), text(pago.operacion, shade), text(pago.comentario, shade)
            ]);
        });
    });

    const lastDataRow = Math.max(rows.length, firstDataRow);
    rows.push(blank());
    const total = { fontSize: 10, fontWeight: 'bold', backgroundColor: SHADE, topBorderStyle: 'thin', topBorderColor: '#6B7280' };
    const totals = Array.from({ length: COLS }, () => ({ type: String, value: null, ...total }));
    totals[0] = { type: String, value: 'TOTALES:', ...total, align: 'left', columnSpan: 4 };
    totals[1] = null; totals[2] = null; totals[3] = null;
    totals[4] = { type: 'Formula', value: `SUM(E${firstDataRow}:E${lastDataRow})`, format: MONEDA, align: 'right', ...total };
    totals[9] = { type: 'Formula', value: `SUM(J${firstDataRow}:J${lastDataRow})`, format: MONEDA, align: 'right', ...total };
    totals[10] = { type: 'Formula', value: `SUM(K${firstDataRow}:K${lastDataRow})`, format: MONEDA, align: 'right', ...total };
    rows.push(totals);

    return {
        sheet,
        data: rows,
        columns: [14, 16, 25, 22, 12, 16, 16, 8, 15, 12, 12, 12, 18, 23, 35].map((width) => ({ width })),
        stickyRowsCount: 5,
        showGridLines: false,
        orientation: 'landscape'
    };
};

const fileSede = (nombre) => String(nombre || 'Sede').normalize('NFD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_');
const fechaPago = (value) => toPeruYmd(new Date(value));

/** Facturas/boletas/notas de venta al credito con sus cobros (respuesta de /api/cuentas-por-cobrar/reporte). */
export const descargarCuentasPorCobrar = async ({ empresa, periodo, sedeNombre, facturas }) => {
    const documentos = facturas.map((f) => ({
        tercero: f.cliente_nombre,
        comprobante: COMPROBANTE[f.tipo_comprobante] || upper(f.tipo_comprobante),
        serie_numero: f.numero_comprobante,
        detalle: f.observacion || (f.mesa_numero ? `CONSUMO MESA ${f.mesa_numero}` : 'VENTA'),
        importe: f.total_vigente,
        fecha: f.fecha,
        vencimiento: f.fecha_vencimiento,
        estado: ESTADO[f.estado_cobro] || upper(f.estado_cobro),
        pagos: (f.cobros || []).map((c) => ({
            fecha: fechaPago(c.fecha),
            medio: MEDIO[c.metodo_pago] || upper(c.metodo_pago),
            monto: c.monto,
            destino: c.metodo_pago === 'efectivo' ? 'CAJA' : null,
            operacion: c.referencia,
            comentario: null
        }))
    }));
    await writeXlsxFile([buildSheet({
        sheet: 'CTAS POR COBRAR', titulo: 'CONTROL CUENTAS POR COBRAR', empresa, periodo, terceroLabel: 'Cliente', destinoLabel: 'Destino', documentos
    })]).toFile(`Cuentas_por_cobrar_${fileSede(sedeNombre)}_${periodo.desde}_a_${periodo.hasta}.xlsx`);
};

/** Gastos al credito con sus pagos (respuesta de /api/gastos/por-pagar/reporte). */
export const descargarCuentasPorPagar = async ({ empresa, periodo, sedeNombre, gastos }) => {
    const documentos = gastos.map((g) => ({
        tercero: g.beneficiario,
        comprobante: COMPROBANTE[g.tipo_documento] || upper(g.tipo_documento),
        serie_numero: [g.serie, g.numero].filter(Boolean).join('-') || g.codigo,
        detalle: g.descripcion,
        importe: g.importe,
        fecha: g.fecha,
        vencimiento: g.fecha_vencimiento,
        estado: ESTADO[g.estado_pago] || upper(g.estado_pago),
        pagos: (g.pagos || []).map((p) => ({
            fecha: fechaPago(p.fecha),
            medio: MEDIO[p.metodo_pago] || upper(p.metodo_pago),
            monto: p.monto,
            destino: p.metodo_pago === 'efectivo' ? (p.caja_descripcion ? `CAJA ${p.caja_descripcion}` : 'CAJA') : null,
            operacion: p.referencia,
            comentario: p.observacion
        }))
    }));
    await writeXlsxFile([buildSheet({
        sheet: 'CTAS POR PAGAR', titulo: 'CONTROL CUENTAS POR PAGAR', empresa, periodo, terceroLabel: 'Proveedor', destinoLabel: 'Procedencia', documentos
    })]).toFile(`Cuentas_por_pagar_${fileSede(sedeNombre)}_${periodo.desde}_a_${periodo.hasta}.xlsx`);
};
