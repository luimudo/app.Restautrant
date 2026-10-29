import writeXlsxFile from 'write-excel-file/browser';
import { toPeruYmd } from './dateTime';

const SOLES = '"S/ "#,##0.00';
const HEADER = { fontWeight: 'bold', backgroundColor: '#F3F4F6' };

const text = (value) => (value === null || value === undefined || value === '' ? null : String(value));
const header = (label) => ({ value: label, ...HEADER });
const cellText = (value) => ({ type: String, value: text(value) });
const cellSoles = (value) => ({ type: Number, value: Number(value) || 0, format: SOLES });
const siNo = (value) => (Number(value) ? 'Sí' : 'No');

const COLUMNS = [
    { label: 'Categoría', width: 24, cell: (p) => cellText(p.tipo_nombre || 'Sin categoría') },
    { label: 'Plato / Producto', width: 36, cell: (p) => cellText(p.nombre) },
    { label: 'Descripción', width: 48, cell: (p) => cellText(p.descripcion) },
    { label: 'Precio (S/)', width: 14, cell: (p) => cellSoles(p.precio) },
    { label: 'Área', width: 12, cell: (p) => cellText(Number(p.es_barra) ? 'Barra' : 'Cocina') },
    { label: 'Control de stock', width: 14, cell: (p) => cellText(Number(p.es_receta) ? 'Sin stock' : 'Con stock') },
    { label: 'Disponible', width: 12, cell: (p) => cellText(siNo(p.disponible)) },
    { label: 'Stock', width: 10, cell: (p) => ({ type: Number, value: p.stock === undefined || p.stock === null ? null : Number(p.stock) }) }
];

const porCategoria = (productos) => {
    const map = new Map();
    productos.forEach((p) => {
        const key = p.tipo_nombre || 'Sin categoría';
        const item = map.get(key) || { cantidad: 0, suma: 0 };
        item.cantidad += 1;
        item.suma += Number(p.precio) || 0;
        map.set(key, item);
    });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'));
};

/** Genera y descarga la carta en .xlsx: hoja "Carta" (una fila por plato) y hoja "Resumen" por categoría. */
export const descargarCarta = async ({ sedeNombre, productos }) => {
    const ordenados = [...productos].sort((a, b) => (a.tipo_nombre || '').localeCompare(b.tipo_nombre || '', 'es') || a.nombre.localeCompare(b.nombre, 'es'));
    const title = (label) => [{ value: label, fontWeight: 'bold', backgroundColor: '#FDE7D6' }, { value: '' }, { value: '' }, { value: '' }];
    const resumen = [
        title('CARTA / MENÚ'),
        [cellText('Sede'), cellText(sedeNombre)],
        [cellText('Generado'), cellText(new Date().toLocaleString('es-PE', { timeZone: 'America/Lima' }))],
        [cellText('Moneda'), cellText('Soles (S/)')],
        [cellText('Total de platos'), { type: Number, value: ordenados.length }],
        [cellText('Disponibles'), { type: Number, value: ordenados.filter((p) => Number(p.disponible)).length }],
        [{ value: '' }],
        [header('Categoría'), header('Platos'), header('Precio promedio')],
        ...porCategoria(ordenados).map(([nombre, { cantidad, suma }]) => [cellText(nombre), { type: Number, value: cantidad }, cellSoles(suma / cantidad)])
    ];

    const sede = String(sedeNombre || 'Sede').normalize('NFD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_');
    await writeXlsxFile([
        {
            sheet: 'Carta',
            data: [COLUMNS.map((c) => header(c.label)), ...ordenados.map((p) => COLUMNS.map((c) => c.cell(p)))],
            columns: COLUMNS.map((c) => ({ width: c.width })),
            stickyRowsCount: 1
        },
        { sheet: 'Resumen', data: resumen, columns: [{ width: 28 }, { width: 28 }, { width: 18 }, { width: 4 }] }
    ]).toFile(`Carta_${sede}_${toPeruYmd()}.xlsx`);
};
