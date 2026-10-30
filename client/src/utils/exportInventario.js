import writeXlsxFile from 'write-excel-file/browser';
import { toPeruYmd } from './dateTime';

export const STOCK_BAJO = 5;

const MONEDA = '#,##0.00';
const HEADER = { fontWeight: 'bold', backgroundColor: '#F3F4F6' };

const text = (value) => (value === null || value === undefined || value === '' ? null : String(value));
const num = (value) => (value === null || value === undefined || value === '' || Number.isNaN(Number(value)) ? null : Number(value));
const round2 = (value) => Math.round(value * 100) / 100;

const header = (label) => ({ value: label, ...HEADER });
const cellText = (value) => ({ type: String, value: text(value) });
const cellNum = (value) => ({ type: Number, value: num(value), format: MONEDA });
const cellInt = (value) => ({ type: Number, value: num(value) });

const sheet = (name, columns, rows) => ({
    sheet: name,
    data: [columns.map((c) => header(c.label)), ...rows.map((row) => columns.map((c) => c.cell(row)))],
    columns: columns.map((c) => ({ width: c.width })),
    stickyRowsCount: 1
});

// Insumos y bebidas: costo registrado. Una bebida sin costo registrado se aproxima como 40% del precio de venta.
const insumoRow = (i) => {
    const stock = Number(i.stock_actual || 0);
    const costo = Number(i.costo_unitario || 0);
    return { nombre: i.nombre, categoria: i.categoria_nombre, unidad: i.unidad_medida || 'Unidad', stock, costo, valor: round2(stock * costo) };
};
const barraRow = (p) => {
    const stock = Number(p.stock || 0);
    const precio = Number(p.precio || 0);
    const registrado = Number(p.costo_unitario || 0);
    const costo = registrado > 0 ? registrado : round2(precio * 0.4);
    return { nombre: p.nombre, categoria: p.tipo_nombre, unidad: p.unidad_medida || 'Unidad', stock, precio, costo, origen: registrado > 0 ? 'Registrado' : 'Estimado (40%)', valor: round2(stock * costo) };
};

const INSUMO_COLUMNS = [
    { label: 'Insumo', width: 36, cell: (r) => cellText(r.nombre) },
    { label: 'Categoría', width: 20, cell: (r) => cellText(r.categoria || 'Sin categoría') },
    { label: 'Unidad', width: 14, cell: (r) => cellText(r.unidad) },
    { label: 'Stock actual', width: 14, cell: (r) => cellNum(r.stock) },
    { label: 'Costo unitario', width: 16, cell: (r) => cellNum(r.costo) },
    { label: 'Valor en stock', width: 16, cell: (r) => cellNum(r.valor) }
];

const BARRA_COLUMNS = [
    { label: 'Producto', width: 36, cell: (r) => cellText(r.nombre) },
    { label: 'Categoría', width: 20, cell: (r) => cellText(r.categoria || 'Sin categoría') },
    { label: 'Unidad', width: 14, cell: (r) => cellText(r.unidad) },
    { label: 'Stock actual', width: 14, cell: (r) => cellNum(r.stock) },
    { label: 'Precio de venta', width: 16, cell: (r) => cellNum(r.precio) },
    { label: 'Costo unitario', width: 16, cell: (r) => cellNum(r.costo) },
    { label: 'Origen del costo', width: 16, cell: (r) => cellText(r.origen) },
    { label: 'Valor en stock', width: 16, cell: (r) => cellNum(r.valor) }
];

const resumenSheet = (insumos, barra) => {
    const title = (label) => [{ value: label, fontWeight: 'bold', backgroundColor: '#FDE7D6' }, { value: '' }];
    const line = (label, cell) => [cellText(label), cell];
    const sum = (rows, key) => round2(rows.reduce((acc, r) => acc + r[key], 0));

    const data = [
        title('REPORTE DE INVENTARIO'),
        line('Generado', cellText(new Date().toLocaleString('es-PE', { timeZone: 'America/Lima' }))),
        [{ value: '' }],
        title('INSUMOS / COCINA'),
        line('Items', cellInt(insumos.length)),
        line('Valor total en stock', cellNum(sum(insumos, 'valor'))),
        [{ value: '' }],
        title('BARRA / BEBIDAS'),
        line('Items', cellInt(barra.length)),
        line('Valor aprox. en stock', cellNum(sum(barra, 'valor')))
    ];
    return { sheet: 'Resumen', data, columns: [{ width: 34 }, { width: 28 }] };
};

/** Genera y descarga un .xlsx con las hojas Resumen, Insumos y Barra. */
export const descargarReporteInventario = async ({ insumos, productosBar }) => {
    const byName = (a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es');
    const insumoRows = insumos.map(insumoRow).sort(byName);
    const barraRows = productosBar.map(barraRow).sort(byName);
    await writeXlsxFile([
        resumenSheet(insumoRows, barraRows),
        sheet('Insumos', INSUMO_COLUMNS, insumoRows),
        sheet('Barra', BARRA_COLUMNS, barraRows)
    ]).toFile(`Inventario_${toPeruYmd()}.xlsx`);
};

const TIPO_MOVIMIENTO = {
    ingreso_manual: 'ENTRADA', compra: 'COMPRA', egreso_manual: 'SALIDA', ajuste_manual: 'AJUSTE', venta: 'VENTA', anulacion_venta: 'ANULACIÓN DE VENTA',
    transferencia_salida: 'TRANSFERENCIA (SALIDA)', transferencia_entrada: 'TRANSFERENCIA (ENTRADA)', merma_transferencia: 'MERMA'
};
const ITEM_MOVIMIENTO = { insumo: 'Insumo', producto: 'Bebida / producto', equipo: 'Equipo' };
const cellOpcionalSoles = (value) => ({ type: Number, value: value === null || value === undefined ? null : Number(value), format: '"S/ "#,##0.00' });

const MOVIMIENTO_COLUMNS = [
    { label: 'Fecha', width: 17, cell: (m) => ({ type: Date, value: m.fecha ? new Date(m.fecha) : null, format: 'dd/mm/yyyy hh:mm' }) },
    { label: 'Tipo', width: 22, cell: (m) => cellText(TIPO_MOVIMIENTO[m.motivo] || m.motivo) },
    { label: 'Almacén', width: 22, cell: (m) => cellText(m.almacen_nombre) },
    { label: 'Sede', width: 18, cell: (m) => cellText(m.sede_nombre) },
    { label: 'Producto / insumo', width: 34, cell: (m) => cellText(m.item_nombre) },
    { label: 'Clase', width: 16, cell: (m) => cellText(ITEM_MOVIMIENTO[m.tipo_item] || m.tipo_item) },
    { label: 'Cantidad', width: 12, cell: (m) => ({ type: Number, value: Number(m.cantidad), format: '#,##0.###' }) },
    { label: 'Unidad', width: 12, cell: (m) => cellText(m.unidad) },
    { label: 'Costo unitario', width: 14, cell: (m) => cellOpcionalSoles(m.costo_unitario) },
    { label: 'Costo total', width: 14, cell: (m) => cellOpcionalSoles(m.costo_total) },
    { label: 'Referencia', width: 28, cell: (m) => cellText(m.referencia) },
    { label: 'Motivo / detalle', width: 36, cell: (m) => cellText(m.detalle) },
    { label: 'Operador', width: 20, cell: (m) => cellText(m.usuario_nombre || 'SISTEMA') }
];

/** Descarga el historial (kardex) de movimientos del periodo en un .xlsx. */
export const descargarMovimientos = async ({ periodo, sedeNombre, movimientos }) => {
    const sede = String(sedeNombre || 'Sede').normalize('NFD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_');
    await writeXlsxFile([sheet('Movimientos', MOVIMIENTO_COLUMNS, movimientos)])
        .toFile(`Movimientos_inventario_${sede}_${periodo.desde}_a_${periodo.hasta}.xlsx`);
};
