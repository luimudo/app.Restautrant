const { test } = require('node:test');
const assert = require('node:assert/strict');
const facturacion = require('../facturacion');

const config = { facturacion_url: 'https://facturacion.test', facturacion_token: 'fe_' + 'a'.repeat(30), nubefact_ambiente: 'PRUEBAS', ruc: '20615200892' };

// Boleta tal como la arma buildComprobantePayload del sistema (IGV 10.5 %, precios con IGV incluido)
const boleta = {
    operacion: 'generar_comprobante', tipo_de_comprobante: 2, serie: 'B003', numero: 119, sunat_transaction: 1,
    cliente_tipo_de_documento: '-', cliente_numero_de_documento: '-', cliente_denominacion: 'CLIENTES VARIOS',
    cliente_direccion: '', fecha_de_emision: '26-10-2026', moneda: 1, porcentaje_de_igv: 10.5,
    total_gravada: 20, total_igv: 2.1, total: 22.1, condiciones_de_pago: 'CONTADO', observaciones: '',
    items: [{ unidad_de_medida: 'NIU', codigo: 'P7', descripcion: 'Lomo saltado', cantidad: 1, valor_unitario: 20, precio_unitario: 22.1, descuento: '', subtotal: 20, tipo_de_igv: 1, igv: 2.1, total: 22.1 }]
};

const respuesta = (status, data) => ({ status, text: async () => JSON.stringify(data) });
const docApi = (extra = {}) => ({
    id: 'abc', tipoDocumento: '03', serie: 'B003', numero: 119, estado: 'Aceptado', codigoRespuesta: '0',
    mensajeSunat: 'La Boleta numero B003-119, ha sido aceptada', hash: 'HASH=', qr: 'QR|', urlXml: 'https://x/xml', urlCdr: 'https://x/cdr',
    creadoUtc: new Date().toISOString(), ...extra
});

test('boleta: traduce al formato de la API conservando tasa de IGV e importes del sistema', () => {
    const r = facturacion._traduccion.solicitudComprobante(boleta, 'cpe-2-B003-119');
    assert.equal(r.tipoDocumento, '03');
    assert.equal(r.numero, 119);
    assert.equal(r.tasaIgv, 10.5);
    assert.equal(r.fechaEmision, '2026-10-26');
    assert.deepEqual([r.cliente.tipoDocumento, r.cliente.numeroDocumento], ['0', '-']);
    assert.equal(r.items[0].valorVenta, 20);
    assert.equal(r.items[0].igv, 2.1);
    assert.equal(r.items[0].precioConIgv, 22.1);
    assert.equal(r.items[0].tipoAfectacionIgv, '10');
});

test('nota de credito: documento que modifica y motivo', () => {
    const nc = { ...boleta, tipo_de_comprobante: 3, serie: 'B003', numero: 104, tipo_de_nota_de_credito: 1,
        documento_que_se_modifica_tipo: 2, documento_que_se_modifica_serie: 'B003', documento_que_se_modifica_numero: 119 };
    const r = facturacion._traduccion.solicitudComprobante(nc, 'x');
    assert.equal(r.tipoDocumento, '07');
    assert.deepEqual(r.documentoReferencia, { tipoDocumento: '03', serie: 'B003', numero: 119, codigoMotivo: '01', descripcion: 'Anulacion de la operacion' });
});

test('factura a credito: cuotas y monto neto', () => {
    const f = { ...boleta, tipo_de_comprobante: 1, serie: 'F003', numero: 106, cliente_tipo_de_documento: 6, cliente_numero_de_documento: '20100070970',
        cliente_denominacion: 'CLIENTE SAC', condiciones_de_pago: 'CREDITO', venta_al_credito: [{ cuota: 1, fecha_de_pago: '30-11-2026', importe: 22.1 }] };
    const r = facturacion._traduccion.solicitudComprobante(f, 'x');
    assert.equal(r.formaPago, 'Credito');
    assert.deepEqual(r.cuotas, [{ monto: 22.1, fechaVencimiento: '2026-11-30' }]);
});

test('un tipo de IGV no soportado detiene el envio', () => {
    const mala = { ...boleta, items: [{ ...boleta.items[0], tipo_de_igv: 6 }] };
    assert.throws(() => facturacion._traduccion.solicitudComprobante(mala, 'x'), /no soportado/);
});

test('guia remitente: se traduce con conductor y documento relacionado', () => {
    const g = {
        operacion: 'generar_guia', tipo_de_comprobante: 7, serie: 'T003', numero: 101, cliente_tipo_de_documento: 6, cliente_numero_de_documento: '20100070970',
        cliente_denominacion: 'CLIENTE SAC', fecha_de_emision: '26-10-2026', fecha_de_inicio_de_traslado: '27-10-2026', motivo_de_traslado: '01',
        peso_bruto_total: 12.5, peso_bruto_unidad_de_medida: 'KGM', numero_de_bultos: 3, tipo_de_transporte: '02', transportista_placa_numero: 'ABC123',
        punto_de_partida_ubigeo: '130107', punto_de_partida_direccion: 'A', punto_de_partida_codigo_establecimiento_sunat: '0000',
        punto_de_llegada_ubigeo: '130101', punto_de_llegada_direccion: 'B', punto_de_llegada_codigo_establecimiento_sunat: '',
        conductor_documento_tipo: '1', conductor_documento_numero: '12345678', conductor_nombre: 'Juan', conductor_apellidos: 'Perez', conductor_numero_licencia: 'Q1',
        documento_relacionado: [{ tipo: '03', serie: 'B003', numero: 119 }], items: [{ codigo: 'P7', descripcion: 'Cajas', cantidad: 3, unidad_de_medida: 'NIU' }]
    };
    const r = facturacion._traduccion.solicitudGuia(g, 'x');
    assert.equal(r.tipoDocumento, '09');
    assert.equal(r.fechaInicioTraslado, '2026-10-27');
    assert.equal(r.codigoEstablecimientoLlegada, undefined);
    assert.deepEqual(r.documentoRelacionado, { tipoDocumento: '03', serie: 'B003', numero: 119 });
    assert.equal(r.conductores[0].licencia, 'Q1');
});

test('validarCredenciales: solo https (o http a localhost) y API key con formato fe_', () => {
    assert.doesNotThrow(() => facturacion.validarCredenciales(config));
    assert.doesNotThrow(() => facturacion.validarCredenciales({ ...config, facturacion_url: 'http://localhost:5072' }));
    assert.throws(() => facturacion.validarCredenciales({ ...config, facturacion_url: 'http://facturacion.test' }), /HTTPS/);
    assert.throws(() => facturacion.validarCredenciales({ ...config, facturacion_token: 'abc' }), /formato invalido/);
    assert.throws(() => facturacion.validarCredenciales({}), /Configure la URL/);
});

test('request: aceptado -> campos del sistema y estado aceptado', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => respuesta(201, { success: true, data: docApi() }));
    const r = await facturacion.request(config, boleta);
    assert.equal(r.aceptada_por_sunat, true);
    assert.equal(r.codigo_hash, 'HASH=');
    assert.equal(r.cadena_para_codigo_qr, 'QR|');
    assert.equal(r.tipo_de_comprobante, 2);
    assert.equal(facturacion.estadoDesdeRespuesta(r, 'enviar'), 'aceptado');
    const [url, init] = fetch.mock.calls[0].arguments;
    assert.equal(url, 'https://facturacion.test/api/v1/comprobantes');
    assert.equal(init.headers['X-Api-Key'], config.facturacion_token);
});

test('request: rechazo de SUNAT (422) -> estado rechazado, sin lanzar', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => respuesta(422, { success: false, data: docApi({ estado: 'Rechazado', codigoRespuesta: '2800', mensajeSunat: 'Dato invalido' }) }));
    const r = await facturacion.request(config, boleta);
    assert.equal(facturacion.estadoDesdeRespuesta(r, 'enviar'), 'rechazado');
    assert.equal(r.sunat_description, 'Dato invalido');
});

test('request: SUNAT no disponible (502) -> incierto, para consultar o reenviar', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => respuesta(502, { success: false, data: docApi({ estado: 'Error', mensajeSunat: 'No se pudo contactar a SUNAT', hash: null, qr: null }) }));
    const r = await facturacion.request(config, boleta);
    assert.equal(facturacion.estadoDesdeRespuesta(r, 'enviar'), 'incierto');
});

test('request: un documento en Error de hace mas de 30 s se reenvia', async (t) => {
    const viejo = new Date(Date.now() - 120000).toISOString();
    let llamadas = 0;
    t.mock.method(globalThis, 'fetch', async (url) => {
        llamadas++;
        if (String(url).endsWith('/reenviar')) return respuesta(200, { success: true, data: docApi() });
        return respuesta(502, { success: false, data: docApi({ estado: 'Error', creadoUtc: viejo }) });
    });
    const r = await facturacion.request(config, boleta);
    assert.equal(llamadas, 2);
    assert.equal(facturacion.estadoDesdeRespuesta(r, 'enviar'), 'aceptado');
});

test('request: solicitud invalida (400) lanza error, sin marcar el documento', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => respuesta(400, { success: false, message: 'La serie B009 no esta registrada/activa' }));
    await assert.rejects(() => facturacion.request(config, boleta), /serie B009/);
});

test('request: API key invalida (401)', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => respuesta(401, { success: false, message: 'API key invalida' }));
    await assert.rejects(() => facturacion.request(config, boleta), /API key de facturacion es invalida/);
});

test('request: sin respuesta de red -> incierto (consultar antes de reenviar)', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => { throw new Error('ECONNRESET'); });
    await assert.rejects(() => facturacion.request(config, boleta), (err) => err.incierto === true);
});

test('consultar: documento inexistente -> pendiente (se puede enviar)', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => respuesta(404, { success: false, message: 'Documento no encontrado.' }));
    const r = await facturacion.request(config, facturacion.consultarPayload('boleta', 'B003', 200));
    assert.equal(facturacion.estadoDesdeRespuesta(r, 'consultar'), 'pendiente');
});

test('verificarCuenta: en PRUEBAS bloquea una cuenta que emite en produccion', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => respuesta(200, { ruc: '20615200892', produccion: true, tieneCertificado: true }));
    await assert.rejects(() => facturacion.verificarCuenta({ ...config, facturacion_token: 'fe_' + 'b'.repeat(30) }), /PRUEBAS pero la cuenta/);
});

test('verificarCuenta: en PRODUCCION exige el mismo RUC', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => respuesta(200, { ruc: '20000000001', produccion: true, tieneCertificado: true }));
    await assert.rejects(
        () => facturacion.verificarCuenta({ ...config, nubefact_ambiente: 'PRODUCCION', facturacion_token: 'fe_' + 'c'.repeat(30) }),
        /no al de la empresa/
    );
});
