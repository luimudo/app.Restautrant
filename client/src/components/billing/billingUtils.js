export const TIPO_LABEL = { boleta: 'Boleta', factura: 'Factura', nota_venta: 'Nota de venta', nota_credito: 'Nota de crédito', nota_debito: 'Nota de débito' };

export const METODOS_COBRO = [
    { value: 'efectivo', label: 'Efectivo' },
    { value: 'tarjeta', label: 'Tarjeta' },
    { value: 'yape', label: 'Yape' },
    { value: 'plin', label: 'Plin' },
    { value: 'transferencia', label: 'Transferencia' },
    { value: 'deposito', label: 'Deposito' }
];
export const METODO_LABEL = Object.fromEntries(METODOS_COBRO.map((m) => [m.value, m.label]));

/** Electronic receipts that still need an action with SUNAT. */
export const puedeEnviar = (f) => ['pendiente', 'error'].includes(f.estado_sunat);
export const puedeConsultar = (f) => ['enviando', 'enviado', 'incierto', 'error', 'rechazado', 'pendiente'].includes(f.estado_sunat);

export const money = (value) => `S/ ${Number(value || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const readJson = async (res, fallback) => {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || fallback);
    return body;
};

