/**
 * Conector de la API propia de facturacion electronica (FacturacionSaaS).
 *
 * El sistema sigue armando el documento electronico con el formato interno que ya guarda en `facturas.nubefact_payload`
 * y `guias.nubefact_payload` (nombres de columna heredados). Este modulo lo traduce a la solicitud de la API y convierte la
 * respuesta a los campos que el resto del sistema ya entiende (aceptada_por_sunat, codigo_hash, enlaces, errors...).
 *
 * La URL y la API key se guardan en configuracion_empresa (facturacion_url / facturacion_token); la key nunca sale en respuestas.
 */

class FacturacionError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

const TIPOS = { factura: 1, boleta: 2, nota_credito: 3, nota_debito: 4 };
const TIPO_SUNAT = { 1: '01', 2: '03', 3: '07', 4: '08', 7: '09', 8: '31' };
const TIPO_INTERNO = { '01': 1, '03': 2, '07': 3, '08': 4, '09': 7, '31': 8 };
const TIMEOUT_MS = Number(process.env.FACTURACION_TIMEOUT_MS) || 30000;

// Tipo de afectacion al IGV del documento interno -> catalogo 07 de SUNAT.
const AFECTACION_IGV = { 1: '10', 8: '20', 9: '30', 16: '40' };

const MOTIVOS_NC = {
    1: 'Anulacion de la operacion', 2: 'Anulacion por error en el RUC', 3: 'Correccion por error en la descripcion',
    4: 'Descuento global', 5: 'Descuento por item', 6: 'Devolucion total', 7: 'Devolucion por item',
    8: 'Bonificacion', 9: 'Disminucion en el valor', 10: 'Otros conceptos', 13: 'Ajustes de montos y/o fechas de pago'
};
const MOTIVOS_ND = { 1: 'Intereses por mora', 2: 'Aumento en el valor', 3: 'Penalidades / otros conceptos' };

const API_KEY_REGEX = /^fe_[A-Za-z0-9_-]{20,}$/;

/** Valida URL y API key antes de usarlas. Solo HTTPS (HTTP unicamente hacia localhost, para pruebas locales). */
const validarCredenciales = (config) => {
    if (!config?.facturacion_url || !config?.facturacion_token) {
        throw new FacturacionError(503, 'Configure la URL y la API key de facturacion electronica en Configuracion > Facturacion electronica');
    }
    let url;
    try {
        url = new URL(config.facturacion_url);
    } catch {
        throw new FacturacionError(503, 'La URL de facturacion electronica no es valida');
    }
    const local = ['localhost', '127.0.0.1'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search) {
        throw new FacturacionError(503, 'La URL de la API de facturacion debe ser HTTPS (https://...)');
    }
    if (!API_KEY_REGEX.test(config.facturacion_token)) {
        throw new FacturacionError(503, 'La API key de facturacion tiene un formato invalido');
    }
    return { base: `${url.origin}${url.pathname.replace(/\/+$/, '')}`, token: config.facturacion_token };
};

// ---------------------------------------------------------------- Traduccion documento interno -> API

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

/** "DD-MM-YYYY" -> "YYYY-MM-DD" (acepta ISO). */
const fechaIso = (valor) => {
    if (!valor) return undefined;
    const s = String(valor).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (!m) throw new FacturacionError(400, `Fecha invalida: ${valor}`);
    return `${m[3]}-${m[2]}-${m[1]}`;
};

const clienteApi = (p) => {
    let tipo = String(p.cliente_tipo_de_documento ?? '').trim();
    let numero = String(p.cliente_numero_de_documento ?? '').trim();
    if (tipo === '' || tipo === '-' || numero === '' || numero === '-') {
        tipo = '0'; // boleta sin documento (menor a S/ 700)
        numero = '-';
    }
    return {
        tipoDocumento: tipo,
        numeroDocumento: numero,
        razonSocial: String(p.cliente_denominacion || '').trim() || 'CLIENTES VARIOS',
        direccion: p.cliente_direccion || undefined
    };
};

const itemsApi = (p) => (p.items || []).map((it, i) => {
    const afectacion = AFECTACION_IGV[Number(it.tipo_de_igv)];
    if (!afectacion) throw new FacturacionError(400, `Item ${i + 1}: tipo de IGV ${it.tipo_de_igv} no soportado`);
    return {
        codigo: it.codigo || undefined,
        descripcion: it.descripcion,
        unidadMedida: it.unidad_de_medida || 'NIU',
        cantidad: num(it.cantidad),
        valorUnitario: num(it.valor_unitario),
        tipoAfectacionIgv: afectacion,
        // Importes ya calculados por el sistema (los que se imprimen en el ticket): la API los respeta.
        valorVenta: it.subtotal !== undefined ? num(it.subtotal) : undefined,
        igv: it.igv !== undefined ? num(it.igv) : undefined,
        precioConIgv: it.precio_unitario !== undefined ? num(it.precio_unitario) : undefined
    };
});

const solicitudComprobante = (p, externalId) => {
    const tipoDocumento = TIPO_SUNAT[Number(p.tipo_de_comprobante)];
    if (!['01', '03', '07', '08'].includes(tipoDocumento)) throw new FacturacionError(400, `Tipo de comprobante ${p.tipo_de_comprobante} no soportado`);
    if (Number(p.moneda || 1) !== 1) throw new FacturacionError(400, 'Solo se soporta moneda PEN');

    const req = {
        tipoDocumento,
        serie: p.serie,
        numero: parseInt(p.numero, 10),
        externalId,
        fechaEmision: fechaIso(p.fecha_de_emision),
        moneda: 'PEN',
        tasaIgv: num(p.porcentaje_de_igv) || 18,
        cliente: clienteApi(p),
        items: itemsApi(p),
        observaciones: p.observaciones || undefined
    };

    if (tipoDocumento === '07' || tipoDocumento === '08') {
        const credito = tipoDocumento === '07';
        const codigo = Number(credito ? p.tipo_de_nota_de_credito : p.tipo_de_nota_de_debito);
        req.documentoReferencia = {
            tipoDocumento: TIPO_SUNAT[Number(p.documento_que_se_modifica_tipo)],
            serie: p.documento_que_se_modifica_serie,
            numero: parseInt(p.documento_que_se_modifica_numero, 10),
            codigoMotivo: String(codigo).padStart(2, '0'),
            descripcion: (credito ? MOTIVOS_NC : MOTIVOS_ND)[codigo] || 'Otros conceptos'
        };
        return req;
    }

    if (String(p.condiciones_de_pago || '').toUpperCase() === 'CREDITO' && tipoDocumento === '01') {
        const cuotas = (p.venta_al_credito || []).map((c) => ({ monto: num(c.importe), fechaVencimiento: fechaIso(c.fecha_de_pago) }));
        if (cuotas.length === 0) throw new FacturacionError(400, 'La venta al credito requiere cuotas');
        req.formaPago = 'Credito';
        req.cuotas = cuotas;
        req.montoNetoPendiente = Number(cuotas.reduce((s, c) => s + c.monto, 0).toFixed(2));
    }
    return req;
};

const solicitudGuia = (p, externalId) => {
    const tipoDocumento = TIPO_SUNAT[Number(p.tipo_de_comprobante)];
    if (!['09', '31'].includes(tipoDocumento)) throw new FacturacionError(400, `Tipo de guia ${p.tipo_de_comprobante} no soportado`);
    if (p.sunat_envio_indicador) throw new FacturacionError(400, 'Pagador del flete / subcontratador no esta soportado por la API de facturacion');
    const persona = (tipo, numero, nombre) => ({ tipoDocumento: String(tipo || '6'), numeroDocumento: String(numero || ''), razonSocial: String(nombre || '') });

    const req = {
        tipoDocumento,
        serie: p.serie,
        numero: parseInt(p.numero, 10),
        externalId,
        fechaEmision: fechaIso(p.fecha_de_emision),
        observaciones: p.observaciones || undefined,
        pesoBrutoTotal: num(p.peso_bruto_total),
        unidadPeso: p.peso_bruto_unidad_de_medida || 'KGM',
        fechaInicioTraslado: fechaIso(p.fecha_de_inicio_de_traslado),
        partida: { ubigeo: p.punto_de_partida_ubigeo, direccion: p.punto_de_partida_direccion },
        llegada: { ubigeo: p.punto_de_llegada_ubigeo, direccion: p.punto_de_llegada_direccion },
        // El codigo de establecimiento anexo solo se envia si el sistema lo informa (p. ej. traslado entre establecimientos).
        codigoEstablecimientoPartida: p.punto_de_partida_codigo_establecimiento_sunat || undefined,
        codigoEstablecimientoLlegada: p.punto_de_llegada_codigo_establecimiento_sunat || undefined,
        placaVehiculo: p.transportista_placa_numero || undefined,
        items: (p.items || []).map((it) => ({
            codigo: it.codigo || undefined, descripcion: it.descripcion, unidadMedida: it.unidad_de_medida || 'NIU', cantidad: num(it.cantidad)
        }))
    };
    const rel = Array.isArray(p.documento_relacionado) ? p.documento_relacionado[0] : null;
    if (tipoDocumento === '31') {
        req.remitente = persona(p.cliente_tipo_de_documento, p.cliente_numero_de_documento, p.cliente_denominacion);
        req.destinatario = persona(p.destinatario_documento_tipo, p.destinatario_documento_numero, p.destinatario_denominacion);
        req.modalidadTraslado = '01';
        req.motivoTraslado = '01';
        req.tucVehiculoPrincipal = p.tuc_vehiculo_principal || undefined;
        if (rel) req.guiaRemitenteReferencia = `${rel.serie}-${rel.numero}`;
    } else {
        req.destinatario = persona(p.cliente_tipo_de_documento, p.cliente_numero_de_documento, p.cliente_denominacion);
        req.motivoTraslado = p.motivo_de_traslado || '01';
        req.motivoTrasladoOtros = p.motivo_de_traslado_otros_descripcion || undefined;
        req.modalidadTraslado = p.tipo_de_transporte || '02';
        req.numeroBultos = p.numero_de_bultos ? parseInt(p.numero_de_bultos, 10) : undefined;
        if (req.modalidadTraslado === '01') {
            req.transportista = persona(p.transportista_documento_tipo, p.transportista_documento_numero, p.transportista_denominacion);
            req.registroMtc = p.transportista_numero_mtc || undefined;
        }
        if (rel) req.documentoRelacionado = { tipoDocumento: String(rel.tipo), serie: rel.serie, numero: parseInt(rel.numero, 10) };
    }
    if (p.conductor_numero_licencia || p.conductor_documento_numero) {
        req.conductores = [{
            tipoDocumento: String(p.conductor_documento_tipo || '1'), numeroDocumento: String(p.conductor_documento_numero || ''),
            nombres: p.conductor_nombre || '', apellidos: p.conductor_apellidos || '', licencia: p.conductor_numero_licencia || ''
        }];
    }
    return req;
};

// ---------------------------------------------------------------- Respuesta API -> campos del sistema

const RESPONSE_FIELDS = [
    'tipo_de_comprobante', 'serie', 'numero', 'aceptada_por_sunat', 'anulado', 'sunat_description', 'sunat_note',
    'sunat_responsecode', 'sunat_soap_error', 'enlace', 'enlace_del_pdf', 'enlace_del_xml', 'enlace_del_cdr',
    'cadena_para_codigo_qr', 'codigo_hash', 'codigo', 'errors'
];

const cut = (v, n = 2000) => (v === null || v === undefined ? v : String(v).slice(0, n));

const respuestaDesdeDocumento = (doc) => {
    const r = {
        tipo_de_comprobante: TIPO_INTERNO[doc.tipoDocumento],
        serie: doc.serie,
        numero: doc.numero,
        aceptada_por_sunat: doc.estado === 'Aceptado',
        anulado: doc.estado === 'Anulado',
        sunat_description: cut(doc.mensajeSunat),
        enlace_del_xml: doc.urlXml || undefined,
        enlace_del_cdr: doc.urlCdr || undefined,
        cadena_para_codigo_qr: doc.qr || undefined,
        codigo_hash: doc.hash || undefined
    };
    if (doc.estado === 'Rechazado') {
        r.aceptada_por_sunat = false;
        r.sunat_responsecode = cut(doc.codigoRespuesta) || '2000'; // distinto de 0: el sistema lo marca "rechazado"
    } else if (doc.estado === 'Error') {
        r.sunat_soap_error = cut(doc.mensajeSunat) || 'SUNAT no respondio'; // el sistema lo marca "incierto" y se consulta/reenvia
    } else if (doc.estado === 'Aceptado') {
        r.sunat_responsecode = '0';
    }
    return Object.fromEntries(Object.entries(r).filter(([k, v]) => v !== undefined && RESPONSE_FIELDS.includes(k)));
};

const aMs = (iso) => Date.parse(/Z$|[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`);

// ---------------------------------------------------------------- HTTP

const http = async (config, method, path, body) => {
    const { base, token } = validarCredenciales(config);
    try {
        const response = await fetch(`${base}${path}`, {
            method,
            redirect: 'error',
            signal: AbortSignal.timeout(TIMEOUT_MS),
            headers: { 'X-Api-Key': token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
            body: body ? JSON.stringify(body) : undefined
        });
        const raw = await response.text();
        let data = null;
        try { data = raw ? JSON.parse(raw) : null; } catch { /* respuesta no JSON */ }
        return { status: response.status, data };
    } catch {
        const incierto = new FacturacionError(502, 'No se confirmo la respuesta de la API de facturacion. Consulta el comprobante antes de reenviarlo.');
        incierto.incierto = true;
        throw incierto;
    }
};

const mensajeDe = (data, status) => {
    if (data?.message) return String(data.message).slice(0, 500);
    if (data?.errors && typeof data.errors === 'object') return Object.values(data.errors).flat().join('; ').slice(0, 500);
    return `La API de facturacion respondio HTTP ${status}`;
};

/** Interpreta la respuesta HTTP: documento (aceptado/pendiente/rechazado/error) o excepcion si la solicitud es invalida. */
const documentoDe = ({ status, data }) => {
    if ([200, 201, 422, 502].includes(status) && data?.data) return data.data;
    if (status === 401) throw new FacturacionError(503, 'La API key de facturacion es invalida o fue revocada');
    throw new FacturacionError(status >= 500 ? 502 : 400, mensajeDe(data, status));
};

/** Un documento en Error (SUNAT no disponible) se reintenta si lleva mas de 30 s; un ticket en proceso se consulta. */
const resolverPendiente = async (config, doc) => {
    try {
        if (doc.estado === 'Error' && Date.now() - aMs(doc.creadoUtc) > 30000) {
            return documentoDe(await http(config, 'POST', `/api/v1/documentos/${doc.id}/reenviar`));
        }
        if (doc.estado === 'EnProceso' && doc.ticket) {
            return documentoDe(await http(config, 'POST', `/api/v1/documentos/${doc.id}/consultar`));
        }
    } catch (err) {
        if (!(err instanceof FacturacionError)) throw err;
    }
    return doc;
};

const buscar = async (config, tipoSunat, serie, numero) => {
    const query = new URLSearchParams({ tipo: tipoSunat, serie, numero: String(numero) });
    const res = await http(config, 'GET', `/api/v1/documentos/buscar?${query}`);
    if (res.status === 404) return null;
    return documentoDe(res);
};

/**
 * Punto unico de envio y consulta. `payload.operacion`:
 *   generar_comprobante | generar_guia | consultar_comprobante | consultar_guia
 * Devuelve los campos de respuesta del sistema; `errors` + `codigo` 24 = el documento no existe.
 */
const request = async (config, payload) => {
    const operacion = payload?.operacion;
    if (operacion === 'generar_comprobante' || operacion === 'generar_guia') {
        const esGuia = operacion === 'generar_guia';
        const externalId = `${esGuia ? 'gre' : 'cpe'}-${payload.tipo_de_comprobante}-${payload.serie}-${parseInt(payload.numero, 10)}`;
        const solicitud = esGuia ? solicitudGuia(payload, externalId) : solicitudComprobante(payload, externalId);
        let doc = documentoDe(await http(config, 'POST', esGuia ? '/api/v1/guias' : '/api/v1/comprobantes', solicitud));
        doc = await resolverPendiente(config, doc);
        return respuestaDesdeDocumento(doc);
    }
    if (operacion === 'consultar_comprobante' || operacion === 'consultar_guia') {
        const doc = await buscar(config, TIPO_SUNAT[Number(payload.tipo_de_comprobante)], payload.serie, payload.numero);
        if (!doc) return { errors: 'El documento no existe en la API de facturacion', codigo: 24 };
        return respuestaDesdeDocumento(await resolverPendiente(config, doc));
    }
    throw new FacturacionError(400, `Operacion ${operacion} no soportada`);
};

/** Datos de la cuenta a la que apunta la API key (RUC y si emite en beta o produccion). */
const infoCuenta = async (config) => {
    const res = await http(config, 'GET', '/api/v1/tenant');
    if (res.status === 401) throw new FacturacionError(503, 'La API key de facturacion es invalida o fue revocada');
    if (res.status !== 200) throw new FacturacionError(502, mensajeDe(res.data, res.status));
    return res.data;
};

const cuentasVerificadas = new Map();

/**
 * Comprueba (con cache de 5 min) que la API key apunta a la cuenta correcta ANTES de emitir: un comprobante emitido por la
 * cuenta equivocada llega a SUNAT y no se borra. PRODUCCION exige el mismo RUC de la empresa, ambiente de produccion y certificado;
 * PRUEBAS exige que la cuenta emita en beta.
 */
const verificarCuenta = async (config) => {
    const { token } = validarCredenciales(config);
    const previa = cuentasVerificadas.get(token);
    if (previa && Date.now() - previa < 5 * 60 * 1000) return;
    const info = await infoCuenta(config);
    if (config.nubefact_ambiente === 'PRODUCCION') {
        if (info.ruc !== config.ruc) throw new FacturacionError(409, `La API key pertenece al RUC ${info.ruc} y no al de la empresa (${config.ruc}). Se detiene la emision.`);
        if (!info.produccion) throw new FacturacionError(409, 'El sistema esta en PRODUCCION pero la cuenta de facturacion emite en SUNAT beta (pruebas).');
        if (!info.tieneCertificado) throw new FacturacionError(409, 'La cuenta de facturacion no tiene certificado digital cargado.');
    } else if (info.produccion) {
        throw new FacturacionError(409, 'El sistema esta en PRUEBAS pero la cuenta de facturacion emite en produccion (validez fiscal). Se detiene la emision.');
    }
    cuentasVerificadas.set(token, Date.now());
};

/** Estado local segun la respuesta (mismos estados que el resto del sistema). */
const estadoDesdeRespuesta = (response, accion) => {
    if (response.errors) {
        const codigo = Number(response.codigo);
        if (accion === 'consultar' && codigo === 24) return 'pendiente'; // no existe: se puede enviar
        return codigo === 23 ? 'incierto' : 'error';
    }
    if (response.anulado === true) return 'anulado';
    if (response.aceptada_por_sunat === true) return response.sunat_note ? 'observado' : 'aceptado';
    if (response.sunat_responsecode && !['0', '0000'].includes(String(response.sunat_responsecode))) return 'rechazado';
    if (response.sunat_soap_error) return 'incierto';
    return 'enviado'; // recibido por la API; SUNAT todavia no responde
};

const consultarPayload = (tipo, serie, numero) => ({
    operacion: 'consultar_comprobante',
    tipo_de_comprobante: TIPOS[tipo],
    serie,
    numero
});

module.exports = {
    FacturacionError, TIPOS, validarCredenciales, request, infoCuenta, verificarCuenta, estadoDesdeRespuesta, consultarPayload,
    // expuestos para pruebas
    _traduccion: { solicitudComprobante, solicitudGuia, respuestaDesdeDocumento, fechaIso }
};
