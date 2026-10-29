import writeXlsxFile from 'write-excel-file/browser';
import { toPeruYmd } from './dateTime';

const SOLES = '"S/ "#,##0.00';
const FECHA_HORA = 'dd/mm/yyyy hh:mm';
const HEADER = { fontWeight: 'bold', backgroundColor: '#F3F4F6' };

const ETAPA = { solicitado: 'Solicitado', enviado: 'Enviado', facturado: 'Facturado', entregado: 'Entregado', rechazado: 'Rechazado' };
const COMPROBANTE = { boleta: 'Boleta', factura: 'Factura', nota_venta: 'Nota de venta' };

const text = (value) => (value === null || value === undefined || value === '' ? null : String(value));
const header = (label) => ({ value: label, ...HEADER });
const cellText = (value) => ({ type: String, value: text(value) });
const cellInt = (value) => ({ type: Number, value: value === null || value === undefined ? null : Number(value) });
const cellSoles = (value) => ({ type: Number, value: Number(value) || 0, format: SOLES });
const cellFecha = (value) => ({ type: Date, value: value ? new Date(value) : null, format: FECHA_HORA });

const sheet = (name, columns, rows) => ({
    sheet: name,
    data: [columns.map((c) => header(c.label)), ...rows.map((row) => columns.map((c) => c.cell(row)))],
    columns: columns.map((c) => ({ width: c.width })),
    stickyRowsCount: 1
});

const PEDIDO_COLUMNS = [
    { label: 'N° pedido', width: 10, cell: (p) => cellInt(p.pedido_id) },
    { label: 'Solicitado', width: 17, cell: (p) => cellFecha(p.fecha_solicitado) },
    { label: 'Cliente', width: 28, cell: (p) => cellText(p.cliente_nombre) },
    { label: 'Teléfono', width: 14, cell: (p) => cellText(p.telefono) },
    { label: 'Dirección', width: 38, cell: (p) => cellText(p.direccion) },
    { label: 'Referencia', width: 26, cell: (p) => cellText(p.referencia) },
    { label: 'Observación', width: 28, cell: (p) => cellText(p.observacion) },
    { label: 'Productos', width: 10, cell: (p) => cellInt(p.lineas) },
    { label: 'Total', width: 14, cell: (p) => cellSoles(p.total) },
    { label: 'Estado', width: 12, cell: (p) => cellText(ETAPA[p.estado] || p.estado) },
    { label: 'Repartidor', width: 20, cell: (p) => cellText(p.repartidor) },
    { label: 'Comprobante', width: 14, cell: (p) => cellText(p.factura_id ? (COMPROBANTE[p.tipo_comprobante] || p.tipo_comprobante) : null) },
    { label: 'Serie y número', width: 18, cell: (p) => cellText(p.factura_id ? p.numero_comprobante : null) },
    { label: 'Enviado', width: 17, cell: (p) => cellFecha(p.fecha_enviado) },
    { label: 'Facturado', width: 17, cell: (p) => cellFecha(p.fecha_facturado) },
    { label: 'Entregado', width: 17, cell: (p) => cellFecha(p.fecha_entregado) },
    { label: 'Rechazado', width: 17, cell: (p) => cellFecha(p.fecha_rechazado) },
    { label: 'Motivo de rechazo', width: 30, cell: (p) => cellText(p.motivo_rechazo) },
    { label: 'Registrado por', width: 20, cell: (p) => cellText(p.usuario_nombre) }
];

const DETALLE_COLUMNS = [
    { label: 'N° pedido', width: 10, cell: (l) => cellInt(l.pedido_id) },
    { label: 'Cliente', width: 28, cell: (l) => cellText(l.cliente_nombre) },
    { label: 'Estado', width: 12, cell: (l) => cellText(ETAPA[l.estado] || l.estado) },
    { label: 'Producto', width: 36, cell: (l) => cellText(l.producto_nombre) },
    { label: 'Cantidad', width: 10, cell: (l) => cellInt(l.cantidad) },
    { label: 'P. unitario', width: 14, cell: (l) => cellSoles(l.precio_unitario) },
    { label: 'Subtotal', width: 14, cell: (l) => cellSoles(l.subtotal) },
    { label: 'Notas', width: 28, cell: (l) => cellText(l.notas) }
];

const resumenSheet = ({ periodo, sedeNombre, pedidos }) => {
    const title = (label) => [{ value: label, fontWeight: 'bold', backgroundColor: '#FDE7D6' }, { value: '' }, { value: '' }];
    const validos = pedidos.filter((p) => p.estado !== 'rechazado');
    const monto = (lista) => lista.reduce((acc, p) => acc + (Number(p.total) || 0), 0);
    const filaEtapa = (estado) => {
        const lista = pedidos.filter((p) => p.estado === estado);
        return [cellText(ETAPA[estado]), cellInt(lista.length), cellSoles(monto(lista))];
    };
    const data = [
        title('REPORTE DE PEDIDOS DELIVERY'),
        [cellText('Periodo'), cellText(`${periodo.desde} al ${periodo.hasta}`)],
        [cellText('Sede'), cellText(sedeNombre)],
        [cellText('Generado'), cellText(new Date().toLocaleString('es-PE', { timeZone: 'America/Lima' }))],
        [{ value: '' }],
        [header('Etapa'), header('Pedidos'), header('Monto')],
        ...['solicitado', 'enviado', 'facturado', 'entregado', 'rechazado'].map(filaEtapa),
        [{ value: '', fontWeight: 'bold' }],
        [{ value: 'Total sin rechazados', fontWeight: 'bold' }, { type: Number, value: validos.length, fontWeight: 'bold' }, { type: Number, value: monto(validos), format: SOLES, fontWeight: 'bold' }],
        [cellText('Facturados (con comprobante)'), cellInt(pedidos.filter((p) => p.factura_id && p.factura_estado !== 'anulado').length), cellSoles(monto(pedidos.filter((p) => p.factura_id && p.factura_estado !== 'anulado')))]
    ];
    return { sheet: 'Resumen', data, columns: [{ width: 34 }, { width: 26 }, { width: 16 }] };
};

/** Descarga un .xlsx con los pedidos delivery del periodo: hojas Resumen, Pedidos y Detalle de productos. */
export const descargarReporteDelivery = async ({ periodo, sedeNombre, pedidos }) => {
    const lineas = pedidos.flatMap((p) => (p.detalles || []).map((d) => ({ ...d, pedido_id: p.pedido_id, cliente_nombre: p.cliente_nombre, estado: p.estado })));
    const sede = String(sedeNombre || 'Sede').normalize('NFD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_');
    await writeXlsxFile([
        resumenSheet({ periodo, sedeNombre, pedidos }),
        sheet('Pedidos', PEDIDO_COLUMNS, pedidos),
        sheet('Detalle', DETALLE_COLUMNS, lineas)
    ]).toFile(`Pedidos_delivery_${sede}_${periodo.desde}_a_${periodo.hasta}_${toPeruYmd()}.xlsx`);
};
