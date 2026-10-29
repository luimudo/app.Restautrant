/**
 * Conector de NubeFact (API-Integracion, JSON). La URL y el token se guardan en
 * configuracion_empresa y los edita el administrador; el token nunca sale en respuestas.
 */

class NubefactError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

const NUBEFACT_TIPOS = { factura: 1, boleta: 2, nota_credito: 3, nota_debito: 4 };
const NUBEFACT_URL_REGEX = /^\/api\/v1\/[a-zA-Z0-9-]+\/?$/;
const NUBEFACT_TOKEN_REGEX = /^[a-zA-Z0-9._-]{10,}$/;

/** Valida URL y token antes de usarlos; nunca sigue otra URL que la de NubeFact. */
const validarCredenciales = (config) => {
    if (!config?.nubefact_url || !config?.nubefact_token) {
        throw new NubefactError(503, 'Configura la URL y el token de NubeFact en Configuracion > Facturacion electronica');
    }
    let url;
    try {
        url = new URL(config.nubefact_url);
    } catch {
        throw new NubefactError(503, 'La URL de NubeFact no es valida');
    }
    if (url.protocol !== 'https:' || url.hostname !== 'api.nubefact.com' || !NUBEFACT_URL_REGEX.test(url.pathname)
        || url.search || url.username || url.password) {
        throw new NubefactError(503, 'Usa la URL HTTPS de API-Integracion de NubeFact (https://api.nubefact.com/api/v1/...)');
    }
    if (!NUBEFACT_TOKEN_REGEX.test(config.nubefact_token)) {
        throw new NubefactError(503, 'El token de NubeFact tiene un formato invalido');
    }
    return { url: url.href, token: config.nubefact_token };
};

const RESPONSE_FIELDS = [
    'tipo_de_comprobante', 'serie', 'numero', 'aceptada_por_sunat', 'anulado', 'sunat_description', 'sunat_note',
    'sunat_responsecode', 'sunat_soap_error', 'enlace', 'enlace_del_pdf', 'enlace_del_xml', 'enlace_del_cdr',
    'cadena_para_codigo_qr', 'codigo_hash', 'codigo', 'errors'
];

/** POST a NubeFact. Si no hay respuesta confirmada lanza `incierto`: hay que consultar antes de reenviar. */
const request = async (config, payload) => {
    const { url, token } = validarCredenciales(config);
    try {
        const response = await fetch(url, {
            method: 'POST',
            redirect: 'error',
            signal: AbortSignal.timeout(20000),
            headers: { 'Content-Type': 'application/json', Authorization: `Token token="${token}"` },
            body: JSON.stringify(payload)
        });
        const raw = await response.text();
        const data = JSON.parse(raw);
        if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error('Respuesta invalida');
        if (!response.ok && !data.errors) throw new Error('Respuesta HTTP sin resultado');
        // Only result fields are kept: never headers, token or the raw body.
        const sanitize = (value) => {
            if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
            const text = typeof value === 'string' ? value : JSON.stringify(value);
            return text.replaceAll(token, '[REDACTADO]').slice(0, 2000);
        };
        return Object.fromEntries(RESPONSE_FIELDS.filter((key) => Object.hasOwn(data, key)).map((key) => [key, sanitize(data[key])]));
    } catch (err) {
        if (err instanceof NubefactError) throw err;
        const incierto = new NubefactError(502, 'No se confirmo la respuesta de NubeFact. Consulta el comprobante antes de reenviarlo.');
        incierto.incierto = true;
        throw incierto;
    }
};

/** Estado local segun la respuesta del proveedor (mismo criterio que DistribucionBebidas). */
const estadoDesdeRespuesta = (response, accion) => {
    if (response.errors) {
        const codigo = Number(response.codigo);
        if (accion === 'consultar' && codigo === 24) return 'pendiente'; // no existe: se puede enviar
        return codigo === 23 ? 'incierto' : 'error'; // 23: ya existe, hay que consultar
    }
    if (response.anulado === true) return 'anulado';
    if (response.aceptada_por_sunat === true) return response.sunat_note ? 'observado' : 'aceptado';
    if (response.sunat_responsecode && !['0', '0000'].includes(String(response.sunat_responsecode))) return 'rechazado';
    if (response.sunat_soap_error) return 'incierto';
    // Registrado en NubeFact; las boletas se aceptan despues, en el resumen diario de SUNAT.
    return 'enviado';
};

const consultarPayload = (tipo, serie, numero) => ({
    operacion: 'consultar_comprobante',
    tipo_de_comprobante: NUBEFACT_TIPOS[tipo],
    serie,
    numero
});

module.exports = { NubefactError, NUBEFACT_TIPOS, validarCredenciales, request, estadoDesdeRespuesta, consultarPayload };
