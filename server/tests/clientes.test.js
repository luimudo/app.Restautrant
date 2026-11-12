const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');
const { signToken } = require('../auth');
const permisos = require('../permisos');
const { app, asegurarClientesActivo } = require('../index');

let server;
let baseUrl;
let token;
let sedeId;
let userId;
const createdClienteIds = [];
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

const crearCliente = async (nombre) => {
    const res = await api('POST', '/api/clientes', { nombre, telefono: '999111222', email: '', documento: '' });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    createdClienteIds.push(res.data.id);
    return res.data.id;
};

before(async () => {
    await permisos.iniciar();
    await asegurarClientesActivo();
    const [[admin]] = await pool.query(
        "SELECT id, sede_id FROM usuarios WHERE rol = 'administrador' AND sede_id IS NOT NULL LIMIT 1"
    );
    userId = admin.id;
    sedeId = Number(admin.sede_id);
    token = signToken({ uid: userId });
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    if (createdPedidoIds.length) await pool.query('DELETE FROM pedidos WHERE id IN (?)', [createdPedidoIds]);
    if (createdClienteIds.length) await pool.query('DELETE FROM clientes WHERE id IN (?)', [createdClienteIds]);
    server.close();
    await pool.end();
});

test('editar un cliente actualiza sus datos', async () => {
    const id = await crearCliente('Cliente Test Editar');
    const res = await api('PUT', `/api/clientes/${id}`, {
        nombre: 'Cliente Test Editado', telefono: '988777666', email: 'test@ejemplo.com', tipo_documento: 'DNI', documento: '12345678', direccion: 'Av. Prueba 123'
    });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    const [[row]] = await pool.query('SELECT * FROM clientes WHERE id = ?', [id]);
    assert.equal(row.nombre, 'Cliente Test Editado');
    assert.equal(row.tipo_documento, 'DNI');
    assert.equal(row.direccion, 'Av. Prueba 123');
});

test('editar sin nombre responde 400', async () => {
    const id = await crearCliente('Cliente Test Sin Nombre');
    const res = await api('PUT', `/api/clientes/${id}`, { nombre: '  ' });
    assert.equal(res.status, 400);
});

test('un cliente sin referencias se elimina', async () => {
    const id = await crearCliente('Cliente Test Eliminar');
    const res = await api('DELETE', `/api/clientes/${id}`);
    assert.equal(res.status, 200, JSON.stringify(res.data));
    const [rows] = await pool.query('SELECT id FROM clientes WHERE id = ?', [id]);
    assert.equal(rows.length, 0);
});

test('un cliente con pedidos no se elimina: responde 409 y se puede desactivar y reactivar', async () => {
    const id = await crearCliente('Cliente Test Con Pedido');
    const [p] = await pool.query(
        "INSERT INTO pedidos (sede_id, usuario_id, cliente_id, estado, total) VALUES (?, ?, ?, 'pagado', 10.00)",
        [sedeId, userId, id]
    );
    createdPedidoIds.push(p.insertId);

    const res = await api('DELETE', `/api/clientes/${id}`);
    assert.equal(res.status, 409, JSON.stringify(res.data));
    assert.equal(res.data.puede_desactivar, true);
    assert.match(res.data.error, /1 pedido/);
    const [rows] = await pool.query('SELECT id FROM clientes WHERE id = ?', [id]);
    assert.equal(rows.length, 1, 'el cliente no debe borrarse');

    const des = await api('PATCH', `/api/clientes/${id}/estado`, { activo: false });
    assert.equal(des.status, 200, JSON.stringify(des.data));
    const activos = await api('GET', '/api/clientes');
    assert.ok(!activos.data.some((c) => c.id === id), 'un desactivado no aparece en el listado por defecto');
    const todos = await api('GET', '/api/clientes?todos=1');
    assert.ok(todos.data.some((c) => c.id === id && Number(c.activo) === 0), 'aparece con ?todos=1 como desactivado');

    const act = await api('PATCH', `/api/clientes/${id}/estado`, { activo: true });
    assert.equal(act.status, 200);
    const [[row]] = await pool.query('SELECT activo FROM clientes WHERE id = ?', [id]);
    assert.equal(Number(row.activo), 1);
});
