const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');
const { signToken } = require('../auth');
const permisos = require('../permisos');
const { app, asegurarDescuentos, asegurarStockDecimal, asegurarVersion2, personal } = require('../index');

/**
 * Pruebas de la version 2 (propuesta COT-2026-0010) contra la base de prueba:
 *   T-01 recordatorios con monto -> gasto, R-02 cajas con almacen, R-03 presentaciones por litros, R-01 Personal.
 * Los registros de prueba llevan el prefijo "[PRUEBA V2]"; los que no se pueden borrar (comprobantes) quedan anulados.
 */
const ETIQUETA = `[PRUEBA V2 ${Date.now().toString(36)}]`;
let server;
let baseUrl;
let token;
let sedeId;
let userId;
let zonaId;
const limpieza = { recordatorios: [], productos: [], mesas: [], cajas: [], personal: [], elementos: [] };

const api = async (method, path, body, extraHeaders = {}) => {
    const isBuffer = Buffer.isBuffer(body);
    const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
            ...(isBuffer ? { 'Content-Type': 'application/octet-stream' } : { 'Content-Type': 'application/json' }),
            Authorization: `Bearer ${token}`,
            'x-sede-id': String(sedeId),
            ...extraHeaders
        },
        body: body === undefined ? undefined : (isBuffer ? body : JSON.stringify(body))
    });
    const type = res.headers.get('content-type') || '';
    const data = type.includes('application/json') ? await res.json().catch(() => ({})) : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data };
};
const ok = (res, status = 200) => assert.equal(res.status, status, JSON.stringify(res.data));
const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());

before(async () => {
    await permisos.iniciar();
    await asegurarDescuentos();
    await asegurarStockDecimal();
    await asegurarVersion2();
    await personal.asegurarEsquema();
    const [[admin]] = await pool.query("SELECT id, sede_id FROM usuarios WHERE rol = 'administrador' AND sede_id IS NOT NULL LIMIT 1");
    assert.ok(admin, 'Debe existir un administrador con sede');
    userId = Number(admin.id);
    sedeId = Number(admin.sede_id);
    token = signToken({ uid: userId });
    const [[zona]] = await pool.query('SELECT id FROM zonas WHERE sede_id = ? LIMIT 1', [sedeId]);
    zonaId = zona ? Number(zona.id) : null;
    await new Promise((resolve) => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
});

after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    try {
        if (limpieza.recordatorios.length) await pool.query('UPDATE recordatorios SET eliminado = 1 WHERE id IN (?)', [limpieza.recordatorios]);
        if (limpieza.productos.length) await pool.query('UPDATE productos SET disponible = 0 WHERE id IN (?)', [limpieza.productos]);
        if (limpieza.cajas.length) await pool.query('UPDATE cajas SET activo = 0 WHERE id IN (?)', [limpieza.cajas]);
        if (limpieza.elementos.length) await pool.query('UPDATE epp_elementos SET activo = 0 WHERE id IN (?)', [limpieza.elementos]);
        if (limpieza.personal.length) {
            const ids = limpieza.personal;
            const [ctl] = await pool.query('SELECT DISTINCT control_id FROM epp_control_detalle WHERE personal_id IN (?)', [ids]);
            await pool.query('DELETE FROM epp_control_detalle WHERE personal_id IN (?)', [ids]);
            if (ctl.length) await pool.query('DELETE FROM epp_controles WHERE id IN (?) AND NOT EXISTS (SELECT 1 FROM epp_control_detalle d WHERE d.control_id = epp_controles.id)', [ctl.map((c) => c.control_id)]);
            await pool.query('DELETE d FROM epp_devoluciones d JOIN epp_entregas e ON e.id = d.entrega_id WHERE e.personal_id IN (?)', [ids]);
            await pool.query('DELETE FROM epp_entregas WHERE personal_id IN (?)', [ids]);
            await pool.query('DELETE p FROM personal_adjunto_partes p JOIN personal_adjuntos a ON a.id = p.adjunto_id WHERE a.personal_id IN (?)', [ids]);
            await pool.query('DELETE FROM personal_adjuntos WHERE personal_id IN (?)', [ids]);
            await pool.query('DELETE FROM personal WHERE id IN (?)', [ids]);
        }
        await pool.query("DELETE FROM personal_turnos WHERE nombre LIKE '[PRUEBA V2%' AND NOT EXISTS (SELECT 1 FROM epp_controles c WHERE c.turno_id = personal_turnos.id) AND NOT EXISTS (SELECT 1 FROM personal x WHERE x.turno_id = personal_turnos.id)");
        if (limpieza.elementos.length) await pool.query('DELETE FROM epp_elementos WHERE id IN (?) AND NOT EXISTS (SELECT 1 FROM epp_entregas e WHERE e.elemento_id = epp_elementos.id)', [limpieza.elementos]);
    } finally {
        await pool.end();
    }
});

// ---------------- T-01 ----------------
test('T-01: atender un recordatorio con monto genera el gasto al contado, no duplica el periodo y revertir exige anular el gasto', async () => {
    const [[cat]] = await pool.query("SELECT id FROM categorias_gasto WHERE activo = 1 ORDER BY id LIMIT 1");
    const creado = await api('POST', '/api/recordatorios', {
        nombre: `${ETIQUETA} Internet`, categoria: 'pago', monto: 150.5, tipo_vencimiento: 'periodico', dia_pago: 5, dias_aviso: 3
    });
    ok(creado, 201);
    limpieza.recordatorios.push(creado.data.id);

    const atendido = await api('POST', `/api/recordatorios/${creado.data.id}/atender`, {
        generar_pago: true, fecha_pago: hoy(), metodo_pago: 'transferencia', referencia: 'OP-123', categoria_gasto_id: cat.id
    });
    ok(atendido);
    assert.equal(atendido.data.estado, 'atendido');
    assert.ok(atendido.data.pago_periodo, 'Debe quedar vinculado el gasto del periodo');
    assert.equal(atendido.data.periodo_actual, hoy().slice(0, 7));
    const gastoId = atendido.data.pago_periodo.gasto_id;

    const gasto = await api('GET', `/api/gastos/${gastoId}`);
    ok(gasto);
    assert.equal(Number(gasto.data.importe), 150.5);
    assert.equal(gasto.data.condicion_pago, 'contado');
    assert.equal(gasto.data.estado_pago, 'pagado');
    assert.equal(gasto.data.pagos.length, 1);
    assert.equal(gasto.data.pagos[0].metodo_pago, 'transferencia');

    // Ya atendido en el periodo: no se puede volver a atender (ni duplicar el pago).
    const otra = await api('POST', `/api/recordatorios/${creado.data.id}/atender`, { generar_pago: true, metodo_pago: 'efectivo' });
    assert.equal(otra.status, 409);

    // Revertir con el gasto vigente: se pide anularlo primero.
    const revertir = await api('POST', `/api/recordatorios/${creado.data.id}/revertir`);
    assert.equal(revertir.status, 409);
    assert.match(revertir.data.error, /anule/i);

    ok(await api('POST', `/api/pagos-gastos/${gasto.data.pagos[0].id}/anular`, { motivo: 'Prueba automatizada' }));
    ok(await api('POST', `/api/gastos/${gastoId}/anular`, { motivo: 'Prueba automatizada' }));
    const revertido = await api('POST', `/api/recordatorios/${creado.data.id}/revertir`);
    ok(revertido);
    assert.notEqual(revertido.data.estado, 'atendido');
    assert.equal(revertido.data.pago_periodo, null);

    // Un recordatorio sin monto se atiende sin generar movimientos.
    const doc = await api('POST', '/api/recordatorios', {
        nombre: `${ETIQUETA} Licencia`, categoria: 'licencia', tipo_vencimiento: 'fecha', fecha_vencimiento: hoy(), dias_aviso: 3
    });
    ok(doc, 201);
    limpieza.recordatorios.push(doc.data.id);
    const docAtendido = await api('POST', `/api/recordatorios/${doc.data.id}/atender`, { generar_pago: true, metodo_pago: 'efectivo' });
    ok(docAtendido);
    assert.equal(docAtendido.data.estado, 'atendido');
    assert.equal(docAtendido.data.pago_periodo, null);
});

// ---------------- R-02 + R-03 ----------------
const stockEn = async (almacenId, productoId) => {
    const [[r]] = await pool.query('SELECT COALESCE(SUM(stock), 0) AS stock FROM stock_productos WHERE almacen_id = ? AND producto_id = ?', [almacenId, productoId]);
    return Number(r.stock);
};

test('R-02/R-03: la venta de presentaciones descuenta litros del barril en el almacen de la caja y la anulacion los devuelve', async () => {
    const [almacenes] = await pool.query('SELECT id, para_ventas FROM almacenes WHERE sede_id = ? AND activo = 1 ORDER BY para_ventas ASC, id ASC', [sedeId]);
    assert.ok(almacenes.length > 0, 'La sede necesita al menos un almacen activo');
    const almacenCaja = Number(almacenes[0].id); // de preferencia uno que NO es el de ventas por defecto
    const [[litro]] = await pool.query("SELECT id FROM unidades_medida WHERE permite_decimales = 1 AND activo = 1 ORDER BY abreviatura = 'Lt' DESC LIMIT 1");
    const [[categoria]] = await pool.query('SELECT id FROM tipos_producto LIMIT 1');

    // Caja nueva asociada al almacen
    const caja = await api('POST', '/api/cajas', { descripcion: `${ETIQUETA} Caja barra`, almacen_id: almacenCaja });
    ok(caja, 201);
    limpieza.cajas.push(caja.data.id);
    const otroSede = await pool.query('SELECT id FROM almacenes WHERE sede_id <> ? LIMIT 1', [sedeId]);
    if (otroSede[0][0]) {
        const mala = await api('PUT', `/api/cajas/${caja.data.id}`, { descripcion: `${ETIQUETA} Caja barra`, almacen_id: otroSede[0][0].id });
        assert.equal(mala.status, 400, 'No se acepta un almacen de otra sede');
    }
    const lista = await api('GET', '/api/cajas?todas=1');
    ok(lista);
    const enLista = lista.data.find((c) => c.id === caja.data.id);
    assert.equal(Number(enLista.almacen_id), almacenCaja);

    // Barril (stock en litros) y dos presentaciones
    const barril = await api('POST', '/api/productos', {
        nombre: `${ETIQUETA} Cerveza barril`, precio: 0, tipo_id: categoria.id, es_receta: false, disponible: false, unidad_id: litro?.id, stock: 0
    });
    ok(barril);
    limpieza.productos.push(barril.data.id);
    await pool.query(
        'INSERT INTO stock_productos (almacen_id, sede_id, producto_id, stock) VALUES (?, ?, ?, 30) ON DUPLICATE KEY UPDATE stock = 30',
        [almacenCaja, sedeId, barril.data.id]
    );
    const vaso = await api('POST', '/api/productos', {
        nombre: `${ETIQUETA} Vaso 0.5 L`, precio: 8, tipo_id: categoria.id, es_receta: false, disponible: true, factor_venta: 0.5, producto_base_id: barril.data.id
    });
    ok(vaso);
    limpieza.productos.push(vaso.data.id);
    const jarra = await api('POST', '/api/productos', {
        nombre: `${ETIQUETA} Jarra 1.5 L`, precio: 22, tipo_id: categoria.id, es_receta: false, disponible: true, factor_venta: 1.5, producto_base_id: barril.data.id
    });
    ok(jarra);
    limpieza.productos.push(jarra.data.id);

    const vasoDb = await api('GET', `/api/productos/${vaso.data.id}`);
    ok(vasoDb);
    assert.equal(Number(vasoDb.data.es_receta), 1, 'La presentacion no tiene stock propio');
    assert.equal(Number(vasoDb.data.producto_base_id), barril.data.id);
    assert.equal(Number(vasoDb.data.stock_base), 30);

    // Validaciones: una presentacion no puede ser base, y el barril no puede pasar a "Sin stock"
    const presentacionDePresentacion = await api('POST', '/api/productos', {
        nombre: `${ETIQUETA} Mal`, precio: 1, tipo_id: categoria.id, es_receta: true, disponible: false, factor_venta: 1, producto_base_id: vaso.data.id
    });
    assert.equal(presentacionDePresentacion.status, 400);
    const barrilSinStock = await api('PUT', `/api/productos/${barril.data.id}`, {
        nombre: `${ETIQUETA} Cerveza barril`, precio: 0, tipo_id: categoria.id, es_receta: true, disponible: false
    });
    assert.equal(barrilSinStock.status, 400);

    // Pedido: 2 vasos (1 L) + 1 jarra (1.5 L) = 2.5 L
    const numeroMesa = `V2-${Date.now().toString(36).slice(-5)}`;
    const [mesa] = await pool.query('INSERT INTO mesas (sede_id, numero, capacidad, zona_id) VALUES (?, ?, 4, ?)', [sedeId, numeroMesa, zonaId]);
    const pedido = await api('POST', '/api/pedidos', {
        mesa_id: mesa.insertId, usuario_id: userId,
        detalles: [{ producto_id: vaso.data.id, cantidad: 2 }, { producto_id: jarra.data.id, cantidad: 1 }]
    });
    ok(pedido);

    // Sesion de la caja nueva y nota de venta registrada en ella
    const apertura = await api('POST', '/api/caja/apertura', { caja_id: caja.data.id, monto_inicial: 0 });
    ok(apertura, 201);
    const venta = await api('POST', '/api/facturas', {
        pedido_id: pedido.data.id, tipo_comprobante: 'nota_venta', condicion_pago: 'contado', caja_id: caja.data.id,
        cliente: { nombre: 'CLIENTES VARIOS' }, pago: { metodo_pago: 'efectivo' }
    });
    assert.ok([200, 201].includes(venta.status), JSON.stringify(venta.data));
    const facturaId = venta.data.id || venta.data.factura?.id;
    assert.ok(facturaId, `Respuesta sin id: ${JSON.stringify(venta.data)}`);
    assert.equal(await stockEn(almacenCaja, barril.data.id), 27.5, 'Se descuentan 2.5 L del almacen de la caja');

    // Reporte de consumo en litros
    const reporte = await api('GET', `/api/reportes/consumo-litros?desde=${hoy()}&hasta=${hoy()}`);
    ok(reporte);
    const total = reporte.data.totales.find((t) => t.base_id === barril.data.id);
    assert.ok(total);
    assert.equal(total.litros, 2.5);
    assert.equal(total.unidades, 3);

    // Anulacion: vuelven los litros al mismo almacen
    ok(await api('POST', `/api/facturas/${facturaId}/anular`, { motivo: 'Prueba automatizada' }));
    assert.equal(await stockEn(almacenCaja, barril.data.id), 30);

    // Cierre de la caja y desactivacion
    ok(await api('POST', '/api/caja/cierre', { sesion_id: apertura.data.id, monto_contado: 0 }));
    const desactivada = await api('PUT', `/api/cajas/${caja.data.id}`, { descripcion: `${ETIQUETA} Caja barra`, almacen_id: almacenCaja, activo: false });
    ok(desactivada);
    const abrirInactiva = await api('POST', '/api/caja/apertura', { caja_id: caja.data.id, monto_inicial: 0 });
    assert.equal(abrirInactiva.status, 409);
});

// ---------------- R-01 ----------------
test('R-01: trabajador con adjunto de mas de 4 MB, entrega de EPP, control diario C/NC y costos', async () => {
    const opciones = await api('GET', '/api/personal/opciones');
    ok(opciones);
    assert.ok(opciones.data.puede_ver_remuneracion);
    const area = opciones.data.areas.find((a) => a.activo) || opciones.data.areas[0];
    const turno = opciones.data.turnos.find((t) => t.activo) || opciones.data.turnos[0];
    const cargo = opciones.data.cargos[0];

    // Catalogo: turno nuevo y elemento de control diario del area
    const nuevoTurno = await api('POST', '/api/personal/catalogos/turnos', { nombre: `${ETIQUETA} Turno`, hora_inicio: '08:00', hora_fin: '16:00' });
    ok(nuevoTurno, 201);
    const elemento = await api('POST', '/api/personal/elementos', {
        nombre: `${ETIQUETA} Mandil`, tipo: 'uniforme', unidad: 'UND', frecuencia_meses: 6, costo_unitario: 25, area_id: area.id, control_diario: true
    });
    ok(elemento, 201);
    limpieza.elementos.push(elemento.data.id);

    const dni = String(Date.now()).slice(-8);
    const trabajador = await api('POST', '/api/personal/trabajadores', {
        dni, nombres: 'Prueba', apellidos: `${ETIQUETA} Personal`, fecha_ingreso: `${hoy().slice(0, 7)}-01`, cargo_id: cargo.id, area_id: area.id,
        turno_id: nuevoTurno.data.id, vinculo: 'planilla', remuneracion: 1500, funciones: ['mozo', 'caja'], telefono: '999888777'
    });
    ok(trabajador, 201);
    limpieza.personal.push(trabajador.data.id);
    assert.deepEqual(trabajador.data.funciones, ['mozo', 'caja']);
    assert.equal(trabajador.data.remuneracion, 1500);

    const duplicado = await api('POST', '/api/personal/trabajadores', { dni, nombres: 'Otro', apellidos: 'Duplicado' });
    assert.equal(duplicado.status, 409);

    // Adjunto de 5 MB (mayor al max_allowed_packet de 4 MB del hosting): se guarda en partes
    const pdf = Buffer.alloc(5 * 1024 * 1024 + 123, 0x20);
    pdf.write('%PDF-1.4\n', 0, 'ascii');
    const subida = await api('POST', `/api/personal/trabajadores/${trabajador.data.id}/adjuntos?nombre=${encodeURIComponent('contrato prueba.pdf')}&tipo=contrato`, pdf);
    ok(subida, 201);
    assert.equal(subida.data.tamano, pdf.length);
    const descarga = await api('GET', `/api/personal/adjuntos/${subida.data.id}`);
    ok(descarga);
    assert.ok(Buffer.isBuffer(descarga.data) && descarga.data.equals(pdf), 'El archivo descargado es identico al subido');
    const noPermitido = await api('POST', `/api/personal/trabajadores/${trabajador.data.id}/adjuntos?nombre=x.exe`, Buffer.from('MZ ejecutable'));
    assert.equal(noPermitido.status, 400);

    // Entrega con proximo cambio segun frecuencia y devolucion parcial
    const entrega = await api('POST', '/api/personal/entregas', {
        personal_id: trabajador.data.id, elemento_id: elemento.data.id, cantidad: 2, talla: 'M', estado: 'nuevo', motivo: 'Ingreso', fecha: hoy()
    });
    ok(entrega, 201);
    assert.equal(entrega.data.costo_total, 50);
    assert.ok(entrega.data.proximo_cambio > hoy());
    const devolucion = await api('POST', `/api/personal/entregas/${entrega.data.id}/devolver`, { cantidad: 1, estado: 'regular', motivo: 'Cambio de talla' });
    ok(devolucion);
    assert.equal(devolucion.data.pendiente, 1);
    const excesiva = await api('POST', `/api/personal/entregas/${entrega.data.id}/devolver`, { cantidad: 5, estado: 'bueno', motivo: 'Exceso' });
    assert.equal(excesiva.status, 409);

    // Control diario del turno y area
    const control = await api('POST', '/api/personal/controles', { fecha: hoy(), turno_id: nuevoTurno.data.id, area_id: area.id });
    ok(control, 201);
    const items = control.data.items.filter((i) => i.personal_id === trabajador.data.id);
    assert.ok(items.some((i) => i.elemento_id === elemento.data.id), 'El elemento de control diario del area aparece en el control');
    const cerrarIncompleto = await api('POST', `/api/personal/controles/${control.data.id}/cerrar`);
    assert.equal(cerrarIncompleto.status, 409);
    const ncSinObs = await api('POST', `/api/personal/controles/${control.data.id}/marcar`, { items: [{ id: items[0].id, resultado: 'NC' }] });
    assert.equal(ncSinObs.status, 400);
    const marcas = control.data.items.map((i, n) => ({ id: i.id, resultado: n === 0 ? 'NC' : 'C', observacion: n === 0 ? 'No usa el elemento' : '' }));
    ok(await api('POST', `/api/personal/controles/${control.data.id}/marcar`, { items: marcas }));
    const cerrado = await api('POST', `/api/personal/controles/${control.data.id}/cerrar`);
    ok(cerrado);
    assert.equal(cerrado.data.estado, 'cerrado');
    const esperado = Math.round((10000 * (marcas.length - 1)) / marcas.length) / 100;
    assert.equal(cerrado.data.cumplimiento, esperado);

    // Costos del mes: remuneracion prorrateada + uniforme entregado
    const costos = await api('GET', `/api/personal/costos?desde=${hoy().slice(0, 7)}-01&hasta=${hoy()}`);
    ok(costos);
    const fila = costos.data.trabajadores.find((t) => t.personal_id === trabajador.data.id);
    assert.ok(fila);
    assert.equal(fila.costo_uniforme, 50);
    const dias = Number(hoy().slice(8, 10));
    assert.equal(fila.remuneracion_periodo, Math.round(1500 * dias / 30 * 100) / 100);
    assert.ok(costos.data.areas.some((a) => a.area_id === area.id));

    // Cese
    const cese = await api('PUT', `/api/personal/trabajadores/${trabajador.data.id}`, {
        ...trabajador.data, fecha_cese: hoy(), estado: 'cesado'
    });
    ok(cese);
    assert.equal(cese.data.estado, 'cesado');

    await pool.query('UPDATE personal_turnos SET activo = 0 WHERE id = ?', [nuevoTurno.data.id]);
});
