import writeXlsxFile from 'write-excel-file/browser';
import { toPeruYmd } from './dateTime';

const SOLES = '"S/ "#,##0.00';
const HEADER = { fontWeight: 'bold', backgroundColor: '#F3F4F6' };

const CATEGORIAS = {
    coccion: 'Cocción', refrigeracion: 'Refrigeración', preparacion: 'Preparación', lavado: 'Lavado',
    bar_cafeteria: 'Bar / Cafetería', ventilacion: 'Ventilación', electronica: 'Electrónica / POS', mobiliario: 'Mobiliario', otro: 'Otro'
};
const AREAS = { cocina: 'Cocina', bar: 'Bar', salon: 'Salón', almacen: 'Almacén', caja: 'Caja', otro: 'Otro' };
const ESTADO_EQUIPO = { operativo: 'Operativo', en_mantenimiento: 'En mantenimiento', averiado: 'Averiado', baja: 'De baja' };
const ESTADO_MANT = { programado: 'Programado', en_ejecucion: 'En ejecución', ejecutado: 'Ejecutado', anulado: 'Anulado' };
const TIPO_MANT = { preventivo: 'Preventivo', correctivo: 'Correctivo' };
const PRIORIDAD = { alta: 'Alta', media: 'Media', baja: 'Baja' };

const text = (value) => (value === null || value === undefined || value === '' ? null : String(value));
const cellText = (value) => ({ type: String, value: text(value) });
const cellSoles = (value) => ({ type: Number, value: value === null || value === undefined || value === '' ? null : Number(value), format: SOLES });
const cellFecha = (ymd) => ({ type: Date, value: ymd ? new Date(`${String(ymd).slice(0, 10)}T00:00:00`) : null, format: 'dd/mm/yyyy' });
const siNo = (value) => (Number(value) ? 'Sí' : 'No');

const sheet = (name, columns, rows) => ({
    sheet: name,
    data: [columns.map((c) => ({ value: c.label, ...HEADER })), ...rows.map((row) => columns.map((c) => c.cell(row)))],
    columns: columns.map((c) => ({ width: c.width })),
    stickyRowsCount: 1
});

const nombreArchivo = (prefijo, sedeNombre, sufijo = '') => {
    const sede = String(sedeNombre || 'Sede').normalize('NFD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_');
    return `${prefijo}_${sede}${sufijo ? `_${sufijo}` : ''}_${toPeruYmd()}.xlsx`;
};

const EQUIPO_COLUMNS = [
    { label: 'Código', width: 12, cell: (e) => cellText(e.codigo) },
    { label: 'Equipo', width: 34, cell: (e) => cellText(e.nombre) },
    { label: 'Sede', width: 20, cell: (e) => cellText(e.sede_nombre) },
    { label: 'Área', width: 12, cell: (e) => cellText(AREAS[e.area] || e.area) },
    { label: 'Categoría', width: 18, cell: (e) => cellText(CATEGORIAS[e.categoria] || e.categoria) },
    { label: 'Almacén', width: 22, cell: (e) => cellText(e.almacen_nombre) },
    { label: 'Marca', width: 16, cell: (e) => cellText(e.marca) },
    { label: 'Modelo', width: 16, cell: (e) => cellText(e.modelo) },
    { label: 'Serie', width: 18, cell: (e) => cellText(e.serie) },
    { label: 'Proveedor', width: 26, cell: (e) => cellText(e.proveedor_nombre) },
    { label: 'Fecha de compra', width: 15, cell: (e) => cellFecha(e.fecha_compra) },
    { label: 'Costo de compra', width: 15, cell: (e) => cellSoles(e.costo_compra) },
    { label: 'Garantía hasta', width: 14, cell: (e) => cellFecha(e.garantia_hasta) },
    { label: 'En garantía', width: 12, cell: (e) => cellText(siNo(e.en_garantia)) },
    { label: 'Próximo mantenimiento', width: 20, cell: (e) => cellFecha(e.proximo_mantenimiento) },
    { label: 'Mant. pendientes', width: 15, cell: (e) => ({ type: Number, value: Number(e.mantenimientos_pendientes) || 0 }) },
    { label: 'Costo de mantenimiento', width: 20, cell: (e) => cellSoles(e.costo_mantenimiento) },
    { label: 'Estado', width: 18, cell: (e) => cellText(ESTADO_EQUIPO[e.estado] || e.estado) },
    { label: 'Observación', width: 36, cell: (e) => cellText(e.observacion) },
    { label: 'Motivo de baja', width: 30, cell: (e) => cellText(e.motivo_baja) }
];

const MANTENIMIENTO_COLUMNS = [
    { label: 'Código', width: 12, cell: (m) => cellText(m.codigo) },
    { label: 'Fecha programada', width: 16, cell: (m) => cellFecha(m.fecha_programada) },
    { label: 'Fecha de ejecución', width: 17, cell: (m) => cellFecha(m.fecha_ejecucion) },
    { label: 'Vencido', width: 10, cell: (m) => cellText(siNo(m.vencido)) },
    { label: 'Sede', width: 20, cell: (m) => cellText(m.sede_nombre) },
    { label: 'Equipo', width: 32, cell: (m) => cellText(m.equipo_nombre) },
    { label: 'Código equipo', width: 14, cell: (m) => cellText(m.equipo_codigo) },
    { label: 'Área', width: 12, cell: (m) => cellText(AREAS[m.equipo_area] || m.equipo_area) },
    { label: 'Tipo', width: 12, cell: (m) => cellText(TIPO_MANT[m.tipo] || m.tipo) },
    { label: 'Prioridad', width: 11, cell: (m) => cellText(m.tipo === 'correctivo' ? (PRIORIDAD[m.prioridad] || m.prioridad) : null) },
    { label: 'Descripción', width: 40, cell: (m) => cellText(m.descripcion) },
    { label: 'Trabajo realizado', width: 40, cell: (m) => cellText(m.trabajo_realizado) },
    { label: 'Técnico', width: 20, cell: (m) => cellText(m.tecnico) },
    { label: 'Reportado por', width: 20, cell: (m) => cellText(m.reportado_por_nombre) },
    { label: 'Costo material', width: 14, cell: (m) => cellSoles(m.estado === 'ejecutado' ? m.costo_material : null) },
    { label: 'Costo servicio', width: 14, cell: (m) => cellSoles(m.estado === 'ejecutado' ? m.costo_servicio : null) },
    { label: 'Costo total', width: 13, cell: (m) => cellSoles(m.estado === 'ejecutado' ? m.costo_total : null) },
    { label: 'Gasto', width: 12, cell: (m) => cellText(m.gasto_codigo) },
    { label: 'Estado', width: 14, cell: (m) => cellText(ESTADO_MANT[m.estado] || m.estado) },
    { label: 'Motivo de anulación', width: 30, cell: (m) => cellText(m.motivo_anulacion) }
];

/** Inventario de equipos con los filtros aplicados. */
export const descargarInventarioEquipos = async ({ sedeNombre, equipos }) => {
    await writeXlsxFile([sheet('Equipos', EQUIPO_COLUMNS, equipos)]).toFile(nombreArchivo('Equipos', sedeNombre));
};

/** Mantenimientos programados o en ejecución. */
export const descargarMantenimientosPendientes = async ({ sedeNombre, mantenimientos }) => {
    await writeXlsxFile([sheet('Pendientes', MANTENIMIENTO_COLUMNS, mantenimientos)]).toFile(nombreArchivo('Mantenimientos_pendientes', sedeNombre));
};

/** Historial de mantenimientos del periodo. */
export const descargarHistorialMantenimientos = async ({ sedeNombre, periodo, mantenimientos }) => {
    await writeXlsxFile([sheet('Historial', MANTENIMIENTO_COLUMNS, mantenimientos)])
        .toFile(nombreArchivo('Historial_mantenimientos', sedeNombre, `${periodo.desde}_a_${periodo.hasta}`));
};
