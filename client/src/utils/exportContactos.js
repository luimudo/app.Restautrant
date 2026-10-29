import writeXlsxFile from 'write-excel-file/browser';

const HEADER = { fontWeight: 'bold', backgroundColor: '#F3F4F6' };

const text = (value) => (value === null || value === undefined || value === '' ? null : String(value));
const header = (label) => ({ value: label, ...HEADER });
const cellText = (value) => ({ type: String, value: text(value) });
const cellInt = (value) => ({ type: Number, value: Number.isFinite(Number(value)) ? Number(value) : null });

const sheet = (name, columns, rows) => ({
    sheet: name,
    data: [columns.map((c) => header(c.label)), ...rows.map((row) => columns.map((c) => c.cell(row)))],
    columns: columns.map((c) => ({ width: c.width })),
    stickyRowsCount: 1
});

const PROVEEDOR_COLUMNS = [
    { label: 'N°', width: 8, cell: (r) => cellInt(r.id) },
    { label: 'Razón social', width: 36, cell: (r) => cellText(r.razon_social) },
    { label: 'RUC', width: 15, cell: (r) => cellText(r.ruc) },
    { label: 'Contacto', width: 26, cell: (r) => cellText(r.contacto) },
    { label: 'Teléfono', width: 16, cell: (r) => cellText(r.telefono) },
    { label: 'Dirección', width: 38, cell: (r) => cellText(r.direccion) },
    { label: 'N° de cuenta', width: 24, cell: (r) => cellText(r.nro_cuenta) },
    { label: 'Observaciones', width: 40, cell: (r) => cellText(r.observaciones) }
];

const CLIENTE_COLUMNS = [
    { label: 'N°', width: 8, cell: (r) => cellInt(r.id) },
    { label: 'Nombre / razón social', width: 36, cell: (r) => cellText(r.nombre) },
    { label: 'Tipo de documento', width: 18, cell: (r) => cellText(r.tipo_documento) },
    { label: 'N° de documento', width: 18, cell: (r) => cellText(r.documento) },
    { label: 'Teléfono', width: 16, cell: (r) => cellText(r.telefono) },
    { label: 'Email', width: 32, cell: (r) => cellText(r.email) },
    { label: 'Dirección', width: 38, cell: (r) => cellText(r.direccion) }
];

const fecha = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });

/** Descarga un .xlsx con la lista de proveedores recibida (la que se ve en pantalla). */
export const descargarProveedores = async (rows) => {
    await writeXlsxFile([sheet('Proveedores', PROVEEDOR_COLUMNS, rows)]).toFile(`Proveedores_${fecha()}.xlsx`);
};

/** Descarga un .xlsx con la lista de clientes recibida (la que se ve en pantalla). */
export const descargarClientes = async (rows) => {
    await writeXlsxFile([sheet('Clientes', CLIENTE_COLUMNS, rows)]).toFile(`Clientes_${fecha()}.xlsx`);
};
