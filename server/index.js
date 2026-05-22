const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const pool = require('./db');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Routes
// We will define routes here or import them

// Basic Health Check
app.get('/', (req, res) => {
    res.send('Restaurant System API Running');
});

const USER_PROFILES = ['administrador', 'mozo', 'caja', 'cocina'];
const PROFILE_ALIASES = {
    administrador: 'administrador',
    admin: 'administrador',
    mozo: 'mozo',
    mesero: 'mozo',
    caja: 'caja',
    cajero: 'caja',
    cocina: 'cocina',
    cocinero: 'cocina'
};

const normalizeProfile = (value) => {
    if (typeof value !== 'string') return null;
    return PROFILE_ALIASES[value.toLowerCase().trim()] || null;
};

const requireProfiles = (...allowedProfiles) => {
    const normalizedAllowed = allowedProfiles
        .map((profile) => normalizeProfile(profile))
        .filter(Boolean);

    return (req, res, next) => {
        const currentProfile = normalizeProfile(req.userContext?.perfil);
        if (!currentProfile) {
            return res.status(401).json({
                error: 'No autenticado para esta operacion',
                perfiles_permitidos: normalizedAllowed
            });
        }

        if (!normalizedAllowed.includes(currentProfile)) {
            return res.status(403).json({
                error: 'No autorizado para esta operacion',
                perfil_actual: currentProfile,
                perfiles_permitidos: normalizedAllowed
            });
        }

        next();
    };
};

const allowAnyProfile = requireProfiles(...USER_PROFILES);
const allowAdmin = requireProfiles('administrador');
const allowAdminOrCashier = requireProfiles('administrador', 'caja');
const allowAdminOrWaiter = requireProfiles('administrador', 'mozo');
const allowAdminOrKitchen = requireProfiles('administrador', 'cocina');
const allowAdminWaiterCashier = requireProfiles('administrador', 'mozo', 'caja');
const allowAdminKitchenForWrites = requireProfiles('administrador', 'cocina');

app.use('/api', async (req, _res, next) => {
    req.userContext = {
        id: null,
        perfil: normalizeProfile(req.header('x-user-profile'))
    };

    const rawUserId = req.header('x-user-id');
    if (!rawUserId) return next();

    const userId = Number(rawUserId);
    if (!Number.isInteger(userId) || userId <= 0) return next();

    try {
        const [rows] = await pool.query(
            'SELECT id, nombre, rol FROM usuarios WHERE id = ? LIMIT 1',
            [userId]
        );

        if (rows.length > 0) {
            req.userContext = {
                id: Number(rows[0].id),
                nombre: rows[0].nombre,
                perfil: normalizeProfile(rows[0].rol)
            };
        }
    } catch (error) {
        console.error('Error resolving user context:', error.message);
    }

    next();
});

// --- Perfiles / Usuarios ---
app.get('/api/perfiles', (_req, res) => {
    res.json(USER_PROFILES);
});

app.get('/api/usuarios', async (_req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT id, nombre, email, rol as perfil, creado_en
            FROM usuarios
            ORDER BY creado_en DESC
        `);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/usuarios/:id', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT id, nombre, email, rol as perfil, creado_en
            FROM usuarios
            WHERE id = ?
        `, [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/usuarios', allowAdmin, async (req, res) => {
    const { nombre, email, password, perfil } = req.body;
    const normalizedProfile = normalizeProfile(perfil);

    if (!nombre || !email || !password || !normalizedProfile) {
        return res.status(400).json({
            error: 'nombre, email, password y perfil son obligatorios',
            perfiles_validos: USER_PROFILES
        });
    }

    try {
        const [result] = await pool.query(
            'INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES (?, ?, ?, ?)',
            [nombre, email, password, normalizedProfile]
        );
        res.status(201).json({
            id: result.insertId,
            nombre,
            email,
            perfil: normalizedProfile
        });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'El email ya existe' });
        }
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/usuarios/:id', allowAdmin, async (req, res) => {
    const { nombre, email, password, perfil } = req.body;
    try {
        const [existingRows] = await pool.query('SELECT * FROM usuarios WHERE id = ?', [req.params.id]);
        if (existingRows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });

        const existing = existingRows[0];
        const normalizedProfile = perfil !== undefined ? normalizeProfile(perfil) : existing.rol;
        if (!normalizedProfile) {
            return res.status(400).json({
                error: 'Perfil invalido',
                perfiles_validos: USER_PROFILES
            });
        }

        const nextNombre = nombre ?? existing.nombre;
        const nextEmail = email ?? existing.email;
        const nextPasswordHash = password ?? existing.password_hash;

        await pool.query(
            'UPDATE usuarios SET nombre = ?, email = ?, password_hash = ?, rol = ? WHERE id = ?',
            [nextNombre, nextEmail, nextPasswordHash, normalizedProfile, req.params.id]
        );

        res.json({
            id: Number(req.params.id),
            nombre: nextNombre,
            email: nextEmail,
            perfil: normalizedProfile
        });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'El email ya existe' });
        }
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/usuarios/:id', allowAdmin, async (req, res) => {
    try {
        const [result] = await pool.query('DELETE FROM usuarios WHERE id = ?', [req.params.id]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
        res.json({ message: 'Usuario eliminado' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Clientes ---
app.get('/api/clientes', allowAnyProfile, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM clientes');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/clientes/:id', allowAnyProfile, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM clientes WHERE id = ?', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ message: 'Cliente no encontrado' });
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/clientes', allowAdminWaiterCashier, async (req, res) => {
    const { nombre, telefono, email, documento } = req.body;
    try {
        const [result] = await pool.query(
            'INSERT INTO clientes (nombre, telefono, email, documento) VALUES (?, ?, ?, ?)',
            [nombre, telefono, email, documento]
        );
        res.json({ id: result.insertId, ...req.body });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Zonas ---
app.get('/api/zonas', allowAnyProfile, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM zonas');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/zonas/:id', allowAnyProfile, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM zonas WHERE id = ?', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ message: 'Zona no encontrada' });
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/zonas', allowAdmin, async (req, res) => {
    const { nombre } = req.body;
    try {
        const [result] = await pool.query(
            'INSERT INTO zonas (nombre) VALUES (?)',
            [nombre]
        );
        res.json({ id: result.insertId, nombre });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/zonas/:id', allowAdmin, async (req, res) => {
    const { nombre, estado } = req.body;
    try {
        await pool.query(
            'UPDATE zonas SET nombre = ?, estado = ? WHERE id = ?',
            [nombre, estado !== undefined ? estado : true, req.params.id]
        );
        res.json({ message: 'Zona actualizada' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/zonas/:id', allowAdmin, async (req, res) => {
    try {
        await pool.query('DELETE FROM zonas WHERE id = ?', [req.params.id]);
        res.json({ message: 'Zona eliminada' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const buildCashSessionSummary = async (connection, sessionId) => {
    const [sessionRows] = await connection.query(`
        SELECT
            s.*,
            c.descripcion as caja_descripcion,
            ua.nombre as usuario_apertura_nombre,
            uc.nombre as usuario_cierre_nombre
        FROM caja_sesiones s
        JOIN cajas c ON c.id = s.caja_id
        LEFT JOIN usuarios ua ON ua.id = s.usuario_apertura_id
        LEFT JOIN usuarios uc ON uc.id = s.usuario_cierre_id
        WHERE s.id = ?
        LIMIT 1
    `, [sessionId]);

    if (sessionRows.length === 0) {
        return null;
    }

    const session = sessionRows[0];

    const [movSummaryRows] = await connection.query(`
        SELECT
            COALESCE(SUM(CASE WHEN tipo = 'ingreso' THEN monto ELSE 0 END), 0) as ingresos_manual,
            COALESCE(SUM(CASE WHEN tipo = 'egreso' THEN monto ELSE 0 END), 0) as egresos_manual
        FROM movimientos_caja
        WHERE sesion_id = ?
    `, [sessionId]);

    const [salesSummaryRows] = await connection.query(`
        SELECT
            COUNT(*) as comprobantes,
            COALESCE(SUM(total_venta), 0) as ventas_totales
        FROM facturas
        WHERE sesion_caja_id = ?
    `, [sessionId]);

    const movSummary = movSummaryRows[0] || {};
    const salesSummary = salesSummaryRows[0] || {};

    const montoInicial = Number(session.monto_inicial) || 0;
    const ingresosManual = Number(movSummary.ingresos_manual) || 0;
    const egresosManual = Number(movSummary.egresos_manual) || 0;
    const ventasTotales = Number(salesSummary.ventas_totales) || 0;
    const montoTeorico = montoInicial + ingresosManual - egresosManual + ventasTotales;

    const [movRows] = await connection.query(`
        SELECT id, tipo, monto, descripcion, fecha, usuario_id
        FROM movimientos_caja
        WHERE sesion_id = ?
        ORDER BY fecha DESC
        LIMIT 30
    `, [sessionId]);

    return {
        ...session,
        resumen: {
            monto_inicial: Number(montoInicial.toFixed(2)),
            ingresos_manual: Number(ingresosManual.toFixed(2)),
            egresos_manual: Number(egresosManual.toFixed(2)),
            ventas_totales: Number(ventasTotales.toFixed(2)),
            comprobantes: Number(salesSummary.comprobantes) || 0,
            monto_teorico: Number(montoTeorico.toFixed(2)),
            diferencia_actual: session.monto_contado_cierre !== null
                ? Number((Number(session.monto_contado_cierre) - montoTeorico).toFixed(2))
                : null
        },
        movimientos: movRows
    };
};

// --- Cajas ---
app.get('/api/cajas', allowAdminOrCashier, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM cajas');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/cajas', allowAdmin, async (req, res) => {
    const { descripcion, saldo, estado } = req.body;
    try {
        const [result] = await pool.query(
            'INSERT INTO cajas (descripcion, saldo, estado) VALUES (?, ?, ?)',
            [descripcion, saldo || 0, estado || 'cerrada']
        );
        res.json({ id: result.insertId, ...req.body });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/caja/sesion-activa', allowAdminOrCashier, async (req, res) => {
    const cajaId = req.query.caja_id ? Number(req.query.caja_id) : null;
    try {
        const [rows] = await pool.query(`
            SELECT id
            FROM caja_sesiones
            WHERE estado = 'abierta' ${cajaId ? 'AND caja_id = ?' : ''}
            ORDER BY fecha_apertura DESC
            LIMIT 1
        `, cajaId ? [cajaId] : []);

        if (rows.length === 0) {
            return res.json(null);
        }

        const sessionSummary = await buildCashSessionSummary(pool, rows[0].id);
        res.json(sessionSummary);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/caja/apertura', allowAdminOrCashier, async (req, res) => {
    const { caja_id, usuario_id, monto_inicial, observaciones } = req.body;
    const cajaId = Number(caja_id);
    const userId = usuario_id ? Number(usuario_id) : null;
    const montoInicial = Number(monto_inicial) || 0;

    if (!cajaId) {
        return res.status(400).json({ error: 'caja_id es obligatorio' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [activeRows] = await connection.query(
            `SELECT id FROM caja_sesiones WHERE caja_id = ? AND estado = 'abierta' LIMIT 1`,
            [cajaId]
        );
        if (activeRows.length > 0) {
            await connection.rollback();
            return res.status(409).json({ error: 'Ya existe una sesion abierta para esta caja' });
        }

        const [cajaRows] = await connection.query('SELECT id FROM cajas WHERE id = ? LIMIT 1', [cajaId]);
        if (cajaRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Caja no encontrada' });
        }

        const [result] = await connection.query(
            `INSERT INTO caja_sesiones (caja_id, usuario_apertura_id, monto_inicial, observaciones_apertura, estado)
             VALUES (?, ?, ?, ?, 'abierta')`,
            [cajaId, userId, montoInicial, observaciones || null]
        );

        await connection.query('UPDATE cajas SET estado = ? WHERE id = ?', ['abierta', cajaId]);
        await connection.commit();

        const summary = await buildCashSessionSummary(pool, result.insertId);
        res.status(201).json(summary);
    } catch (err) {
        await connection.rollback();
        res.status(500).json({ error: err.message });
    } finally {
        connection.release();
    }
});

app.get('/api/caja/resumen/:sesionId', allowAdminOrCashier, async (req, res) => {
    const sessionId = Number(req.params.sesionId);
    if (!sessionId) return res.status(400).json({ error: 'sesionId invalido' });
    try {
        const summary = await buildCashSessionSummary(pool, sessionId);
        if (!summary) return res.status(404).json({ error: 'Sesion no encontrada' });
        res.json(summary);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/caja/movimiento-manual', allowAdminOrCashier, async (req, res) => {
    const { sesion_id, tipo, monto, descripcion, usuario_id } = req.body;
    const sessionId = Number(sesion_id);
    const amount = Number(monto);
    const userId = usuario_id ? Number(usuario_id) : null;

    if (!sessionId || !['ingreso', 'egreso'].includes(tipo) || !(amount > 0)) {
        return res.status(400).json({ error: 'sesion_id, tipo y monto validos son obligatorios' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [sessionRows] = await connection.query(
            `SELECT id, caja_id, estado FROM caja_sesiones WHERE id = ? LIMIT 1`,
            [sessionId]
        );
        if (sessionRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Sesion no encontrada' });
        }

        const session = sessionRows[0];
        if (session.estado !== 'abierta') {
            await connection.rollback();
            return res.status(409).json({ error: 'La sesion ya esta cerrada' });
        }

        await connection.query(
            `INSERT INTO movimientos_caja (caja_id, sesion_id, tipo, monto, descripcion, usuario_id)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [session.caja_id, sessionId, tipo, amount, descripcion || null, userId]
        );

        const adjustment = tipo === 'ingreso' ? amount : -amount;
        await connection.query('UPDATE cajas SET saldo = saldo + ? WHERE id = ?', [adjustment, session.caja_id]);

        await connection.commit();
        const summary = await buildCashSessionSummary(pool, sessionId);
        res.status(201).json(summary);
    } catch (err) {
        await connection.rollback();
        res.status(500).json({ error: err.message });
    } finally {
        connection.release();
    }
});

app.post('/api/caja/cierre', allowAdminOrCashier, async (req, res) => {
    const { sesion_id, usuario_cierre_id, monto_contado, observaciones } = req.body;
    const sessionId = Number(sesion_id);
    const userId = usuario_cierre_id ? Number(usuario_cierre_id) : null;
    const cashCounted = Number(monto_contado);

    if (!sessionId || Number.isNaN(cashCounted)) {
        return res.status(400).json({ error: 'sesion_id y monto_contado son obligatorios' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const summary = await buildCashSessionSummary(connection, sessionId);
        if (!summary) {
            await connection.rollback();
            return res.status(404).json({ error: 'Sesion no encontrada' });
        }
        if (summary.estado !== 'abierta') {
            await connection.rollback();
            return res.status(409).json({ error: 'La sesion ya fue cerrada' });
        }

        const montoTeorico = Number(summary.resumen?.monto_teorico || 0);
        const diferencia = Number((cashCounted - montoTeorico).toFixed(2));

        await connection.query(`
            UPDATE caja_sesiones
            SET
                estado = 'cerrada',
                fecha_cierre = CURRENT_TIMESTAMP,
                usuario_cierre_id = ?,
                monto_teorico_cierre = ?,
                monto_contado_cierre = ?,
                diferencia = ?,
                observaciones_cierre = ?
            WHERE id = ?
        `, [userId, montoTeorico, cashCounted, diferencia, observaciones || null, sessionId]);

        await connection.query('UPDATE cajas SET estado = ? WHERE id = ?', ['cerrada', summary.caja_id]);
        await connection.commit();

        const closedSummary = await buildCashSessionSummary(pool, sessionId);
        res.json(closedSummary);
    } catch (err) {
        await connection.rollback();
        res.status(500).json({ error: err.message });
    } finally {
        connection.release();
    }
});

app.post('/api/cajas/:id/movimientos', allowAdminOrCashier, async (req, res) => {
    const { tipo, monto, descripcion, usuario_id } = req.body;
    const caja_id = req.params.id;

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [activeSessionRows] = await connection.query(
            `SELECT id FROM caja_sesiones WHERE caja_id = ? AND estado = 'abierta' ORDER BY fecha_apertura DESC LIMIT 1`,
            [caja_id]
        );
        const activeSessionId = activeSessionRows.length > 0 ? activeSessionRows[0].id : null;

        // Register movement
        await connection.query(
            'INSERT INTO movimientos_caja (caja_id, sesion_id, tipo, monto, descripcion, usuario_id) VALUES (?, ?, ?, ?, ?, ?)',
            [caja_id, activeSessionId, tipo, monto, descripcion, usuario_id]
        );

        // Update caja balance
        const adjustment = tipo === 'ingreso' ? monto : -monto;
        await connection.query(
            'UPDATE cajas SET saldo = saldo + ? WHERE id = ?',
            [adjustment, caja_id]
        );

        await connection.commit();
        res.json({ message: 'Movimiento registrado exitosamente' });
    } catch (err) {
        await connection.rollback();
        res.status(500).json({ error: err.message });
    } finally {
        connection.release();
    }
});

// --- Mesas ---
app.get('/api/mesas', allowAnyProfile, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT m.*, z.nombre as zona_nombre,
            (
                SELECT p2.estado
                FROM pedidos p2
                WHERE p2.mesa_id = m.id
                  AND EXISTS (
                      SELECT 1
                      FROM detalles_pedido dp2
                      WHERE dp2.pedido_id = p2.id
                  )
                ORDER BY p2.fecha_creacion DESC
                LIMIT 1
            ) as ultimo_estado_pedido
            FROM mesas m 
            LEFT JOIN zonas z ON m.zona_id = z.id
        `);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/mesas/:id', allowAnyProfile, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT m.*, z.nombre as zona_nombre 
            FROM mesas m 
            LEFT JOIN zonas z ON m.zona_id = z.id 
            WHERE m.id = ?
        `, [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ message: 'Mesa no encontrada' });
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/mesas', allowAdmin, async (req, res) => {
    const { numero, capacidad, zona_id } = req.body;
    try {
        const [result] = await pool.query(
            'INSERT INTO mesas (numero, capacidad, zona_id) VALUES (?, ?, ?)',
            [numero, capacidad, zona_id]
        );
        res.json({ id: result.insertId, ...req.body });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/mesas/:id', allowAdmin, async (req, res) => {
    const { numero, capacidad, zona_id, estado } = req.body;
    try {
        await pool.query(
            'UPDATE mesas SET numero = ?, capacidad = ?, zona_id = ?, estado = ? WHERE id = ?',
            [numero, capacidad, zona_id, estado || 'libre', req.params.id]
        );
        res.json({ message: 'Mesa actualizada' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/mesas/:id', allowAdmin, async (req, res) => {
    try {
        await pool.query('DELETE FROM mesas WHERE id = ?', [req.params.id]);
        res.json({ message: 'Mesa eliminada' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Proveedores ---
app.get('/api/proveedores', allowAdminKitchenForWrites, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM proveedores');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/proveedores', allowAdminKitchenForWrites, async (req, res) => {
    const { razon_social, ruc, contacto, telefono, direccion } = req.body;
    try {
        const [result] = await pool.query(
            'INSERT INTO proveedores (razon_social, ruc, contacto, telefono, direccion) VALUES (?, ?, ?, ?, ?)',
            [razon_social, ruc, contacto, telefono, direccion]
        );
        res.json({ id: result.insertId, ...req.body });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/proveedores/:id', allowAdminKitchenForWrites, async (req, res) => {
    const { razon_social, ruc, contacto, telefono, direccion } = req.body;
    try {
        await pool.query(
            'UPDATE proveedores SET razon_social = ?, ruc = ?, contacto = ?, telefono = ?, direccion = ? WHERE id = ?',
            [razon_social, ruc, contacto, telefono, direccion, req.params.id]
        );
        res.json({ message: 'Proveedor actualizado' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/proveedores/:id', allowAdminKitchenForWrites, async (req, res) => {
    try {
        await pool.query('DELETE FROM proveedores WHERE id = ?', [req.params.id]);
        res.json({ message: 'Proveedor eliminado' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Insumos ---
app.get('/api/insumos', allowAdminKitchenForWrites, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM insumos');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/insumos', allowAdminKitchenForWrites, async (req, res) => {
    const { nombre, unidad_medida, costo_unitario, stock_actual } = req.body;
    try {
        const [result] = await pool.query(
            'INSERT INTO insumos (nombre, unidad_medida, costo_unitario, stock_actual) VALUES (?, ?, ?, ?)',
            [nombre, unidad_medida, costo_unitario, stock_actual]
        );
        res.json({ id: result.insertId, ...req.body });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.put('/api/insumos/:id', allowAdminKitchenForWrites, async (req, res) => {
    const { nombre, unidad_medida, costo_unitario, stock_actual } = req.body;
    try {
        await pool.query(
            'UPDATE insumos SET nombre = ?, unidad_medida = ?, costo_unitario = ?, stock_actual = ? WHERE id = ?',
            [nombre, unidad_medida, costo_unitario, stock_actual, req.params.id]
        );
        res.json({ message: 'Insumo actualizado' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/insumos/:id', allowAdminKitchenForWrites, async (req, res) => {
    try {
        await pool.query('DELETE FROM insumos WHERE id = ?', [req.params.id]);
        res.json({ message: 'Insumo eliminado' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Compras ---
app.post('/api/compras', allowAdminKitchenForWrites, async (req, res) => {
    const { proveedor_id, detalles, numero_factura_proveedor } = req.body;
    // detalles is array of { insumo_id, producto_id, cantidad, precio_unitario }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        let total = 0;
        detalles.forEach(item => {
            total += item.cantidad * item.precio_unitario;
        });

        // Create Purchase Header
        const [compraResult] = await connection.query(
            'INSERT INTO compras (proveedor_id, total, numero_factura_proveedor, estado) VALUES (?, ?, ?, ?)',
            [proveedor_id, total, numero_factura_proveedor, 'recibido']
        );
        const compraId = compraResult.insertId;

        // Create Details and Update Stock
        for (const item of detalles) {
            const subtotal = item.cantidad * item.precio_unitario;
            await connection.query(
                'INSERT INTO detalles_compra (compra_id, insumo_id, producto_id, cantidad, precio_unitario, subtotal) VALUES (?, ?, ?, ?, ?, ?)',
                [compraId, item.insumo_id || null, item.producto_id || null, item.cantidad, item.precio_unitario, subtotal]
            );

            // Update Stock
            if (item.producto_id) {
                await connection.query(
                    'UPDATE productos SET stock = stock + ? WHERE id = ?',
                    [item.cantidad, item.producto_id]
                );
            } else if (item.insumo_id) {
                await connection.query(
                    'UPDATE insumos SET stock_actual = stock_actual + ?, costo_unitario = ? WHERE id = ?',
                    [item.cantidad, item.precio_unitario, item.insumo_id]
                );
            }
        }

        await connection.commit();
        res.json({ id: compraId, total, message: 'Compra registrada y stock actualizado' });

    } catch (err) {
        await connection.rollback();
        console.error('Error in POST /api/compras:', err);
        res.status(500).json({ error: err.message });
    } finally {
        connection.release();
    }
});

// --- Tipos de Producto (Categorías) ---
app.get('/api/categorias', allowAdminKitchenForWrites, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM tipos_producto');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/categorias/:id', allowAdminKitchenForWrites, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM tipos_producto WHERE id = ?', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ message: 'Categoría no encontrada' });
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/categorias', allowAdminKitchenForWrites, async (req, res) => {
    const { nombre, descripcion, es_barra } = req.body;
    try {
        const [result] = await pool.query(
            'INSERT INTO tipos_producto (nombre, descripcion, es_barra) VALUES (?, ?, ?)',
            [nombre, descripcion, es_barra || false]
        );
        res.json({ id: result.insertId, ...req.body });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/categorias/:id', allowAdminKitchenForWrites, async (req, res) => {
    const { nombre, descripcion, es_barra } = req.body;
    try {
        await pool.query(
            'UPDATE tipos_producto SET nombre = ?, descripcion = ?, es_barra = ? WHERE id = ?',
            [nombre, descripcion, es_barra, req.params.id]
        );
        res.json({ message: 'Categoría actualizada' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/categorias/:id', allowAdminKitchenForWrites, async (req, res) => {
    try {
        await pool.query('DELETE FROM tipos_producto WHERE id = ?', [req.params.id]);
        res.json({ message: 'Categoría eliminada' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Productos ---
app.get('/api/productos', allowAnyProfile, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT p.*, t.nombre as tipo_nombre, t.es_barra
            FROM productos p 
            LEFT JOIN tipos_producto t ON p.tipo_id = t.id
        `);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/productos/:id', allowAnyProfile, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT p.*, t.nombre as tipo_nombre, t.es_barra
            FROM productos p 
            LEFT JOIN tipos_producto t ON p.tipo_id = t.id
            WHERE p.id = ?
        `, [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ message: 'Producto no encontrado' });
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/productos', allowAdminKitchenForWrites, async (req, res) => {
    const { nombre, descripcion, precio, tipo_id, es_receta, disponible, stock } = req.body;
    try {
        const [result] = await pool.query(
            'INSERT INTO productos (nombre, descripcion, precio, tipo_id, es_receta, disponible, stock) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [nombre, descripcion, precio, tipo_id, es_receta !== undefined ? es_receta : true, disponible !== undefined ? disponible : true, stock || 0]
        );
        res.json({ id: result.insertId, ...req.body });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/productos/:id', allowAdminKitchenForWrites, async (req, res) => {
    const { nombre, descripcion, precio, tipo_id, es_receta, disponible, stock } = req.body;
    try {
        await pool.query(
            'UPDATE productos SET nombre = ?, descripcion = ?, precio = ?, tipo_id = ?, es_receta = ?, disponible = ?, stock = ? WHERE id = ?',
            [nombre, descripcion, precio, tipo_id, es_receta, disponible, stock || 0, req.params.id]
        );
        res.json({ message: 'Producto actualizado' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/productos/:id', allowAdminKitchenForWrites, async (req, res) => {
    try {
        await pool.query('DELETE FROM productos WHERE id = ?', [req.params.id]);
        res.json({ message: 'Producto eliminado' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Pedidos ---
app.get('/api/pedidos/mesa/:mesaId/activo', allowAdminWaiterCashier, async (req, res) => {
    try {
        const [pedidos] = await pool.query(`
            SELECT id, estado, total 
            FROM pedidos 
            WHERE mesa_id = ?
              AND estado NOT IN ('pagado', 'cancelado')
              AND EXISTS (
                  SELECT 1
                  FROM detalles_pedido dp
                  WHERE dp.pedido_id = pedidos.id
              )
            ORDER BY fecha_creacion DESC LIMIT 1
        `, [req.params.mesaId]);

        if (pedidos.length === 0) {
            return res.json(null);
        }

        const pedido = pedidos[0];
        const [detalles] = await pool.query(`
            SELECT dp.*, p.nombre as producto_nombre, p.precio, tp.es_barra
            FROM detalles_pedido dp
            JOIN productos p ON dp.producto_id = p.id
            LEFT JOIN tipos_producto tp ON p.tipo_id = tp.id
            WHERE dp.pedido_id = ?
        `, [pedido.id]);

        res.json({ ...pedido, detalles });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/pedidos', allowAnyProfile, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT p.*, m.numero as mesa_numero, c.nombre as cliente_nombre 
            FROM pedidos p 
            LEFT JOIN mesas m ON p.mesa_id = m.id 
            LEFT JOIN clientes c ON p.cliente_id = c.id
            ORDER BY p.fecha_creacion DESC
        `);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/pedidos/:id/detalle', allowAdminWaiterCashier, async (req, res) => {
    try {
        const [pedidoRows] = await pool.query(`
            SELECT p.*, m.numero as mesa_numero, c.nombre as cliente_nombre
            FROM pedidos p
            LEFT JOIN mesas m ON p.mesa_id = m.id
            LEFT JOIN clientes c ON p.cliente_id = c.id
            WHERE p.id = ?
            LIMIT 1
        `, [req.params.id]);

        if (pedidoRows.length === 0) {
            return res.status(404).json({ error: 'Pedido no encontrado' });
        }

        const pedido = pedidoRows[0];
        const [detalles] = await pool.query(`
            SELECT
                dp.*,
                p.nombre as producto_nombre,
                p.precio
            FROM detalles_pedido dp
            LEFT JOIN productos p ON dp.producto_id = p.id
            WHERE dp.pedido_id = ?
            ORDER BY dp.id ASC
        `, [req.params.id]);

        res.json({ ...pedido, detalles: Array.isArray(detalles) ? detalles : [] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/pedidos/cocina', allowAdminOrKitchen, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT 
                p.id as pedido_id, p.mesa_id, p.cliente_id, p.fecha_creacion, p.estado, p.total,
                m.numero as mesa_numero,
                c.nombre as cliente_nombre,
                dp.id as detalle_id, dp.producto_id, dp.cantidad, dp.notas,
                prod.nombre as producto_nombre, dp.estado_comanda
            FROM pedidos p
            LEFT JOIN mesas m ON p.mesa_id = m.id
            LEFT JOIN clientes c ON p.cliente_id = c.id
            JOIN detalles_pedido dp ON p.id = dp.pedido_id
            JOIN productos prod ON dp.producto_id = prod.id
            LEFT JOIN tipos_producto tp ON prod.tipo_id = tp.id
            WHERE p.estado IN ('pendiente', 'en_proceso', 'listo')
            AND (tp.es_barra = 0 OR tp.es_barra IS NULL)
            AND date(p.fecha_creacion) = date('now')
            ORDER BY p.fecha_creacion ASC
        `);

        const pedidosMap = {};
        rows.forEach(row => {
            if (!pedidosMap[row.pedido_id]) {
                pedidosMap[row.pedido_id] = {
                    id: row.pedido_id,
                    mesa_id: row.mesa_id,
                    mesa_numero: row.mesa_numero,
                    cliente_nombre: row.cliente_nombre,
                    fecha_creacion: row.fecha_creacion,
                    estado: row.estado,
                    total: row.total,
                    detalles: []
                };
            }
            pedidosMap[row.pedido_id].detalles.push({
                detalle_id: row.detalle_id,
                producto_id: row.producto_id,
                producto_nombre: row.producto_nombre,
                cantidad: row.cantidad,
                notas: row.notas,
                estado_comanda: row.estado_comanda
            });
        });

        res.json(Object.values(pedidosMap));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/pedidos/bar', allowAdminOrKitchen, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT 
                p.id as pedido_id, p.mesa_id, p.cliente_id, p.fecha_creacion, p.estado, p.total,
                m.numero as mesa_numero,
                c.nombre as cliente_nombre,
                dp.id as detalle_id, dp.producto_id, dp.cantidad, dp.notas,
                prod.nombre as producto_nombre, dp.estado_comanda
            FROM pedidos p
            LEFT JOIN mesas m ON p.mesa_id = m.id
            LEFT JOIN clientes c ON p.cliente_id = c.id
            JOIN detalles_pedido dp ON p.id = dp.pedido_id
            JOIN productos prod ON dp.producto_id = prod.id
            JOIN tipos_producto tp ON prod.tipo_id = tp.id
            WHERE p.estado IN ('pendiente', 'en_proceso', 'listo')
            AND tp.es_barra = 1
            AND date(p.fecha_creacion) = date('now')
            ORDER BY p.fecha_creacion ASC
        `);

        const pedidosMap = {};
        rows.forEach(row => {
            if (!pedidosMap[row.pedido_id]) {
                pedidosMap[row.pedido_id] = {
                    id: row.pedido_id,
                    mesa_id: row.mesa_id,
                    mesa_numero: row.mesa_numero,
                    cliente_nombre: row.cliente_nombre,
                    fecha_creacion: row.fecha_creacion,
                    estado: row.estado,
                    total: row.total,
                    detalles: []
                };
            }
            pedidosMap[row.pedido_id].detalles.push({
                detalle_id: row.detalle_id,
                producto_id: row.producto_id,
                producto_nombre: row.producto_nombre,
                cantidad: row.cantidad,
                notas: row.notas,
                estado_comanda: row.estado_comanda
            });
        });

        res.json(Object.values(pedidosMap));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/pedidos/:id/despachar-bar', allowAdminOrKitchen, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Get the items for this order that are bar items
        const [items] = await connection.query(`
            SELECT dp.producto_id, dp.cantidad 
            FROM detalles_pedido dp
            JOIN productos p ON dp.producto_id = p.id
            JOIN tipos_producto tp ON p.tipo_id = tp.id
            WHERE dp.pedido_id = ? AND tp.es_barra = 1
        `, [req.params.id]);

        // 2. Deduct stock for each item
        for (const item of items) {
            await connection.query(
                'UPDATE productos SET stock = stock - ? WHERE id = ?',
                [item.cantidad, item.producto_id]
            );
        }

        // 3. Update order status to 'listo' (or similar logic)
        // If there are other items (kitchen), we might only want to mark bar as done
        // For simplicity, we'll mark the whole order as 'listo' if it's currently 'en_proceso' or 'pendiente'
        await connection.query('UPDATE pedidos SET estado = ? WHERE id = ?', ['listo', req.params.id]);

        await connection.commit();
        res.json({ message: 'Pedido de bar despachado y stock actualizado' });
    } catch (err) {
        await connection.rollback();
        res.status(500).json({ error: err.message });
    } finally {
        connection.release();
    }
});

app.post('/api/pedidos', allowAdminOrWaiter, async (req, res) => {
    const { mesa_id, cliente_id, usuario_id, detalles } = req.body;
    console.log('Recibiendo pedido:', { mesa_id, cliente_id, usuario_id, detalles });
    // detalles is array of { producto_id, quantity, notes }

    if (!mesa_id || !usuario_id || !Array.isArray(detalles) || detalles.length === 0) {
        return res.status(400).json({
            error: 'mesa_id, usuario_id y al menos un detalle son obligatorios'
        });
    }

    const invalidItem = detalles.find((item) => {
        const productId = Number(item?.producto_id);
        const quantity = Number(item?.cantidad);
        return !Number.isInteger(productId) || productId <= 0 || !Number.isFinite(quantity) || quantity <= 0;
    });

    if (invalidItem) {
        return res.status(400).json({
            error: 'Cada detalle debe tener producto_id y cantidad validos'
        });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // Create Header
        const [orderResult] = await connection.query(
            'INSERT INTO pedidos (mesa_id, cliente_id, usuario_id, estado) VALUES (?, ?, ?, ?)',
            [mesa_id, cliente_id, usuario_id, 'pendiente']
        );
        const pedidoId = orderResult.insertId;

        // Create Details
        let total = 0;
        for (const item of detalles) {
            // Get product price
            const [prodRows] = await connection.query('SELECT precio FROM productos WHERE id = ?', [item.producto_id]);
            const precio = prodRows[0].precio;
            const subtotal = precio * item.cantidad;
            total += subtotal;

            await connection.query(
                'INSERT INTO detalles_pedido (pedido_id, producto_id, cantidad, precio_unitario, subtotal, notas) VALUES (?, ?, ?, ?, ?, ?)',
                [pedidoId, item.producto_id, item.cantidad, precio, subtotal, item.notas || '']
            );
        }

        // Update Total
        await connection.query('UPDATE pedidos SET total = ? WHERE id = ?', [total, pedidoId]);

        await connection.commit();
        res.json({ id: pedidoId, total, message: 'Pedido creado exitosamente' });

    } catch (err) {
        await connection.rollback();
        res.status(500).json({ error: err.message });
    } finally {
        connection.release();
    }
});

app.put('/api/pedidos/:id/items', allowAdminOrWaiter, async (req, res) => {
    const { detalles } = req.body;
    const pedidoId = req.params.id;

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        let totalAdicional = 0;
        for (const item of detalles) {
            const [prodRows] = await connection.query('SELECT precio FROM productos WHERE id = ?', [item.producto_id]);
            const precio = prodRows[0].precio;
            const subtotal = precio * item.cantidad;
            totalAdicional += subtotal;

            await connection.query(
                'INSERT INTO detalles_pedido (pedido_id, producto_id, cantidad, precio_unitario, subtotal, notas) VALUES (?, ?, ?, ?, ?, ?)',
                [pedidoId, item.producto_id, item.cantidad, precio, subtotal, item.notas || '']
            );
        }

        // Update Total
        await connection.query('UPDATE pedidos SET total = total + ?, estado = ? WHERE id = ?', [totalAdicional, 'pendiente', pedidoId]);

        await connection.commit();
        res.json({ message: 'Items añadidos al pedido' });
    } catch (err) {
        await connection.rollback();
        res.status(500).json({ error: err.message });
    } finally {
        connection.release();
    }
});

app.put('/api/pedidos/detalle/:id/estado', allowAdminOrKitchen, async (req, res) => {
    let { estado } = req.body; 
    
    // Mapeo estricto para los valores del ENUM de la base de datos
    // ENUM: 'pendiente', 'en_cocina', 'listo'
    let estadoDB = 'pendiente';
    if (estado === 'preparacion' || estado === 'en_cocina') estadoDB = 'en_cocina';
    if (estado === 'listo' || estado === 'despachado') estadoDB = 'listo';

    try {
        const [result] = await pool.query('UPDATE detalles_pedido SET estado_comanda = ? WHERE id = ?', [estadoDB, req.params.id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Ítem no encontrado' });
        }
        res.json({ message: 'Estado actualizado', nuevoEstado: estadoDB });
    } catch (err) {
        console.error('Error actualizando estado:', err);
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/pedidos/:id/estado', allowAdminOrKitchen, async (req, res) => {
    const { estado } = req.body;
    try {
        await pool.query('UPDATE pedidos SET estado = ? WHERE id = ?', [estado, req.params.id]);
        res.json({ message: 'Estado de pedido actualizado' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Correlativos ---
app.get('/api/correlativos', allowAdminOrCashier, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM correlativos');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/correlativos/:tipo', allowAdmin, async (req, res) => {
    const { serie, siguiente_numero } = req.body;
    try {
        await pool.query('UPDATE correlativos SET serie = ?, siguiente_numero = ? WHERE tipo = ?', [serie, siguiente_numero, req.params.tipo]);
        res.json({ message: 'Correlativo actualizado' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Facturación ---
app.post('/api/facturas', allowAdminOrCashier, async (req, res) => {
    const { pedido_id, tipo_comprobante, cliente_id } = req.body;

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Obtener y actualizar correlativo
        const [corrRows] = await connection.query('SELECT serie, siguiente_numero FROM correlativos WHERE tipo = ?', [tipo_comprobante]);
        if (corrRows.length === 0) throw new Error('Configuración de correlativos no encontrada');
        
        const { serie, siguiente_numero } = corrRows[0];
        const numero_comprobante = `${serie}-${String(siguiente_numero).padStart(8, '0')}`;

        // 2. Incrementar correlativo para la siguiente vez
        await connection.query('UPDATE correlativos SET siguiente_numero = siguiente_numero + 1 WHERE tipo = ?', [tipo_comprobante]);

        // 3. Obtener Total del Pedido
        const [orderRows] = await connection.query(`
            SELECT
                p.total,
                p.estado,
                (
                    SELECT COUNT(*)
                    FROM detalles_pedido dp
                    WHERE dp.pedido_id = p.id
                ) as detalles_count
            FROM pedidos p
            WHERE p.id = ?
            LIMIT 1
        `, [pedido_id]);
        if (orderRows.length === 0) throw new Error('Pedido no encontrado');

        const order = orderRows[0];
        const total = Number(order.total) || 0;
        const estadoPedido = String(order.estado || '').toLowerCase();
        const detallesCount = Number(order.detalles_count) || 0;

        if (estadoPedido === 'pagado') {
            throw new Error('El pedido ya fue pagado');
        }

        if (estadoPedido === 'cancelado') {
            throw new Error('No se puede facturar un pedido cancelado');
        }

        if (detallesCount <= 0 || total <= 0) {
            throw new Error('No se puede facturar un pedido sin detalle o con total 0');
        }

        const impuesto = total * 0.18; // Ejemplo IGV 18%

        // 3.1 Relacionar la venta con una sesion de caja activa (si existe)
        const [sessionRows] = await connection.query(`
            SELECT id
            FROM caja_sesiones
            WHERE estado = 'abierta'
            ORDER BY fecha_apertura DESC
            LIMIT 1
        `);
        const sesionCajaId = sessionRows.length > 0 ? sessionRows[0].id : null;

        const [result] = await connection.query(
            'INSERT INTO facturas (pedido_id, cliente_id, tipo_comprobante, numero_comprobante, total_venta, impuesto, sesion_caja_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [pedido_id, cliente_id, tipo_comprobante, numero_comprobante, total, impuesto, sesionCajaId]
        );

        // 4. Actualizar estado del pedido a pagado
        await connection.query('UPDATE pedidos SET estado = ? WHERE id = ?', ['pagado', pedido_id]);

        await connection.commit();
        res.json({ id: result.insertId, numero: numero_comprobante, total });

    } catch (err) {
        await connection.rollback();
        console.error(err);
        res.status(500).json({ error: err.message });
    } finally {
        connection.release();
    }
});

// --- Estadísticas ---
app.get('/api/stats/ventas-hoy', allowAnyProfile, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT COALESCE(SUM(total_venta), 0) as total
            FROM facturas
            WHERE date(fecha_emision) = date('now')
        `);
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/stats/ventas-tiempo', allowAnyProfile, async (req, res) => {
    const { desde, hasta } = req.query;
    const today = new Date().toISOString().slice(0, 10);
    const startDate = typeof desde === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(desde) ? desde : today;
    const endDate = typeof hasta === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(hasta) ? hasta : today;

    if (startDate > endDate) {
        return res.status(400).json({ error: 'Rango de fechas invalido' });
    }

    try {
        const [rows] = await pool.query(`
            SELECT
                strftime('%Y-%m-%d', fecha_emision) as fecha,
                COUNT(*) as cantidad,
                COALESCE(SUM(total_venta), 0) as total
            FROM facturas
            WHERE fecha_emision >= ? AND fecha_emision < date(?, '+1 day')
            GROUP BY strftime('%Y-%m-%d', fecha_emision)
            ORDER BY strftime('%Y-%m-%d', fecha_emision) ASC
        `, [startDate, endDate]);

        const map = new Map(rows.map(row => [row.fecha, row]));
        const series = [];
        const cursor = new Date(`${startDate}T00:00:00.000Z`);
        const limit = new Date(`${endDate}T00:00:00.000Z`);

        while (cursor <= limit) {
            const key = cursor.toISOString().slice(0, 10);
            const row = map.get(key);
            series.push({
                fecha: key,
                cantidad: Number(row?.cantidad || 0),
                total: Number(row?.total || 0)
            });
            cursor.setUTCDate(cursor.getUTCDate() + 1);
        }

        const totalComprobantes = series.reduce((acc, item) => acc + item.cantidad, 0);
        const totalVentas = series.reduce((acc, item) => acc + item.total, 0);
        const promedioDiario = series.length > 0 ? totalComprobantes / series.length : 0;

        res.json({
            periodo: { desde: startDate, hasta: endDate },
            resumen: {
                total_comprobantes: totalComprobantes,
                total_ventas: Number(totalVentas.toFixed(2)),
                promedio_diario: Number(promedioDiario.toFixed(2))
            },
            series
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/reportes/ventas', allowAdminOrCashier, async (req, res) => {
    const { desde, hasta } = req.query;
    const today = new Date().toISOString().slice(0, 10);
    const startDate = typeof desde === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(desde) ? desde : today;
    const endDate = typeof hasta === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(hasta) ? hasta : today;

    if (startDate > endDate) {
        return res.status(400).json({ error: 'Rango de fechas invalido' });
    }

    try {
        const [comprobantes] = await pool.query(`
            SELECT
                f.id,
                f.numero_comprobante,
                f.tipo_comprobante,
                f.total_venta,
                f.impuesto,
                f.fecha_emision,
                p.id as pedido_id,
                m.numero as mesa_numero,
                COALESCE(c.nombre, 'PUBLICO EN GENERAL') as cliente_nombre
            FROM facturas f
            JOIN pedidos p ON p.id = f.pedido_id
            LEFT JOIN mesas m ON m.id = p.mesa_id
            LEFT JOIN clientes c ON c.id = f.cliente_id
            WHERE DATE(f.fecha_emision) BETWEEN ? AND ?
            ORDER BY f.fecha_emision DESC
        `, [startDate, endDate]);

        const [porTipo] = await pool.query(`
            SELECT
                tipo_comprobante,
                COUNT(*) as cantidad,
                COALESCE(SUM(total_venta), 0) as total
            FROM facturas
            WHERE DATE(fecha_emision) BETWEEN ? AND ?
            GROUP BY tipo_comprobante
        `, [startDate, endDate]);

        const [topProductos] = await pool.query(`
            SELECT
                COALESCE(prod.nombre, 'Producto') as producto_nombre,
                SUM(dp.cantidad) as cantidad_vendida,
                COALESCE(SUM(dp.subtotal), 0) as total_vendido
            FROM facturas f
            JOIN pedidos p ON p.id = f.pedido_id
            JOIN detalles_pedido dp ON dp.pedido_id = p.id
            LEFT JOIN productos prod ON prod.id = dp.producto_id
            WHERE DATE(f.fecha_emision) BETWEEN ? AND ?
            GROUP BY dp.producto_id, prod.nombre
            ORDER BY total_vendido DESC
            LIMIT 10
        `, [startDate, endDate]);

        const resumen = comprobantes.reduce((acc, row) => {
            acc.totalVentas += Number(row.total_venta) || 0;
            acc.totalIGV += Number(row.impuesto) || 0;
            return acc;
        }, { totalVentas: 0, totalIGV: 0 });

        const totalComprobantes = comprobantes.length;
        const ticketPromedio = totalComprobantes > 0 ? (resumen.totalVentas / totalComprobantes) : 0;

        res.json({
            periodo: { desde: startDate, hasta: endDate },
            resumen: {
                total_comprobantes: totalComprobantes,
                total_ventas: Number(resumen.totalVentas.toFixed(2)),
                total_igv: Number(resumen.totalIGV.toFixed(2)),
                ticket_promedio: Number(ticketPromedio.toFixed(2))
            },
            por_tipo: porTipo,
            top_productos: topProductos,
            comprobantes
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
