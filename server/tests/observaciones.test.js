const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');
const { signToken } = require('../auth');
const permisos = require('../permisos');
const { app, asegurarDescuentos, asegurarStockDecimal, asegurarVersion2, asegurarObservacionesNov2026, personal } = require('../index');

/**
 * Observaciones del cliente (nov. 2026) contra la base de prueba:
 *   - Cajas por usuario: un cajero solo ve y opera las cajas que tiene asignadas; el administrador y el contador, todas.
 *   - Perfiles y permisos: solo el super admin.
 *   - Costo promedio ponderado con 4 decimales y tambien en compras de bebidas.
 * Los registros de prueba llevan el prefijo "[PRUEBA OBS]".
 */
const ETIQUETA = `[PRUEBA OBS ${Date.now().toString(36)}]`;
let server;
let baseUrl;
let sedeId;
let tokenAdmin;
const limpieza = { usuarios: [], cajas: [], sesiones: [], insumos: [], productos: [], compras: [] };

const api = async (method, path, body, token = tokenAdmin) => {
    const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-sede-id': String(sedeId) },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
};
const ok = (res, status = 200) => assert.equal(res.status, status, JSON.stringify(res.data));

const crearUsuario = async (rol, sede = sedeId) => {
    const sufijo = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
    const [r] = await pool.query(
        'INSERT INTO usuarios (nombre, usuario, email, password_hash, rol, sede_id) VALUES (?, ?, ?, ?, ?, ?)',
        [`${ETIQUETA} ${rol}`, `prueba_${rol}_${sufijo}`, `prueba_${rol}_${sufijo}@prueba.local`, 'x', rol, sede]
    );
    limpieza.usuarios.push(r.insertId);
    return { id: r.insertId, token: signToken({ uid: r.insertId }) };
};

before(async () => {
    await permisos.iniciar();
    await asegurarDescuentos();
    await asegurarStockDecimal();
    await asegurarVersion2();
    await asegurarObservacionesNov2026();
    await personal.asegurarEsquema();
    const [[admin]] = await pool.query("SELECT id, sede_id FROM usuarios WHERE rol = 'administrador' AND sede_id IS NOT NULL LIMIT 1");
    assert.ok(admin, 'Debe existir un administrador con sede');
    sedeId = Number(admin.sede_id);
    tokenAdmin = signToken({ uid: Number(admin.id) });
    await new Promise((resolve) => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
});

after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    try {
        if (limpieza.sesiones.length) {
            await pool.query("UPDATE caja_sesiones SET estado = 'cerrada', fecha_cierre = CURRENT_TIMESTAMP WHERE id IN (?) AND estado = 'abierta'", [limpieza.sesiones]);
        }
        if (limpieza.cajas.length) {
            await pool.query('DELETE FROM caja_usuarios WHERE caja_id IN (?)', [limpieza.cajas]);
            await pool.query("UPDATE cajas SET activo = 0, estado = 'cerrada' WHERE id IN (?)", [limpieza.cajas]);
        }
        if (limpieza.productos.length) await pool.query('UPDATE productos SET disponible = 0 WHERE id IN (?)', [limpieza.productos]);
        for (const id of limpieza.usuarios) {
            // Un usuario con sesiones de caja queda (la base es de prueba); sin referencias se elimina.
            await pool.query('DELETE FROM caja_usuarios WHERE usuario_id = ?', [id]);
            await pool.query('DELETE FROM usuarios WHERE id = ?', [id]).catch(() => pool.query("UPDATE usuarios SET rol = 'mozo' WHERE id = ?", [id]));
        }
    } finally {
        await pool.end();
    }
});

// ---------------- Perfiles y permisos ----------------
test('Perfiles y permisos: solo el super admin; el administrador de sede conserva Configuracion y usuarios', async () => {
    const admin = permisos.contextoDe('administrador');
    assert.ok(!admin.modulos.has('permisos'), 'El administrador no tiene el modulo de perfiles y permisos');
    assert.ok(admin.modulos.has('settings'), 'El administrador conserva Configuracion');
    assert.equal((await api('GET', '/api/permisos')).status, 403);
    assert.equal((await api('PUT', '/api/permisos/perfiles/mozo', { modulos: ['pos'] })).status, 403);
    ok(await api('GET', '/api/usuarios'));
    ok(await api('GET', '/api/perfiles'));

    const [[superadmin]] = await pool.query("SELECT id FROM usuarios WHERE rol = 'superadmin' LIMIT 1");
    if (superadmin) {
        const permisosSuper = await api('GET', '/api/permisos', undefined, signToken({ uid: Number(superadmin.id) }));
        ok(permisosSuper);
        assert.ok(permisosSuper.data.modulos.some((m) => m.clave === 'permisos'));
    }
});

// ---------------- Cajas por usuario ----------------
test('Cajas: el cajero solo ve y opera sus cajas (varias por turno); administrador y contador operan todas', async () => {
    const [[almacen]] = await pool.query('SELECT id FROM almacenes WHERE sede_id = ? AND activo = 1 LIMIT 1', [sedeId]);
    const cajero = await crearUsuario('caja');
    const cajero2 = await crearUsuario('caja');
    const contador = await crearUsuario('contador');

    const asignada = await api('POST', '/api/cajas', { descripcion: `${ETIQUETA} Caja 1`, almacen_id: almacen?.id || null, usuario_ids: [cajero.id, cajero2.id] });
    ok(asignada, 201);
    limpieza.cajas.push(asignada.data.id);
    const ajena = await api('POST', '/api/cajas', { descripcion: `${ETIQUETA} Caja 2`, almacen_id: almacen?.id || null });
    ok(ajena, 201);
    limpieza.cajas.push(ajena.data.id);

    // Usuarios de otra sede no se asignan.
    const [[otroUsuario]] = await pool.query('SELECT id FROM usuarios WHERE sede_id IS NOT NULL AND sede_id <> ? LIMIT 1', [sedeId]);
    if (otroUsuario) {
        assert.equal((await api('PUT', `/api/cajas/${ajena.data.id}`, { descripcion: `${ETIQUETA} Caja 2`, usuario_ids: [otroUsuario.id] })).status, 400);
    }

    // El administrador ve ambas con sus usuarios.
    const todas = await api('GET', '/api/cajas?todas=1');
    ok(todas);
    const c1 = todas.data.find((c) => c.id === asignada.data.id);
    assert.deepEqual(c1.usuarios.map((u) => u.id).sort(), [cajero.id, cajero2.id].sort());
    assert.ok(todas.data.some((c) => c.id === ajena.data.id));

    // El cajero solo ve la suya.
    const suyas = await api('GET', '/api/cajas', undefined, cajero.token);
    ok(suyas);
    assert.ok(suyas.data.some((c) => c.id === asignada.data.id));
    assert.ok(!suyas.data.some((c) => c.id === ajena.data.id), 'No ve la caja que no tiene asignada');

    // No puede abrir ni consultar la caja ajena.
    assert.equal((await api('POST', '/api/caja/apertura', { caja_id: ajena.data.id, monto_inicial: 0 }, cajero.token)).status, 403);
    assert.equal((await api('GET', `/api/caja/sesion-activa?caja_id=${ajena.data.id}`, undefined, cajero.token)).status, 403);

    // Abre la suya; el administrador abre la ajena.
    const sesion = await api('POST', '/api/caja/apertura', { caja_id: asignada.data.id, monto_inicial: 50, turno: 'Mañana' }, cajero.token);
    ok(sesion, 201);
    limpieza.sesiones.push(sesion.data.id);
    const sesionAjena = await api('POST', '/api/caja/apertura', { caja_id: ajena.data.id, monto_inicial: 10 });
    ok(sesionAjena, 201);
    limpieza.sesiones.push(sesionAjena.data.id);

    // Sin caja_id, la sesion activa del cajero es la de su caja (nunca la ajena aunque sea mas reciente).
    const activa = await api('GET', '/api/caja/sesion-activa', undefined, cajero.token);
    ok(activa);
    assert.equal(activa.data.caja_id, asignada.data.id);
    const abiertas = await api('GET', '/api/caja/sesiones-abiertas', undefined, cajero.token);
    ok(abiertas);
    assert.ok(abiertas.data.every((s) => s.caja_id === asignada.data.id));

    // Movimientos, resumen, informe y cierre de la caja ajena: prohibidos para el cajero.
    assert.equal((await api('POST', '/api/caja/movimiento-manual', { sesion_id: sesionAjena.data.id, tipo: 'ingreso', monto: 5, descripcion: 'x' }, cajero.token)).status, 403);
    assert.equal((await api('GET', `/api/caja/resumen/${sesionAjena.data.id}`, undefined, cajero.token)).status, 403);
    assert.equal((await api('GET', `/api/caja/sesiones/${sesionAjena.data.id}/informe`, undefined, cajero.token)).status, 403);
    assert.equal((await api('POST', '/api/caja/cierre', { sesion_id: sesionAjena.data.id, monto_contado: 10 }, cajero.token)).status, 403);
    const historial = await api('GET', '/api/caja/sesiones', undefined, cajero.token);
    ok(historial);
    assert.ok(!historial.data.sesiones.some((s) => s.caja_id === ajena.data.id));

    // El segundo cajero (otro turno) opera la misma caja: registra un movimiento y la cierra.
    ok(await api('POST', '/api/caja/movimiento-manual', { sesion_id: sesion.data.id, tipo: 'ingreso', monto: 5, descripcion: `${ETIQUETA} sencillo` }, cajero2.token), 201);
    const cierre = await api('POST', '/api/caja/cierre', { sesion_id: sesion.data.id, monto_contado: 55 }, cajero2.token);
    ok(cierre);
    assert.equal(cierre.data.estado, 'cerrada');

    // El contador (multisede, con Facturacion) ve y opera todas las cajas de la sede elegida.
    const delContador = await api('GET', '/api/cajas', undefined, contador.token);
    ok(delContador);
    assert.ok(delContador.data.some((c) => c.id === ajena.data.id) && delContador.data.some((c) => c.id === asignada.data.id));
    ok(await api('GET', `/api/caja/resumen/${sesionAjena.data.id}`, undefined, contador.token));
    ok(await api('POST', '/api/caja/cierre', { sesion_id: sesionAjena.data.id, monto_contado: 10 }, contador.token));

    // Quitar al cajero de la caja: deja de verla. Activar/desactivar sin usuario_ids conserva la asignacion.
    ok(await api('PUT', `/api/cajas/${asignada.data.id}`, { descripcion: `${ETIQUETA} Caja 1`, almacen_id: almacen?.id || null, activo: true }));
    assert.ok((await api('GET', '/api/cajas', undefined, cajero.token)).data.some((c) => c.id === asignada.data.id));
    ok(await api('PUT', `/api/cajas/${asignada.data.id}`, { descripcion: `${ETIQUETA} Caja 1`, almacen_id: almacen?.id || null, usuario_ids: [cajero2.id] }));
    assert.deepEqual((await api('GET', '/api/cajas', undefined, cajero.token)).data, []);
});

// ---------------- Costo promedio ----------------
test('Costo promedio: 4 decimales en insumos y promedio ponderado tambien en compras de bebidas', async () => {
    const [[proveedor]] = await pool.query('SELECT id FROM proveedores LIMIT 1');
    assert.ok(proveedor, 'Debe existir un proveedor');
    const [[unidad]] = await pool.query('SELECT id FROM unidades_medida WHERE activo = 1 LIMIT 1');
    const insumo = await api('POST', '/api/insumos', { nombre: `${ETIQUETA} Harina (g)`, costo_unitario: 0, stock_actual: 0, unidad_id: unidad?.id });
    ok(insumo);
    limpieza.insumos.push(insumo.data.id);

    // S/ 12.50 el kg = S/ 0.0125 el gramo: antes se guardaba 0.01 (20 % menos).
    ok(await api('POST', '/api/compras', { proveedor_id: proveedor.id, numero_factura_proveedor: `${ETIQUETA} F1`, detalles: [{ insumo_id: insumo.data.id, cantidad: 1000, precio_unitario: 0.0125 }] }));
    let [[fila]] = await pool.query('SELECT costo_unitario FROM insumos WHERE id = ?', [insumo.data.id]);
    assert.equal(Number(fila.costo_unitario), 0.0125);
    ok(await api('POST', '/api/compras', { proveedor_id: proveedor.id, numero_factura_proveedor: `${ETIQUETA} F2`, detalles: [{ insumo_id: insumo.data.id, cantidad: 1000, precio_unitario: 0.0175 }] }));
    [[fila]] = await pool.query('SELECT costo_unitario FROM insumos WHERE id = ?', [insumo.data.id]);
    assert.equal(Number(fila.costo_unitario), 0.015, '(1000 x 0.0125 + 1000 x 0.0175) / 2000');

    // Bebida: antes la compra no tocaba su costo.
    const [[categoria]] = await pool.query('SELECT id FROM tipos_producto ORDER BY id LIMIT 1');
    const bebida = await api('POST', '/api/productos', { nombre: `${ETIQUETA} Gaseosa`, precio: 5, tipo_id: categoria.id, es_receta: false, disponible: false, stock: 0 });
    ok(bebida);
    limpieza.productos.push(bebida.data.id);
    ok(await api('POST', '/api/compras', { proveedor_id: proveedor.id, numero_factura_proveedor: `${ETIQUETA} F3`, detalles: [{ producto_id: bebida.data.id, cantidad: 10, precio_unitario: 2.5 }] }));
    ok(await api('POST', '/api/compras', { proveedor_id: proveedor.id, numero_factura_proveedor: `${ETIQUETA} F4`, detalles: [{ producto_id: bebida.data.id, cantidad: 30, precio_unitario: 3.5 }] }));
    const [[prod]] = await pool.query('SELECT costo_unitario FROM productos WHERE id = ?', [bebida.data.id]);
    assert.equal(Number(prod.costo_unitario), 3.25, '(10 x 2.50 + 30 x 3.50) / 40');
});
