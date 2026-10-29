import writeXlsxFile from 'write-excel-file/browser';

/**
 * Reporte de ventas en el formato del modelo "Ventas · modelo Excel": una hoja "Reporte de ventas", primera fila congelada
 * con las 32 columnas en su orden, una fila por comprobante. Las filas llegan armadas desde el servidor
 * (GET /api/reportes/ventas/excel): aquí solo se escriben con su tipo (texto o número).
 */

const COLUMNAS_NUMERICAS = new Set([11, 23, 24, 25, 26, 27, 28, 30]); // # Correlativo, Monto deuda ... Total, Descuento Global
const COLUMNAS_MONEDA = new Set([23, 24, 25, 26, 27, 28, 30]);

// Widths of the model where it defines them (A, X, AD, AE, AF); the rest are sized to read the content.
const ANCHOS = [25, 22, 18, 26, 32, 14, 12, 24, 30, 13, 8, 13, 16, 12, 10, 16, 20, 13, 11, 18, 11, 16, 24, 18, 11, 14, 11, 10, 11, 25, 18, 25];

export const descargarReporteVentasExcel = async ({ periodo, columnas, filas }) => {
    const encabezado = columnas.map((label) => ({ type: String, value: label, fontWeight: 'bold' }));
    const datos = filas.map((fila) => fila.map((valor, i) => {
        if (COLUMNAS_NUMERICAS.has(i)) {
            return { type: Number, value: Number(valor) || 0, ...(COLUMNAS_MONEDA.has(i) ? { format: '#,##0.00' } : {}) };
        }
        return { type: String, value: valor === null || valor === undefined || valor === '' ? null : String(valor) };
    }));

    await writeXlsxFile([encabezado, ...datos], {
        sheet: 'Reporte de ventas',
        columns: ANCHOS.map((width) => ({ width })),
        stickyRowsCount: 1
    }).toFile(`Ventas ${periodo.desde} a ${periodo.hasta}.xlsx`);
};
