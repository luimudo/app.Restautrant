import writeXlsxFile from 'write-excel-file/browser';

const ESTADO = { pendiente: 'Pendiente', confirmada: 'Confirmada', cancelada: 'Cancelada' };
const TIPO = { consumo: 'Por consumo', evento: 'Por evento' };

const FECHA = 'dd/mm/yyyy';
const HEADER = { fontWeight: 'bold', backgroundColor: '#F3F4F6' };

const ymdToDate = (ymd) => (ymd ? new Date(`${String(ymd).slice(0, 10)}T00:00:00Z`) : null);
const text = (value) => (value === null || value === undefined || value === '' ? null : String(value));

const header = (label) => ({ value: label, ...HEADER });
const cellText = (value) => ({ type: String, value: text(value) });
const cellInt = (value) => ({ type: Number, value: value === null || value === undefined ? null : Number(value) });
const cellDate = (ymd) => ({ type: Date, value: ymdToDate(ymd), format: FECHA });
const cellDateTime = (value) => ({ type: Date, value: value ? new Date(value) : null, format: 'dd/mm/yyyy hh:mm' });

const COLUMNS = [
    { label: 'N° reserva', width: 11, cell: (r) => cellInt(r.id) },
    { label: 'Fecha', width: 12, cell: (r) => cellDate(r.fecha) },
    { label: 'Hora', width: 8, cell: (r) => cellText(r.hora) },
    { label: 'Sede', width: 18, cell: (r) => cellText(r.sede_nombre) },
    { label: 'Cliente', width: 30, cell: (r) => cellText(r.nombre_completo) },
    { label: 'DNI', width: 12, cell: (r) => cellText(r.dni) },
    { label: 'Tipo', width: 14, cell: (r) => cellText(TIPO[r.tipo] || r.tipo) },
    { label: 'Personas', width: 10, cell: (r) => cellInt(r.numero_personas) },
    { label: 'Estado', width: 12, cell: (r) => cellText(ESTADO[r.estado] || r.estado) },
    { label: 'Comentario', width: 40, cell: (r) => cellText(r.comentario) },
    { label: 'Registrada por', width: 20, cell: (r) => cellText(r.usuario_registro_nombre) },
    { label: 'Fecha de registro', width: 17, cell: (r) => cellDateTime(r.creado_en) },
    { label: 'Confirmada por', width: 20, cell: (r) => cellText(r.usuario_confirmacion_nombre) },
    { label: 'Fecha de confirmación', width: 20, cell: (r) => cellDateTime(r.fecha_confirmacion) },
    { label: 'Motivo de cancelación', width: 36, cell: (r) => cellText(r.motivo_cancelacion) },
    { label: 'Cancelada por', width: 20, cell: (r) => cellText(r.usuario_cancelacion_nombre) },
    { label: 'Fecha de cancelación', width: 20, cell: (r) => cellDateTime(r.fecha_cancelacion) }
];

const resumenSheet = ({ periodo, sedeNombre, estado, reservas, resumen }) => {
    const title = (label) => [{ value: label, fontWeight: 'bold', backgroundColor: '#FDE7D6' }, { value: '' }];
    const line = (label, value) => [cellText(label), typeof value === 'number' ? cellInt(value) : cellText(value)];
    const porTipo = (tipo, campo) => reservas
        .filter((r) => r.estado !== 'cancelada' && r.tipo === tipo)
        .reduce((acc, r) => acc + (campo === 'personas' ? Number(r.numero_personas) || 0 : 1), 0);

    const data = [
        title('REPORTE DE RESERVAS'),
        line('Periodo', `${periodo.desde} al ${periodo.hasta}`),
        line('Sede', sedeNombre),
        line('Estado filtrado', estado === 'todos' ? 'Todos' : ESTADO[estado]),
        line('Generado', new Date().toLocaleString('es-PE', { timeZone: 'America/Lima' })),
        [{ value: '' }],
        title('TOTALES'),
        line('Reservas', resumen.total),
        line('Pendientes', resumen.pendiente),
        line('Confirmadas', resumen.confirmada),
        line('Canceladas', resumen.cancelada),
        line('Personas confirmadas', resumen.personas_confirmadas),
        [{ value: '' }],
        title('RESERVAS ACTIVAS (sin canceladas)'),
        line('Por consumo (reservas)', porTipo('consumo', 'reservas')),
        line('Por consumo (personas)', porTipo('consumo', 'personas')),
        line('Por evento (reservas)', porTipo('evento', 'reservas')),
        line('Por evento (personas)', porTipo('evento', 'personas'))
    ];
    return { sheet: 'Resumen', data, columns: [{ width: 34 }, { width: 28 }] };
};

/** Genera y descarga un .xlsx con las hojas Resumen y Reservas. */
export const descargarReporteReservas = async ({ periodo, sedeNombre, estado, reservas, resumen }) => {
    const sheets = [
        resumenSheet({ periodo, sedeNombre, estado, reservas, resumen }),
        {
            sheet: 'Reservas',
            data: [COLUMNS.map((c) => header(c.label)), ...reservas.map((r) => COLUMNS.map((c) => c.cell(r)))],
            columns: COLUMNS.map((c) => ({ width: c.width })),
            stickyRowsCount: 1
        }
    ];
    const sede = String(sedeNombre).normalize('NFD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_');
    await writeXlsxFile(sheets).toFile(`Reservas_${sede}_${periodo.desde}_a_${periodo.hasta}.xlsx`);
};
