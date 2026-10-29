import writeXlsxFile from 'write-excel-file/browser';

const MONEDA = '#,##0.00';
const HEADER = { fontWeight: 'bold', backgroundColor: '#F3F4F6' };
const ESTADO = { recibido: 'Recibido', pendiente: 'Pendiente' };

const text = (value) => (value === null || value === undefined || value === '' ? null : String(value));
const num = (value) => (value === null || value === undefined || value === '' || Number.isNaN(Number(value)) ? null : Number(value));
const round2 = (value) => Math.round(value * 100) / 100;

const header = (label) => ({ value: label, ...HEADER });
const cellText = (value) => ({ type: String, value: text(value) });
const cellNum = (value) => ({ type: Number, value: num(value), format: MONEDA });
const cellInt = (value) => ({ type: Number, value: num(value) });
const cellDateTime = (value) => ({ type: Date, value: value ? new Date(value) : null, format: 'dd/mm/yyyy hh:mm' });

const sheet = (name, columns, rows) => ({
    sheet: name,
    data: [columns.map((c) => header(c.label)), ...rows.map((row) => columns.map((c) => c.cell(row)))],
    columns: columns.map((c) => ({ width: c.width })),
    stickyRowsCount: 1
});

const DETALLE_COLUMNS = [
    { label: 'N° compra', width: 10, cell: (r) => cellInt(r.compra_id) },
    { label: 'Fecha', width: 17, cell: (r) => cellDateTime(r.fecha_compra) },
    { label: 'N° factura / boleta', width: 20, cell: (r) => cellText(r.numero_factura_proveedor) },
    { label: 'Proveedor', width: 30, cell: (r) => cellText(r.proveedor) },
    { label: 'RUC', width: 14, cell: (r) => cellText(r.proveedor_ruc) },
    { label: 'Tipo', width: 14, cell: (r) => cellText(r.tipo) },
    { label: 'Item', width: 34, cell: (r) => cellText(r.item) },
    { label: 'Unidad', width: 12, cell: (r) => cellText(r.unidad_medida) },
    { label: 'Cantidad', width: 12, cell: (r) => cellNum(r.cantidad) },
    { label: 'P. unitario', width: 14, cell: (r) => cellNum(r.precio_unitario) },
    { label: 'Subtotal', width: 14, cell: (r) => cellNum(r.subtotal) },
    { label: 'Estado', width: 12, cell: (r) => cellText(ESTADO[r.estado] || r.estado) }
];

const group = (rows, keyFn) => {
    const map = new Map();
    rows.forEach((r) => map.set(keyFn(r), (map.get(keyFn(r)) || 0) + Number(r.subtotal || 0)));
    return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, round2(v)]);
};

const resumenSheet = ({ periodo, sedeNombre, rows }) => {
    const title = (label) => [{ value: label, fontWeight: 'bold', backgroundColor: '#FDE7D6' }, { value: '' }];
    const line = (label, cell) => [cellText(label), cell];
    const compras = new Map(rows.map((r) => [r.compra_id, Number(r.total_compra || 0)]));
    const totalGeneral = round2([...compras.values()].reduce((acc, v) => acc + v, 0));

    const data = [
        title('REPORTE DE COMPRAS'),
        line('Periodo', cellText(`${periodo.desde} al ${periodo.hasta}`)),
        line('Sede', cellText(sedeNombre)),
        line('Generado', cellText(new Date().toLocaleString('es-PE', { timeZone: 'America/Lima' }))),
        [{ value: '' }],
        title('TOTALES'),
        line('Compras registradas', cellInt(compras.size)),
        line('Items comprados', cellInt(rows.filter((r) => r.item).length)),
        line('Monto total comprado', cellNum(totalGeneral)),
        [{ value: '' }],
        title('MONTO POR PROVEEDOR'),
        ...group(rows, (r) => r.proveedor || 'Sin proveedor').map(([k, v]) => line(k, cellNum(v))),
        [{ value: '' }],
        title('MONTO POR TIPO'),
        ...group(rows, (r) => r.tipo).map(([k, v]) => line(k, cellNum(v)))
    ];
    return { sheet: 'Resumen', data, columns: [{ width: 34 }, { width: 28 }] };
};

/** Genera y descarga un .xlsx con las hojas Resumen y Detalle de compras. */
export const descargarReporteCompras = async ({ periodo, sedeNombre, rows }) => {
    const sede = String(sedeNombre).normalize('NFD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_');
    await writeXlsxFile([
        resumenSheet({ periodo, sedeNombre, rows }),
        sheet('Detalle', DETALLE_COLUMNS, rows)
    ]).toFile(`Compras_${sede}_${periodo.desde}_a_${periodo.hasta}.xlsx`);
};
