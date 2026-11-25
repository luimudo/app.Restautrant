import writeXlsxFile from 'write-excel-file/browser';
import { toPeruYmd } from './dateTime';

// Excel de cada seccion del modulo Personal, con las mismas columnas que la grilla de la pantalla.
const SOLES = '"S/ "#,##0.00';
const HEADER = { fontWeight: 'bold', backgroundColor: '#F3F4F6' };

export const VINCULO_LABEL = { planilla: 'Planilla', honorarios: 'Honorarios', locacion: 'Locación de servicios', practicante: 'Practicante' };
export const ESTADO_LABEL = { activo: 'Activo', vacaciones: 'Vacaciones', suspendido: 'Suspendido', cesado: 'Cesado' };
export const ESTADO_ELEMENTO_LABEL = { nuevo: 'Nuevo', bueno: 'Bueno', regular: 'Regular', danado: 'Dañado' };

const t = (v) => ({ type: String, value: v === null || v === undefined || v === '' ? null : String(v) });
const n = (v, format) => ({ type: Number, value: v === null || v === undefined || v === '' ? null : Number(v), ...(format ? { format } : {}) });
const s = (v) => n(v, SOLES);
const f = (ymd) => ({ type: Date, value: ymd ? new Date(`${String(ymd).slice(0, 10)}T00:00:00`) : null, format: 'dd/mm/yyyy' });

const descargar = async (prefijo, sedeNombre, columnas, filas, sufijo = '') => {
    const sede = String(sedeNombre || 'Sede').normalize('NFD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_');
    // write-excel-file 4.x: el archivo se descarga con .toFile() (la opcion fileName ya no existe).
    await writeXlsxFile([columnas.map((c) => ({ value: c.label, ...HEADER })), ...filas.map((row) => columnas.map((c) => c.cell(row)))], {
        columns: columnas.map((c) => ({ width: c.width })),
        stickyRowsCount: 1
    }).toFile(`${prefijo}_${sede}${sufijo ? `_${sufijo}` : ''}_${toPeruYmd()}.xlsx`);
};

export const exportarTrabajadores = (sede, filas, conRemuneracion) => descargar('Personal_trabajadores', sede, [
    { label: 'DNI', width: 11, cell: (r) => t(r.dni) },
    { label: 'Código', width: 10, cell: (r) => t(r.codigo) },
    { label: 'Apellidos', width: 24, cell: (r) => t(r.apellidos) },
    { label: 'Nombres', width: 22, cell: (r) => t(r.nombres) },
    { label: 'Cargo', width: 18, cell: (r) => t(r.cargo) },
    { label: 'Área', width: 14, cell: (r) => t(r.area) },
    { label: 'Turno', width: 10, cell: (r) => t(r.turno) },
    { label: 'Vínculo', width: 16, cell: (r) => t(VINCULO_LABEL[r.vinculo] || r.vinculo) },
    { label: 'Funciones', width: 40, cell: (r) => t(r.funciones) },
    { label: 'Ingreso', width: 12, cell: (r) => f(r.fecha_ingreso) },
    { label: 'Cese', width: 12, cell: (r) => f(r.fecha_cese) },
    { label: 'Nacimiento', width: 12, cell: (r) => f(r.fecha_nacimiento) },
    ...(conRemuneracion ? [{ label: 'Remuneración', width: 14, cell: (r) => s(r.remuneracion) }] : []),
    { label: 'Sistema de pensión', width: 18, cell: (r) => t(r.sistema_pension) },
    { label: 'CUSPP', width: 14, cell: (r) => t(r.cuspp) },
    { label: 'RUC', width: 13, cell: (r) => t(r.ruc) },
    { label: 'Teléfono', width: 13, cell: (r) => t(r.telefono) },
    { label: 'Correo', width: 24, cell: (r) => t(r.email) },
    { label: 'Dirección', width: 30, cell: (r) => t(r.direccion) },
    { label: 'Contacto de emergencia', width: 24, cell: (r) => t([r.contacto_emergencia, r.telefono_emergencia].filter(Boolean).join(' · ')) },
    { label: 'Usuario del sistema', width: 18, cell: (r) => t(r.usuario_nombre) },
    { label: 'Documentos', width: 11, cell: (r) => n(r.adjuntos) },
    { label: 'Estado', width: 11, cell: (r) => t(ESTADO_LABEL[r.estado] || r.estado) }
], filas);

export const exportarEntregas = (sede, filas) => descargar('Personal_uniforme_EPP', sede, [
    { label: 'Fecha', width: 12, cell: (r) => f(r.fecha) },
    { label: 'DNI', width: 11, cell: (r) => t(r.dni) },
    { label: 'Trabajador', width: 28, cell: (r) => t(r.trabajador) },
    { label: 'Área', width: 14, cell: (r) => t(r.area) },
    { label: 'Tipo', width: 10, cell: (r) => t(r.elemento_tipo === 'uniforme' ? 'Uniforme' : 'EPP') },
    { label: 'Elemento', width: 26, cell: (r) => t(r.elemento_nombre) },
    { label: 'Cantidad', width: 10, cell: (r) => n(r.cantidad) },
    { label: 'Devuelta', width: 10, cell: (r) => n(r.devuelta) },
    { label: 'Fecha devolución', width: 15, cell: (r) => f(r.fecha_devolucion) },
    { label: 'Dada de baja', width: 12, cell: (r) => n(r.baja) },
    { label: 'Fecha baja', width: 12, cell: (r) => f(r.fecha_baja) },
    { label: 'Pendiente', width: 10, cell: (r) => n(r.pendiente) },
    { label: 'Talla', width: 8, cell: (r) => t(r.talla) },
    { label: 'Estado', width: 10, cell: (r) => t(ESTADO_ELEMENTO_LABEL[r.estado] || r.estado) },
    { label: 'Motivo', width: 26, cell: (r) => t(r.motivo) },
    { label: 'Próximo cambio', width: 14, cell: (r) => f(r.proximo_cambio) },
    { label: 'Costo unitario', width: 13, cell: (r) => s(r.costo_unitario) },
    { label: 'Costo total', width: 13, cell: (r) => s(r.costo_total) },
    { label: 'Anulada', width: 9, cell: (r) => t(Number(r.anulada) ? 'Sí' : 'No') },
    { label: 'Registró', width: 16, cell: (r) => t(r.usuario_nombre) }
], filas);

export const exportarControl = (sede, control) => descargar('Personal_control_CNC', sede, [
    { label: 'Fecha', width: 12, cell: () => f(control.fecha) },
    { label: 'Turno', width: 12, cell: () => t(control.turno) },
    { label: 'Área del control', width: 16, cell: () => t(control.area || 'Todas') },
    { label: 'DNI', width: 11, cell: (r) => t(r.dni) },
    { label: 'Trabajador', width: 28, cell: (r) => t(r.trabajador) },
    { label: 'Elemento', width: 26, cell: (r) => t(r.elemento_nombre) },
    { label: 'Resultado', width: 10, cell: (r) => t(r.resultado || 'Sin marcar') },
    { label: 'Observación', width: 36, cell: (r) => t(r.observacion) },
    { label: 'Repuesto', width: 10, cell: (r) => t(r.reposicion_id ? 'Sí' : '') }
], control.items || [], `${control.fecha}_${control.turno}`);

export const exportarControles = (sede, filas) => descargar('Personal_controles', sede, [
    { label: 'Fecha', width: 12, cell: (r) => f(r.fecha) },
    { label: 'Turno', width: 12, cell: (r) => t(r.turno) },
    { label: 'Área', width: 16, cell: (r) => t(r.area || 'Todas') },
    { label: 'Casillas', width: 10, cell: (r) => n(r.items) },
    { label: 'No conformes', width: 13, cell: (r) => n(r.no_conformes) },
    { label: 'Cumplimiento %', width: 15, cell: (r) => n(r.cumplimiento, '0.00') },
    { label: 'Estado', width: 10, cell: (r) => t(r.estado === 'cerrado' ? 'Cerrado' : 'Abierto') },
    { label: 'Registró', width: 16, cell: (r) => t(r.usuario_nombre) }
], filas);

export const exportarElementos = (sede, filas) => descargar('Personal_elementos_EPP', sede, [
    { label: 'Elemento', width: 28, cell: (r) => t(r.nombre) },
    { label: 'Tipo', width: 10, cell: (r) => t(r.tipo === 'uniforme' ? 'Uniforme' : 'EPP') },
    { label: 'Unidad', width: 8, cell: (r) => t(r.unidad) },
    { label: 'Cambio cada (meses)', width: 18, cell: (r) => n(r.frecuencia_meses) },
    { label: 'Costo unitario', width: 14, cell: (r) => s(r.costo_unitario) },
    { label: 'Área', width: 14, cell: (r) => t(r.area || 'Todas') },
    { label: 'Control diario', width: 13, cell: (r) => t(Number(r.control_diario) ? 'Sí' : 'No') },
    { label: 'Activo', width: 8, cell: (r) => t(Number(r.activo) ? 'Sí' : 'No') }
], filas);

// Costos: solo el valor de EPP y uniformes vigentes, por trabajador y por area (dos hojas).
export const exportarCostos = async (sede, data) => {
    const colsT = [
        { label: 'DNI', width: 11, cell: (r) => t(r.dni) },
        { label: 'Trabajador', width: 30, cell: (r) => t(r.trabajador) },
        { label: 'Área', width: 16, cell: (r) => t(r.area) },
        { label: 'Cargo', width: 18, cell: (r) => t(r.cargo) },
        { label: 'Estado', width: 11, cell: (r) => t(ESTADO_LABEL[r.estado] || r.estado) },
        { label: 'EPP', width: 12, cell: (r) => s(r.costo_epp) },
        { label: 'Uniformes', width: 12, cell: (r) => s(r.costo_uniforme) },
        { label: 'Total EPP y uniforme', width: 20, cell: (r) => s(r.costo_total) }
    ];
    const colsA = [
        { label: 'Área', width: 18, cell: (r) => t(r.area) },
        { label: 'Trabajadores', width: 13, cell: (r) => n(r.trabajadores) },
        { label: 'EPP', width: 12, cell: (r) => s(r.costo_epp) },
        { label: 'Uniformes', width: 12, cell: (r) => s(r.costo_uniforme) },
        { label: 'Total EPP y uniforme', width: 20, cell: (r) => s(r.costo_total) }
    ];
    const hoja = (nombre, cols, filas) => ({
        sheet: nombre,
        data: [cols.map((c) => ({ value: c.label, ...HEADER })), ...filas.map((row) => cols.map((c) => c.cell(row)))],
        columns: cols.map((c) => ({ width: c.width })),
        stickyRowsCount: 1
    });
    const sedeArchivo = String(sede || 'Sede').normalize('NFD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_');
    const periodo = [data.periodo?.desde, data.periodo?.hasta].filter(Boolean).join('_') || toPeruYmd();
    await writeXlsxFile([hoja('Por trabajador', colsT, data.trabajadores), hoja('Por área', colsA, data.areas)])
        .toFile(`Personal_costos_EPP_uniforme_${sedeArchivo}_${periodo}.xlsx`);
};

export const exportarCatalogo = (sede, nombre, filas, conHorario) => descargar(`Personal_${nombre}`, sede, [
    { label: 'Nombre', width: 26, cell: (r) => t(r.nombre) },
    { label: 'Descripción', width: 34, cell: (r) => t(r.descripcion) },
    ...(conHorario ? [
        { label: 'Hora inicio', width: 12, cell: (r) => t(r.hora_inicio) },
        { label: 'Hora fin', width: 12, cell: (r) => t(r.hora_fin) }
    ] : []),
    { label: 'Activo', width: 8, cell: (r) => t(Number(r.activo) ? 'Sí' : 'No') }
], filas);
