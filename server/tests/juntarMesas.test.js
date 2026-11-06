const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');
const { signToken } = require('../auth');
const permisos = require('../permisos');
const { app, asegurarDescuentos, asegurarStockDecimal } = require('../index');

let server;
let baseUrl;
let token;
let userId;
let sedeId;
let zonaId;
let productoId;
const createdMesaIds = [];
const createdPedidoIds = [];

const api = async (method, path, body) => {
    const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            'x-sede-id': String(sedeId)
        },
        body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
};

const crearMesaPrueba = async (sufijo) => {
    const numero = `T-${sufijo}-${Date.now().toString(36).slice(-4)}`;
    const [r] = await pool.query(
        'INSERT INTO mesas (sede_id, numero, capacidad, zona_id) VALUES (?, ?, 4, ?)',
        [sedeId, numero, zonaId]
    );
    createdMesaIds.push(r.insertId);
    return { id: r.insertId, numero };
};

const abrirComanda = async (mesaId, cantidad = 1) => {
    const res = await api('POST', '/api/pedidos', {
        mesa_id: mesaId,
        usuario_id: userId,
        detalles: [{ producto_id: productoId, cantidad }]
    });
    assert.equal(res.status, 200, `Error al crear comanda: ${JSON.stringify(res.data)}`);
    if (res.data.id) createdPedidoIds.push(res.data.id);
    return res.data.id;
};

const registrarComandaHistoricaPagada = async (mesaId) => {
    const [r] = await pool.query(
        "INSERT INTO pedidos (sede_id, mesa_id, usuario_id, estado, total) VALUES (?, ?, ?, 'pagado', 25.00)",
        [sedeId, mesaId, userId]
    );
    createdPedidoIds.push(r.insertId);
    await pool.query(
        "INSERT INTO detalles_pedido (pedido_id, producto_id, cantidad, precio_unitario, subtotal, estado_comanda) VALUES (?, ?, 1, 25.00, 25.00, 'listo')",
        [r.insertId, productoId]
    );
    return r.insertId;
};

const estadoMesas = async (...ids) => {
    const res = await api('GET', '/api/mesas');
    assert.equal(res.status, 200);
    return ids.map((id) => res.data.find((m) => Number(m.id) === Number(id)));
};

before(async () => {
    await permisos.iniciar();
    await asegurarDescuentos();
    await asegurarStockDecimal();

    const [[admin]] = await pool.query(
        "SELECT id, sede_id FROM usuarios WHERE rol IN ('administrador', 'mozo') AND sede_id IS NOT NULL LIMIT 1"
    );
    assert.ok(admin, 'Debe existir un usuario administrador o mozo en la base de pruebas');
    userId = Number(admin.id);
    sedeId = Number(admin.sede_id);
    token = signToken({ uid: userId });

    const [[zona]] = await pool.query('SELECT id FROM zonas WHERE sede_id = ? LIMIT 1', [sedeId]);
    zonaId = zona ? Number(zona.id) : null;

    // Usamos una receta (no descuenta stock de almacén) para que las pruebas sean limpias.
    const [[prod]] = await pool.query('SELECT id FROM productos WHERE es_receta = 1 LIMIT 1');
    assert.ok(prod, 'Debe existir al menos un producto de receta en la carta');
    productoId = Number(prod.id);

    await new Promise((resolve) => {
        server = app.listen(0, () => {
            baseUrl = `http://127.0.0.1:${server.address().port}`;
            resolve();
        });
    });
});

after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    try {
        if (createdMesaIds.length > 0) {
            const [pedidos] = await pool.query('SELECT id FROM pedidos WHERE mesa_id IN (?)', [createdMesaIds]);
            const allPedidoIds = [...new Set([...createdPedidoIds, ...pedidos.map((p) => p.id)])];
            if (allPedidoIds.length > 0) {
                await pool.query('UPDATE pedidos SET unido_a_pedido_id = NULL WHERE id IN (?) OR unido_a_pedido_id IN (?)', [allPedidoIds, allPedidoIds]);
                await pool.query('DELETE FROM detalles_pedido WHERE pedido_id IN (?)', [allPedidoIds]);
                await pool.query('DELETE FROM pedidos WHERE id IN (?)', [allPedidoIds]);
            }
            await pool.query('DELETE FROM mesas WHERE id IN (?)', [createdMesaIds]);
        }
    } finally {
        await pool.end();
    }
});

test('Unir Mesa 1 y Mesa 2 (con comandas historicas pagadas) deja ambas ocupadas y bloquea nuevas comandas en Mesa 2 hasta liberar o pagar', async () => {
    const mesa1 = await crearMesaPrueba('M1');
    const mesa2 = await crearMesaPrueba('M2');

    // Escenario real de produccion: ambas mesas ya atendieron clientes antes (tienen comandas pagadas en su historial).
    await registrarComandaHistoricaPagada(mesa1.id);
    await registrarComandaHistoricaPagada(mesa2.id);

    // Hoy se abren comandas en Mesa 1 y Mesa 2 y se unen en la Mesa 1.
    await abrirComanda(mesa1.id, 1);
    await abrirComanda(mesa2.id, 2);

    const joinRes = await api('POST', '/api/pedidos/juntar-mesas', {
        mesa_destino_id: mesa1.id,
        mesas_origen_ids: [mesa2.id]
    });
    assert.equal(joinRes.status, 200, JSON.stringify(joinRes.data));
    assert.equal(joinRes.data.comandas_unidas, 2);

    // Verificar que AMBAS quedan ocupadas: Mesa 1 con la comanda abierta y Mesa 2 como "unida a Mesa 1"
    // (incluso teniendo ultimo_estado_pedido = 'pagado' de su cliente anterior).
    const [m1, m2] = await estadoMesas(mesa1.id, mesa2.id);
    assert.equal(m1.ultimo_estado_pedido, 'pendiente');
    assert.equal(m1.unida_a_mesa_id, null);
    assert.equal(m2.ultimo_estado_pedido, 'pagado', 'El historial pagado existe pero no debe ocultar la union vigente');
    assert.equal(Number(m2.unida_a_mesa_id), mesa1.id, 'Mesa 2 debe figurar unida a Mesa 1');

    // No se debe permitir abrir una comanda individual en la Mesa 2 mientras siga unida.
    const intentoNuevo = await api('POST', '/api/pedidos', {
        mesa_id: mesa2.id,
        usuario_id: userId,
        detalles: [{ producto_id: productoId, cantidad: 1 }]
    });
    assert.equal(intentoNuevo.status, 409);
    assert.equal(Number(intentoNuevo.data.unida_a_mesa_id), mesa1.id);

    // Tampoco se puede elegir la Mesa 2 (que está unida) como destino de otra unión.
    const mesa3 = await crearMesaPrueba('M3');
    await abrirComanda(mesa3.id, 1);
    const intentoDestino = await api('POST', '/api/pedidos/juntar-mesas', {
        mesa_destino_id: mesa2.id,
        mesas_origen_ids: [mesa3.id]
    });
    assert.equal(intentoDestino.status, 409);

    // Al liberar la Mesa 1, tanto la Mesa 1 como la Mesa 2 vuelven a estar disponibles.
    const liberarRes = await api('POST', `/api/pedidos/mesa/${mesa1.id}/liberar`);
    assert.equal(liberarRes.status, 200);

    const [m1Libre, m2Libre] = await estadoMesas(mesa1.id, mesa2.id);
    assert.equal(m1Libre.ultimo_estado_pedido, 'pagado');
    assert.equal(m1Libre.unida_a_mesa_id, null);
    assert.equal(m2Libre.unida_a_mesa_id, null, 'Al liberarse la Mesa 1, la Mesa 2 queda libre automaticamente');

    // Ahora sí la Mesa 2 puede recibir un nuevo cliente normalmente.
    await abrirComanda(mesa2.id, 1);
    const [, m2Nueva] = await estadoMesas(mesa1.id, mesa2.id);
    assert.equal(m2Nueva.ultimo_estado_pedido, 'pendiente');
    assert.equal(m2Nueva.unida_a_mesa_id, null);
});

test('Unir hacia una mesa destino libre y pagar la cuenta libera todas las mesas unidas', async () => {
    const mesaDestinoLibre = await crearMesaPrueba('DL');
    const mesaOrigen1 = await crearMesaPrueba('O1');
    const mesaOrigen2 = await crearMesaPrueba('O2');

    await registrarComandaHistoricaPagada(mesaOrigen1.id);
    await abrirComanda(mesaOrigen1.id, 1);
    await abrirComanda(mesaOrigen2.id, 1);

    // Destino libre: tanto Origen 1 como Origen 2 deben quedar bloqueadas como unidas al destino.
    const joinRes = await api('POST', '/api/pedidos/juntar-mesas', {
        mesa_destino_id: mesaDestinoLibre.id,
        mesas_origen_ids: [mesaOrigen1.id, mesaOrigen2.id]
    });
    assert.equal(joinRes.status, 200, JSON.stringify(joinRes.data));
    assert.equal(joinRes.data.comandas_unidas, 2);

    const [d, o1, o2] = await estadoMesas(mesaDestinoLibre.id, mesaOrigen1.id, mesaOrigen2.id);
    assert.equal(d.ultimo_estado_pedido, 'pendiente');
    assert.equal(Number(o1.unida_a_mesa_id), mesaDestinoLibre.id, 'La primera mesa de origen tambien queda unida y bloqueada');
    assert.equal(Number(o2.unida_a_mesa_id), mesaDestinoLibre.id, 'La segunda mesa de origen tambien queda unida y bloqueada');

    // Cuando la cuenta del destino se paga, todas las mesas vuelven a quedar disponibles.
    await pool.query("UPDATE pedidos SET estado = 'pagado' WHERE id = ?", [joinRes.data.id]);

    const [dPagada, o1Libre, o2Libre] = await estadoMesas(mesaDestinoLibre.id, mesaOrigen1.id, mesaOrigen2.id);
    assert.equal(dPagada.ultimo_estado_pedido, 'pagado');
    assert.equal(o1Libre.unida_a_mesa_id, null);
    assert.equal(o2Libre.unida_a_mesa_id, null);
});
