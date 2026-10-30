const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const pool = require('./db');
const facturacion = require('./facturacion');
const formatos = require('./formatosComprobante');
const { hashPassword, isHashed, verifyPassword, signToken, verifyToken } = require('./auth');
const permisos = require('./permisos');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '5mb' }));

const clientBuildPath = path.join(__dirname, 'public');
const hasClientBuild = fs.existsSync(path.join(clientBuildPath, 'index.html'));

if (hasClientBuild) {
    app.use(express.static(clientBuildPath));
} else {
    // Basic Health Check (only used when no client build is bundled, e.g. local API-only dev)
    app.get('/', (req, res) => {
        res.send('Restaurant System API Running');
    });
}

const SUPERADMIN = 'superadmin';
const USER_PROFILES = ['administrador', 'mozo', 'caja', 'cocina'];
const PROFILE_ALIASES = {
    superadmin: SUPERADMIN,
    administrador: 'administrador',
    admin: 'administrador',
    mozo: 'mozo',
    mesero: 'mozo',
    caja: 'caja',
    cajero: 'caja',
    cocina: 'cocina',
    cocinero: 'cocina'
};
const USUARIO_REGEX = /^[a-zA-Z0-9._-]{3,50}$/;

// Accepts the built-in profiles (with their aliases) and any profile defined in the permissions screen.
const normalizeProfile = (value) => {
    if (typeof value !== 'string') return null;
    const key = value.toLowerCase().trim();
    return PROFILE_ALIASES[key] || (permisos.get(key) ? key : null);
};

const isSuperadmin = (req) => req.userContext?.perfil === SUPERADMIN;
// Superadmin and the profiles with multisede scope (p. ej. contador) see and pick any sede.
const isMultisede = (req) => Boolean(req.userContext?.multisede);
const sedeOf = (req) => req.userContext?.sedeId ?? null;

// The superadmin passes every profile check. Everyone else passes when their base profile is listed (a custom profile such as
// contador acts as its base: administrador, mozo, caja o cocina) or when a module added to their profile owns the route.
const requireProfiles = (...allowedProfiles) => {
    const normalizedAllowed = allowedProfiles
        .map((profile) => normalizeProfile(profile))
        .filter(Boolean);

    return (req, res, next) => {
        const currentProfile = req.userContext?.perfil;
        if (!currentProfile) {
            return res.status(401).json({
                error: 'No autenticado para esta operacion',
                perfiles_permitidos: normalizedAllowed
            });
        }

        if (currentProfile !== SUPERADMIN && !normalizedAllowed.includes(req.userContext.base) && !permisos.concedeRuta(req)) {
            return res.status(403).json({
                error: 'No autorizado para esta operacion',
                perfil_actual: currentProfile,
                perfiles_permitidos: normalizedAllowed
            });
        }

        next();
    };
};

// Operational data belongs to a sede; the superadmin picks it with x-sede-id.
const requireSede = (req, res, next) => {
    if (!sedeOf(req)) {
        return res.status(400).json({ error: 'Seleccione una sede para continuar' });
    }
    next();
};

const allowAnyProfile = requireProfiles(...USER_PROFILES);
const allowSuperadmin = requireProfiles(SUPERADMIN);
const allowAdmin = requireProfiles('administrador');
const allowAdminOrCashier = requireProfiles('administrador', 'caja');
const allowAdminOrWaiter = requireProfiles('administrador', 'mozo');
const allowAdminOrKitchen = requireProfiles('administrador', 'cocina');
const allowAdminWaiterCashier = requireProfiles('administrador', 'mozo', 'caja');
const allowAdminKitchenForWrites = requireProfiles('administrador', 'cocina');

const USER_WITH_SEDE_SQL = `
    SELECT u.id, u.nombre, u.usuario, u.email, u.rol, u.sede_id, u.password_hash, u.creado_en,
           s.nombre AS sede_nombre, s.estado AS sede_estado
    FROM usuarios u
    LEFT JOIN sedes s ON s.id = u.sede_id
`;

const toPublicUser = (row) => {
    const perfil = normalizeProfile(row.rol);
    const acceso = permisos.contextoDe(perfil);
    return {
        id: Number(row.id),
        nombre: row.nombre,
        usuario: row.usuario,
        email: row.email,
        perfil,
        perfil_nombre: perfil === SUPERADMIN ? 'Super admin' : (permisos.get(perfil)?.nombre || perfil),
        base: acceso.base,
        multisede: acceso.multisede,
        modulos: [...acceso.modulos],
        sede_id: row.sede_id !== null ? Number(row.sede_id) : null,
        sede_nombre: row.sede_nombre || null
    };
};

// Multisede users may have no home sede; the rest need an active one.
const sedeIsUsable = (row) => {
    const perfil = normalizeProfile(row.rol);
    if (perfil === SUPERADMIN) return true;
    if (permisos.contextoDe(perfil).multisede && !row.sede_id) return true;
    return Boolean(row.sede_id) && Number(row.sede_estado) === 1;
};

// --- Autenticacion ---
app.post('/api/auth/login', async (req, res) => {
    const identifier = String(req.body?.usuario || '').trim();
    const password = String(req.body?.password || '');

    if (!identifier || !password) {
        return res.status(400).json({ error: 'Usuario y clave son obligatorios' });
    }

    try {
        const [rows] = await pool.query(
            `${USER_WITH_SEDE_SQL} WHERE u.usuario = ? OR u.email = ? LIMIT 1`,
            [identifier, identifier]
        );
        const user = rows[0];

        if (!user || !verifyPassword(password, user.password_hash)) {
            return res.status(401).json({ error: 'Usuario o clave incorrectos' });
        }
        if (!normalizeProfile(user.rol)) {
            return res.status(403).json({ error: 'El perfil de este usuario ya no existe' });
        }
        if (!sedeIsUsable(user)) {
            return res.status(403).json({ error: 'La sede de este usuario esta inactiva' });
        }

        if (!isHashed(user.password_hash)) {
            await pool.query('UPDATE usuarios SET password_hash = ? WHERE id = ?', [hashPassword(password), user.id]);
        }

        res.json({ token: signToken({ uid: Number(user.id) }), usuario: toPublicUser(user) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Product images are public menu assets (an <img> tag cannot send the Bearer token); writes remain restricted to menu managers.
app.get('/api/productos/:id/imagen', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT mime_type, contenido FROM producto_imagenes WHERE producto_id = ? LIMIT 1', [req.params.id]);
        if (!rows.length) return res.status(404).end();
        res.set({ 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
        res.type(rows[0].mime_type).send(rows[0].contenido);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Every other /api route requires a valid token.
app.use('/api', async (req, res, next) => {
    const header = req.header('authorization') || '';
    const payload = header.startsWith('Bearer ') ? verifyToken(header.slice(7)) : null;
    if (!payload) {
        return res.status(401).json({ error: 'Sesion no valida o expirada' });
    }

    try {
        const [rows] = await pool.query(`${USER_WITH_SEDE_SQL} WHERE u.id = ? LIMIT 1`, [payload.uid]);
        const user = rows[0];
        if (!user) {
            return res.status(401).json({ error: 'Sesion no valida o expirada' });
        }
        if (!sedeIsUsable(user)) {
            return res.status(403).json({ error: 'La sede de este usuario esta inactiva' });
        }

        const perfil = normalizeProfile(user.rol);
        if (!perfil) {
            return res.status(403).json({ error: 'El perfil de este usuario ya no existe' });
        }
        const acceso = permisos.contextoDe(perfil);
        let sedeId = user.sede_id !== null ? Number(user.sede_id) : null;

        if (acceso.multisede) {
            // The superadmin must pick a sede; other multisede profiles fall back to their own sede.
            const requested = Number(req.header('x-sede-id'));
            if (perfil === SUPERADMIN) sedeId = null;
            if (Number.isInteger(requested) && requested > 0) {
                const [sedeRows] = await pool.query('SELECT id FROM sedes WHERE id = ? LIMIT 1', [requested]);
                if (sedeRows.length > 0) sedeId = requested;
            }
        }

        req.userContext = {
            id: Number(user.id),
            nombre: user.nombre,
            perfil,
            base: acceso.base,
            multisede: acceso.multisede,
            modulos: acceso.modulos,
            sedeUsuarioId: user.sede_id !== null ? Number(user.sede_id) : null,
            sedeId
        };
        next();
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// A route that belongs to a module is closed to profiles without that module.
app.use('/api', permisos.compuerta);

app.get('/api/auth/me', async (req, res) => {
    try {
        const [rows] = await pool.query(`${USER_WITH_SEDE_SQL} WHERE u.id = ? LIMIT 1`, [req.userContext.id]);
        if (rows.length === 0) return res.status(401).json({ error: 'Sesion no valida o expirada' });
        res.json(toPublicUser(rows[0]));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Sedes ---
const SEDE_COLUMNS = 'id, nombre, direccion, telefono, estado, creado_en';

app.get('/api/sedes', async (req, res) => {
    try {
        if (isMultisede(req)) {
            const [rows] = await pool.query(`
                SELECT s.id, s.nombre, s.direccion, s.telefono, s.estado, s.creado_en,
                       (SELECT COUNT(*) FROM usuarios u WHERE u.sede_id = s.id) AS usuarios,
                       (SELECT COUNT(*) FROM mesas m WHERE m.sede_id = s.id) AS mesas
                FROM sedes s
                ORDER BY s.nombre
            `);
            return res.json(rows);
        }
        const [rows] = await pool.query(`SELECT ${SEDE_COLUMNS} FROM sedes WHERE id = ?`, [req.userContext.sedeUsuarioId]);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/sedes', allowSuperadmin, async (req, res) => {
    const nombre = String(req.body?.nombre || '').trim();
    const direccion = String(req.body?.direccion || '').trim() || null;
    const telefono = String(req.body?.telefono || '').trim() || null;

    if (!nombre) return res.status(400).json({ error: 'El nombre de la sede es obligatorio' });

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [result] = await connection.query(
            'INSERT INTO sedes (nombre, direccion, telefono, estado) VALUES (?, ?, ?, 1)',
            [nombre, direccion, telefono]
        );
        const sedeId = result.insertId;
        const suffix = String(sedeId).padStart(3, '0');

        // Every sede starts with its own numbering series, a cash register and a zone.
        await connection.query(
            `INSERT INTO correlativos (sede_id, tipo, serie, siguiente_numero) VALUES
                (?, 'boleta', ?, 1), (?, 'factura', ?, 1), (?, 'nota_venta', ?, 1),
                (?, 'nc_boleta', ?, 1), (?, 'nd_boleta', ?, 1), (?, 'nc_factura', ?, 1), (?, 'nd_factura', ?, 1),
                (?, 'guia_interna', ?, 1), (?, 'guia_remitente', ?, 1)`,
            [sedeId, `B${suffix}`, sedeId, `F${suffix}`, sedeId, `NV${String(sedeId).padStart(2, '0')}`,
                sedeId, `B${suffix}`, sedeId, `B${suffix}`, sedeId, `F${suffix}`, sedeId, `F${suffix}`,
                sedeId, `GI${String(sedeId).padStart(2, '0')}`, sedeId, `T${suffix}`]
        );
        // Main warehouse of the new sede: it receives purchases and dispatches sales.
        await connection.query(
            `INSERT INTO almacenes (sede_id, codigo, nombre, direccion, cod_establecimiento, para_ventas, para_compras)
             VALUES (?, ?, 'Almacén principal', ?, NULL, 1, 1)`,
            [sedeId, `ALM-${String(sedeId).padStart(2, '0')}`, direccion || null]
        );
        await connection.query(
            "INSERT INTO cajas (sede_id, descripcion, saldo, estado) VALUES (?, 'Caja Principal', 0, 'cerrada')",
            [sedeId]
        );
        await connection.query("INSERT INTO zonas (sede_id, nombre) VALUES (?, 'Salón Principal')", [sedeId]);

        await connection.commit();

        const [rows] = await pool.query(`SELECT ${SEDE_COLUMNS} FROM sedes WHERE id = ?`, [sedeId]);
        res.status(201).json(rows[0]);
    } catch (err) {
        await connection.rollback();
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'Ya existe una sede con ese nombre' });
        }
        res.status(500).json({ error: err.message });
    } finally {
        connection.release();
    }
});

app.put('/api/sedes/:id', allowSuperadmin, async (req, res) => {
    try {
        const [existingRows] = await pool.query(`SELECT ${SEDE_COLUMNS} FROM sedes WHERE id = ?`, [req.params.id]);
        if (existingRows.length === 0) return res.status(404).json({ error: 'Sede no encontrada' });
        const existing = existingRows[0];

        const nombre = req.body?.nombre !== undefined ? String(req.body.nombre).trim() : existing.nombre;
        const direccion = req.body?.direccion !== undefined ? (String(req.body.direccion).trim() || null) : existing.direccion;
        const telefono = req.body?.telefono !== undefined ? (String(req.body.telefono).trim() || null) : existing.telefono;
        const estado = req.body?.estado !== undefined ? (req.body.estado ? 1 : 0) : existing.estado;

        if (!nombre) return res.status(400).json({ error: 'El nombre de la sede es obligatorio' });

        await pool.query(
            'UPDATE sedes SET nombre = ?, direccion = ?, telefono = ?, estado = ? WHERE id = ?',
            [nombre, direccion, telefono, estado, req.params.id]
        );
        const [rows] = await pool.query(`SELECT ${SEDE_COLUMNS} FROM sedes WHERE id = ?`, [req.params.id]);
        res.json(rows[0]);
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'Ya existe una sede con ese nombre' });
        }
        res.status(500).json({ error: err.message });
    }
});

// --- Perfiles / Usuarios ---
// Profiles a user may assign: multisede ones only when the user is multisede too (a sede administrator cannot widen a scope).
const perfilesAsignables = (req) => permisos.todos()
    .filter((p) => isMultisede(req) || p.alcance !== 'multisede')
    .map((p) => p.codigo);

app.get('/api/perfiles', (req, res) => {
    res.json(isSuperadmin(req) ? [SUPERADMIN, ...perfilesAsignables(req)] : perfilesAsignables(req));
});

// Names and scope of every profile, for labels in any screen.
app.get('/api/perfiles/detalle', (req, res) => {
    res.json([
        { codigo: SUPERADMIN, nombre: 'Super admin', alcance: 'multisede' },
        ...permisos.todos().map((p) => ({ codigo: p.codigo, nombre: p.nombre, alcance: p.alcance }))
    ]);
});

// --- Permisos por perfil (pantalla de permisos) ---
const PERFIL_REGEX = /^[a-z][a-z0-9_]{2,29}$/;

const perfilesConUsuarios = async () => {
    const [rows] = await pool.query('SELECT rol, COUNT(*) AS total FROM usuarios GROUP BY rol');
    return new Map(rows.map((r) => [r.rol, Number(r.total)]));
};

const perfilPublico = (p, usuarios) => ({
    codigo: p.codigo, nombre: p.nombre, descripcion: p.descripcion, base: p.base, alcance: p.alcance,
    sistema: Number(p.sistema) === 1, usuarios: usuarios.get(p.codigo) || 0, modulos: [...p.modulos]
});

app.get('/api/permisos', allowAdmin, async (req, res) => {
    try {
        const usuarios = await perfilesConUsuarios();
        res.json({
            modulos: permisos.MODULOS,
            bases: permisos.BASES,
            editable: permisos.estaListo(),
            puede_alcance: isSuperadmin(req),
            perfiles: permisos.todos().map((p) => perfilPublico(p, usuarios))
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const exigirEsquemaPermisos = (res) => {
    if (permisos.estaListo()) return true;
    res.status(503).json({ error: 'Las tablas de permisos no estan disponibles: reinicie la aplicacion o revise la base de datos' });
    return false;
};

app.post('/api/permisos/perfiles', allowAdmin, async (req, res) => {
    if (!exigirEsquemaPermisos(res)) return;
    const codigo = String(req.body?.codigo || '').trim().toLowerCase();
    const nombre = String(req.body?.nombre || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    const descripcion = String(req.body?.descripcion || '').trim().slice(0, 255) || null;
    const base = String(req.body?.base || '').trim();
    const alcance = req.body?.alcance === 'multisede' ? 'multisede' : 'sede';
    const copiarDe = permisos.get(req.body?.copiar_de);

    if (!PERFIL_REGEX.test(codigo)) return res.status(400).json({ error: 'El codigo debe tener 3 a 30 caracteres: minusculas, numeros o guion bajo, empezando con letra' });
    if (!nombre) return res.status(400).json({ error: 'Ingrese el nombre del perfil' });
    if (!permisos.BASES.includes(base)) return res.status(400).json({ error: 'Seleccione el perfil base' });
    if (codigo === SUPERADMIN || PROFILE_ALIASES[codigo] || permisos.get(codigo)) return res.status(409).json({ error: 'Ya existe un perfil con ese codigo' });
    if (alcance === 'multisede' && !isSuperadmin(req)) return res.status(403).json({ error: 'Solo el super administrador crea perfiles multisede' });

    try {
        await pool.query(
            'INSERT INTO perfiles (codigo, nombre, descripcion, base, alcance, sistema) VALUES (?, ?, ?, ?, ?, 0)',
            [codigo, nombre, descripcion, base, alcance]
        );
        if (copiarDe && copiarDe.modulos.size > 0) {
            await pool.query('INSERT INTO perfil_modulos (perfil, modulo) VALUES ?', [[...copiarDe.modulos].map((m) => [codigo, m])]);
        }
        await permisos.recargar();
        res.status(201).json(perfilPublico(permisos.get(codigo), await perfilesConUsuarios()));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/permisos/perfiles/:codigo', allowAdmin, async (req, res) => {
    if (!exigirEsquemaPermisos(res)) return;
    const perfil = permisos.get(req.params.codigo);
    if (!perfil) return res.status(404).json({ error: 'Perfil no encontrado' });

    const modulos = Array.isArray(req.body?.modulos) ? [...new Set(req.body.modulos.map(String))] : null;
    if (modulos && modulos.some((m) => !permisos.MODULO_CLAVES.includes(m))) return res.status(400).json({ error: 'Hay un modulo que no existe' });
    // Without settings the administrador could not open this screen again.
    if (modulos && perfil.codigo === 'administrador' && !modulos.includes('settings')) {
        return res.status(409).json({ error: 'El administrador debe conservar el modulo de configuracion' });
    }
    const nombre = req.body?.nombre !== undefined ? String(req.body.nombre).trim().replace(/\s+/g, ' ').slice(0, 60) : perfil.nombre;
    if (!nombre) return res.status(400).json({ error: 'Ingrese el nombre del perfil' });
    const descripcion = req.body?.descripcion !== undefined ? (String(req.body.descripcion).trim().slice(0, 255) || null) : perfil.descripcion;

    // Scope and base change what the profile can do beyond the modules, so only the superadmin touches them.
    let alcance = perfil.alcance;
    let base = perfil.base;
    if (req.body?.alcance !== undefined || req.body?.base !== undefined) {
        if (!isSuperadmin(req)) return res.status(403).json({ error: 'Solo el super administrador cambia el alcance o el perfil base' });
        if (req.body.alcance !== undefined) alcance = req.body.alcance === 'multisede' ? 'multisede' : 'sede';
        if (req.body.base !== undefined) {
            if (!permisos.BASES.includes(req.body.base)) return res.status(400).json({ error: 'Perfil base invalido' });
            base = req.body.base;
        }
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        await connection.query('UPDATE perfiles SET nombre = ?, descripcion = ?, base = ?, alcance = ? WHERE codigo = ?', [nombre, descripcion, base, alcance, perfil.codigo]);
        if (modulos) {
            await connection.query('DELETE FROM perfil_modulos WHERE perfil = ?', [perfil.codigo]);
            if (modulos.length > 0) await connection.query('INSERT INTO perfil_modulos (perfil, modulo) VALUES ?', [modulos.map((m) => [perfil.codigo, m])]);
        }
        await connection.commit();
        await permisos.recargar();
        res.json(perfilPublico(permisos.get(perfil.codigo), await perfilesConUsuarios()));
    } catch (err) {
        await connection.rollback();
        res.status(500).json({ error: err.message });
    } finally {
        connection.release();
    }
});

app.delete('/api/permisos/perfiles/:codigo', allowAdmin, async (req, res) => {
    if (!exigirEsquemaPermisos(res)) return;
    const perfil = permisos.get(req.params.codigo);
    if (!perfil) return res.status(404).json({ error: 'Perfil no encontrado' });
    if (Number(perfil.sistema) === 1) return res.status(409).json({ error: 'Los perfiles base del sistema no se pueden eliminar' });
    try {
        const usuarios = await perfilesConUsuarios();
        if ((usuarios.get(perfil.codigo) || 0) > 0) return res.status(409).json({ error: 'El perfil tiene usuarios asignados: cambialos de perfil primero' });
        await pool.query('DELETE FROM perfiles WHERE codigo = ?', [perfil.codigo]);
        await permisos.recargar();
        res.json({ message: 'Perfil eliminado' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const USER_LIST_SQL = `
    SELECT u.id, u.nombre, u.usuario, u.email, u.rol AS perfil, u.sede_id, s.nombre AS sede_nombre, u.creado_en
    FROM usuarios u
    LEFT JOIN sedes s ON s.id = u.sede_id
`;

// Superadmin sees everyone; an administrador only the users of their own sede.
const userScope = (req) => (isSuperadmin(req)
    ? { where: '1 = 1', params: [] }
    : { where: "u.sede_id = ? AND u.rol <> 'superadmin'", params: [req.userContext.sedeUsuarioId] });

app.get('/api/usuarios', allowAdmin, async (req, res) => {
    try {
        const scope = userScope(req);
        const [rows] = await pool.query(`${USER_LIST_SQL} WHERE ${scope.where} ORDER BY u.creado_en DESC`, scope.params);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/usuarios/:id', allowAdmin, async (req, res) => {
    try {
        const scope = userScope(req);
        const [rows] = await pool.query(`${USER_LIST_SQL} WHERE u.id = ? AND ${scope.where}`, [req.params.id, ...scope.params]);
        if (rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/** Resolves the sede a user being created/edited must belong to. Returns { sedeId } or { error, status }. */
const resolveTargetSede = async (req, perfil, requestedSedeId, fallbackSedeId) => {
    if (perfil === SUPERADMIN) {
        return isSuperadmin(req) ? { sedeId: null } : { status: 403, error: 'No autorizado para crear super administradores' };
    }
    const multisedePerfil = permisos.contextoDe(perfil).multisede;
    if (!isSuperadmin(req)) {
        if (multisedePerfil) return { status: 403, error: 'Solo el super administrador asigna perfiles multisede' };
        return { sedeId: req.userContext.sedeUsuarioId };
    }

    // A multisede profile (p. ej. contador) may have no home sede.
    const sedeId = Number(requestedSedeId) || fallbackSedeId || (multisedePerfil ? null : sedeOf(req));
    if (!sedeId && multisedePerfil) return { sedeId: null };
    if (!sedeId) return { status: 400, error: 'Seleccione la sede del usuario' };
    const [rows] = await pool.query('SELECT id FROM sedes WHERE id = ? LIMIT 1', [sedeId]);
    if (rows.length === 0) return { status: 400, error: 'Sede no encontrada' };
    return { sedeId };
};

app.post('/api/usuarios', allowAdmin, async (req, res) => {
    const { nombre, email, usuario, password, perfil, sede_id } = req.body;
    const normalizedProfile = normalizeProfile(perfil);
    const login = String(usuario || '').trim();

    if (!nombre || !email || !login || !password || !normalizedProfile) {
        return res.status(400).json({
            error: 'nombre, usuario, email, password y perfil son obligatorios',
            perfiles_validos: permisos.todos().map((p) => p.codigo)
        });
    }
    if (!USUARIO_REGEX.test(login)) {
        return res.status(400).json({ error: 'El usuario debe tener 3 a 50 caracteres (letras, numeros, punto, guion)' });
    }

    try {
        const target = await resolveTargetSede(req, normalizedProfile, sede_id, null);
        if (target.error) return res.status(target.status).json({ error: target.error });

        const [result] = await pool.query(
            'INSERT INTO usuarios (nombre, usuario, email, password_hash, rol, sede_id) VALUES (?, ?, ?, ?, ?, ?)',
            [nombre, login, email, hashPassword(password), normalizedProfile, target.sedeId]
        );
        res.status(201).json({
            id: result.insertId,
            nombre,
            usuario: login,
            email,
            perfil: normalizedProfile,
            sede_id: target.sedeId
        });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'El usuario o el email ya existe' });
        }
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/usuarios/:id', allowAdmin, async (req, res) => {
    const { nombre, email, usuario, password, perfil, sede_id } = req.body;
    try {
        const scope = userScope(req);
        const [existingRows] = await pool.query(
            `SELECT u.* FROM usuarios u WHERE u.id = ? AND ${scope.where}`,
            [req.params.id, ...scope.params]
        );
        if (existingRows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });

        const existing = existingRows[0];
        const normalizedProfile = perfil !== undefined ? normalizeProfile(perfil) : normalizeProfile(existing.rol);
        if (!normalizedProfile) {
            return res.status(400).json({
                error: 'Perfil invalido',
                perfiles_validos: permisos.todos().map((p) => p.codigo)
            });
        }

        const nextLogin = usuario !== undefined ? String(usuario).trim() : existing.usuario;
        if (!USUARIO_REGEX.test(nextLogin)) {
            return res.status(400).json({ error: 'El usuario debe tener 3 a 50 caracteres (letras, numeros, punto, guion)' });
        }

        const target = await resolveTargetSede(req, normalizedProfile, sede_id, existing.sede_id);
        if (target.error) return res.status(target.status).json({ error: target.error });

        if (normalizeProfile(existing.rol) === SUPERADMIN && normalizedProfile !== SUPERADMIN) {
            const [others] = await pool.query("SELECT COUNT(*) AS total FROM usuarios WHERE rol = 'superadmin' AND id <> ?", [existing.id]);
            if (Number(others[0].total) === 0) {
                return res.status(409).json({ error: 'Debe existir al menos un super administrador' });
            }
        }

        const nextNombre = nombre ?? existing.nombre;
        const nextEmail = email ?? existing.email;
        const nextPasswordHash = password ? hashPassword(password) : existing.password_hash;

        await pool.query(
            'UPDATE usuarios SET nombre = ?, usuario = ?, email = ?, password_hash = ?, rol = ?, sede_id = ? WHERE id = ?',
            [nextNombre, nextLogin, nextEmail, nextPasswordHash, normalizedProfile, target.sedeId, existing.id]
        );

        res.json({
            id: Number(existing.id),
            nombre: nextNombre,
            usuario: nextLogin,
            email: nextEmail,
            perfil: normalizedProfile,
            sede_id: target.sedeId
        });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'El usuario o el email ya existe' });
        }
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/usuarios/:id', allowAdmin, async (req, res) => {
    if (Number(req.params.id) === req.userContext.id) {
        return res.status(409).json({ error: 'No puede eliminar su propio usuario' });
    }
    try {
        const scope = userScope(req);
        const [result] = await pool.query(`DELETE u FROM usuarios u WHERE u.id = ? AND ${scope.where}`, [req.params.id, ...scope.params]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
        res.json({ message: 'Usuario eliminado' });
    } catch (err) {
        if (err.code === 'ER_ROW_IS_REFERENCED_2') {
            return res.status(409).json({ error: 'El usuario tiene operaciones registradas y no se puede eliminar' });
        }
        res.status(500).json({ error: err.message });
    }
});

// --- Clientes (compartidos entre sedes) ---
app.get('/api/clientes', allowAnyProfile, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM clientes');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Ubigeos (codigo INEI/SUNAT de 6 digitos): buscador por distrito, provincia, departamento o codigo, como en Cealka.
app.get('/api/ubigeos', allowAnyProfile, async (req, res) => {
    const termino = String(req.query.q ?? '').trim();
    if (termino.length < 2) return res.json([]);
    try {
        const like = `%${termino}%`;
        const [rows] = await pool.query(
            `SELECT codigo, distrito, provincia, departamento FROM ubigeos
             WHERE distrito LIKE ? OR provincia LIKE ? OR departamento LIKE ? OR codigo LIKE ?
             ORDER BY (distrito = ?) DESC, (codigo LIKE ?) DESC, departamento, provincia, distrito
             LIMIT 20`,
            [like, like, like, like, termino, `${termino}%`]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/ubigeos/:codigo', allowAnyProfile, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT codigo, distrito, provincia, departamento FROM ubigeos WHERE codigo = ?', [req.params.codigo]);
        if (rows.length === 0) return res.status(404).json({ error: 'Ubigeo no encontrado' });
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Busqueda de cliente por DNI o RUC (como el POS de Cealka): primero entre los clientes registrados; si no esta y hay token
// de Decolecta (DECOLECTA_TOKEN, tambien se acepta APISPERU_TOKEN), consulta RENIEC/SUNAT y guarda el resultado.
app.get('/api/clientes/buscar', allowAdminWaiterCashier, async (req, res) => {
    const tipo = String(req.query.doc_tipo || '').trim().toUpperCase();
    const numero = String(req.query.doc_numero || '').trim();
    if (tipo === 'DNI' ? !/^\d{8}$/.test(numero) : tipo === 'RUC' ? !/^(10|15|16|17|20)\d{9}$/.test(numero) : true) {
        return res.status(400).json({ error: tipo === 'RUC' ? 'El RUC debe tener 11 digitos y empezar con 10, 15, 16, 17 o 20' : 'Indique un DNI de 8 digitos o un RUC de 11 digitos' });
    }
    try {
        const [rows] = await pool.query('SELECT id, nombre, direccion FROM clientes WHERE tipo_documento = ? AND documento = ? LIMIT 1', [tipo, numero]);
        if (rows[0]) return res.json({ origen: 'registrado', cliente_id: rows[0].id, nombre: rows[0].nombre, direccion: rows[0].direccion || '' });

        const token = process.env.DECOLECTA_TOKEN || process.env.APISPERU_TOKEN;
        if (!token) return res.status(404).json({ error: 'No esta entre los clientes registrados. Ingrese el nombre manualmente (la consulta a RENIEC/SUNAT no esta configurada).' });
        const url = tipo === 'RUC' ? `https://api.decolecta.com/v1/sunat/ruc?numero=${numero}` : `https://api.decolecta.com/v1/reniec/dni?numero=${numero}`;
        const respuesta = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
        if (!respuesta.ok) return res.status(404).json({ error: 'No se encontro informacion para ese documento. Ingrese el nombre manualmente.' });
        const datos = await respuesta.json();
        const nombre = String((tipo === 'RUC' ? datos.razon_social : datos.full_name) || '').trim();
        const direccion = tipo === 'RUC' ? String(datos.direccion || '').trim() : '';
        if (!nombre) return res.status(404).json({ error: 'No se encontro informacion para ese documento. Ingrese el nombre manualmente.' });
        const [insertado] = await pool.query('INSERT INTO clientes (nombre, documento, tipo_documento, direccion) VALUES (?, ?, ?, ?)', [nombre.slice(0, 200), numero, tipo, direccion.slice(0, 255) || null]);
        res.json({ origen: tipo === 'RUC' ? 'SUNAT' : 'RENIEC', cliente_id: insertado.insertId, nombre, direccion });
    } catch (err) {
        res.status(502).json({ error: 'No se pudo consultar el documento. Ingrese el nombre manualmente.' });
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
    const { nombre, telefono, email, documento, tipo_documento: tipoDocumento, direccion } = req.body;
    try {
        const [result] = await pool.query(
            'INSERT INTO clientes (nombre, telefono, email, documento, tipo_documento, direccion) VALUES (?, ?, ?, ?, ?, ?)',
            [nombre, telefono, email, documento, ['DNI', 'RUC', 'CE', 'PAS'].includes(tipoDocumento) ? tipoDocumento : null, direccion || null]
        );
        res.json({ ...req.body, id: result.insertId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Zonas ---
app.get('/api/zonas', allowAnyProfile, requireSede, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM zonas WHERE sede_id = ?', [sedeOf(req)]);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/zonas/:id', allowAnyProfile, requireSede, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM zonas WHERE id = ? AND sede_id = ?', [req.params.id, sedeOf(req)]);
        if (rows.length === 0) return res.status(404).json({ message: 'Zona no encontrada' });
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/zonas', allowAdmin, requireSede, async (req, res) => {
    const { nombre } = req.body;
    try {
        const [result] = await pool.query(
            'INSERT INTO zonas (sede_id, nombre) VALUES (?, ?)',
            [sedeOf(req), nombre]
        );
        res.json({ id: result.insertId, nombre });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/zonas/:id', allowAdmin, requireSede, async (req, res) => {
    const { nombre, estado } = req.body;
    try {
        await pool.query(
            'UPDATE zonas SET nombre = ?, estado = ? WHERE id = ? AND sede_id = ?',
            [nombre, estado !== undefined ? estado : true, req.params.id, sedeOf(req)]
        );
        res.json({ message: 'Zona actualizada' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/zonas/:id', allowAdmin, requireSede, async (req, res) => {
    try {
        await pool.query('DELETE FROM zonas WHERE id = ? AND sede_id = ?', [req.params.id, sedeOf(req)]);
        res.json({ message: 'Zona eliminada' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// The shift column arrives with the database migration: until then opening a session keeps working without it.
let sesionesConTurnoCache = null;
const sesionesConTurno = async () => {
    if (sesionesConTurnoCache === true) return true;
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS total FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'caja_sesiones' AND COLUMN_NAME = 'turno'`
    );
    sesionesConTurnoCache = Number(rows[0].total) > 0;
    return sesionesConTurnoCache;
};

const buildCashSessionSummary = async (connection, sessionId, sedeId) => {
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
        WHERE s.id = ? AND s.sede_id = ?
        LIMIT 1
    `, [sessionId, sedeId]);

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
        WHERE sesion_caja_id = ? AND tipo_comprobante IN ('boleta', 'factura', 'nota_venta')
          AND condicion_pago = 'contado' AND estado_comercial = 'vigente'
    `, [sessionId]);

    // Only cash collections stay in the drawer; cards and transfers are reported apart.
    const [cobrosRows] = await connection.query(`
        SELECT
            COALESCE(SUM(CASE WHEN metodo_pago = 'efectivo' THEN IF(tipo = 'devolucion', -monto, monto) ELSE 0 END), 0) as cobros_efectivo,
            COALESCE(SUM(CASE WHEN metodo_pago <> 'efectivo' THEN IF(tipo = 'devolucion', -monto, monto) ELSE 0 END), 0) as cobros_otros
        FROM cobros_venta
        WHERE sesion_id = ? AND estado = 'activo'
    `, [sessionId]);

    const movSummary = movSummaryRows[0] || {};
    const salesSummary = salesSummaryRows[0] || {};
    const cobrosSummary = cobrosRows[0] || {};

    const montoInicial = Number(session.monto_inicial) || 0;
    const ingresosManual = Number(movSummary.ingresos_manual) || 0;
    const egresosManual = Number(movSummary.egresos_manual) || 0;
    const ventasTotales = Number(salesSummary.ventas_totales) || 0;
    const cobrosEfectivo = Number(cobrosSummary.cobros_efectivo) || 0;
    const cobrosOtros = Number(cobrosSummary.cobros_otros) || 0;
    const montoTeorico = montoInicial + ingresosManual - egresosManual + cobrosEfectivo;

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
            cobros_efectivo: Number(cobrosEfectivo.toFixed(2)),
            cobros_otros: Number(cobrosOtros.toFixed(2)),
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
app.get('/api/cajas', allowAdminOrCashier, requireSede, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM cajas WHERE sede_id = ?', [sedeOf(req)]);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/cajas', allowAdmin, requireSede, async (req, res) => {
    const { descripcion, saldo, estado } = req.body;
    try {
        const [result] = await pool.query(
            'INSERT INTO cajas (sede_id, descripcion, saldo, estado) VALUES (?, ?, ?, ?)',
            [sedeOf(req), descripcion, saldo || 0, estado || 'cerrada']
        );
        res.json({ ...req.body, id: result.insertId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/caja/sesion-activa', allowAdminOrCashier, requireSede, async (req, res) => {
    const cajaId = req.query.caja_id ? Number(req.query.caja_id) : null;
    const sedeId = sedeOf(req);
    try {
        const [rows] = await pool.query(`
            SELECT id
            FROM caja_sesiones
            WHERE estado = 'abierta' AND sede_id = ? ${cajaId ? 'AND caja_id = ?' : ''}
            ORDER BY fecha_apertura DESC
            LIMIT 1
        `, cajaId ? [sedeId, cajaId] : [sedeId]);

        if (rows.length === 0) {
            return res.json(null);
        }

        const sessionSummary = await buildCashSessionSummary(pool, rows[0].id, sedeId);
        res.json(sessionSummary);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Open sessions of the sede, one per caja: the sale picks the caja it is registered in.
app.get('/api/caja/sesiones-abiertas', allowAdminOrCashier, requireSede, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT s.id, s.caja_id, c.descripcion AS caja_descripcion, s.fecha_apertura
             FROM caja_sesiones s JOIN cajas c ON c.id = s.caja_id
             WHERE s.sede_id = ? AND s.estado = 'abierta' ORDER BY c.descripcion ASC`,
            [sedeOf(req)]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/caja/apertura', allowAdminOrCashier, requireSede, async (req, res) => {
    const { caja_id, monto_inicial, observaciones } = req.body;
    const turno = String(req.body.turno ?? '').trim().slice(0, 30) || null;
    const cajaId = Number(caja_id);
    const userId = req.userContext.id; // el usuario que abre es el de la sesion iniciada, no un dato del formulario
    const montoInicial = Number(monto_inicial) || 0;
    const sedeId = sedeOf(req);

    if (!cajaId) {
        return res.status(400).json({ error: 'caja_id es obligatorio' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // Locking the caja row serialises concurrent openings of the same register.
        const [cajaRows] = await connection.query('SELECT id FROM cajas WHERE id = ? AND sede_id = ? LIMIT 1 FOR UPDATE', [cajaId, sedeId]);
        if (cajaRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Caja no encontrada' });
        }

        const [activeRows] = await connection.query(
            `SELECT id FROM caja_sesiones WHERE caja_id = ? AND estado = 'abierta' LIMIT 1`,
            [cajaId]
        );
        if (activeRows.length > 0) {
            await connection.rollback();
            return res.status(409).json({ error: 'Ya existe una sesion abierta para esta caja' });
        }

        const conTurno = await sesionesConTurno();
        const [result] = await connection.query(
            `INSERT INTO caja_sesiones (sede_id, caja_id, ${conTurno ? 'turno, ' : ''}usuario_apertura_id, monto_inicial, observaciones_apertura, estado)
             VALUES (?, ?, ${conTurno ? '?, ' : ''}?, ?, ?, 'abierta')`,
            conTurno ? [sedeId, cajaId, turno, userId, montoInicial, observaciones || null] : [sedeId, cajaId, userId, montoInicial, observaciones || null]
        );

        await connection.query('UPDATE cajas SET estado = ? WHERE id = ?', ['abierta', cajaId]);
        await connection.commit();

        const summary = await buildCashSessionSummary(pool, result.insertId, sedeId);
        res.status(201).json(summary);
    } catch (err) {
        await connection.rollback();
        res.status(500).json({ error: err.message });
    } finally {
        connection.release();
    }
});

app.get('/api/caja/resumen/:sesionId', allowAdminOrCashier, requireSede, async (req, res) => {
    const sessionId = Number(req.params.sesionId);
    if (!sessionId) return res.status(400).json({ error: 'sesionId invalido' });
    try {
        const summary = await buildCashSessionSummary(pool, sessionId, sedeOf(req));
        if (!summary) return res.status(404).json({ error: 'Sesion no encontrada' });
        res.json(summary);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Informe de movimientos del arqueo (como el informe de cierre de caja de Cealka) ---
const DOC_VENTA_LABEL = { boleta: 'Boleta', factura: 'Factura', nota_venta: 'Nota de venta' };
const MEDIO_CAJA_LABEL = { efectivo: 'EFECTIVO', yape: 'YAPE', plin: 'PLIN', tarjeta: 'TARJETA', transferencia: 'TRANSFERENCIA', deposito: 'DEPOSITO' };

/**
 * Every movement of a cash session in one list: sale collections and refunds (by payment method) and the manual
 * movements of the drawer (cash). Cash movements move the drawer; the others are reported as "bancos".
 */
const armarInformeCaja = async (connection, sessionId, sedeId) => {
    const sesion = await buildCashSessionSummary(connection, sessionId, sedeId);
    if (!sesion) return null;

    const [cobros] = await connection.query(
        `SELECT cv.id, cv.fecha, cv.tipo, cv.monto, cv.metodo_pago, cv.referencia, f.tipo_comprobante, f.numero_comprobante,
                f.cliente_nombre, f.cliente_num_doc, n.numero_comprobante AS nota_numero, u.nombre AS usuario_nombre
         FROM cobros_venta cv
         JOIN facturas f ON f.id = cv.factura_id
         LEFT JOIN facturas n ON n.id = cv.nota_id
         LEFT JOIN usuarios u ON u.id = cv.usuario_id
         WHERE cv.sesion_id = ? AND cv.estado = 'activo'
         ORDER BY cv.fecha ASC, cv.id ASC`,
        [sessionId]
    );
    const [manuales] = await connection.query(
        `SELECT m.id, m.fecha, m.tipo, m.monto, m.descripcion, m.categoria, u.nombre AS usuario_nombre
         FROM movimientos_caja m LEFT JOIN usuarios u ON u.id = m.usuario_id
         WHERE m.sesion_id = ? ORDER BY m.fecha ASC, m.id ASC`,
        [sessionId]
    );

    const movimientos = [
        ...cobros.map((c) => ({
            fecha: c.fecha,
            tipo: c.tipo === 'devolucion' ? 'egreso' : 'ingreso',
            origen: c.tipo === 'devolucion' ? 'devolucion' : 'venta',
            medio: MEDIO_CAJA_LABEL[c.metodo_pago] || String(c.metodo_pago).toUpperCase(),
            es_efectivo: c.metodo_pago === 'efectivo',
            doc_tipo: DOC_VENTA_LABEL[c.tipo_comprobante] || c.tipo_comprobante,
            doc_numero: c.numero_comprobante,
            tercero: c.cliente_nombre || 'CLIENTES VARIOS',
            tercero_doc: c.cliente_num_doc || '',
            monto: Number(c.monto),
            referencia: c.referencia || '',
            comentario: c.tipo === 'devolucion' ? `Devolución por ${c.nota_numero || 'nota de crédito'}` : '',
            usuario_nombre: c.usuario_nombre || ''
        })),
        ...manuales.map((m) => ({
            fecha: m.fecha,
            tipo: m.tipo,
            origen: m.tipo === 'egreso' && m.categoria === 'retiro' ? 'retiro'
                : m.tipo === 'egreso' && /^Pago G-/i.test(m.descripcion || '') ? 'pago_gasto' : 'manual',
            medio: 'EFECTIVO',
            es_efectivo: true,
            doc_tipo: 'Movimiento',
            doc_numero: '',
            tercero: '',
            tercero_doc: '',
            monto: Number(m.monto),
            referencia: '',
            comentario: m.descripcion || '',
            usuario_nombre: m.usuario_nombre || ''
        }))
    ].sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

    const suma = (lista) => round2(lista.reduce((acc, m) => acc + m.monto, 0));
    const efectivo = movimientos.filter((m) => m.es_efectivo);
    const bancos = movimientos.filter((m) => !m.es_efectivo);
    const inicial = Number(sesion.monto_inicial) || 0;
    const ingresosEfectivo = suma(efectivo.filter((m) => m.tipo === 'ingreso'));
    const egresosEfectivo = suma(efectivo.filter((m) => m.tipo === 'egreso'));
    const esperado = round2(inicial + ingresosEfectivo - egresosEfectivo);
    const cerrada = sesion.estado === 'cerrada';

    const porMedio = {};
    movimientos.forEach((m) => { porMedio[m.medio] = round2((porMedio[m.medio] || 0) + (m.tipo === 'ingreso' ? m.monto : -m.monto)); });

    const config = await getEmpresaConfig(connection);
    const [sedes] = await connection.query('SELECT nombre, direccion FROM sedes WHERE id = ?', [sedeId]);

    return {
        empresa: {
            razon_social: config.razon_social || config.nombre_comercial || '',
            ruc: config.ruc || '',
            direccion: sedes[0]?.direccion || config.direccion || '',
            sede: sedes[0]?.nombre || ''
        },
        sesion: {
            id: sesion.id, caja: sesion.caja_descripcion, turno: sesion.turno || '', estado: sesion.estado,
            fecha_apertura: sesion.fecha_apertura, fecha_cierre: sesion.fecha_cierre,
            usuario_apertura: sesion.usuario_apertura_nombre, usuario_cierre: sesion.usuario_cierre_nombre,
            observaciones_apertura: sesion.observaciones_apertura, observaciones_cierre: sesion.observaciones_cierre
        },
        resumen: {
            monto_inicial: round2(inicial),
            ingresos_efectivo: ingresosEfectivo,
            egresos_efectivo: egresosEfectivo,
            ingresos_bancos: suma(bancos.filter((m) => m.tipo === 'ingreso')),
            egresos_bancos: suma(bancos.filter((m) => m.tipo === 'egreso')),
            ventas_efectivo: suma(efectivo.filter((m) => m.origen === 'venta')),
            ingresos_manuales: suma(efectivo.filter((m) => m.origen === 'manual' && m.tipo === 'ingreso')),
            pagos_gastos: suma(efectivo.filter((m) => m.origen === 'pago_gasto')),
            egresos_manuales: suma(efectivo.filter((m) => m.origen === 'manual' && m.tipo === 'egreso')),
            retiros: suma(efectivo.filter((m) => m.origen === 'retiro')),
            devoluciones_efectivo: suma(efectivo.filter((m) => m.origen === 'devolucion')),
            ventas_totales: Number(sesion.resumen.ventas_totales),
            esperado,
            real: cerrada && sesion.monto_contado_cierre !== null ? round2(Number(sesion.monto_contado_cierre)) : null,
            diferencia: cerrada && sesion.diferencia !== null ? round2(Number(sesion.diferencia)) : null
        },
        por_medio: porMedio,
        movimientos
    };
};

// Historial de arqueos (sesiones de caja) de la sede, para elegir el informe a descargar.
app.get('/api/caja/sesiones', allowAdminOrCashier, requireSede, async (req, res) => {
    const hoy = todayLocal();
    const desde = typeof req.query.desde === 'string' && isRealDate(req.query.desde) ? req.query.desde : addDaysToDate(hoy, -30);
    const hasta = typeof req.query.hasta === 'string' && isRealDate(req.query.hasta) ? req.query.hasta : hoy;
    if (desde > hasta) return res.status(400).json({ error: 'Rango de fechas invalido' });
    const conditions = ['s.sede_id = ?', 'DATE(s.fecha_apertura) BETWEEN ? AND ?'];
    const params = [sedeOf(req), desde, hasta];
    if (Number(req.query.caja_id)) { conditions.push('s.caja_id = ?'); params.push(Number(req.query.caja_id)); }
    try {
        const [rows] = await pool.query(
            `SELECT s.id, s.caja_id, ${(await sesionesConTurno()) ? 's.turno,' : ''} c.descripcion AS caja_descripcion, s.estado, s.fecha_apertura, s.fecha_cierre, s.monto_inicial,
                    s.monto_teorico_cierre, s.monto_contado_cierre, s.diferencia,
                    ua.nombre AS usuario_apertura_nombre, uc.nombre AS usuario_cierre_nombre
             FROM caja_sesiones s
             JOIN cajas c ON c.id = s.caja_id
             LEFT JOIN usuarios ua ON ua.id = s.usuario_apertura_id
             LEFT JOIN usuarios uc ON uc.id = s.usuario_cierre_id
             WHERE ${conditions.join(' AND ')}
             ORDER BY s.fecha_apertura DESC, s.id DESC LIMIT 200`,
            params
        );
        res.json({ periodo: { desde, hasta }, sesiones: rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/caja/sesiones/:id/informe', allowAdminOrCashier, requireSede, async (req, res) => {
    const sessionId = Number(req.params.id);
    if (!sessionId) return res.status(400).json({ error: 'Sesion invalida' });
    try {
        const informe = await armarInformeCaja(pool, sessionId, sedeOf(req));
        if (!informe) return res.status(404).json({ error: 'Sesion no encontrada' });
        res.json(informe);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/caja/movimiento-manual', allowAdminOrCashier, requireSede, async (req, res) => {
    const { sesion_id, tipo, monto, descripcion } = req.body;
    // An outgoing movement is either a small expense ('egreso') or a cash withdrawal/handover ('retiro').
    const categoria = tipo === 'egreso' && req.body.categoria === 'retiro' ? 'retiro' : tipo === 'egreso' ? 'egreso' : null;
    const sessionId = Number(sesion_id);
    const amount = Number(monto);
    const userId = req.userContext.id; // el usuario del movimiento es el de la sesion iniciada
    const sedeId = sedeOf(req);

    if (!sessionId || !['ingreso', 'egreso'].includes(tipo) || !(amount > 0)) {
        return res.status(400).json({ error: 'sesion_id, tipo y monto validos son obligatorios' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [sessionRows] = await connection.query(
            `SELECT id, caja_id, estado FROM caja_sesiones WHERE id = ? AND sede_id = ? LIMIT 1`,
            [sessionId, sedeId]
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
            `INSERT INTO movimientos_caja (caja_id, sesion_id, tipo, monto, descripcion, categoria, usuario_id)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [session.caja_id, sessionId, tipo, amount, descripcion || null, categoria, userId]
        );

        const adjustment = tipo === 'ingreso' ? amount : -amount;
        await connection.query('UPDATE cajas SET saldo = saldo + ? WHERE id = ?', [adjustment, session.caja_id]);

        await connection.commit();
        const summary = await buildCashSessionSummary(pool, sessionId, sedeId);
        res.status(201).json(summary);
    } catch (err) {
        await connection.rollback();
        res.status(500).json({ error: err.message });
    } finally {
        connection.release();
    }
});

app.post('/api/caja/cierre', allowAdminOrCashier, requireSede, async (req, res) => {
    const { sesion_id, monto_contado, observaciones } = req.body;
    const sessionId = Number(sesion_id);
    const userId = req.userContext.id; // quien cierra es el usuario de la sesion iniciada
    const cashCounted = Number(monto_contado);
    const sedeId = sedeOf(req);

    if (!sessionId || Number.isNaN(cashCounted)) {
        return res.status(400).json({ error: 'sesion_id y monto_contado son obligatorios' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const summary = await buildCashSessionSummary(connection, sessionId, sedeId);
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

        const closedSummary = await buildCashSessionSummary(pool, sessionId, sedeId);
        res.json(closedSummary);
    } catch (err) {
        await connection.rollback();
        res.status(500).json({ error: err.message });
    } finally {
        connection.release();
    }
});

app.post('/api/cajas/:id/movimientos', allowAdminOrCashier, requireSede, async (req, res) => {
    const { tipo, monto, descripcion, usuario_id } = req.body;
    const caja_id = req.params.id;

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [cajaRows] = await connection.query('SELECT id FROM cajas WHERE id = ? AND sede_id = ? LIMIT 1', [caja_id, sedeOf(req)]);
        if (cajaRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Caja no encontrada' });
        }

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
const zonaBelongsToSede = async (zonaId, sedeId) => {
    if (!zonaId) return true;
    const [rows] = await pool.query('SELECT id FROM zonas WHERE id = ? AND sede_id = ? LIMIT 1', [zonaId, sedeId]);
    return rows.length > 0;
};

app.get('/api/mesas', allowAnyProfile, requireSede, async (req, res) => {
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
            WHERE m.sede_id = ?
        `, [sedeOf(req)]);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/mesas/:id', allowAnyProfile, requireSede, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT m.*, z.nombre as zona_nombre
            FROM mesas m
            LEFT JOIN zonas z ON m.zona_id = z.id
            WHERE m.id = ? AND m.sede_id = ?
        `, [req.params.id, sedeOf(req)]);
        if (rows.length === 0) return res.status(404).json({ message: 'Mesa no encontrada' });
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/mesas', allowAdmin, requireSede, async (req, res) => {
    const { numero, capacidad, zona_id } = req.body;
    try {
        if (!(await zonaBelongsToSede(zona_id, sedeOf(req)))) {
            return res.status(400).json({ error: 'La zona no pertenece a esta sede' });
        }
        const [result] = await pool.query(
            'INSERT INTO mesas (sede_id, numero, capacidad, zona_id) VALUES (?, ?, ?, ?)',
            [sedeOf(req), numero, capacidad, zona_id]
        );
        res.json({ ...req.body, id: result.insertId });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'Ya existe una mesa con ese numero en esta sede' });
        }
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/mesas/:id', allowAdmin, requireSede, async (req, res) => {
    const { numero, capacidad, zona_id, estado } = req.body;
    try {
        if (!(await zonaBelongsToSede(zona_id, sedeOf(req)))) {
            return res.status(400).json({ error: 'La zona no pertenece a esta sede' });
        }
        await pool.query(
            'UPDATE mesas SET numero = ?, capacidad = ?, zona_id = ?, estado = ? WHERE id = ? AND sede_id = ?',
            [numero, capacidad, zona_id, estado || 'libre', req.params.id, sedeOf(req)]
        );
        res.json({ message: 'Mesa actualizada' });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'Ya existe una mesa con ese numero en esta sede' });
        }
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/mesas/:id', allowAdmin, requireSede, async (req, res) => {
    try {
        await pool.query('DELETE FROM mesas WHERE id = ? AND sede_id = ?', [req.params.id, sedeOf(req)]);
        res.json({ message: 'Mesa eliminada' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Proveedores (compartidos entre sedes) ---
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
    const nroCuenta = String(req.body.nro_cuenta ?? '').trim().slice(0, 60) || null;
    const observaciones = String(req.body.observaciones ?? '').trim().slice(0, 500) || null;
    try {
        const [result] = await pool.query(
            'INSERT INTO proveedores (razon_social, ruc, contacto, telefono, direccion, nro_cuenta, observaciones) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [razon_social, ruc, contacto, telefono, direccion, nroCuenta, observaciones]
        );
        res.json({ ...req.body, id: result.insertId, nro_cuenta: nroCuenta, observaciones });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/proveedores/:id', allowAdminKitchenForWrites, async (req, res) => {
    const { razon_social, ruc, contacto, telefono, direccion } = req.body;
    const nroCuenta = String(req.body.nro_cuenta ?? '').trim().slice(0, 60) || null;
    const observaciones = String(req.body.observaciones ?? '').trim().slice(0, 500) || null;
    try {
        await pool.query(
            'UPDATE proveedores SET razon_social = ?, ruc = ?, contacto = ?, telefono = ?, direccion = ?, nro_cuenta = ?, observaciones = ? WHERE id = ?',
            [razon_social, ruc, contacto, telefono, direccion, nroCuenta, observaciones, req.params.id]
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

// --- Stock por almacen ---
// Each sede has warehouses: purchases enter the "para_compras" one and sales leave the "para_ventas" one.
// Screens keep showing the sede total (the sum of its warehouses).
const STOCK_TABLES = {
    producto: { table: 'stock_productos', column: 'producto_id', amount: 'stock' },
    insumo: { table: 'stock_insumos', column: 'insumo_id', amount: 'stock_actual' }
};

const almacenPorDefecto = async (connection, sedeId, uso) => {
    const flag = uso === 'ventas' ? 'para_ventas' : 'para_compras';
    const [rows] = await connection.query(
        `SELECT id FROM almacenes WHERE sede_id = ? AND activo = 1 ORDER BY ${flag} DESC, id ASC LIMIT 1`,
        [sedeId]
    );
    if (rows.length === 0) throw new Error('La sede no tiene almacenes activos');
    return rows[0].id;
};

const adjustStockAlmacen = async (connection, tipo, almacenId, sedeId, itemId, delta) => {
    const { table, column, amount } = STOCK_TABLES[tipo];
    await connection.query(
        `INSERT INTO ${table} (almacen_id, sede_id, ${column}, ${amount}) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE ${amount} = ${amount} + VALUES(${amount})`,
        [almacenId, sedeId, itemId, delta]
    );
};

/** Sets the sede total by adjusting its default warehouse (the other warehouses keep their stock). */
const setStockSede = async (connection, tipo, sedeId, itemId, total, uso) => {
    const { table, column, amount } = STOCK_TABLES[tipo];
    const almacenId = await almacenPorDefecto(connection, sedeId, uso);
    const [otros] = await connection.query(
        `SELECT COALESCE(SUM(${amount}), 0) AS total FROM ${table} WHERE sede_id = ? AND ${column} = ? AND almacen_id <> ?`,
        [sedeId, itemId, almacenId]
    );
    await connection.query(
        `INSERT INTO ${table} (almacen_id, sede_id, ${column}, ${amount}) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE ${amount} = VALUES(${amount})`,
        [almacenId, sedeId, itemId, (Number(total) || 0) - Number(otros[0].total)]
    );
};

const setProductStock = (connection, sedeId, productoId, stock) => setStockSede(connection, 'producto', sedeId, productoId, stock, 'ventas');

// Sales (negative) leave the sales warehouse; entries go to the purchases warehouse unless one is given.
const adjustProductStock = async (connection, sedeId, productoId, delta, almacenId = null) => adjustStockAlmacen(
    connection, 'producto', almacenId || await almacenPorDefecto(connection, sedeId, delta < 0 ? 'ventas' : 'compras'), sedeId, productoId, delta
);

/**
 * Finished products (bar categories or items that are not prepared from a recipe) leave the sales warehouse when
 * the order is sold. Stock may go negative: selling is never blocked by a missing count.
 */
// True once productos.factor_venta exists (se crea al iniciar); mientras no, cada unidad vendida descuenta 1 como antes.
let tieneFactorVenta = false;

const descontarStockVenta = async (connection, sedeId, pedidoId, referencia, usuarioId) => {
    const [items] = await connection.query(
        `SELECT dp.producto_id, ROUND(SUM(dp.cantidad) * ${tieneFactorVenta ? 'MAX(p.factor_venta)' : '1'}, 3) AS cantidad
         FROM detalles_pedido dp
         JOIN productos p ON p.id = dp.producto_id
         LEFT JOIN tipos_producto tp ON tp.id = p.tipo_id
         WHERE dp.pedido_id = ? AND (tp.es_barra = 1 OR p.es_receta = 0)
         GROUP BY dp.producto_id`,
        [pedidoId]
    );
    if (items.length === 0) return;
    const almacenId = await almacenPorDefecto(connection, sedeId, 'ventas');
    for (const item of items) {
        const cantidad = Number(item.cantidad);
        await adjustStockAlmacen(connection, 'producto', almacenId, sedeId, item.producto_id, -cantidad);
        await registrarMovimiento(connection, {
            almacenId, sedeId, tipo: 'producto', itemId: item.producto_id, cantidad: -cantidad,
            motivo: 'venta', transferenciaId: null, detalle: referencia, usuarioId
        });
    }
};

const setSupplyStock = (connection, sedeId, insumoId, stock) => setStockSede(connection, 'insumo', sedeId, insumoId, stock, 'compras');

const adjustSupplyStock = async (connection, sedeId, insumoId, delta, almacenId = null) => adjustStockAlmacen(
    connection, 'insumo', almacenId || await almacenPorDefecto(connection, sedeId, 'compras'), sedeId, insumoId, delta
);

// --- Unidades de medida (catalogo compartido) y conversiones ---
/** Catalog text (abbreviation or name, lowercase) -> SUNAT unit code; reloaded whenever the catalog changes. */
const unidadesSunatPorTexto = new Map();

const cargarUnidadesSunat = async () => {
    const [rows] = await pool.query('SELECT nombre, abreviatura, codigo_sunat FROM unidades_medida');
    unidadesSunatPorTexto.clear();
    for (const r of rows) {
        unidadesSunatPorTexto.set(String(r.abreviatura).toLowerCase(), r.codigo_sunat);
        unidadesSunatPorTexto.set(String(r.nombre).toLowerCase(), r.codigo_sunat);
    }
};

const httpError = (status, message) => Object.assign(new Error(message), { status });

/** Validates a unit id sent with an item: it must exist and be active. */
const unidadValida = async (connection, value) => {
    const id = Number(value);
    const [rows] = Number.isInteger(id) && id > 0 ? await connection.query('SELECT * FROM unidades_medida WHERE id = ?', [id]) : [[]];
    if (rows.length === 0) throw httpError(400, 'La unidad de medida seleccionada no existe');
    if (!Number(rows[0].activo)) throw httpError(400, `La unidad ${rows[0].abreviatura} esta desactivada`);
    return rows[0];
};

/**
 * Unit of an item body: the chosen unit_id, else the legacy text (name or abbreviation), else "Unidad".
 * Returns the unit row; the item keeps unidad_id plus the abbreviation in unidad_medida (the text other reports read).
 */
const resolverUnidad = async (connection, body) => {
    if (body.unidad_id !== undefined && body.unidad_id !== null && body.unidad_id !== '') return unidadValida(connection, body.unidad_id);
    const texto = String(body.unidad_medida ?? '').trim();
    const [rows] = await connection.query(
        'SELECT * FROM unidades_medida WHERE activo = 1 AND (LOWER(abreviatura) = LOWER(?) OR LOWER(nombre) = LOWER(?)) LIMIT 1',
        [texto || 'Unidad', texto || 'Unidad']
    );
    if (rows.length === 0) throw httpError(400, 'La unidad de medida seleccionada no existe');
    return rows[0];
};

/** How many units of `haciaId` one unit of `desdeId` is worth (direct or inverse conversion), or null when none is defined. */
const factorConversion = async (connection, desdeId, haciaId) => {
    if (Number(desdeId) === Number(haciaId)) return 1;
    const [rows] = await connection.query(
        `SELECT unidad_origen_id, factor FROM unidad_conversiones
         WHERE (unidad_origen_id = ? AND unidad_destino_id = ?) OR (unidad_origen_id = ? AND unidad_destino_id = ?)`,
        [desdeId, haciaId, haciaId, desdeId]
    );
    const directa = rows.find((r) => Number(r.unidad_origen_id) === Number(desdeId));
    if (directa) return Number(directa.factor);
    return rows[0] ? 1 / Number(rows[0].factor) : null;
};

/**
 * Quantity line typed in `unidadId` for an item stocked in its own unit (catalogo.unidad_id):
 * factor to the stock unit, and whether the quantity must be a whole number.
 */
const esEntero = (tipoItem, catalogo) => !Number(catalogo.permite_decimales ?? (tipoItem === 'producto' ? 0 : 1));

const unidadDeLinea = async (connection, tipoItem, catalogo, unidadId, nombre) => {
    const base = catalogo.unidad_id ? Number(catalogo.unidad_id) : null;
    const elegida = unidadId ? Number(unidadId) : null;
    if (!elegida || !base || elegida === base) {
        return { factor: 1, entero: esEntero(tipoItem, catalogo) };
    }
    if (tipoItem !== 'insumo') throw httpError(400, `${nombre} no admite conversion de unidades`);
    const unidad = await unidadValida(connection, elegida);
    const factor = await factorConversion(connection, elegida, base);
    if (factor === null) throw httpError(400, `No hay conversion definida entre ${unidad.abreviatura} y la unidad de ${nombre}`);
    return { factor, entero: !Number(unidad.permite_decimales) };
};

/** SUNAT catalog 03 (units of measure) codes accepted for the catalog: an invented code would make SUNAT reject the receipt. */
const CODIGOS_SUNAT = {
    NIU: 'Unidad (bienes)', ZZ: 'Unidad (servicios)', KGM: 'Kilogramo', GRM: 'Gramo', LBR: 'Libra', ONZ: 'Onza', TNE: 'Tonelada metrica',
    LTR: 'Litro', MLT: 'Mililitro', GLL: 'Galon', MTR: 'Metro', CMT: 'Centimetro', MMT: 'Milimetro', MTK: 'Metro cuadrado', MTQ: 'Metro cubico',
    BX: 'Caja', BG: 'Bolsa', BO: 'Botella', CA: 'Lata', DZN: 'Docena', PK: 'Paquete', SA: 'Saco', SET: 'Juego', PR: 'Par', MIL: 'Millar',
    CEN: 'Centenar', BJ: 'Balde', CT: 'Carton', RL: 'Rollo', TU: 'Tubo', ST: 'Hoja', KT: 'Kit'
};

const textoUnidad = (value, max) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

/** Validated body of a unit, or the error message. */
const datosUnidad = (body) => {
    const nombre = textoUnidad(body?.nombre, 60);
    const abreviatura = textoUnidad(body?.abreviatura, 20);
    const codigo = String(body?.codigo_sunat ?? 'NIU').trim().toUpperCase();
    if (nombre.length < 2) return { error: 'El nombre de la unidad debe tener al menos 2 caracteres' };
    if (abreviatura.length < 1) return { error: 'Ingrese la abreviatura de la unidad' };
    if (!CODIGOS_SUNAT[codigo]) return { error: 'Seleccione un codigo de unidad SUNAT valido (catalogo 03)' };
    return { data: { nombre, abreviatura, codigo_sunat: codigo, permite_decimales: body?.permite_decimales === false || body?.permite_decimales === 0 ? 0 : 1 } };
};

app.get('/api/unidades-codigos-sunat', allowAnyProfile, (req, res) => {
    res.json(Object.entries(CODIGOS_SUNAT).map(([codigo, nombre]) => ({ codigo, nombre })));
});

app.get('/api/unidades-medida', allowAnyProfile, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT u.*, (SELECT COUNT(*) FROM insumos i WHERE i.unidad_id = u.id) AS insumos,
                    (SELECT COUNT(*) FROM productos p WHERE p.unidad_id = u.id) AS productos
             FROM unidades_medida u ORDER BY u.activo DESC, u.nombre ASC`
        );
        res.json(rows.map((r) => ({ ...r, activo: Number(r.activo), permite_decimales: Number(r.permite_decimales), insumos: Number(r.insumos), productos: Number(r.productos) })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/unidades-medida', allowAdmin, async (req, res) => {
    const { data, error } = datosUnidad(req.body);
    if (error) return res.status(400).json({ error });
    try {
        const [repetida] = await pool.query('SELECT id FROM unidades_medida WHERE nombre = ? OR abreviatura = ?', [data.nombre, data.abreviatura]);
        if (repetida.length > 0) return res.status(409).json({ error: 'Ya existe una unidad con ese nombre o abreviatura' });
        const [result] = await pool.query(
            'INSERT INTO unidades_medida (nombre, abreviatura, codigo_sunat, permite_decimales) VALUES (?, ?, ?, ?)',
            [data.nombre, data.abreviatura, data.codigo_sunat, data.permite_decimales]
        );
        await cargarUnidadesSunat();
        res.status(201).json({ id: result.insertId, ...data, activo: 1, insumos: 0, productos: 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/unidades-medida/:id', allowAdmin, async (req, res) => {
    const { data, error } = datosUnidad(req.body);
    if (error) return res.status(400).json({ error });
    const activo = req.body?.activo === false || req.body?.activo === 0 ? 0 : 1;
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [actual] = await connection.query('SELECT id FROM unidades_medida WHERE id = ? FOR UPDATE', [req.params.id]);
        if (actual.length === 0) throw httpError(404, 'Unidad no encontrada');
        const [repetida] = await connection.query('SELECT id FROM unidades_medida WHERE (nombre = ? OR abreviatura = ?) AND id <> ?', [data.nombre, data.abreviatura, req.params.id]);
        if (repetida.length > 0) throw httpError(409, 'Ya existe una unidad con ese nombre o abreviatura');
        await connection.query(
            'UPDATE unidades_medida SET nombre = ?, abreviatura = ?, codigo_sunat = ?, permite_decimales = ?, activo = ? WHERE id = ?',
            [data.nombre, data.abreviatura, data.codigo_sunat, data.permite_decimales, activo, req.params.id]
        );
        // insumos.unidad_medida keeps the abbreviation as text for reports and guides.
        await connection.query('UPDATE insumos SET unidad_medida = ? WHERE unidad_id = ?', [data.abreviatura, req.params.id]);
        await connection.commit();
        await cargarUnidadesSunat();
        res.json({ id: Number(req.params.id), ...data, activo });
    } catch (err) {
        await connection.rollback();
        res.status(err.status || 500).json({ error: err.message });
    } finally {
        connection.release();
    }
});

app.delete('/api/unidades-medida/:id', allowAdmin, async (req, res) => {
    try {
        const [uso] = await pool.query(
            `SELECT (SELECT COUNT(*) FROM insumos WHERE unidad_id = ?) + (SELECT COUNT(*) FROM productos WHERE unidad_id = ?) AS total`,
            [req.params.id, req.params.id]
        );
        if (Number(uso[0].total) > 0) return res.status(409).json({ error: `La unidad la usan ${uso[0].total} item(s): cambialos de unidad o desactivala` });
        const [result] = await pool.query('DELETE FROM unidades_medida WHERE id = ?', [req.params.id]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Unidad no encontrada' });
        await cargarUnidadesSunat();
        res.json({ message: 'Unidad eliminada' });
    } catch (err) {
        res.status(err.code === 'ER_ROW_IS_REFERENCED_2' ? 409 : 500).json({ error: err.code === 'ER_ROW_IS_REFERENCED_2' ? 'La unidad ya se uso en compras: desactivala en lugar de eliminarla' : err.message });
    }
});

app.get('/api/unidades-conversiones', allowAnyProfile, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT c.id, c.unidad_origen_id, c.unidad_destino_id, c.factor,
                    o.abreviatura AS origen, d.abreviatura AS destino
             FROM unidad_conversiones c
             JOIN unidades_medida o ON o.id = c.unidad_origen_id
             JOIN unidades_medida d ON d.id = c.unidad_destino_id
             ORDER BY o.nombre, d.nombre`
        );
        res.json(rows.map((r) => ({ ...r, factor: Number(r.factor) })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 1 unidad de origen = factor unidades de destino. Guardar de nuevo el mismo par actualiza el factor.
app.post('/api/unidades-conversiones', allowAdmin, async (req, res) => {
    const origenId = Number(req.body?.unidad_origen_id);
    const destinoId = Number(req.body?.unidad_destino_id);
    const factor = Math.round(Number(req.body?.factor) * 1e6) / 1e6;
    if (!(origenId > 0) || !(destinoId > 0)) return res.status(400).json({ error: 'Seleccione la unidad de origen y la de destino' });
    if (origenId === destinoId) return res.status(400).json({ error: 'La unidad de origen y la de destino deben ser distintas' });
    if (!(factor > 0) || factor >= 1e8) return res.status(400).json({ error: 'El factor debe ser un numero mayor a 0' });
    const connection = await pool.getConnection();
    try {
        await unidadValida(connection, origenId);
        await unidadValida(connection, destinoId);
        // The inverse is computed from the direct one, so a pair is stored in one direction only.
        await connection.query('DELETE FROM unidad_conversiones WHERE unidad_origen_id = ? AND unidad_destino_id = ?', [destinoId, origenId]);
        await connection.query(
            `INSERT INTO unidad_conversiones (unidad_origen_id, unidad_destino_id, factor) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE factor = VALUES(factor)`,
            [origenId, destinoId, factor]
        );
        res.status(201).json({ message: 'Conversion guardada' });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    } finally {
        connection.release();
    }
});

app.delete('/api/unidades-conversiones/:id', allowAdmin, async (req, res) => {
    try {
        const [result] = await pool.query('DELETE FROM unidad_conversiones WHERE id = ?', [req.params.id]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Conversion no encontrada' });
        res.json({ message: 'Conversion eliminada' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Categorias de insumo (catalogo compartido) ---
/** Validates the category sent with a supply: a known category id, or null for "sin categoria". */
const categoriaInsumoValida = async (connection, value) => {
    if (value === undefined || value === null || value === '') return null;
    const id = Number(value);
    const [rows] = Number.isInteger(id) && id > 0 ? await connection.query('SELECT id FROM categorias_insumo WHERE id = ?', [id]) : [[]];
    if (rows.length === 0) throw Object.assign(new Error('La categoria seleccionada no existe'), { status: 400 });
    return id;
};

const nombreCategoriaInsumo = (value) => String(value ?? '').trim().replace(/\s+/g, ' ');

app.get('/api/categorias-insumo', allowAdminKitchenForWrites, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT c.id, c.nombre, (SELECT COUNT(*) FROM insumos i WHERE i.categoria_id = c.id) AS insumos
             FROM categorias_insumo c ORDER BY c.nombre ASC`
        );
        res.json(rows.map((r) => ({ ...r, insumos: Number(r.insumos) })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/categorias-insumo', allowAdminKitchenForWrites, async (req, res) => {
    const nombre = nombreCategoriaInsumo(req.body?.nombre);
    if (nombre.length < 2 || nombre.length > 80) return res.status(400).json({ error: 'El nombre de la categoria debe tener entre 2 y 80 caracteres' });
    try {
        const [existente] = await pool.query('SELECT id FROM categorias_insumo WHERE nombre = ?', [nombre]);
        if (existente.length > 0) return res.status(409).json({ error: 'Ya existe una categoria con ese nombre' });
        const [result] = await pool.query('INSERT INTO categorias_insumo (nombre) VALUES (?)', [nombre]);
        res.status(201).json({ id: result.insertId, nombre, insumos: 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/categorias-insumo/:id', allowAdminKitchenForWrites, async (req, res) => {
    const nombre = nombreCategoriaInsumo(req.body?.nombre);
    if (nombre.length < 2 || nombre.length > 80) return res.status(400).json({ error: 'El nombre de la categoria debe tener entre 2 y 80 caracteres' });
    try {
        const [actual] = await pool.query('SELECT id FROM categorias_insumo WHERE id = ?', [req.params.id]);
        if (actual.length === 0) return res.status(404).json({ error: 'Categoria no encontrada' });
        const [repetida] = await pool.query('SELECT id FROM categorias_insumo WHERE nombre = ? AND id <> ?', [nombre, req.params.id]);
        if (repetida.length > 0) return res.status(409).json({ error: 'Ya existe una categoria con ese nombre' });
        await pool.query('UPDATE categorias_insumo SET nombre = ? WHERE id = ?', [nombre, req.params.id]);
        res.json({ id: Number(req.params.id), nombre });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/categorias-insumo/:id', allowAdminKitchenForWrites, async (req, res) => {
    try {
        const [uso] = await pool.query('SELECT COUNT(*) AS total FROM insumos WHERE categoria_id = ?', [req.params.id]);
        if (Number(uso[0].total) > 0) return res.status(409).json({ error: `La categoria tiene ${uso[0].total} insumo(s): cambialos de categoria antes de eliminarla` });
        const [result] = await pool.query('DELETE FROM categorias_insumo WHERE id = ?', [req.params.id]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Categoria no encontrada' });
        res.json({ message: 'Categoria eliminada' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Insumos (catalogo compartido, stock por sede) ---
app.get('/api/insumos', allowAdminKitchenForWrites, requireSede, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT i.*, c.nombre AS categoria_nombre, um.permite_decimales AS unidad_decimales,
                   (SELECT COALESCE(SUM(si.stock_actual), 0) FROM stock_insumos si WHERE si.insumo_id = i.id AND si.sede_id = ?) AS stock_actual
            FROM insumos i
            LEFT JOIN categorias_insumo c ON c.id = i.categoria_id
            LEFT JOIN unidades_medida um ON um.id = i.unidad_id
        `, [sedeOf(req)]);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/insumos', allowAdminKitchenForWrites, requireSede, async (req, res) => {
    const { nombre, costo_unitario, stock_actual } = req.body;
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const categoriaId = await categoriaInsumoValida(connection, req.body.categoria_id);
        const unidad = await resolverUnidad(connection, req.body);
        const [result] = await connection.query(
            'INSERT INTO insumos (nombre, unidad_medida, unidad_id, costo_unitario, categoria_id) VALUES (?, ?, ?, ?, ?)',
            [nombre, unidad.abreviatura, unidad.id, costo_unitario, categoriaId]
        );
        await setSupplyStock(connection, sedeOf(req), result.insertId, stock_actual);
        await connection.commit();
        res.json({ ...req.body, id: result.insertId, unidad_id: unidad.id, unidad_medida: unidad.abreviatura });
    } catch (err) {
        await connection.rollback();
        res.status(err.status || 500).json({ error: err.message });
    } finally {
        connection.release();
    }
});

app.put('/api/insumos/:id', allowAdminKitchenForWrites, requireSede, async (req, res) => {
    const { nombre, costo_unitario, stock_actual } = req.body;
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const categoriaId = await categoriaInsumoValida(connection, req.body.categoria_id);
        const unidad = await resolverUnidad(connection, req.body);
        await connection.query(
            'UPDATE insumos SET nombre = ?, unidad_medida = ?, unidad_id = ?, costo_unitario = ?, categoria_id = ? WHERE id = ?',
            [nombre, unidad.abreviatura, unidad.id, costo_unitario, categoriaId, req.params.id]
        );
        if (stock_actual !== undefined) {
            await setSupplyStock(connection, sedeOf(req), req.params.id, stock_actual);
        }
        await connection.commit();
        res.json({ message: 'Insumo actualizado' });
    } catch (err) {
        await connection.rollback();
        res.status(err.status || 500).json({ error: err.message });
    } finally {
        connection.release();
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
// Detalle de compras de la sede (una fila por item) para el reporte descargable.
app.get('/api/compras', allowAdminKitchenForWrites, requireSede, async (req, res) => {
    const { desde, hasta } = req.query;
    const ymd = /^\d{4}-\d{2}-\d{2}$/;
    if ((desde && !ymd.test(desde)) || (hasta && !ymd.test(hasta))) {
        return res.status(400).json({ error: 'Rango de fechas invalido' });
    }
    try {
        const params = [sedeOf(req)];
        let where = 'c.sede_id = ?';
        if (desde) { where += ' AND DATE(c.fecha_compra) >= ?'; params.push(desde); }
        if (hasta) { where += ' AND DATE(c.fecha_compra) <= ?'; params.push(hasta); }
        const [rows] = await pool.query(
            `SELECT c.id AS compra_id, c.fecha_compra, c.numero_factura_proveedor, c.estado, c.total AS total_compra,
                    COALESCE(pr.razon_social, '') AS proveedor, pr.ruc AS proveedor_ruc,
                    d.insumo_id, d.producto_id, COALESCE(i.nombre, p.nombre) AS item,
                    CASE WHEN d.insumo_id IS NOT NULL THEN 'Insumo' ELSE 'Bebida / Bar' END AS tipo,
                    COALESCE(du.abreviatura, i.unidad_medida) AS unidad_medida, d.cantidad, d.precio_unitario, d.subtotal
             FROM compras c
             JOIN proveedores pr ON pr.id = c.proveedor_id
             LEFT JOIN detalles_compra d ON d.compra_id = c.id
             LEFT JOIN unidades_medida du ON du.id = d.unidad_id
             LEFT JOIN insumos i ON i.id = d.insumo_id
             LEFT JOIN productos p ON p.id = d.producto_id
             WHERE ${where}
             ORDER BY c.fecha_compra DESC, c.id DESC, d.id`,
            params
        );
        res.json(rows);
    } catch (err) {
        console.error('Error in GET /api/compras:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/compras', allowAdminKitchenForWrites, requireSede, async (req, res) => {
    const { proveedor_id, detalles, numero_factura_proveedor, almacen_id: almacenElegido } = req.body;
    const sedeId = sedeOf(req);
    // detalles is array of { insumo_id, producto_id, cantidad, precio_unitario }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // The purchase enters the chosen warehouse of the sede, or its purchases warehouse.
        let almacenId = null;
        if (almacenElegido) {
            const [almRows] = await connection.query('SELECT id FROM almacenes WHERE id = ? AND sede_id = ? AND activo = 1', [almacenElegido, sedeId]);
            if (almRows.length === 0) throw new Error('El almacen no pertenece a la sede o esta inactivo');
            almacenId = almRows[0].id;
        }

        let total = 0;
        detalles.forEach(item => {
            total += item.cantidad * item.precio_unitario;
        });

        // Create Purchase Header
        const [compraResult] = await connection.query(
            'INSERT INTO compras (sede_id, proveedor_id, total, numero_factura_proveedor, estado) VALUES (?, ?, ?, ?, ?)',
            [sedeId, proveedor_id, total, numero_factura_proveedor, 'recibido']
        );
        const compraId = compraResult.insertId;

        // Warehouse that receives the purchase: the chosen one or the sede's purchases warehouse.
        const almacenIngresoId = almacenId || await almacenPorDefecto(connection, sedeId, 'compras');
        const conKardex = await movimientosConCostos();
        const referenciaCompra = String(numero_factura_proveedor || '').trim().slice(0, 100) || null;

        // Create Details and Update Stock
        for (const item of detalles) {
            const subtotal = item.cantidad * item.precio_unitario;
            // A supply can be bought in another unit (a box of 12 kg): the stock and the cost go in the supply's own unit.
            let cantidadStock = Number(item.cantidad);
            let costoStock = Number(item.precio_unitario);
            let unidadCompraId = null;
            if (item.insumo_id) {
                const [insumoRows] = await connection.query(
                    'SELECT i.nombre, i.unidad_id, um.permite_decimales FROM insumos i LEFT JOIN unidades_medida um ON um.id = i.unidad_id WHERE i.id = ?', [item.insumo_id]
                );
                if (!insumoRows[0]) throw httpError(404, 'Un insumo de la compra ya no existe');
                const { factor, entero } = await unidadDeLinea(connection, 'insumo', insumoRows[0], item.unidad_id, insumoRows[0].nombre);
                if (entero && !Number.isInteger(cantidadStock)) throw httpError(400, `${insumoRows[0].nombre} se compra en unidades enteras`);
                cantidadStock = Math.round(cantidadStock * factor * 1000) / 1000;
                costoStock = Math.round((costoStock / factor) * 100) / 100;
                unidadCompraId = item.unidad_id ? Number(item.unidad_id) : insumoRows[0].unidad_id;
            }
            await connection.query(
                'INSERT INTO detalles_compra (compra_id, insumo_id, producto_id, unidad_id, cantidad, precio_unitario, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [compraId, item.insumo_id || null, item.producto_id || null, unidadCompraId, item.cantidad, item.precio_unitario, subtotal]
            );

            // Update Stock
            // Every purchase line also enters the kardex (inventory movements and warehouse history).
            const registrarIngresoCompra = (tipoItem, itemId, cantidad, costoUnitario) => connection.query(
                `INSERT INTO inventario_movimientos (almacen_id, sede_id, tipo_item, item_id, cantidad, motivo, detalle, usuario_id${conKardex ? ', referencia, costo_unitario, costo_total' : ''})
                 VALUES (?, ?, ?, ?, ?, 'compra', ?, ?${conKardex ? ', ?, ?, ?' : ''})`,
                [almacenIngresoId, sedeId, tipoItem, itemId, cantidad, `Compra #${compraId}`, req.userContext.id,
                    ...(conKardex ? [referenciaCompra, costoUnitario, Math.round(costoUnitario * cantidad * 100) / 100] : [])]
            );
            if (item.producto_id) {
                await adjustProductStock(connection, sedeId, item.producto_id, Number(item.cantidad), almacenIngresoId);
                await registrarIngresoCompra('producto', item.producto_id, Number(item.cantidad), Number(item.precio_unitario));
            } else if (item.insumo_id) {
                // Weighted average cost over the stock of the supply in every warehouse, taken before this purchase enters.
                const [totales] = await connection.query(
                    'SELECT COALESCE(SUM(stock_actual), 0) AS stock FROM stock_insumos WHERE insumo_id = ? FOR UPDATE', [item.insumo_id]
                );
                const [actual] = await connection.query('SELECT costo_unitario FROM insumos WHERE id = ?', [item.insumo_id]);
                const previo = Math.max(0, Number(totales[0].stock));
                const costoPrevio = Number(actual[0]?.costo_unitario || 0);
                const promedio = previo > 0 && cantidadStock > 0
                    ? ((previo * costoPrevio) + (cantidadStock * costoStock)) / (previo + cantidadStock)
                    : costoStock;
                await adjustSupplyStock(connection, sedeId, item.insumo_id, cantidadStock, almacenIngresoId);
                await connection.query(
                    'UPDATE insumos SET costo_unitario = ? WHERE id = ?',
                    [Math.round(promedio * 100) / 100, item.insumo_id]
                );
                await registrarIngresoCompra('insumo', item.insumo_id, cantidadStock, costoStock);
            }
        }

        await connection.commit();
        res.json({ id: compraId, total, message: 'Compra registrada y stock actualizado' });

    } catch (err) {
        await connection.rollback();
        console.error('Error in POST /api/compras:', err);
        res.status(err.status || 500).json({ error: err.message });
    } finally {
        connection.release();
    }
});

// --- Tipos de Producto (Categorías, compartidas) ---
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
        res.json({ ...req.body, id: result.insertId });
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

// --- Productos (carta compartida, stock por sede) ---
const PRODUCT_SELECT_SQL = `
    SELECT p.*, (SELECT COALESCE(SUM(sp.stock), 0) FROM stock_productos sp WHERE sp.producto_id = p.id AND sp.sede_id = ?) AS stock,
           t.nombre as tipo_nombre, t.es_barra, COALESCE(um.abreviatura, 'Unidad') AS unidad_medida, COALESCE(um.permite_decimales, 0) AS unidad_decimales,
           CASE WHEN EXISTS (SELECT 1 FROM producto_imagenes pi WHERE pi.producto_id = p.id)
                THEN CONCAT('/api/productos/', p.id, '/imagen') ELSE NULL END AS imagen_url
    FROM productos p
    LEFT JOIN tipos_producto t ON p.tipo_id = t.id
    LEFT JOIN unidades_medida um ON um.id = p.unidad_id
`;

const parseProductImage = (dataUrl) => {
    const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(dataUrl || ''));
    if (!match) throw new Error('Usa una imagen JPG, PNG o WebP valida.');
    const mimeType = match[1];
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length || buffer.length > 3 * 1024 * 1024) throw new Error('La imagen optimizada no puede superar 3 MB.');
    const validSignature = mimeType === 'image/jpeg'
        ? buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
        : mimeType === 'image/png'
            ? buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            : buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
    if (!validSignature) throw new Error('El contenido no coincide con el formato de imagen seleccionado.');
    return { mimeType, buffer };
};

// (GET /api/productos/:id/imagen es publica y esta registrada antes del middleware de autenticacion.)
app.put('/api/productos/:id/imagen', allowAdminKitchenForWrites, requireSede, async (req, res) => {
    try {
        const { mimeType, buffer } = parseProductImage(req.body?.imagen_data);
        const [products] = await pool.query('SELECT id FROM productos WHERE id = ? LIMIT 1', [req.params.id]);
        if (!products.length) return res.status(404).json({ error: 'Producto no encontrado.' });
        await pool.query(
            `INSERT INTO producto_imagenes (producto_id, mime_type, contenido) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE mime_type = VALUES(mime_type), contenido = VALUES(contenido)`,
            [req.params.id, mimeType, buffer]
        );
        res.json({ ok: true, imagen_url: `/api/productos/${req.params.id}/imagen` });
    } catch (err) {
        res.status(err.message?.includes('imagen') || err.message?.includes('formato') ? 400 : 500).json({ error: err.message });
    }
});

app.delete('/api/productos/:id/imagen', allowAdminKitchenForWrites, requireSede, async (req, res) => {
    try {
        await pool.query('DELETE FROM producto_imagenes WHERE producto_id = ?', [req.params.id]);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/productos', allowAnyProfile, requireSede, async (req, res) => {
    try {
        const [rows] = await pool.query(PRODUCT_SELECT_SQL, [sedeOf(req)]);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/productos/:id', allowAnyProfile, requireSede, async (req, res) => {
    try {
        const [rows] = await pool.query(`${PRODUCT_SELECT_SQL} WHERE p.id = ?`, [sedeOf(req), req.params.id]);
        if (rows.length === 0) return res.status(404).json({ message: 'Producto no encontrado' });
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * Units of stock that each unit sold takes out (a 620 ml bottle of beer stocked in litres: 0.62). Blank or missing means 1.
 * `actual` is the value to keep when the client sends nothing.
 */
const parseFactorVenta = (valor, actual = 1) => {
    if (valor === undefined || valor === null || valor === '') return actual;
    const factor = Math.round(Number(valor) * 10000) / 10000;
    if (!(factor > 0) || factor > 100000) throw httpError(400, 'El descuento de stock por unidad vendida debe ser mayor a 0');
    return factor;
};

app.post('/api/productos', allowAdminKitchenForWrites, requireSede, async (req, res) => {
    const { nombre, descripcion, precio, tipo_id, es_receta, disponible, stock } = req.body;
    const connection = await pool.getConnection();
    try {
        const factorVenta = parseFactorVenta(req.body.factor_venta);
        await connection.beginTransaction();
        const unidad = await resolverUnidad(connection, req.body);
        const [result] = await connection.query(
            `INSERT INTO productos (nombre, descripcion, precio, tipo_id, es_receta, disponible, unidad_id${tieneFactorVenta ? ', factor_venta' : ''}) VALUES (?, ?, ?, ?, ?, ?, ?${tieneFactorVenta ? ', ?' : ''})`,
            [nombre, descripcion, precio, tipo_id, es_receta !== undefined ? es_receta : true, disponible !== undefined ? disponible : true, unidad.id, ...(tieneFactorVenta ? [factorVenta] : [])]
        );
        await setProductStock(connection, sedeOf(req), result.insertId, stock);
        await connection.commit();
        res.json({ ...req.body, id: result.insertId, unidad_id: unidad.id, unidad_medida: unidad.abreviatura });
    } catch (err) {
        await connection.rollback();
        res.status(err.status || 500).json({ error: err.message });
    } finally {
        connection.release();
    }
});

app.put('/api/productos/:id', allowAdminKitchenForWrites, requireSede, async (req, res) => {
    const { nombre, descripcion, precio, tipo_id, es_receta, disponible, stock } = req.body;
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        // Clients that do not send a unit keep the one the product already has.
        const unidad = req.body.unidad_id || req.body.unidad_medida ? await resolverUnidad(connection, req.body) : null;
        const factorVenta = parseFactorVenta(req.body.factor_venta, null);
        await connection.query(
            `UPDATE productos SET nombre = ?, descripcion = ?, precio = ?, tipo_id = ?, es_receta = ?, disponible = ?, unidad_id = COALESCE(?, unidad_id)${tieneFactorVenta ? ', factor_venta = COALESCE(?, factor_venta)' : ''} WHERE id = ?`,
            [nombre, descripcion, precio, tipo_id, es_receta, disponible, unidad ? unidad.id : null, ...(tieneFactorVenta ? [factorVenta] : []), req.params.id]
        );
        await setProductStock(connection, sedeOf(req), req.params.id, stock);
        await connection.commit();
        res.json({ message: 'Producto actualizado' });
    } catch (err) {
        await connection.rollback();
        res.status(err.status || 500).json({ error: err.message });
    } finally {
        connection.release();
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
app.get('/api/pedidos/mesa/:mesaId/activo', allowAdminWaiterCashier, requireSede, async (req, res) => {
    try {
        const [pedidos] = await pool.query(`
            SELECT id, estado, total
            FROM pedidos
            WHERE mesa_id = ?
              AND sede_id = ?
              AND estado NOT IN ('pagado', 'cancelado')
              AND EXISTS (
                  SELECT 1
                  FROM detalles_pedido dp
                  WHERE dp.pedido_id = pedidos.id
              )
            ORDER BY fecha_creacion DESC LIMIT 1
        `, [req.params.mesaId, sedeOf(req)]);

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

app.get('/api/pedidos', allowAnyProfile, requireSede, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT p.*, m.numero as mesa_numero, c.nombre as cliente_nombre,
                   (pdl.pedido_id IS NOT NULL) AS es_delivery, pdl.cliente_nombre AS delivery_cliente,
                   pdl.direccion AS delivery_direccion, pdl.estado AS delivery_estado
            FROM pedidos p
            LEFT JOIN mesas m ON p.mesa_id = m.id
            LEFT JOIN pedidos_delivery pdl ON pdl.pedido_id = p.id
            LEFT JOIN clientes c ON p.cliente_id = c.id
            WHERE p.sede_id = ?
            ORDER BY p.fecha_creacion DESC
        `, [sedeOf(req)]);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/pedidos/:id/detalle', allowAdminWaiterCashier, requireSede, async (req, res) => {
    try {
        const [pedidoRows] = await pool.query(`
            SELECT p.*, m.numero as mesa_numero, c.nombre as cliente_nombre
            FROM pedidos p
            LEFT JOIN mesas m ON p.mesa_id = m.id
            LEFT JOIN clientes c ON p.cliente_id = c.id
            WHERE p.id = ? AND p.sede_id = ?
            LIMIT 1
        `, [req.params.id, sedeOf(req)]);

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

const groupKitchenRows = (rows) => {
    const pedidosMap = {};
    rows.forEach(row => {
        if (!pedidosMap[row.pedido_id]) {
            pedidosMap[row.pedido_id] = {
                id: row.pedido_id,
                mesa_id: row.mesa_id,
                mesa_numero: row.mesa_numero,
                es_delivery: Boolean(Number(row.es_delivery)),
                delivery_cliente: row.delivery_cliente || null,
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
    return Object.values(pedidosMap);
};

app.get('/api/pedidos/cocina', allowAdminOrKitchen, requireSede, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT
                p.id as pedido_id, p.mesa_id, p.cliente_id, p.fecha_creacion, p.estado, p.total,
                m.numero as mesa_numero,
                c.nombre as cliente_nombre,
                dp.id as detalle_id, dp.producto_id, dp.cantidad, dp.notas,
                prod.nombre as producto_nombre, dp.estado_comanda,
                (pdl.pedido_id IS NOT NULL) AS es_delivery, pdl.cliente_nombre AS delivery_cliente
            FROM pedidos p
            LEFT JOIN mesas m ON p.mesa_id = m.id
            LEFT JOIN pedidos_delivery pdl ON pdl.pedido_id = p.id
            LEFT JOIN clientes c ON p.cliente_id = c.id
            JOIN detalles_pedido dp ON p.id = dp.pedido_id
            JOIN productos prod ON dp.producto_id = prod.id
            LEFT JOIN tipos_producto tp ON prod.tipo_id = tp.id
            WHERE p.sede_id = ?
            AND p.estado IN ('pendiente', 'en_proceso', 'listo')
            AND (tp.es_barra = 0 OR tp.es_barra IS NULL)
            AND DATE(p.fecha_creacion) = CURDATE()
            ORDER BY p.fecha_creacion ASC
        `, [sedeOf(req)]);

        res.json(groupKitchenRows(rows));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/pedidos/bar', allowAdminOrKitchen, requireSede, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT
                p.id as pedido_id, p.mesa_id, p.cliente_id, p.fecha_creacion, p.estado, p.total,
                m.numero as mesa_numero,
                c.nombre as cliente_nombre,
                dp.id as detalle_id, dp.producto_id, dp.cantidad, dp.notas,
                prod.nombre as producto_nombre, dp.estado_comanda,
                (pdl.pedido_id IS NOT NULL) AS es_delivery, pdl.cliente_nombre AS delivery_cliente
            FROM pedidos p
            LEFT JOIN mesas m ON p.mesa_id = m.id
            LEFT JOIN pedidos_delivery pdl ON pdl.pedido_id = p.id
            LEFT JOIN clientes c ON p.cliente_id = c.id
            JOIN detalles_pedido dp ON p.id = dp.pedido_id
            JOIN productos prod ON dp.producto_id = prod.id
            JOIN tipos_producto tp ON prod.tipo_id = tp.id
            WHERE p.sede_id = ?
            AND p.estado IN ('pendiente', 'en_proceso', 'listo')
            AND tp.es_barra = 1
            AND DATE(p.fecha_creacion) = CURDATE()
            ORDER BY p.fecha_creacion ASC
        `, [sedeOf(req)]);

        res.json(groupKitchenRows(rows));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/pedidos/:id/despachar-bar', allowAdminOrKitchen, requireSede, async (req, res) => {
    const sedeId = sedeOf(req);
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [pedidoRows] = await connection.query('SELECT id FROM pedidos WHERE id = ? AND sede_id = ? LIMIT 1', [req.params.id, sedeId]);
        if (pedidoRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Pedido no encontrado' });
        }

        // 1. Get the items for this order that are bar items
        const [items] = await connection.query(`
            SELECT dp.producto_id, dp.cantidad
            FROM detalles_pedido dp
            JOIN productos p ON dp.producto_id = p.id
            JOIN tipos_producto tp ON p.tipo_id = tp.id
            WHERE dp.pedido_id = ? AND tp.es_barra = 1
        `, [req.params.id]);

        // 2. Stock is deducted when the order is paid (descontarStockVenta), never here: dispatching twice would count twice.

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

app.post('/api/pedidos', allowAdminOrWaiter, requireSede, async (req, res) => {
    const { mesa_id, cliente_id, usuario_id, detalles } = req.body;
    const sedeId = sedeOf(req);
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

        const [mesaRows] = await connection.query('SELECT id FROM mesas WHERE id = ? AND sede_id = ? LIMIT 1', [mesa_id, sedeId]);
        if (mesaRows.length === 0) {
            await connection.rollback();
            return res.status(400).json({ error: 'La mesa no pertenece a esta sede' });
        }

        // Create Header
        const [orderResult] = await connection.query(
            'INSERT INTO pedidos (sede_id, mesa_id, cliente_id, usuario_id, estado) VALUES (?, ?, ?, ?, ?)',
            [sedeId, mesa_id, cliente_id, usuario_id, 'pendiente']
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

app.put('/api/pedidos/:id/detalles', allowAdminWaiterCashier, requireSede, async (req, res) => {
    const detalles = req.body?.detalles;
    if (!Array.isArray(detalles) || detalles.length === 0 || detalles.length > 100) {
        return res.status(400).json({ error: 'La comanda debe tener entre 1 y 100 productos.' });
    }
    const invalidItem = detalles.find((item) => {
        const productId = Number(item?.producto_id);
        const quantity = Number(item?.cantidad);
        const detailId = item?.detalle_id == null ? null : Number(item.detalle_id);
        return !Number.isInteger(productId) || productId <= 0
            || !Number.isInteger(quantity) || quantity <= 0
            || (detailId !== null && (!Number.isInteger(detailId) || detailId <= 0));
    });
    if (invalidItem) return res.status(400).json({ error: 'Cada producto debe tener identificadores y cantidades enteras validas.' });

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [orders] = await connection.query(
            'SELECT id, estado FROM pedidos WHERE id = ? AND sede_id = ? LIMIT 1 FOR UPDATE',
            [req.params.id, sedeOf(req)]
        );
        const order = orders[0];
        if (!order) {
            await connection.rollback();
            return res.status(404).json({ error: 'Comanda no encontrada.' });
        }
        if (['pagado', 'cancelado'].includes(order.estado)) {
            await connection.rollback();
            return res.status(409).json({ error: 'Esta comanda ya no se puede editar.' });
        }
        const [invoices] = await connection.query('SELECT id FROM facturas WHERE pedido_id = ? LIMIT 1', [order.id]);
        if (invoices.length) {
            await connection.rollback();
            return res.status(409).json({ error: 'La comanda ya tiene un comprobante y no se puede editar.' });
        }

        const [currentRows] = await connection.query(
            'SELECT id, producto_id, precio_unitario FROM detalles_pedido WHERE pedido_id = ? ORDER BY id FOR UPDATE',
            [order.id]
        );
        const currentById = new Map(currentRows.map((row) => [Number(row.id), row]));
        const seenDetailIds = new Set();
        const normalizedItems = [];
        for (const item of detalles) {
            const detailId = item.detalle_id == null ? null : Number(item.detalle_id);
            const productId = Number(item.producto_id);
            const quantity = Number(item.cantidad);
            if (detailId !== null) {
                const existing = currentById.get(detailId);
                if (!existing || Number(existing.producto_id) !== productId || seenDetailIds.has(detailId)) {
                    throw Object.assign(new Error('Una de las lineas ya no corresponde a esta comanda. Recarga e intenta nuevamente.'), { status: 409 });
                }
                seenDetailIds.add(detailId);
                normalizedItems.push({ detailId, productId, quantity, price: Number(existing.precio_unitario) });
            } else {
                const [products] = await connection.query('SELECT precio FROM productos WHERE id = ? AND disponible = 1 LIMIT 1', [productId]);
                if (!products.length) throw Object.assign(new Error('Uno de los productos agregados ya no esta disponible.'), { status: 409 });
                normalizedItems.push({ detailId: null, productId, quantity, price: Number(products[0].precio) });
            }
        }

        for (const item of normalizedItems) {
            const subtotal = Math.round(item.price * 100) * item.quantity / 100;
            if (item.detailId !== null) {
                await connection.query(
                    'UPDATE detalles_pedido SET cantidad = ?, subtotal = ? WHERE id = ? AND pedido_id = ?',
                    [item.quantity, subtotal, item.detailId, order.id]
                );
            } else {
                await connection.query(
                    'INSERT INTO detalles_pedido (pedido_id, producto_id, cantidad, precio_unitario, subtotal, notas) VALUES (?, ?, ?, ?, ?, ?)',
                    [order.id, item.productId, item.quantity, item.price, subtotal, '']
                );
            }
        }
        const removedIds = currentRows.filter((row) => !seenDetailIds.has(Number(row.id))).map((row) => Number(row.id));
        if (removedIds.length) {
            await connection.query('DELETE FROM detalles_pedido WHERE pedido_id = ? AND id IN (?)', [order.id, removedIds]);
        }
        const [totals] = await connection.query('SELECT COALESCE(SUM(subtotal), 0) AS total FROM detalles_pedido WHERE pedido_id = ?', [order.id]);
        const total = Number(totals[0]?.total || 0);
        await connection.query('UPDATE pedidos SET total = ? WHERE id = ?', [total, order.id]);
        const [savedRows] = await connection.query(
            `SELECT dp.id, dp.id AS detalle_id, dp.producto_id, dp.cantidad, dp.precio_unitario, dp.subtotal,
                    p.nombre AS producto_nombre, dp.estado_comanda
             FROM detalles_pedido dp JOIN productos p ON p.id = dp.producto_id
             WHERE dp.pedido_id = ? ORDER BY dp.id`,
            [order.id]
        );
        await connection.commit();
        res.json({ id: Number(order.id), total, detalles: savedRows });
    } catch (err) {
        await connection.rollback();
        res.status(err.status || 500).json({ error: err.message });
    } finally {
        connection.release();
    }
});

app.put('/api/pedidos/:id/items', allowAdminOrWaiter, requireSede, async (req, res) => {
    const { detalles } = req.body;
    const pedidoId = req.params.id;

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [pedidoRows] = await connection.query('SELECT id FROM pedidos WHERE id = ? AND sede_id = ? LIMIT 1', [pedidoId, sedeOf(req)]);
        if (pedidoRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Pedido no encontrado' });
        }

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

// Juntar mesas: las comandas abiertas de las mesas de origen pasan a una sola comanda en la mesa de destino.
// Si el destino no tiene comanda, la primera comanda de origen se muda a esa mesa y recibe las demas.
app.post('/api/pedidos/juntar-mesas', allowAdminOrWaiter, requireSede, async (req, res) => {
    const sedeId = sedeOf(req);
    const destinoId = Number(req.body?.mesa_destino_id);
    const origenIds = [...new Set((Array.isArray(req.body?.mesas_origen_ids) ? req.body.mesas_origen_ids : []).map(Number))];
    if (!Number.isInteger(destinoId) || destinoId <= 0) return res.status(400).json({ error: 'Seleccione la mesa de destino.' });
    if (origenIds.length === 0 || origenIds.some((id) => !Number.isInteger(id) || id <= 0)) {
        return res.status(400).json({ error: 'Seleccione al menos una mesa para juntar.' });
    }
    if (origenIds.length > 20) return res.status(400).json({ error: 'No se pueden juntar mas de 20 mesas a la vez.' });
    if (origenIds.includes(destinoId)) return res.status(400).json({ error: 'La mesa de destino no puede estar entre las mesas a juntar.' });

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [mesas] = await connection.query('SELECT id, numero FROM mesas WHERE sede_id = ? AND id IN (?)', [sedeId, [destinoId, ...origenIds]]);
        if (mesas.length !== origenIds.length + 1) throw Object.assign(new Error('Alguna mesa no pertenece a esta sede.'), { status: 400 });
        const numeroDe = new Map(mesas.map((m) => [Number(m.id), m.numero]));

        // Open order of each table (one per table), locked while the lines move.
        const abierto = async (mesaId) => {
            const [rows] = await connection.query(
                `SELECT p.id, p.mesa_id FROM pedidos p
                 WHERE p.sede_id = ? AND p.mesa_id = ? AND p.estado NOT IN ('pagado', 'cancelado')
                   AND EXISTS (SELECT 1 FROM detalles_pedido dp WHERE dp.pedido_id = p.id)
                 ORDER BY p.fecha_creacion ASC FOR UPDATE`,
                [sedeId, mesaId]
            );
            return rows;
        };
        const pedidosOrigen = [];
        for (const mesaId of origenIds) {
            const pedidos = await abierto(mesaId);
            if (pedidos.length === 0) throw Object.assign(new Error(`La mesa ${numeroDe.get(mesaId)} no tiene una comanda abierta para juntar.`), { status: 409 });
            pedidosOrigen.push(...pedidos);
        }
        const pedidosDestino = await abierto(destinoId);
        const todos = [...pedidosDestino, ...pedidosOrigen];

        const [facturados] = await connection.query('SELECT pedido_id FROM facturas WHERE pedido_id IN (?)', [todos.map((p) => p.id)]);
        if (facturados.length > 0) throw Object.assign(new Error('Una de las comandas ya tiene comprobante y no se puede juntar.'), { status: 409 });

        const base = pedidosDestino[0] || pedidosOrigen[0];
        const resto = todos.filter((p) => Number(p.id) !== Number(base.id));
        if (Number(base.mesa_id) !== destinoId) await connection.query('UPDATE pedidos SET mesa_id = ? WHERE id = ?', [destinoId, base.id]);
        for (const pedido of resto) {
            await connection.query('UPDATE detalles_pedido SET pedido_id = ? WHERE pedido_id = ?', [base.id, pedido.id]);
            await connection.query("UPDATE pedidos SET estado = 'cancelado', total = 0, unido_a_pedido_id = ? WHERE id = ?", [base.id, pedido.id]);
        }

        // The merged order shows the least advanced state of its lines.
        const [lineas] = await connection.query('SELECT estado_comanda, subtotal FROM detalles_pedido WHERE pedido_id = ?', [base.id]);
        const total = round2(lineas.reduce((acc, l) => acc + Number(l.subtotal), 0));
        const estado = lineas.some((l) => l.estado_comanda === 'pendiente') ? 'pendiente'
            : lineas.some((l) => l.estado_comanda === 'en_cocina') ? 'en_proceso' : 'listo';
        await connection.query('UPDATE pedidos SET total = ?, estado = ? WHERE id = ?', [total, estado, base.id]);
        await connection.commit();
        res.json({ id: Number(base.id), mesa_id: destinoId, mesa_numero: numeroDe.get(destinoId), total, mesas_juntadas: origenIds.length, comandas_unidas: resto.length + 1 });
    } catch (err) {
        await connection.rollback();
        res.status(err.status || 500).json({ error: err.message });
    } finally {
        connection.release();
    }
});

app.put('/api/pedidos/detalle/:id/estado', allowAdminOrKitchen, requireSede, async (req, res) => {
    let { estado } = req.body;

    // Mapeo estricto para los valores del ENUM de la base de datos
    // ENUM: 'pendiente', 'en_cocina', 'listo'
    let estadoDB = 'pendiente';
    if (estado === 'preparacion' || estado === 'en_cocina') estadoDB = 'en_cocina';
    if (estado === 'listo' || estado === 'despachado') estadoDB = 'listo';

    try {
        const [result] = await pool.query(
            `UPDATE detalles_pedido dp
             JOIN pedidos p ON p.id = dp.pedido_id
             SET dp.estado_comanda = ?
             WHERE dp.id = ? AND p.sede_id = ?`,
            [estadoDB, req.params.id, sedeOf(req)]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Ítem no encontrado' });
        }
        res.json({ message: 'Estado actualizado', nuevoEstado: estadoDB });
    } catch (err) {
        console.error('Error actualizando estado:', err);
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/pedidos/:id/estado', allowAdminOrKitchen, requireSede, async (req, res) => {
    const { estado } = req.body;
    try {
        await pool.query('UPDATE pedidos SET estado = ? WHERE id = ? AND sede_id = ?', [estado, req.params.id, sedeOf(req)]);
        res.json({ message: 'Estado de pedido actualizado' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Correlativos (por sede) ---
app.get('/api/correlativos', allowAdminOrCashier, requireSede, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM correlativos WHERE sede_id = ?', [sedeOf(req)]);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/correlativos/:tipo', allowAdmin, requireSede, async (req, res) => {
    const tipo = req.params.tipo;
    const serie = String(req.body?.serie || '').trim().toUpperCase();
    const siguiente_numero = Number(req.body?.siguiente_numero);
    if (!SERIE_REGEX[tipo]) return res.status(400).json({ error: 'Tipo de comprobante invalido' });
    if (!SERIE_REGEX[tipo].test(serie)) {
        return res.status(400).json({ error: tipo === 'nota_venta' ? 'Serie invalida' : `La serie de ${tipo} debe tener 4 caracteres y empezar con ${tipo === 'factura' ? 'F' : 'B'}` });
    }
    if (!Number.isInteger(siguiente_numero) || siguiente_numero < 1) return res.status(400).json({ error: 'El siguiente numero debe ser mayor a 0' });
    try {
        // A number already issued with that series is never reused.
        const tipoEmitido = tipo.startsWith('nc_') ? 'nota_credito'
            : tipo.startsWith('nd_') ? 'nota_debito' : tipo;
        const esGuia = tipo === 'guia_interna' || tipo === 'guia_remitente';
        const tipoGuia = tipo === 'guia_remitente' ? 'remitente' : 'interna';
        const [usados] = esGuia
            ? await pool.query('SELECT MAX(numero) AS ultimo FROM guias WHERE sede_id = ? AND tipo = ? AND serie = ?', [sedeOf(req), tipoGuia, serie])
            : await pool.query('SELECT MAX(numero) AS ultimo FROM facturas WHERE sede_id = ? AND tipo_comprobante = ? AND serie = ?', [sedeOf(req), tipoEmitido, serie]);
        const ultimo = Number(usados[0].ultimo) || 0;
        if (siguiente_numero <= ultimo) {
            return res.status(409).json({ error: `La serie ${serie} ya emitio hasta el numero ${ultimo}: el siguiente debe ser mayor` });
        }
        const [configRows] = await pool.query('SELECT 1 FROM correlativos WHERE tipo = ? AND sede_id = ? LIMIT 1', [tipo, sedeOf(req)]);
        if (configRows.length === 0) return res.status(404).json({ error: 'No existe un correlativo configurado para este tipo en la sede' });
        await pool.query(
            'UPDATE correlativos SET serie = ?, siguiente_numero = ? WHERE tipo = ? AND sede_id = ?',
            [serie, siguiente_numero, tipo, sedeOf(req)]
        );
        res.json({ message: 'Correlativo actualizado' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Facturación ---
// --- Facturacion electronica (boletas y facturas por la API propia de facturacion) y notas de venta ---
const TIPOS_COMPROBANTE = ['boleta', 'factura', 'nota_venta'];
const TIPOS_ELECTRONICOS = ['boleta', 'factura'];
// Comprobantes que se envian a SUNAT (las notas de credito/debito modifican una boleta o factura).
const TIPOS_SUNAT = ['boleta', 'factura', 'nota_credito', 'nota_debito'];
const TIPOS_VENTA = ['boleta', 'factura', 'nota_venta'];
// Net sales: credit notes subtract, debit notes add.
// A voided internal sale note (nota de venta anulada) no longer counts as a sale.
const NOTA_VENTA_ANULADA_SQL = "(tipo_comprobante = 'nota_venta' AND estado_comercial = 'anulado')";
const VENTA_NETA_SQL = `CASE WHEN ${NOTA_VENTA_ANULADA_SQL} THEN 0 WHEN tipo_comprobante = 'nota_credito' THEN -total_venta ELSE total_venta END`;
const TIPOS_DOC_CLIENTE = ['DNI', 'RUC', 'CE', 'PAS'];
const METODOS_COBRO = ['efectivo', 'yape', 'plin', 'tarjeta', 'transferencia', 'deposito'];
const METODO_COBRO_LABEL = { efectivo: 'EFECTIVO', yape: 'YAPE', plin: 'PLIN', tarjeta: 'TARJETA', transferencia: 'TRANSFERENCIA', deposito: 'DEPOSITO' };
const ESTADOS_SUNAT = ['no_aplica', 'pendiente', 'enviando', 'enviado', 'aceptado', 'observado', 'rechazado', 'error', 'incierto', 'anulado'];
const BOLETA_LIMITE_ANONIMO = 700; // SUNAT: desde S/ 700 la boleta identifica al cliente
const SERIE_REGEX = {
    factura: /^F[A-Z0-9]{3}$/, boleta: /^B[A-Z0-9]{3}$/, nota_venta: /^[A-Z0-9]{1,10}$/,
    nc_factura: /^F[A-Z0-9]{3}$/, nd_factura: /^F[A-Z0-9]{3}$/, nc_boleta: /^B[A-Z0-9]{3}$/, nd_boleta: /^B[A-Z0-9]{3}$/,
    guia_interna: /^[A-Z0-9]{1,10}$/, guia_remitente: /^T[A-Z0-9]{3}$/
};

class FacturacionError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

const sendFacturacionError = (res, err) => {
    if (err.status && err.status < 600) return res.status(err.status).json({ error: err.message });
    return res.status(500).json({ error: err.message });
};

const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const getEmpresaConfig = async (connection = pool) => {
    const [rows] = await connection.query('SELECT * FROM configuracion_empresa WHERE id = 1');
    return rows[0] || {};
};

/** The configuration is returned without the token; only whether it is set and its last characters. */
const publicEmpresaConfig = (config) => {
    // nubefact_url / nubefact_token son columnas heredadas: ya no se usan ni se exponen.
    const { facturacion_token: token, nubefact_token: _legacyToken, nubefact_url: _legacyUrl, ...rest } = config;
    return {
        ...rest,
        envio_automatico: Boolean(Number(rest.envio_automatico)),
        token_configurado: Boolean(token),
        token_final: token ? token.slice(-4) : null
    };
};

const facturaScope = (req, alias) => (isMultisede(req)
    ? { where: '1 = 1', params: [] }
    : { where: `${alias}.sede_id = ?`, params: [req.userContext.sedeUsuarioId] });

const FACTURA_SELECT_SQL = `
    SELECT f.id, f.sede_id, s.nombre AS sede_nombre, f.pedido_id, f.cliente_id, f.tipo_comprobante, f.serie, f.numero,
           f.numero_comprobante, f.fecha_emision, DATE_FORMAT(f.fecha_emision, '%Y-%m-%d') AS fecha,
           DATE_FORMAT(f.fecha_emision, '%H:%i') AS hora, f.subtotal, f.impuesto, f.igv_porcentaje, f.total_venta,
           f.condicion_pago, DATE_FORMAT(f.fecha_vencimiento, '%Y-%m-%d') AS fecha_vencimiento, f.monto_cobrado,
           f.monto_nc, f.monto_nd, ROUND(f.total_venta + f.monto_nd - f.monto_nc, 2) AS total_vigente,
           CASE WHEN f.tipo_comprobante IN ('nota_credito', 'nota_debito') THEN 0
                ELSE ROUND(f.total_venta + f.monto_nd - f.monto_nc - f.monto_cobrado, 2) END AS saldo,
           CASE WHEN f.tipo_comprobante IN ('nota_credito', 'nota_debito') THEN 'no_aplica'
                WHEN f.estado_comercial = 'anulado' THEN 'anulado'
                WHEN f.monto_cobrado >= f.total_venta + f.monto_nd - f.monto_nc THEN 'cobrado'
                WHEN f.fecha_vencimiento IS NOT NULL AND f.fecha_vencimiento < CURDATE() THEN 'vencido'
                WHEN f.monto_cobrado > 0 THEN 'parcial' ELSE 'pendiente' END AS estado_cobro,
           f.estado_comercial, f.documento_origen_id, o.numero_comprobante AS origen_numero, o.tipo_comprobante AS origen_tipo,
           o.serie AS origen_serie, o.numero AS origen_correlativo, f.motivo_codigo, f.motivo_descripcion,
           f.cliente_tipo_doc, f.cliente_num_doc, COALESCE(f.cliente_nombre, c.nombre) AS cliente_nombre, f.cliente_direccion,
           f.observacion, f.usuario_id, u.nombre AS usuario_nombre, f.sesion_caja_id, m.numero AS mesa_numero,
           f.estado_sunat, f.ambiente, f.sunat_descripcion, f.codigo_hash, f.cadena_qr, f.enlace_pdf, f.enlace_xml, f.enlace_cdr,
           f.envios, f.enviado_en, f.motivo_anulacion, f.fecha_anulacion, ufa.nombre AS anulado_por_nombre
    FROM facturas f
    JOIN sedes s ON s.id = f.sede_id
    LEFT JOIN usuarios ufa ON ufa.id = f.anulado_por
    LEFT JOIN pedidos p ON p.id = f.pedido_id
    LEFT JOIN mesas m ON m.id = p.mesa_id
    LEFT JOIN clientes c ON c.id = f.cliente_id
    LEFT JOIN usuarios u ON u.id = f.usuario_id
    LEFT JOIN facturas o ON o.id = f.documento_origen_id
`;

const COBRO_SELECT_SQL = `
    SELECT cv.id, cv.factura_id, cv.sede_id, cv.tipo, cv.nota_id, cv.monto, cv.metodo_pago, cv.referencia, cv.sesion_id, cv.estado, cv.fecha,
           cv.usuario_id, u.nombre AS usuario_nombre, cv.anulado_por, ua.nombre AS anulado_por_nombre,
           cv.motivo_anulacion, cv.fecha_anulacion
    FROM cobros_venta cv
    LEFT JOIN usuarios u ON u.id = cv.usuario_id
    LEFT JOIN usuarios ua ON ua.id = cv.anulado_por
`;

const findFactura = async (connection, req, id, lock = false) => {
    const scope = facturaScope(req, 'f');
    const [rows] = await connection.query(
        `${FACTURA_SELECT_SQL} WHERE f.id = ? AND ${scope.where} LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
        [id, ...scope.params]
    );
    return rows[0] || null;
};

const findFacturaDetalle = async (req, id) => {
    const factura = await findFactura(pool, req, id);
    if (!factura) return null;
    const [cobros] = await pool.query(`${COBRO_SELECT_SQL} WHERE cv.factura_id = ? ORDER BY cv.fecha ASC, cv.id ASC`, [factura.id]);
    const [notas] = await pool.query(
        `SELECT id, tipo_comprobante, numero_comprobante, total_venta, estado_sunat, motivo_codigo, motivo_descripcion, observacion, fecha_emision
         FROM facturas WHERE documento_origen_id = ? ORDER BY id`,
        [factura.id]
    );
    return { ...factura, items: await facturaItems(factura.id), cobros, notas };
};

/** Lines as issued (snapshot); receipts issued before the snapshot existed are rebuilt from the order. */
const facturaItems = async (facturaId) => {
    const [rows] = await pool.query('SELECT items_snapshot, pedido_id, igv_porcentaje FROM facturas WHERE id = ?', [facturaId]);
    const row = rows[0];
    if (!row) return [];
    if (row.items_snapshot) return typeof row.items_snapshot === 'string' ? JSON.parse(row.items_snapshot) : row.items_snapshot;
    const [detalles] = await pool.query(
        `SELECT dp.producto_id, pr.nombre AS descripcion, dp.cantidad, dp.precio_unitario, um.codigo_sunat AS unidad_sunat
         FROM detalles_pedido dp
         LEFT JOIN productos pr ON pr.id = dp.producto_id
         LEFT JOIN unidades_medida um ON um.id = pr.unidad_id
         WHERE dp.pedido_id = ? ORDER BY dp.id`,
        [row.pedido_id]
    );
    return calcularLineas(detalles, Number(row.igv_porcentaje) || 10.5).items;
};

/** Prices include IGV: each line is split into value and IGV and the totals add up exactly. */
const calcularLineas = (detalles, tasa) => {
    const factor = 1 + tasa / 100;
    const items = detalles.map((d) => {
        const cantidad = Number(d.cantidad);
        const precio = Number(d.precio_unitario);
        const total = round2(cantidad * precio);
        const subtotal = round2(total / factor);
        return {
            producto_id: d.producto_id,
            descripcion: String(d.descripcion || `Producto ${d.producto_id}`).slice(0, 250),
            unidad_sunat: d.unidad_sunat || 'NIU',
            cantidad,
            precio_unitario: precio,
            valor_unitario: Math.round((precio / factor) * 1e10) / 1e10,
            subtotal,
            igv: round2(total - subtotal),
            total
        };
    });
    const total = round2(items.reduce((sum, item) => sum + item.total, 0));
    // La base se calcula sobre el total del documento (no sumando líneas redondeadas) y la diferencia
    // de redondeo se absorbe en la línea mayor para que los ítems sigan cuadrando con los totales.
    const gravada = round2(total / factor);
    const ajuste = round2(gravada - items.reduce((sum, item) => sum + item.subtotal, 0));
    if (ajuste !== 0 && items.length) {
        const mayor = items.reduce((max, item) => (item.total > max.total ? item : max), items[0]);
        mayor.subtotal = round2(mayor.subtotal + ajuste);
        mayor.igv = round2(mayor.total - mayor.subtotal);
    }
    return { items, gravada, igv: round2(total - gravada), total };
};

const ddmmyyyy = (ymd) => ymd.split('-').reverse().join('-');

const buildComprobantePayload = ({ tipo, serie, numero, cliente, fecha, condicion, fechaVencimiento, metodo, tasa, calc, observacion }) => {
    const payload = {
        operacion: 'generar_comprobante',
        tipo_de_comprobante: facturacion.TIPOS[tipo],
        serie,
        numero,
        sunat_transaction: 1,
        cliente_tipo_de_documento: { RUC: 6, DNI: 1, CE: 4, PAS: 7 }[cliente.tipo_doc] ?? '-',
        cliente_numero_de_documento: cliente.num_doc || '-',
        cliente_denominacion: cliente.nombre || 'CLIENTES VARIOS',
        cliente_direccion: cliente.direccion || '',
        cliente_email: '',
        fecha_de_emision: ddmmyyyy(fecha),
        moneda: 1,
        porcentaje_de_igv: tasa,
        total_gravada: calc.gravada,
        total_igv: calc.igv,
        total: calc.total,
        condiciones_de_pago: condicion === 'credito' ? 'CREDITO' : 'CONTADO',
        medio_de_pago: condicion === 'credito' ? '' : METODO_COBRO_LABEL[metodo] || '',
        enviar_automaticamente_a_la_sunat: true,
        enviar_automaticamente_al_cliente: false,
        observaciones: observacion || '',
        items: calc.items.map((item) => ({
            unidad_de_medida: item.unidad_sunat || 'NIU',
            codigo: `P${item.producto_id}`,
            descripcion: item.descripcion,
            cantidad: item.cantidad,
            valor_unitario: item.valor_unitario,
            precio_unitario: item.precio_unitario,
            descuento: '',
            subtotal: item.subtotal,
            tipo_de_igv: 1,
            igv: item.igv,
            total: item.total,
            anticipo_regularizacion: false
        }))
    };
    if (condicion === 'credito') {
        payload.fecha_de_vencimiento = ddmmyyyy(fechaVencimiento);
        payload.venta_al_credito = [{ cuota: 1, fecha_de_pago: ddmmyyyy(fechaVencimiento), importe: calc.total }];
    }
    return payload;
};

const parseClienteInput = (body) => {
    const tipoDoc = String(body?.tipo_documento || '').trim().toUpperCase();
    return {
        cliente_id: body?.cliente_id ? Number(body.cliente_id) : null,
        tipo_doc: TIPOS_DOC_CLIENTE.includes(tipoDoc) ? tipoDoc : '-',
        num_doc: String(body?.numero_documento || '').trim().toUpperCase() || null,
        nombre: String(body?.nombre || '').trim().replace(/\s+/g, ' ') || null,
        direccion: String(body?.direccion || '').trim().replace(/\s+/g, ' ') || null
    };
};

const validarDocumentoCliente = (cliente) => {
    if (cliente.tipo_doc === '-') return cliente.num_doc ? 'Seleccione el tipo de documento del cliente' : null;
    if (!cliente.num_doc) return 'Ingrese el numero de documento del cliente';
    if (cliente.tipo_doc === 'DNI' && !/^\d{8}$/.test(cliente.num_doc)) return 'El DNI debe tener 8 digitos';
    if (cliente.tipo_doc === 'RUC' && !/^(10|15|16|17|20)\d{9}$/.test(cliente.num_doc)) return 'El RUC debe tener 11 digitos y empezar con 10, 15, 16, 17 o 20';
    if (['CE', 'PAS'].includes(cliente.tipo_doc) && !/^[A-Z0-9]{4,15}$/.test(cliente.num_doc)) return 'Numero de documento invalido';
    if (!cliente.nombre || cliente.nombre.length < 3) return 'Ingrese el nombre o razon social del cliente';
    return null;
};

/** Identified customers are kept in the shared customer list (found by document number). */
const upsertCliente = async (connection, cliente) => {
    if (cliente.tipo_doc === '-' || !cliente.num_doc) return cliente.cliente_id;
    const [rows] = await connection.query('SELECT id FROM clientes WHERE documento = ? LIMIT 1', [cliente.num_doc]);
    if (rows.length > 0) {
        await connection.query(
            'UPDATE clientes SET nombre = ?, tipo_documento = ?, direccion = COALESCE(?, direccion) WHERE id = ?',
            [cliente.nombre, cliente.tipo_doc, cliente.direccion, rows[0].id]
        );
        return rows[0].id;
    }
    const [result] = await connection.query(
        'INSERT INTO clientes (nombre, documento, tipo_documento, direccion) VALUES (?, ?, ?, ?)',
        [cliente.nombre, cliente.num_doc, cliente.tipo_doc, cliente.direccion]
    );
    return result.insertId;
};

/** Open session of the sede; with `cajaId` it is that register's own session (each caja is independent). */
const openCashSession = async (connection, sedeId, cajaId = null) => {
    const [rows] = await connection.query(
        `SELECT id FROM caja_sesiones WHERE sede_id = ? AND estado = 'abierta' ${cajaId ? 'AND caja_id = ?' : ''} ORDER BY fecha_apertura DESC LIMIT 1 FOR UPDATE`,
        cajaId ? [sedeId, cajaId] : [sedeId]
    );
    return rows[0]?.id || null;
};

const SUNAT_REENVIABLE = ['pendiente', 'error'];

/**
 * Sends (or reconciles) an electronic receipt with the billing API. The row is reserved as `enviando`
 * so two users cannot send the same document; an unconfirmed answer leaves it `incierto`.
 */
const procesarSunat = async (facturaId, accion) => {
    const [rows] = await pool.query(
        'SELECT id, tipo_comprobante, serie, numero, estado_sunat, nubefact_payload FROM facturas WHERE id = ?',
        [facturaId]
    );
    const factura = rows[0];
    if (!factura || !TIPOS_SUNAT.includes(factura.tipo_comprobante) || factura.estado_sunat === 'no_aplica') {
        throw new FacturacionError(409, 'Este comprobante no se envia a SUNAT');
    }
    if (!factura.nubefact_payload) throw new FacturacionError(409, 'El comprobante no tiene contenido electronico para enviar');

    const permitidos = accion === 'enviar' ? SUNAT_REENVIABLE : ESTADOS_SUNAT.filter((e) => e !== 'no_aplica');
    if (!permitidos.includes(factura.estado_sunat)) {
        throw new FacturacionError(409, accion === 'enviar'
            ? `No se puede enviar un comprobante en estado ${factura.estado_sunat}. Consultalo antes de reenviarlo.`
            : 'El comprobante se esta enviando en este momento');
    }
    const config = await getEmpresaConfig();
    facturacion.validarCredenciales(config); // falla antes de reservar el envio
    await facturacion.verificarCuenta(config);

    const [reserva] = await pool.query(
        `UPDATE facturas SET estado_sunat = 'enviando' WHERE id = ? AND estado_sunat = ?`,
        [factura.id, factura.estado_sunat]
    );
    if (reserva.affectedRows === 0) throw new FacturacionError(409, 'Otro usuario esta procesando este comprobante');

    const payload = accion === 'enviar'
        ? (typeof factura.nubefact_payload === 'string' ? JSON.parse(factura.nubefact_payload) : factura.nubefact_payload)
        : facturacion.consultarPayload(factura.tipo_comprobante, factura.serie, factura.numero);

    let response;
    let estado;
    try {
        response = await facturacion.request(config, payload);
        estado = facturacion.estadoDesdeRespuesta(response, accion);
        const mismatch = !response.errors && (Number(response.tipo_de_comprobante) !== facturacion.TIPOS[factura.tipo_comprobante]
            || response.serie !== factura.serie || Number(response.numero) !== Number(factura.numero));
        if (mismatch) {
            estado = 'incierto';
            response = { errors: 'La respuesta de la API de facturacion no corresponde a este comprobante. Consultalo antes de reenviarlo.' };
        }
    } catch (err) {
        if (!err.incierto) {
            await pool.query('UPDATE facturas SET estado_sunat = ? WHERE id = ?', [factura.estado_sunat, factura.id]);
            throw err;
        }
        estado = 'incierto';
        response = { errors: err.message };
    }

    const textoEstado = {
        enviado: 'Recibido por la API de facturacion; pendiente de respuesta de SUNAT.',
        aceptado: 'Aceptado por SUNAT.',
        incierto: 'Respuesta no confirmada: consulta el comprobante antes de reenviarlo.',
        pendiente: 'No registrado en la API de facturacion: puedes enviarlo.'
    };
    const descripcion = String(response.errors || response.sunat_description || response.sunat_note || textoEstado[estado] || estado).slice(0, 1000);
    await pool.query(
        `UPDATE facturas
         SET estado_sunat = ?, nubefact_respuesta = ?, sunat_descripcion = ?,
             codigo_hash = COALESCE(?, codigo_hash), cadena_qr = COALESCE(?, cadena_qr),
             enlace_pdf = COALESCE(?, enlace_pdf), enlace_xml = COALESCE(?, enlace_xml), enlace_cdr = COALESCE(?, enlace_cdr),
             envios = envios + ?, enviado_en = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE enviado_en END
         WHERE id = ?`,
        [estado, JSON.stringify(response), descripcion, response.codigo_hash || null, response.cadena_para_codigo_qr || null,
            response.enlace_del_pdf || null, response.enlace_del_xml || null, response.enlace_del_cdr || null,
            accion === 'enviar' ? 1 : 0, accion === 'enviar' ? 1 : 0, factura.id]
    );

    // "Ya existe" (codigo 23): the document reached the billing API before; reconcile it right away.
    if (accion === 'enviar' && Number(response.codigo) === 23) return procesarSunat(factura.id, 'consultar');
    return estado;
};

/** Data for the printed formats (ticket and A4). */
const datosImpresion = async (detalle) => {
    const [rows] = await pool.query('SELECT empresa_snapshot, ambiente FROM facturas WHERE id = ?', [detalle.id]);
    const snapshot = rows[0]?.empresa_snapshot;
    let empresa = typeof snapshot === 'string' ? JSON.parse(snapshot) : snapshot;
    if (!empresa) {
        const [sedeRows] = await pool.query('SELECT direccion, telefono FROM sedes WHERE id = ?', [detalle.sede_id]);
        const config = await getEmpresaConfig();
        empresa = {
            ruc: config.ruc, razon_social: config.razon_social, nombre_comercial: config.nombre_comercial,
            direccion: sedeRows[0]?.direccion || config.direccion, telefono: sedeRows[0]?.telefono || config.telefono
        };
    }
    const electronico = TIPOS_SUNAT.includes(detalle.tipo_comprobante) && detalle.estado_sunat !== 'no_aplica';
    const cobrosActivos = detalle.cobros.filter((c) => c.estado === 'activo');
    const metodos = [...new Set(cobrosActivos.map((c) => METODO_COBRO_LABEL[c.metodo_pago]))];
    return {
        empresa,
        data: {
            tipo: detalle.tipo_comprobante, serie: detalle.serie, numero: detalle.numero, fecha: detalle.fecha, hora: detalle.hora,
            cliente_nombre: detalle.cliente_nombre || 'CLIENTES VARIOS',
            cliente_doc_tipo: detalle.cliente_tipo_doc, cliente_doc_numero: detalle.cliente_num_doc, cliente_direccion: detalle.cliente_direccion,
            condicion: detalle.condicion_pago, forma_pago: detalle.condicion_pago === 'credito' ? 'Crédito' : (metodos.join(' / ') || 'Contado'),
            items: detalle.items, gravada: detalle.subtotal, igv: detalle.impuesto, igv_porcentaje: detalle.igv_porcentaje, total: detalle.total_venta,
            cuotas: detalle.condicion_pago === 'credito' && !detalle.documento_origen_id ? [{ numero: 1, fecha: detalle.fecha_vencimiento, monto: detalle.total_venta }] : [],
            estado_sunat: detalle.estado_sunat, hash: detalle.codigo_hash, qr: detalle.cadena_qr, electronico,
            pruebas: electronico && rows[0]?.ambiente === 'PRUEBAS', observacion: detalle.documento_origen_id ? null : detalle.observacion,
            mesa: detalle.mesa_numero, pedido_id: detalle.pedido_id,
            ref: detalle.documento_origen_id ? { tipo: detalle.origen_tipo, serie: detalle.origen_serie, numero: detalle.origen_correlativo } : null,
            motivo: detalle.motivo_descripcion ? `${detalle.motivo_descripcion}${detalle.observacion ? ` - ${detalle.observacion}` : ''}` : null
        }
    };
};

// Configuracion de la empresa y de la API de facturacion electronica (administrador y superadmin)
app.get('/api/configuracion/facturacion', allowAdmin, async (req, res) => {
    try {
        res.json(publicEmpresaConfig(await getEmpresaConfig()));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/configuracion/facturacion', allowAdmin, async (req, res) => {
    const body = req.body || {};
    const text = (value, max) => {
        const clean = String(value ?? '').trim().replace(/\s+/g, ' ');
        return clean ? clean.slice(0, max) : null;
    };
    const data = {
        ruc: text(body.ruc, 11),
        razon_social: text(body.razon_social, 200),
        nombre_comercial: text(body.nombre_comercial, 200),
        direccion: text(body.direccion, 255),
        telefono: text(body.telefono, 30),
        igv_porcentaje: Number(body.igv_porcentaje),
        // Columna heredada "nubefact_ambiente": ambiente de emision (PRUEBAS = SUNAT beta, PRODUCCION = SUNAT real).
        nubefact_ambiente: body.nubefact_ambiente === 'PRODUCCION' ? 'PRODUCCION' : 'PRUEBAS',
        facturacion_url: text(body.facturacion_url, 255),
        // RUC de la cuenta de pruebas: lo usan las guias entre establecimientos en PRUEBAS.
        nubefact_ruc_pruebas: text(body.nubefact_ruc_pruebas, 11),
        envio_automatico: body.envio_automatico === false ? 0 : 1
    };

    const errors = [];
    if (data.ruc && !/^(10|15|16|17|20)\d{9}$/.test(data.ruc)) errors.push('El RUC de la empresa debe tener 11 digitos');
    if (!data.razon_social || data.razon_social.length < 3) errors.push('Ingrese la razon social');
    if (!(data.igv_porcentaje > 0 && data.igv_porcentaje <= 18)) errors.push('La tasa de IGV debe estar entre 0 y 18');
    if (data.nubefact_ruc_pruebas && !/^\d{11}$/.test(data.nubefact_ruc_pruebas)) errors.push('El RUC de pruebas debe tener 11 digitos');
    const newToken = typeof body.facturacion_token === 'string' ? body.facturacion_token.trim() : '';
    if (errors.length > 0) return res.status(400).json({ error: errors.join('. ') });

    try {
        const current = await getEmpresaConfig();
        const token = body.borrar_token ? null : (newToken || current.facturacion_token || null);
        if (data.facturacion_url || token) {
            const credenciales = { facturacion_url: data.facturacion_url, facturacion_token: token };
            facturacion.validarCredenciales(credenciales);
            // Si cambia la cuenta o el ambiente, se comprueba contra la API que la key corresponde a lo que se declara.
            const cambio = newToken || data.facturacion_url !== current.facturacion_url || data.nubefact_ambiente !== current.nubefact_ambiente;
            if (cambio) await facturacion.verificarCuenta({ ...credenciales, nubefact_ambiente: data.nubefact_ambiente, ruc: data.ruc });
        }
        await pool.query(
            `UPDATE configuracion_empresa
             SET ruc = ?, razon_social = ?, nombre_comercial = ?, direccion = ?, telefono = ?, igv_porcentaje = ?,
                 nubefact_ambiente = ?, facturacion_url = ?, facturacion_token = ?, nubefact_ruc_pruebas = ?, envio_automatico = ?,
                 actualizado_por = ?, actualizado_en = CURRENT_TIMESTAMP
             WHERE id = 1`,
            [data.ruc, data.razon_social, data.nombre_comercial, data.direccion, data.telefono, data.igv_porcentaje,
                data.nubefact_ambiente, data.facturacion_url, token, data.nubefact_ruc_pruebas, data.envio_automatico,
                req.userContext.id]
        );
        res.json(publicEmpresaConfig(await getEmpresaConfig()));
    } catch (err) {
        sendFacturacionError(res, err);
    }
});

// Comprueba la API key y consulta un comprobante que no existe (no se emite nada).
app.post('/api/configuracion/facturacion/probar', allowAdmin, async (req, res) => {
    try {
        const config = await getEmpresaConfig();
        facturacion.validarCredenciales(config);
        const cuenta = await facturacion.infoCuenta(config);
        const response = await facturacion.request(config, facturacion.consultarPayload('factura', 'F000', 99999999));
        if (response.errors && Number(response.codigo) !== 24) return res.status(400).json({ error: `La API respondio: ${response.errors}` });
        res.json({
            ok: true,
            mensaje: `Conexion correcta. Cuenta: ${cuenta.razonSocial} (RUC ${cuenta.ruc}), ${cuenta.produccion ? 'PRODUCCION' : 'SUNAT beta (pruebas)'}, `
                + `certificado ${cuenta.tieneCertificado ? 'cargado' : 'NO cargado'}.`
        });
    } catch (err) {
        sendFacturacionError(res, err);
    }
});

// Emision: boleta, factura o nota de venta, al contado o al credito
app.post('/api/facturas', allowAdminOrCashier, requireSede, async (req, res) => {
    const body = req.body || {};
    const tipo = String(body.tipo_comprobante || '').trim().toLowerCase();
    const condicion = String(body.condicion_pago || 'contado').trim().toLowerCase();
    const cliente = parseClienteInput(body.cliente);
    const metodo = String(body.pago?.metodo_pago || '').trim().toLowerCase();
    const referencia = String(body.pago?.referencia || '').trim().slice(0, 100) || null;
    const fechaVencimiento = String(body.fecha_vencimiento || '').trim();
    const observacion = String(body.observacion || '').trim().slice(0, 255) || null;
    const pedidoId = Number(body.pedido_id);
    const cajaId = Number(body.caja_id) || null; // the caja the sale is registered in
    const sedeId = sedeOf(req);
    const hoy = todayLocal();

    const errors = [];
    if (!pedidoId) errors.push('Seleccione el pedido');
    if (!TIPOS_COMPROBANTE.includes(tipo)) errors.push('El comprobante debe ser boleta, factura o nota de venta');
    if (!['contado', 'credito'].includes(condicion)) errors.push('La condicion de pago debe ser contado o credito');
    if (condicion === 'contado' && !METODOS_COBRO.includes(metodo)) errors.push('Seleccione el metodo de pago');
    if (condicion === 'credito') {
        if (!isRealDate(fechaVencimiento) || fechaVencimiento <= hoy) errors.push('La fecha de vencimiento del credito debe ser posterior a hoy');
        if (cliente.tipo_doc === '-' && !cliente.cliente_id) errors.push('Una venta al credito requiere identificar al cliente');
    }
    if (errors.length > 0) return res.status(400).json({ error: errors.join('. ') });

    const connection = await pool.getConnection();
    let facturaId;
    try {
        await connection.beginTransaction();

        if (cliente.cliente_id && cliente.tipo_doc === '-') {
            const [cRows] = await connection.query('SELECT nombre, documento, tipo_documento, direccion FROM clientes WHERE id = ?', [cliente.cliente_id]);
            if (cRows[0]?.documento && cRows[0]?.tipo_documento) {
                Object.assign(cliente, { tipo_doc: cRows[0].tipo_documento, num_doc: cRows[0].documento, nombre: cRows[0].nombre, direccion: cliente.direccion || cRows[0].direccion });
            } else if (condicion === 'credito') {
                throw new FacturacionError(400, 'El cliente seleccionado no tiene documento: ingrese su DNI o RUC');
            }
        }
        const docError = validarDocumentoCliente(cliente);
        if (docError) throw new FacturacionError(400, docError);
        if (tipo === 'factura' && cliente.tipo_doc !== 'RUC') throw new FacturacionError(400, 'La factura requiere el RUC del cliente');
        if (tipo === 'boleta' && !['-', 'DNI'].includes(cliente.tipo_doc)) throw new FacturacionError(400, 'La boleta se emite con DNI del cliente (o sin documento). Para un cliente con RUC emita una factura');
        if (tipo === 'factura' && !cliente.direccion) throw new FacturacionError(400, 'Ingrese la direccion fiscal del cliente');

        const config = await getEmpresaConfig(connection);
        if (!config.razon_social) throw new FacturacionError(409, 'Configure los datos de la empresa en Configuracion > Facturacion electronica');
        const electronico = TIPOS_ELECTRONICOS.includes(tipo);
        if (electronico) {
            if (!config.ruc) throw new FacturacionError(409, 'Configure el RUC de la empresa en Configuracion > Facturacion electronica');
            facturacion.validarCredenciales(config);
        }

        const [corrRows] = await connection.query(
            'SELECT serie, siguiente_numero FROM correlativos WHERE tipo = ? AND sede_id = ? FOR UPDATE',
            [tipo, sedeId]
        );
        if (corrRows.length === 0) throw new FacturacionError(409, `No hay serie configurada para ${tipo.replace('_', ' ')} en esta sede`);
        const { serie, siguiente_numero: numero } = corrRows[0];
        if (!SERIE_REGEX[tipo].test(serie)) {
            throw new FacturacionError(409, `La serie ${serie} no es valida para ${tipo}: debe ser ${tipo === 'factura' ? 'Fxxx' : 'Bxxx'} (4 caracteres)`);
        }

        const [orderRows] = await connection.query(
            'SELECT p.id, p.estado, p.cliente_id FROM pedidos p WHERE p.id = ? AND p.sede_id = ? LIMIT 1 FOR UPDATE',
            [pedidoId, sedeId]
        );
        const order = orderRows[0];
        if (!order) throw new FacturacionError(404, 'Pedido no encontrado');
        if (order.estado === 'pagado') throw new FacturacionError(409, 'El pedido ya fue cobrado');
        if (order.estado === 'cancelado') throw new FacturacionError(409, 'No se puede facturar un pedido cancelado');

        const [detalles] = await connection.query(
            `SELECT dp.producto_id, pr.nombre AS descripcion, dp.cantidad, dp.precio_unitario, um.codigo_sunat AS unidad_sunat
             FROM detalles_pedido dp
             LEFT JOIN productos pr ON pr.id = dp.producto_id
             LEFT JOIN unidades_medida um ON um.id = pr.unidad_id
             WHERE dp.pedido_id = ? ORDER BY dp.id`,
            [pedidoId]
        );
        const tasa = Number(config.igv_porcentaje) || 10.5;
        const calc = calcularLineas(detalles, tasa);
        if (calc.items.length === 0 || calc.total <= 0) throw new FacturacionError(409, 'No se puede facturar un pedido sin detalle o con total 0');
        if (tipo === 'boleta' && calc.total >= BOLETA_LIMITE_ANONIMO && cliente.tipo_doc === '-') {
            throw new FacturacionError(400, `Una boleta desde S/ ${BOLETA_LIMITE_ANONIMO} debe identificar al cliente (DNI)`);
        }

        let sesionId = await openCashSession(connection, sedeId, cajaId);
        if (condicion === 'contado' && metodo === 'efectivo' && !sesionId) {
            throw new FacturacionError(409, cajaId
                ? 'La caja seleccionada no esta abierta (Facturacion > Arqueo de Caja)'
                : 'Para cobrar en efectivo abre la caja de la sede (Facturacion > Arqueo de Caja)');
        }

        const clienteId = (await upsertCliente(connection, cliente)) || order.cliente_id || null;
        const [sedeRows] = await connection.query('SELECT direccion, telefono FROM sedes WHERE id = ?', [sedeId]);
        const empresaSnapshot = {
            ruc: config.ruc, razon_social: config.razon_social, nombre_comercial: config.nombre_comercial,
            direccion: sedeRows[0]?.direccion || config.direccion, telefono: sedeRows[0]?.telefono || config.telefono
        };
        const payload = electronico
            ? buildComprobantePayload({ tipo, serie, numero, cliente, fecha: hoy, condicion, fechaVencimiento, metodo, tasa, calc, observacion })
            : null;

        const [result] = await connection.query(
            `INSERT INTO facturas
                (sede_id, pedido_id, cliente_id, tipo_comprobante, numero_comprobante, serie, numero, subtotal, igv_porcentaje,
                 total_venta, impuesto, sesion_caja_id, condicion_pago, fecha_vencimiento, monto_cobrado, cliente_tipo_doc,
                 cliente_num_doc, cliente_nombre, cliente_direccion, observacion, usuario_id, estado_sunat, ambiente,
                 nubefact_payload, empresa_snapshot, items_snapshot)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [sedeId, pedidoId, clienteId, tipo, `${serie}-${String(numero).padStart(8, '0')}`, serie, numero, calc.gravada, tasa,
                calc.total, calc.igv, sesionId, condicion, condicion === 'credito' ? fechaVencimiento : null,
                condicion === 'contado' ? calc.total : 0, cliente.tipo_doc, cliente.num_doc, cliente.nombre || 'CLIENTES VARIOS',
                cliente.direccion, observacion, req.userContext.id, electronico ? 'pendiente' : 'no_aplica',
                electronico ? config.nubefact_ambiente : null, payload ? JSON.stringify(payload) : null,
                JSON.stringify(empresaSnapshot), JSON.stringify(calc.items)]
        );
        facturaId = result.insertId;

        if (condicion === 'contado') {
            await connection.query(
                `INSERT INTO cobros_venta (factura_id, sede_id, monto, metodo_pago, referencia, sesion_id, usuario_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [facturaId, sedeId, calc.total, metodo, referencia, sesionId, req.userContext.id]
            );
        }
        await connection.query('UPDATE correlativos SET siguiente_numero = siguiente_numero + 1 WHERE tipo = ? AND sede_id = ?', [tipo, sedeId]);
        await connection.query('UPDATE pedidos SET estado = ? WHERE id = ?', ['pagado', pedidoId]);
        await descontarStockVenta(connection, sedeId, pedidoId, `Comprobante ${serie}-${String(numero).padStart(8, '0')}`, req.userContext.id);
        await marcarDeliveryFacturado(connection, pedidoId, `${serie}-${String(numero).padStart(8, '0')}`, req.userContext.id);
        await connection.commit();
    } catch (err) {
        await connection.rollback();
        connection.release();
        return sendFacturacionError(res, err);
    }
    connection.release();

    // The receipt is already issued; a sending problem is reported but never undoes the sale.
    let envioError = null;
    try {
        const config = await getEmpresaConfig();
        // Sin la casilla "Enviar a SUNAT" el comprobante queda pendiente: se envia despues desde Comprobantes emitidos.
        if (TIPOS_ELECTRONICOS.includes(tipo) && Number(config.envio_automatico) && body.enviar_sunat !== false) await procesarSunat(facturaId, 'enviar');
    } catch (err) {
        envioError = err.message;
    }
    const detalle = await findFacturaDetalle(req, facturaId);
    res.status(201).json({ ...detalle, total: detalle.total_venta, envio_error: envioError });
});

app.get('/api/facturas', allowAdminOrCashier, async (req, res) => {
    const { desde, hasta, tipo, estado_sunat: estadoSunat, condicion_pago: condicion, q } = req.query;
    const startDate = typeof desde === 'string' && isRealDate(desde) ? desde : todayLocal();
    const endDate = typeof hasta === 'string' && isRealDate(hasta) ? hasta : startDate;
    if (startDate > endDate) return res.status(400).json({ error: 'Rango de fechas invalido' });

    const { sedeFilter, error } = resolveListSede(req);
    if (error) return res.status(400).json({ error });

    const conditions = ['f.fecha_emision >= ?', 'f.fecha_emision < DATE_ADD(?, INTERVAL 1 DAY)'];
    const params = [startDate, endDate];
    if (sedeFilter) { conditions.push('f.sede_id = ?'); params.push(sedeFilter); }
    if ([...TIPOS_COMPROBANTE, 'nota_credito', 'nota_debito'].includes(tipo)) { conditions.push('f.tipo_comprobante = ?'); params.push(tipo); }
    if (ESTADOS_SUNAT.includes(estadoSunat)) { conditions.push('f.estado_sunat = ?'); params.push(estadoSunat); }
    if (['contado', 'credito'].includes(condicion)) { conditions.push('f.condicion_pago = ?'); params.push(condicion); }
    if (typeof q === 'string' && q.trim()) {
        const like = `%${q.trim()}%`;
        conditions.push('(f.numero_comprobante LIKE ? OR f.cliente_nombre LIKE ? OR f.cliente_num_doc LIKE ?)');
        params.push(like, like, like);
    }

    try {
        const [facturas] = await pool.query(
            `${FACTURA_SELECT_SQL} WHERE ${conditions.join(' AND ')} ORDER BY f.fecha_emision DESC, f.id DESC`,
            params
        );
        const resumen = facturas.reduce((acc, f) => {
            acc.cantidad += 1;
            if (f.tipo_comprobante === 'nota_venta' && f.estado_comercial === 'anulado') return acc;
            acc.total += f.tipo_comprobante === 'nota_credito' ? -Number(f.total_venta) : Number(f.total_venta);
            acc[f.tipo_comprobante] = round2((acc[f.tipo_comprobante] || 0) + Number(f.total_venta));
            if (f.condicion_pago === 'credito') acc.credito += Number(f.total_venta);
            if (['pendiente', 'error', 'incierto', 'rechazado'].includes(f.estado_sunat)) acc.por_revisar += 1;
            return acc;
        }, { cantidad: 0, total: 0, boleta: 0, factura: 0, nota_venta: 0, nota_credito: 0, nota_debito: 0, credito: 0, por_revisar: 0 });
        resumen.total = round2(resumen.total);
        resumen.credito = round2(resumen.credito);
        res.json({ periodo: { desde: startDate, hasta: endDate }, sede_id: sedeFilter, resumen, facturas });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/facturas/:id', allowAdminOrCashier, async (req, res) => {
    try {
        const detalle = await findFacturaDetalle(req, req.params.id);
        if (!detalle) return res.status(404).json({ error: 'Comprobante no encontrado' });
        res.json(detalle);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

for (const accion of ['enviar', 'consultar']) {
    app.post(`/api/facturas/:id/${accion}`, allowAdminOrCashier, async (req, res) => {
        try {
            const factura = await findFactura(pool, req, req.params.id);
            if (!factura) return res.status(404).json({ error: 'Comprobante no encontrado' });
            await procesarSunat(factura.id, accion);
            res.json(await findFacturaDetalle(req, factura.id));
        } catch (err) {
            sendFacturacionError(res, err);
        }
    });
}

app.get('/api/facturas/:id/formato/:formato', allowAdminOrCashier, async (req, res) => {
    try {
        const detalle = await findFacturaDetalle(req, req.params.id);
        if (!detalle) return res.status(404).json({ error: 'Comprobante no encontrado' });
        const { data, empresa } = await datosImpresion(detalle);
        if (req.query.recibido) data.recibido = Number(req.query.recibido) || 0;
        if (req.params.formato === 'ticket') {
            const ticket = await formatos.ticketHtml(data, empresa);
            return res.type('html').set('Content-Disposition', `inline; filename="${ticket.filename}"`).send(ticket.html);
        }
        if (req.params.formato === 'a4') {
            const pdf = await formatos.pdfA4(data, empresa);
            return res.type('application/pdf').set('Content-Disposition', `inline; filename="${pdf.filename}"`).send(pdf.buffer);
        }
        res.status(400).json({ error: 'Formato invalido: use ticket o a4' });
    } catch (err) {
        sendFacturacionError(res, err);
    }
});

// Notas de credito y debito: modifican o anulan una boleta/factura electronica y se envian a SUNAT por la API de facturacion.
const MOTIVOS_NOTA = {
    nota_credito: {
        '01': { nombre: 'Anulación de la operación', modo: 'total' },
        '02': { nombre: 'Anulación por error en el RUC', modo: 'total' },
        '06': { nombre: 'Devolución total', modo: 'total' },
        '07': { nombre: 'Devolución por ítem', modo: 'items' },
        '04': { nombre: 'Descuento global', modo: 'monto' },
        '05': { nombre: 'Descuento por ítem', modo: 'monto' },
        '08': { nombre: 'Bonificación', modo: 'monto' },
        '09': { nombre: 'Disminución en el valor', modo: 'monto' },
        '13': { nombre: 'Ajustes de montos y/o fechas de pago', modo: 'monto' }
    },
    nota_debito: {
        '01': { nombre: 'Intereses por mora', modo: 'monto' },
        '02': { nombre: 'Aumento en el valor', modo: 'monto' },
        '03': { nombre: 'Penalidades', modo: 'monto' }
    }
};
const NOTA_SERIE_TIPO = {
    nota_credito: { factura: 'nc_factura', boleta: 'nc_boleta' },
    nota_debito: { factura: 'nd_factura', boleta: 'nd_boleta' }
};
const ORIGEN_ESTADOS_VALIDOS = ['aceptado', 'observado', 'enviado'];

/** What can still be credited: the receipt total plus debit notes, minus credit notes already issued. */
const importeVigente = (f) => round2(Number(f.total_venta) + Number(f.monto_nd) - Number(f.monto_nc));

/** Quantities already returned by item through previous credit notes (motivo 07). */
const cantidadesDevueltas = async (connection, origenId) => {
    const [notas] = await connection.query(
        "SELECT items_snapshot FROM facturas WHERE documento_origen_id = ? AND tipo_comprobante = 'nota_credito' AND motivo_codigo = '07'",
        [origenId]
    );
    const devueltas = {};
    for (const nota of notas) {
        const items = typeof nota.items_snapshot === 'string' ? JSON.parse(nota.items_snapshot) : nota.items_snapshot || [];
        for (const item of items) devueltas[item.producto_id] = (devueltas[item.producto_id] || 0) + Number(item.cantidad);
    }
    return devueltas;
};

const opcionesNota = async (connection, origen) => {
    const items = await facturaItems(origen.id);
    const devueltas = await cantidadesDevueltas(connection, origen.id);
    const [notas] = await connection.query("SELECT COUNT(*) AS total FROM facturas WHERE documento_origen_id = ? AND tipo_comprobante = 'nota_credito'", [origen.id]);
    return {
        items: items.map((item) => ({ ...item, disponible: Math.max(0, Number(item.cantidad) - (devueltas[item.producto_id] || 0)) })),
        importe_vigente: importeVigente(origen),
        tiene_notas_credito: Number(notas[0].total) > 0
    };
};

const validarOrigenNota = (origen) => {
    if (!origen) throw new FacturacionError(404, 'Comprobante no encontrado');
    if (!['boleta', 'factura'].includes(origen.tipo_comprobante)) {
        throw new FacturacionError(409, 'Las notas de credito y debito solo se emiten sobre boletas y facturas electronicas');
    }
    if (origen.estado_comercial === 'anulado') throw new FacturacionError(409, 'El comprobante ya esta anulado');
    if (!ORIGEN_ESTADOS_VALIDOS.includes(origen.estado_sunat)) {
        throw new FacturacionError(409, 'El comprobante debe estar enviado o aceptado por SUNAT antes de emitirle una nota');
    }
};

app.get('/api/facturas/:id/notas/opciones', allowAdmin, async (req, res) => {
    try {
        const origen = await findFactura(pool, req, req.params.id);
        validarOrigenNota(origen);
        const opciones = await opcionesNota(pool, origen);
        const motivos = Object.fromEntries(Object.entries(MOTIVOS_NOTA).map(([tipo, lista]) => [
            tipo,
            Object.entries(lista)
                // A full cancellation only applies while no other credit note was issued.
                .filter(([, m]) => tipo !== 'nota_credito' || m.modo !== 'total' || !opciones.tiene_notas_credito)
                .map(([codigo, m]) => ({ codigo, ...m }))
        ]));
        res.json({
            origen: { id: origen.id, numero_comprobante: origen.numero_comprobante, tipo_comprobante: origen.tipo_comprobante, total_venta: origen.total_venta,
                monto_nc: origen.monto_nc, monto_nd: origen.monto_nd, monto_cobrado: origen.monto_cobrado, saldo: origen.saldo,
                cliente_nombre: origen.cliente_nombre, condicion_pago: origen.condicion_pago },
            ...opciones,
            motivos
        });
    } catch (err) {
        sendFacturacionError(res, err);
    }
});

app.post('/api/facturas/:id/notas', allowAdmin, async (req, res) => {
    const body = req.body || {};
    const tipo = String(body.tipo || '');
    const motivoCodigo = String(body.motivo_codigo || '');
    const sustento = String(body.motivo_descripcion || '').trim().replace(/\s+/g, ' ').slice(0, 255);
    const motivo = MOTIVOS_NOTA[tipo]?.[motivoCodigo];
    const errors = [];
    if (!MOTIVOS_NOTA[tipo]) errors.push('El tipo debe ser nota de credito o nota de debito');
    else if (!motivo) errors.push('Seleccione un motivo valido');
    if (sustento.length < 5) errors.push('Describa el sustento de la nota (al menos 5 caracteres)');
    if (errors.length > 0) return res.status(400).json({ error: errors.join('. ') });

    const connection = await pool.getConnection();
    let notaId;
    try {
        await connection.beginTransaction();
        const origen = await findFactura(connection, req, req.params.id, true);
        validarOrigenNota(origen);
        const config = await getEmpresaConfig(connection);
        facturacion.validarCredenciales(config);
        const opciones = await opcionesNota(connection, origen);
        const tasa = Number(origen.igv_porcentaje) || 10.5;

        // Lines and amounts of the note according to the reason.
        let calc;
        if (motivo.modo === 'total') {
            if (opciones.tiene_notas_credito) throw new FacturacionError(409, 'El comprobante ya tiene notas de credito: use una devolucion por item o una disminucion');
            if (Number(origen.monto_nd) > 0) throw new FacturacionError(409, 'El comprobante tiene notas de debito: anule primero con una nota por el importe vigente');
            calc = calcularLineas(opciones.items.map((item) => ({ ...item, precio_unitario: item.precio_unitario })), tasa);
        } else if (motivo.modo === 'items') {
            const pedidos = Array.isArray(body.items) ? body.items : [];
            const lineas = [];
            for (const linea of pedidos) {
                const cantidad = Number(linea?.cantidad);
                if (!cantidad) continue;
                const item = opciones.items.find((i) => Number(i.producto_id) === Number(linea.producto_id));
                if (!item) throw new FacturacionError(400, 'Hay un item que no pertenece al comprobante');
                if (!Number.isInteger(cantidad) || cantidad < 0 || cantidad > item.disponible) {
                    throw new FacturacionError(400, `Cantidad invalida para ${item.descripcion}: disponible ${item.disponible}`);
                }
                lineas.push({ producto_id: item.producto_id, descripcion: item.descripcion, unidad_sunat: item.unidad_sunat, cantidad, precio_unitario: item.precio_unitario });
            }
            if (lineas.length === 0) throw new FacturacionError(400, 'Indique la cantidad a devolver de al menos un item');
            calc = calcularLineas(lineas, tasa);
        } else {
            const monto = round2(body.monto);
            if (!(monto > 0)) throw new FacturacionError(400, 'Ingrese el importe de la nota');
            if (tipo === 'nota_credito' && monto > opciones.importe_vigente) {
                throw new FacturacionError(400, `El importe supera lo vigente del comprobante (S/ ${opciones.importe_vigente.toFixed(2)})`);
            }
            calc = calcularLineas([{ producto_id: 0, descripcion: `${motivo.nombre}: ${sustento}`.slice(0, 250), cantidad: 1, precio_unitario: monto }], tasa);
            calc.items[0].codigo = 'AJUSTE';
        }
        if (tipo === 'nota_credito' && calc.total > opciones.importe_vigente) {
            throw new FacturacionError(400, `La nota supera lo vigente del comprobante (S/ ${opciones.importe_vigente.toFixed(2)})`);
        }

        // Money already collected above the new amount must go back to the customer.
        const nuevoVigente = tipo === 'nota_credito' ? round2(opciones.importe_vigente - calc.total) : round2(opciones.importe_vigente + calc.total);
        const devolver = round2(Math.max(0, Number(origen.monto_cobrado) - nuevoVigente));
        let devolucion = null;
        if (devolver > 0) {
            const metodo = String(body.devolucion?.metodo_pago || '').trim().toLowerCase();
            if (!METODOS_COBRO.includes(metodo)) throw new FacturacionError(400, `El cliente ya pago: indique como se le devuelven S/ ${devolver.toFixed(2)}`);
            const sesionId = await openCashSession(connection, origen.sede_id);
            if (metodo === 'efectivo') {
                if (!sesionId) throw new FacturacionError(409, 'Para devolver en efectivo abra la caja de la sede');
                const summary = await buildCashSessionSummary(connection, sesionId, origen.sede_id);
                if (devolver > Number(summary.resumen.monto_teorico)) {
                    throw new FacturacionError(409, `Efectivo insuficiente en caja para devolver S/ ${devolver.toFixed(2)}`);
                }
            }
            devolucion = { metodo, referencia: String(body.devolucion?.referencia || '').trim().slice(0, 100) || null, sesionId };
        }

        const tipoSerie = NOTA_SERIE_TIPO[tipo][origen.tipo_comprobante];
        const [corrRows] = await connection.query('SELECT serie, siguiente_numero FROM correlativos WHERE tipo = ? AND sede_id = ? FOR UPDATE', [tipoSerie, origen.sede_id]);
        if (corrRows.length === 0) throw new FacturacionError(409, 'No hay serie configurada para esta nota en la sede');
        const { serie, siguiente_numero: numero } = corrRows[0];
        if (!SERIE_REGEX[origen.tipo_comprobante].test(serie)) {
            throw new FacturacionError(409, `La serie ${serie} no es valida: una nota de ${origen.tipo_comprobante} usa ${origen.tipo_comprobante === 'factura' ? 'Fxxx' : 'Bxxx'}`);
        }

        const [origenRows] = await connection.query('SELECT nubefact_payload, empresa_snapshot, cliente_id, ambiente FROM facturas WHERE id = ?', [origen.id]);
        const origenPayload = typeof origenRows[0].nubefact_payload === 'string' ? JSON.parse(origenRows[0].nubefact_payload) : origenRows[0].nubefact_payload;
        const hoy = todayLocal();
        const payload = {
            operacion: 'generar_comprobante',
            tipo_de_comprobante: facturacion.TIPOS[tipo],
            serie,
            numero,
            sunat_transaction: 1,
            cliente_tipo_de_documento: origenPayload.cliente_tipo_de_documento,
            cliente_numero_de_documento: origenPayload.cliente_numero_de_documento,
            cliente_denominacion: origenPayload.cliente_denominacion,
            cliente_direccion: origenPayload.cliente_direccion || '',
            cliente_email: '',
            fecha_de_emision: ddmmyyyy(hoy),
            moneda: 1,
            porcentaje_de_igv: tasa,
            total_gravada: calc.gravada,
            total_igv: calc.igv,
            total: calc.total,
            documento_que_se_modifica_tipo: facturacion.TIPOS[origen.tipo_comprobante],
            documento_que_se_modifica_serie: origen.serie,
            documento_que_se_modifica_numero: origen.numero,
            [tipo === 'nota_credito' ? 'tipo_de_nota_de_credito' : 'tipo_de_nota_de_debito']: Number(motivoCodigo),
            observaciones: sustento,
            enviar_automaticamente_a_la_sunat: true,
            enviar_automaticamente_al_cliente: false,
            items: calc.items.map((item) => ({
                unidad_de_medida: item.codigo === 'AJUSTE' ? 'ZZ' : item.unidad_sunat || 'NIU',
                codigo: item.codigo || `P${item.producto_id}`,
                descripcion: item.descripcion,
                cantidad: item.cantidad,
                valor_unitario: item.valor_unitario,
                precio_unitario: item.precio_unitario,
                descuento: '',
                subtotal: item.subtotal,
                tipo_de_igv: 1,
                igv: item.igv,
                total: item.total,
                anticipo_regularizacion: false
            }))
        };

        const [result] = await connection.query(
            `INSERT INTO facturas
                (sede_id, pedido_id, cliente_id, tipo_comprobante, numero_comprobante, serie, numero, subtotal, igv_porcentaje,
                 total_venta, impuesto, condicion_pago, monto_cobrado, cliente_tipo_doc, cliente_num_doc, cliente_nombre,
                 cliente_direccion, observacion, usuario_id, estado_sunat, ambiente, nubefact_payload, empresa_snapshot,
                 items_snapshot, documento_origen_id, motivo_codigo, motivo_descripcion)
             VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'contado', 0, ?, ?, ?, ?, ?, ?, 'pendiente', ?, ?, ?, ?, ?, ?, ?)`,
            [origen.sede_id, origenRows[0].cliente_id, tipo, `${serie}-${String(numero).padStart(8, '0')}`, serie, numero, calc.gravada, tasa,
                calc.total, calc.igv, origen.cliente_tipo_doc, origen.cliente_num_doc, origen.cliente_nombre, origen.cliente_direccion,
                sustento, req.userContext.id, origenRows[0].ambiente || config.nubefact_ambiente, JSON.stringify(payload),
                JSON.stringify(typeof origenRows[0].empresa_snapshot === 'string' ? JSON.parse(origenRows[0].empresa_snapshot) : origenRows[0].empresa_snapshot),
                JSON.stringify(calc.items), origen.id, motivoCodigo, motivo.nombre]
        );
        notaId = result.insertId;

        // Effect on the original: amounts, cancellation and refund are registered with the note.
        const anula = tipo === 'nota_credito' && (motivo.modo === 'total' || nuevoVigente <= 0);
        await connection.query(
            `UPDATE facturas SET monto_nc = monto_nc + ?, monto_nd = monto_nd + ?, estado_comercial = ? WHERE id = ?`,
            [tipo === 'nota_credito' ? calc.total : 0, tipo === 'nota_debito' ? calc.total : 0, anula ? 'anulado' : origen.estado_comercial, origen.id]
        );
        if (devolucion) {
            await connection.query(
                `INSERT INTO cobros_venta (factura_id, sede_id, tipo, nota_id, monto, metodo_pago, referencia, sesion_id, usuario_id)
                 VALUES (?, ?, 'devolucion', ?, ?, ?, ?, ?, ?)`,
                [origen.id, origen.sede_id, notaId, devolver, devolucion.metodo, devolucion.referencia, devolucion.sesionId, req.userContext.id]
            );
            await connection.query('UPDATE facturas SET monto_cobrado = monto_cobrado - ? WHERE id = ?', [devolver, origen.id]);
        }
        // Credit notes that cancel or return goods put the stock back, so a re-issued receipt does not count as a second exit.
        if (tipo === 'nota_credito') {
            const detalleStock = `Nota de crédito ${serie}-${String(numero).padStart(8, '0')} sobre ${origen.numero_comprobante}`;
            if (motivo.modo === 'total') {
                await restituirStockVenta(connection, origen, req.userContext.id, { detalle: detalleStock });
            } else if (motivo.modo === 'items') {
                const cantidades = {};
                for (const item of calc.items) cantidades[item.producto_id] = (cantidades[item.producto_id] || 0) + Number(item.cantidad);
                await restituirStockVenta(connection, origen, req.userContext.id, { cantidades, detalle: detalleStock });
            }
        }
        await connection.query('UPDATE correlativos SET siguiente_numero = siguiente_numero + 1 WHERE tipo = ? AND sede_id = ?', [tipoSerie, origen.sede_id]);
        await connection.commit();
    } catch (err) {
        await connection.rollback();
        connection.release();
        return sendFacturacionError(res, err);
    }
    connection.release();

    let envioError = null;
    try {
        const config = await getEmpresaConfig();
        if (Number(config.envio_automatico)) await procesarSunat(notaId, 'enviar');
    } catch (err) {
        envioError = err.message;
    }
    const detalle = await findFacturaDetalle(req, notaId);
    res.status(201).json({ ...detalle, envio_error: envioError });
});

// Pre-cuenta de la mesa (no es comprobante de pago): se imprime con los datos de la empresa.
app.post('/api/precuenta/ticket', allowAdminWaiterCashier, requireSede, async (req, res) => {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const clean = items
        .map((item) => ({ descripcion: String(item?.descripcion || '').slice(0, 120), cantidad: Number(item?.cantidad), precio: Number(item?.precio) }))
        .filter((item) => item.descripcion && item.cantidad > 0 && item.precio >= 0);
    if (clean.length === 0) return res.status(400).json({ error: 'La pre-cuenta no tiene productos' });
    try {
        const config = await getEmpresaConfig();
        const [sedeRows] = await pool.query('SELECT direccion FROM sedes WHERE id = ?', [sedeOf(req)]);
        const [now] = await pool.query("SELECT DATE_FORMAT(NOW(), '%Y-%m-%d') AS fecha, DATE_FORMAT(NOW(), '%H:%i') AS hora");
        const html = formatos.preCuentaHtml({
            mesa: String(req.body?.mesa || '-').slice(0, 20),
            items: clean,
            total: round2(clean.reduce((sum, item) => sum + item.cantidad * item.precio, 0)),
            fecha: now[0].fecha,
            hora: now[0].hora,
            mozo: req.userContext.nombre
        }, { ...config, direccion: sedeRows[0]?.direccion || config.direccion });
        res.type('html').send(html);
    } catch (err) {
        sendFacturacionError(res, err);
    }
});

const rangoReporte = (query) => {
    const startDate = typeof query.desde === 'string' && isRealDate(query.desde) ? query.desde : todayLocal();
    const endDate = typeof query.hasta === 'string' && isRealDate(query.hasta) ? query.hasta : todayLocal();
    return { startDate, endDate };
};

// Reporte descargable de cuentas por cobrar: ventas al credito del periodo con cada uno de sus cobros.
app.get('/api/cuentas-por-cobrar/reporte', allowAdminOrCashier, async (req, res) => {
    const { startDate, endDate } = rangoReporte(req.query);
    if (startDate > endDate) return res.status(400).json({ error: 'Rango de fechas invalido' });
    const { sedeFilter, error } = resolveListSede(req);
    if (error) return res.status(400).json({ error });
    const conditions = [
        "f.tipo_comprobante IN ('boleta', 'factura', 'nota_venta')", "f.condicion_pago = 'credito'", "f.estado_comercial = 'vigente'",
        "f.estado_sunat NOT IN ('anulado', 'rechazado')", '(f.total_venta + f.monto_nd - f.monto_nc) > 0',
        'f.fecha_emision >= ?', 'f.fecha_emision < DATE_ADD(?, INTERVAL 1 DAY)'
    ];
    const params = [startDate, endDate];
    if (sedeFilter) { conditions.push('f.sede_id = ?'); params.push(sedeFilter); }
    try {
        const [facturas] = await pool.query(`${FACTURA_SELECT_SQL} WHERE ${conditions.join(' AND ')} ORDER BY f.fecha_emision ASC, f.id ASC`, params);
        const cobrosPorFactura = new Map();
        if (facturas.length > 0) {
            const [cobros] = await pool.query(
                `${COBRO_SELECT_SQL} WHERE cv.factura_id IN (?) AND cv.estado = 'activo' AND cv.tipo = 'cobro' ORDER BY cv.fecha ASC, cv.id ASC`,
                [facturas.map((f) => f.id)]
            );
            cobros.forEach((c) => cobrosPorFactura.set(c.factura_id, [...(cobrosPorFactura.get(c.factura_id) || []), c]));
        }
        const config = await getEmpresaConfig();
        res.json({
            empresa: config.razon_social || config.nombre_comercial || '',
            periodo: { desde: startDate, hasta: endDate },
            facturas: facturas.map((f) => ({ ...f, cobros: cobrosPorFactura.get(f.id) || [] }))
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Cuentas por cobrar y cobros de ventas al credito.
// Filtros: estado (pendientes por defecto | todos | pendiente | parcial | vencido | cobrado), q (cliente o documento),
// venc_desde/venc_hasta y emi_desde/emi_hasta. "todos" y "cobrado" solo incluyen ventas al credito.
app.get('/api/cuentas-por-cobrar', allowAdminOrCashier, async (req, res) => {
    const { sedeFilter, error } = resolveListSede(req);
    if (error) return res.status(400).json({ error });
    const estado = String(req.query.estado || 'abiertas');
    if (!['abiertas', 'todos', 'pendiente', 'parcial', 'vencido', 'cobrado'].includes(estado)) return res.status(400).json({ error: 'Estado invalido' });
    const fechaQuery = (key) => (typeof req.query[key] === 'string' && isRealDate(req.query[key]) ? req.query[key] : null);
    const conditions = [
        "f.tipo_comprobante IN ('boleta', 'factura', 'nota_venta')", "f.estado_comercial = 'vigente'", "f.estado_sunat NOT IN ('anulado', 'rechazado')",
        '(f.total_venta + f.monto_nd - f.monto_nc) > 0'
    ];
    const params = [];
    if (estado === 'abiertas') conditions.push('f.monto_cobrado < f.total_venta + f.monto_nd - f.monto_nc');
    else conditions.push("f.condicion_pago = 'credito'");
    if (sedeFilter) { conditions.push('f.sede_id = ?'); params.push(sedeFilter); }
    const q = String(req.query.q || '').trim().slice(0, 100);
    if (q) {
        conditions.push('(f.numero_comprobante LIKE ? OR f.cliente_num_doc LIKE ? OR COALESCE(f.cliente_nombre, c.nombre) LIKE ?)');
        params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    [['venc_desde', 'f.fecha_vencimiento >= ?'], ['venc_hasta', 'f.fecha_vencimiento <= ?'],
        ['emi_desde', 'DATE(f.fecha_emision) >= ?'], ['emi_hasta', 'DATE(f.fecha_emision) <= ?']].forEach(([key, sql]) => {
        const valor = fechaQuery(key);
        if (valor) { conditions.push(sql); params.push(valor); }
    });
    try {
        let [facturas] = await pool.query(
            `${FACTURA_SELECT_SQL} WHERE ${conditions.join(' AND ')} ORDER BY f.fecha_vencimiento IS NULL, f.fecha_vencimiento ASC, f.id ASC`,
            params
        );
        if (['pendiente', 'parcial', 'vencido', 'cobrado'].includes(estado)) facturas = facturas.filter((f) => f.estado_cobro === estado);
        const hoy = todayLocal();
        const limite = new Date(`${hoy}T00:00:00Z`);
        limite.setUTCDate(limite.getUTCDate() + 7);
        const en7 = limite.toISOString().slice(0, 10);
        const resumen = facturas.reduce((acc, f) => {
            acc.cantidad += 1;
            acc.total += Number(f.total_vigente);
            acc.cobrado += Number(f.monto_cobrado);
            acc.saldo_total += Number(f.saldo);
            if (f.estado_cobro === 'vencido') { acc.vencido += Number(f.saldo); acc.cantidad_vencidos += 1; }
            else if (Number(f.saldo) > 0 && f.fecha_vencimiento && f.fecha_vencimiento <= en7) acc.por_vencer += Number(f.saldo);
            return acc;
        }, { cantidad: 0, total: 0, cobrado: 0, saldo_total: 0, vencido: 0, cantidad_vencidos: 0, por_vencer: 0 });
        ['total', 'cobrado', 'saldo_total', 'vencido', 'por_vencer'].forEach((k) => { resumen[k] = round2(resumen[k]); });
        res.json({ sede_id: sedeFilter, resumen, facturas });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/cobros', allowAdminOrCashier, async (req, res) => {
    const facturaId = Number(req.body?.factura_id);
    const monto = round2(req.body?.monto);
    const metodo = String(req.body?.metodo_pago || '').trim().toLowerCase();
    const referencia = String(req.body?.referencia || '').trim().slice(0, 100) || null;
    const errors = [];
    if (!facturaId) errors.push('Seleccione el comprobante');
    if (!(monto > 0)) errors.push('El monto debe ser mayor a 0');
    if (!METODOS_COBRO.includes(metodo)) errors.push('Seleccione el metodo de pago');
    if (errors.length > 0) return res.status(400).json({ error: errors.join('. ') });

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const factura = await findFactura(connection, req, facturaId, true);
        if (!factura) throw new FacturacionError(404, 'Comprobante no encontrado');
        if (!TIPOS_VENTA.includes(factura.tipo_comprobante)) throw new FacturacionError(409, 'Las notas no se cobran: registre el cobro en el comprobante original');
        if (factura.estado_comercial === 'anulado' || ['anulado', 'rechazado'].includes(factura.estado_sunat)) throw new FacturacionError(409, 'El comprobante esta anulado o rechazado');
        const saldo = round2(Number(factura.saldo));
        if (monto > saldo) throw new FacturacionError(409, `El cobro supera el saldo pendiente (S/ ${saldo.toFixed(2)})`);

        // Collections of credit sales are independent of the registers: only the sale itself enters its caja.
        const sesionId = null;

        const [upd] = await connection.query(
            'UPDATE facturas SET monto_cobrado = monto_cobrado + ? WHERE id = ? AND monto_cobrado + ? <= total_venta + monto_nd - monto_nc',
            [monto, factura.id, monto]
        );
        if (upd.affectedRows === 0) throw new FacturacionError(409, 'El cobro supera el saldo pendiente');
        const [result] = await connection.query(
            `INSERT INTO cobros_venta (factura_id, sede_id, monto, metodo_pago, referencia, sesion_id, usuario_id)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [factura.id, factura.sede_id, monto, metodo, referencia, sesionId, req.userContext.id]
        );
        await connection.commit();
        const [cobro] = await pool.query(`${COBRO_SELECT_SQL} WHERE cv.id = ?`, [result.insertId]);
        res.status(201).json({ cobro: cobro[0], factura: await findFactura(pool, req, factura.id) });
    } catch (err) {
        await connection.rollback();
        sendFacturacionError(res, err);
    } finally {
        connection.release();
    }
});

/** Puts back the stock that the sale took out (same warehouse and quantities recorded when it was paid). */
const restituirStockVenta = async (connection, factura, usuarioId, { cantidades = null, detalle = null } = {}) => {
    const [salidas] = await connection.query(
        `SELECT almacen_id, item_id, -cantidad AS cantidad FROM inventario_movimientos
         WHERE motivo = 'venta' AND tipo_item = 'producto' AND sede_id = ? AND detalle = ? AND cantidad < 0`,
        [factura.sede_id, `Comprobante ${factura.numero_comprobante}`]
    );
    // `cantidades` (producto_id -> unidades vendidas) limits the return to what a credit note by item gives back; without it everything
    // returns. The movements are in stock units, so the units sold are converted with the product's factor_venta.
    let pendientes = null;
    if (cantidades) {
        pendientes = {};
        const ids = Object.keys(cantidades).map(Number).filter((id) => id > 0);
        const [factores] = ids.length
            ? await connection.query(`SELECT id, ${tieneFactorVenta ? 'factor_venta' : '1 AS factor_venta'} FROM productos WHERE id IN (?)`, [ids])
            : [[]];
        const factorDe = new Map(factores.map((f) => [Number(f.id), Number(f.factor_venta) || 1]));
        for (const id of ids) pendientes[id] = Math.round(Number(cantidades[id]) * (factorDe.get(id) || 1) * 1000) / 1000;
    }
    for (const salida of salidas) {
        let cantidad = Number(salida.cantidad);
        if (pendientes) {
            cantidad = Math.min(cantidad, Number(pendientes[salida.item_id]) || 0);
            if (cantidad <= 0) continue;
            pendientes[salida.item_id] = Math.round((pendientes[salida.item_id] - cantidad) * 1000) / 1000;
        }
        await adjustStockAlmacen(connection, 'producto', salida.almacen_id, factura.sede_id, salida.item_id, cantidad);
        await registrarMovimiento(connection, {
            almacenId: salida.almacen_id, sedeId: factura.sede_id, tipo: 'producto', itemId: salida.item_id, cantidad,
            motivo: 'anulacion_venta', transferenciaId: null, detalle: detalle || `Anulación de ${factura.numero_comprobante}`, usuarioId
        });
    }
};

// Nota de venta (documento interno, sin SUNAT): se anula directamente. Boletas y facturas se anulan con nota de credito.
app.post('/api/facturas/:id/anular', allowAdmin, async (req, res) => {
    const motivo = String(req.body?.motivo || '').trim().replace(/\s+/g, ' ');
    if (motivo.length < 3) return res.status(400).json({ error: 'Ingrese el motivo de la anulacion' });
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const factura = await findFactura(connection, req, req.params.id, true);
        if (!factura) throw new FacturacionError(404, 'Comprobante no encontrado');
        if (factura.tipo_comprobante !== 'nota_venta') {
            throw new FacturacionError(409, 'Solo se anulan directamente las notas de venta: una boleta o factura se anula con una nota de credito');
        }
        if (factura.estado_comercial === 'anulado') throw new FacturacionError(409, 'La nota de venta ya esta anulada');

        // Collections are voided with the note; cash collected in a session that already closed needs a manual cash movement.
        const [cobros] = await connection.query("SELECT id, metodo_pago, sesion_id, monto FROM cobros_venta WHERE factura_id = ? AND estado = 'activo' AND tipo = 'cobro' FOR UPDATE", [factura.id]);
        for (const cobro of cobros) {
            if (cobro.metodo_pago === 'efectivo' && cobro.sesion_id) {
                const [ses] = await connection.query('SELECT estado FROM caja_sesiones WHERE id = ? FOR UPDATE', [cobro.sesion_id]);
                if (ses[0]?.estado !== 'abierta') {
                    throw new FacturacionError(409, 'El efectivo se cobro en una caja que ya se cerro: registre la devolucion como movimiento manual de caja y vuelva a intentar');
                }
            }
        }
        if (cobros.length > 0) {
            await connection.query(
                `UPDATE cobros_venta SET estado = 'anulado', anulado_por = ?, motivo_anulacion = ?, fecha_anulacion = CURRENT_TIMESTAMP
                 WHERE factura_id = ? AND estado = 'activo' AND tipo = 'cobro'`,
                [req.userContext.id, `Anulación de la nota de venta: ${motivo}`.slice(0, 200), factura.id]
            );
        }
        const cobrado = round2(cobros.reduce((acc, c) => acc + Number(c.monto), 0));
        await connection.query(
            `UPDATE facturas SET estado_comercial = 'anulado', estado_sunat = 'anulado', monto_cobrado = GREATEST(monto_cobrado - ?, 0),
                    motivo_anulacion = ?, anulado_por = ?, fecha_anulacion = CURRENT_TIMESTAMP WHERE id = ?`,
            [cobrado, motivo.slice(0, 200), req.userContext.id, factura.id]
        );
        await restituirStockVenta(connection, factura, req.userContext.id);
        if (factura.pedido_id) {
            await connection.query("UPDATE pedidos SET estado = 'cancelado' WHERE id = ?", [factura.pedido_id]);
            await rechazarDeliveryPorAnulacion(connection, factura.pedido_id, factura.numero_comprobante, req.userContext.id);
        }
        await connection.commit();
        res.json(await findFacturaDetalle(req, factura.id));
    } catch (err) {
        await connection.rollback();
        sendFacturacionError(res, err);
    } finally {
        connection.release();
    }
});

app.post('/api/cobros/:id/anular', allowAdmin, async (req, res) => {
    const motivo = String(req.body?.motivo || '').trim();
    if (motivo.length < 3) return res.status(400).json({ error: 'Ingrese el motivo de la anulacion' });
    const scope = facturaScope(req, 'cv');
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [rows] = await connection.query(
            `SELECT cv.* FROM cobros_venta cv WHERE cv.id = ? AND ${scope.where} LIMIT 1 FOR UPDATE`,
            [req.params.id, ...scope.params]
        );
        const cobro = rows[0];
        if (!cobro) throw new FacturacionError(404, 'Cobro no encontrado');
        if (cobro.estado !== 'activo') throw new FacturacionError(409, 'El cobro ya esta anulado');
        if (cobro.metodo_pago === 'efectivo' && cobro.sesion_id) {
            const [ses] = await connection.query('SELECT estado FROM caja_sesiones WHERE id = ? FOR UPDATE', [cobro.sesion_id]);
            if (ses[0]?.estado !== 'abierta') {
                throw new FacturacionError(409, 'La caja de ese cobro ya se cerro: registra la devolucion como movimiento manual de caja');
            }
        }
        await connection.query(
            `UPDATE cobros_venta SET estado = 'anulado', anulado_por = ?, motivo_anulacion = ?, fecha_anulacion = CURRENT_TIMESTAMP WHERE id = ?`,
            [req.userContext.id, motivo.slice(0, 200), cobro.id]
        );
        // Cancelling a refund puts the money back as collected; cancelling a collection reopens the balance.
        await connection.query('UPDATE facturas SET monto_cobrado = monto_cobrado + ? WHERE id = ?', [cobro.tipo === 'devolucion' ? cobro.monto : -cobro.monto, cobro.factura_id]);
        await connection.commit();
        res.json({ factura: await findFactura(pool, req, cobro.factura_id) });
    } catch (err) {
        await connection.rollback();
        sendFacturacionError(res, err);
    } finally {
        connection.release();
    }
});

// --- Reservas ---
const allowReservations = requireProfiles('administrador', 'mozo', 'caja');
const DNI_REGEX = /^\d{8}$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const RESERVA_TIPOS = ['consumo', 'evento'];
const RESERVA_ESTADOS = ['pendiente', 'confirmada', 'cancelada'];
const RESERVA_VENTANA_SEGUNDOS = 2 * 3600; // aforo: reservas confirmadas a +/- 2 horas

const todayLocal = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const isRealDate = (value) => DATE_REGEX.test(value)
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

// DATE/TIME are formatted in SQL so the client receives plain strings (no timezone shifts).
const RESERVA_SELECT_SQL = `
    SELECT r.id, r.sede_id, s.nombre AS sede_nombre, r.nombre_completo, r.dni,
           DATE_FORMAT(r.fecha, '%Y-%m-%d') AS fecha, TIME_FORMAT(r.hora, '%H:%i') AS hora,
           r.tipo, r.numero_personas, r.comentario, r.estado,
           r.usuario_registro_id, ur.nombre AS usuario_registro_nombre,
           r.usuario_confirmacion_id, uc.nombre AS usuario_confirmacion_nombre,
           r.fecha_confirmacion, r.motivo_cancelacion, r.fecha_cancelacion,
           ucan.nombre AS usuario_cancelacion_nombre, r.creado_en
    FROM reservas r
    JOIN sedes s ON s.id = r.sede_id
    LEFT JOIN usuarios ur ON ur.id = r.usuario_registro_id
    LEFT JOIN usuarios uc ON uc.id = r.usuario_confirmacion_id
    LEFT JOIN usuarios ucan ON ucan.id = r.usuario_cancelacion_id
`;

// The superadmin manages reservations of every sede; the rest only those of their own sede.
const reservaScope = (req) => (isMultisede(req)
    ? { where: '1 = 1', params: [] }
    : { where: 'r.sede_id = ?', params: [req.userContext.sedeUsuarioId] });

const findReserva = async (connection, req, id) => {
    const scope = reservaScope(req);
    const [rows] = await connection.query(
        `${RESERVA_SELECT_SQL} WHERE r.id = ? AND ${scope.where} LIMIT 1`,
        [id, ...scope.params]
    );
    return rows[0] || null;
};

const parseReservaInput = (body) => {
    const data = {
        nombre_completo: String(body?.nombre_completo || '').trim().replace(/\s+/g, ' '),
        dni: String(body?.dni || '').trim(),
        fecha: String(body?.fecha || '').trim(),
        hora: String(body?.hora || '').trim().slice(0, 5),
        tipo: String(body?.tipo || '').trim().toLowerCase(),
        numero_personas: Number(body?.numero_personas),
        comentario: String(body?.comentario || '').trim() || null
    };

    const errors = [];
    if (data.nombre_completo.length < 3) errors.push('Ingrese el nombre completo');
    if (!DNI_REGEX.test(data.dni)) errors.push('El DNI debe tener 8 digitos');
    if (!isRealDate(data.fecha)) errors.push('Fecha invalida');
    if (!TIME_REGEX.test(data.hora)) errors.push('Hora invalida');
    if (!RESERVA_TIPOS.includes(data.tipo)) errors.push('El tipo debe ser consumo o evento');
    if (!Number.isInteger(data.numero_personas) || data.numero_personas < 1) {
        errors.push('El numero de personas debe ser mayor a 0');
    }
    return { data, errors };
};

const isFutureSlot = async (connection, fecha, hora) => {
    const [rows] = await connection.query('SELECT TIMESTAMP(?, ?) >= NOW() AS vigente', [fecha, hora]);
    return Number(rows[0].vigente) === 1;
};

/** Business checks a reservation must pass before it can be confirmed. */
const validarReserva = async (connection, reserva) => {
    const checks = [];
    const add = (clave, descripcion, ok, detalle) => checks.push({ clave, descripcion, ok: Boolean(ok), detalle });
    const personas = Number(reserva.numero_personas) || 0;

    add('datos', 'Datos completos', String(reserva.nombre_completo || '').trim().length >= 3 && personas >= 1,
        `${reserva.nombre_completo} · ${personas} persona(s)`);
    add('dni', 'DNI valido (8 digitos)', DNI_REGEX.test(String(reserva.dni)), reserva.dni);

    const vigente = await isFutureSlot(connection, reserva.fecha, reserva.hora);
    add('fecha', 'Fecha y hora aun no pasaron', vigente, `${reserva.fecha} ${reserva.hora}`);

    const [sedeRows] = await connection.query('SELECT estado FROM sedes WHERE id = ?', [reserva.sede_id]);
    add('sede', 'Sede activa', sedeRows.length > 0 && Number(sedeRows[0].estado) === 1, reserva.sede_nombre);

    const [duplicadas] = await connection.query(
        `SELECT id FROM reservas
         WHERE dni = ? AND fecha = ? AND sede_id = ? AND estado = 'confirmada' AND id <> ?
         LIMIT 1`,
        [reserva.dni, reserva.fecha, reserva.sede_id, reserva.id]
    );
    add('duplicado', 'Sin otra reserva confirmada del mismo DNI ese dia', duplicadas.length === 0,
        duplicadas.length > 0 ? `Ya existe la reserva #${duplicadas[0].id}` : 'Sin coincidencias');

    const [capRows] = await connection.query(
        'SELECT COALESCE(SUM(capacidad), 0) AS capacidad FROM mesas WHERE sede_id = ?',
        [reserva.sede_id]
    );
    const capacidad = Number(capRows[0].capacidad) || 0;
    add('capacidad', 'Personas dentro de la capacidad de la sede', capacidad > 0 && personas <= capacidad,
        `${personas} persona(s) / capacidad total ${capacidad}`);

    const [ocupRows] = await connection.query(
        `SELECT COALESCE(SUM(numero_personas), 0) AS personas
         FROM reservas
         WHERE sede_id = ? AND fecha = ? AND estado = 'confirmada' AND id <> ?
           AND ABS(TIME_TO_SEC(TIMEDIFF(hora, ?))) < ?`,
        [reserva.sede_id, reserva.fecha, reserva.id, reserva.hora, RESERVA_VENTANA_SEGUNDOS]
    );
    const ocupadas = Number(ocupRows[0].personas) || 0;
    add('aforo', 'Aforo disponible en ese horario (±2 h)', capacidad > 0 && ocupadas + personas <= capacidad,
        `${ocupadas} ya confirmadas + ${personas} = ${ocupadas + personas} / ${capacidad}`);

    return { valida: checks.every((check) => check.ok), checks };
};

app.get('/api/reservas', allowReservations, async (req, res) => {
    const { desde, hasta, sede_id, estado } = req.query;
    const startDate = typeof desde === 'string' && isRealDate(desde) ? desde : todayLocal();
    const endDate = typeof hasta === 'string' && isRealDate(hasta) ? hasta : startDate;

    if (startDate > endDate) {
        return res.status(400).json({ error: 'Rango de fechas invalido' });
    }

    let sedeFilter;
    if (isMultisede(req)) {
        sedeFilter = sede_id === 'todas' ? null : (Number(sede_id) || sedeOf(req));
        if (sede_id !== 'todas' && !sedeFilter) {
            return res.status(400).json({ error: 'Seleccione una sede para continuar' });
        }
    } else {
        sedeFilter = req.userContext.sedeUsuarioId;
    }

    const conditions = ['r.fecha BETWEEN ? AND ?'];
    const params = [startDate, endDate];
    if (sedeFilter) {
        conditions.push('r.sede_id = ?');
        params.push(sedeFilter);
    }
    if (RESERVA_ESTADOS.includes(estado)) {
        conditions.push('r.estado = ?');
        params.push(estado);
    }

    try {
        const [reservas] = await pool.query(
            `${RESERVA_SELECT_SQL} WHERE ${conditions.join(' AND ')} ORDER BY r.fecha ASC, r.hora ASC, r.id ASC`,
            params
        );

        const resumen = reservas.reduce((acc, row) => {
            acc.total += 1;
            acc[row.estado] = (acc[row.estado] || 0) + 1;
            if (row.estado === 'confirmada') acc.personas_confirmadas += Number(row.numero_personas) || 0;
            return acc;
        }, { total: 0, pendiente: 0, confirmada: 0, cancelada: 0, personas_confirmadas: 0 });

        res.json({
            periodo: { desde: startDate, hasta: endDate },
            sede_id: sedeFilter,
            resumen,
            reservas
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/reservas', allowReservations, requireSede, async (req, res) => {
    const { data, errors } = parseReservaInput(req.body);
    if (errors.length > 0) return res.status(400).json({ error: errors.join('. ') });

    try {
        if (!(await isFutureSlot(pool, data.fecha, data.hora))) {
            return res.status(400).json({ error: 'La fecha y hora de la reserva ya pasaron' });
        }

        const [result] = await pool.query(
            `INSERT INTO reservas
                (sede_id, nombre_completo, dni, fecha, hora, tipo, numero_personas, comentario, estado, usuario_registro_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?)`,
            [sedeOf(req), data.nombre_completo, data.dni, data.fecha, data.hora, data.tipo,
                data.numero_personas, data.comentario, req.userContext.id]
        );
        res.status(201).json(await findReserva(pool, req, result.insertId));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/reservas/:id', allowReservations, async (req, res) => {
    const { data, errors } = parseReservaInput(req.body);
    if (errors.length > 0) return res.status(400).json({ error: errors.join('. ') });

    try {
        const reserva = await findReserva(pool, req, req.params.id);
        if (!reserva) return res.status(404).json({ error: 'Reserva no encontrada' });
        if (reserva.estado !== 'pendiente') {
            return res.status(409).json({ error: 'Solo se pueden editar reservas pendientes' });
        }
        if (!(await isFutureSlot(pool, data.fecha, data.hora))) {
            return res.status(400).json({ error: 'La fecha y hora de la reserva ya pasaron' });
        }

        await pool.query(
            `UPDATE reservas
             SET nombre_completo = ?, dni = ?, fecha = ?, hora = ?, tipo = ?, numero_personas = ?, comentario = ?
             WHERE id = ?`,
            [data.nombre_completo, data.dni, data.fecha, data.hora, data.tipo, data.numero_personas, data.comentario, reserva.id]
        );
        res.json(await findReserva(pool, req, reserva.id));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/reservas/:id/validacion', allowReservations, async (req, res) => {
    try {
        const reserva = await findReserva(pool, req, req.params.id);
        if (!reserva) return res.status(404).json({ error: 'Reserva no encontrada' });
        if (reserva.estado !== 'pendiente') {
            return res.status(409).json({ error: `La reserva ya esta ${reserva.estado}` });
        }
        res.json({ reserva, ...(await validarReserva(pool, reserva)) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/reservas/:id/confirmar', allowReservations, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const reserva = await findReserva(connection, req, req.params.id);
        if (!reserva) {
            await connection.rollback();
            return res.status(404).json({ error: 'Reserva no encontrada' });
        }

        // Locking the sede serialises confirmations so two of them cannot both pass the aforo check.
        await connection.query('SELECT id FROM sedes WHERE id = ? FOR UPDATE', [reserva.sede_id]);
        const [estadoRows] = await connection.query('SELECT estado FROM reservas WHERE id = ? FOR UPDATE', [reserva.id]);
        if (estadoRows[0].estado !== 'pendiente') {
            await connection.rollback();
            return res.status(409).json({ error: `La reserva ya esta ${estadoRows[0].estado}` });
        }

        const validacion = await validarReserva(connection, reserva);
        if (!validacion.valida) {
            await connection.rollback();
            return res.status(422).json({ error: 'La reserva no paso la validacion', ...validacion });
        }

        await connection.query(
            `UPDATE reservas
             SET estado = 'confirmada', usuario_confirmacion_id = ?, fecha_confirmacion = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [req.userContext.id, reserva.id]
        );
        await connection.commit();
        res.json(await findReserva(pool, req, reserva.id));
    } catch (err) {
        await connection.rollback();
        res.status(500).json({ error: err.message });
    } finally {
        connection.release();
    }
});

app.put('/api/reservas/:id/cancelar', allowReservations, async (req, res) => {
    const motivo = String(req.body?.motivo || '').trim();
    if (motivo.length < 3) return res.status(400).json({ error: 'Ingrese el motivo de la cancelacion' });
    try {
        const reserva = await findReserva(pool, req, req.params.id);
        if (!reserva) return res.status(404).json({ error: 'Reserva no encontrada' });
        if (reserva.estado === 'cancelada') {
            return res.status(409).json({ error: 'La reserva ya esta cancelada' });
        }
        await pool.query(
            "UPDATE reservas SET estado = 'cancelada', motivo_cancelacion = ?, usuario_cancelacion_id = ?, fecha_cancelacion = CURRENT_TIMESTAMP WHERE id = ?",
            [motivo.slice(0, 200), req.userContext.id, reserva.id]
        );
        res.json(await findReserva(pool, req, reserva.id));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Gastos y pagos de gastos ---
const allowGastos = requireProfiles('administrador', 'caja');

const GASTO_TIPOS_DOCUMENTO = ['factura', 'boleta', 'ticket', 'recibo_servicios', 'recibo_honorarios', 'tributo', 'sin_comprobante'];
const GASTO_DOCUMENTOS_CON_NUMERO = ['factura', 'boleta', 'recibo_servicios', 'recibo_honorarios'];
const GASTO_DOCUMENTOS_SIN_IGV = ['recibo_honorarios', 'tributo'];
const GASTO_AFECTACIONES = ['gravado', 'inafecto', 'exonerado', 'sin_comprobante'];
const GASTO_CONDICIONES = ['contado', 'credito'];
const GASTO_ESTADOS_PAGO = ['pendiente', 'parcial', 'pagado', 'vencido', 'anulado'];
const METODOS_PAGO_GASTO = ['efectivo', 'yape', 'plin', 'tarjeta', 'transferencia', 'deposito'];
const IGV_GASTO_DEFAULT = 18;

const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const formatSoles = (value) => `S/ ${roundMoney(value).toFixed(2)}`;

const addDaysToDate = (ymd, days) => {
    const date = new Date(`${ymd}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
};

class GastoError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

const sendGastoError = (res, err) => {
    if (err instanceof GastoError) return res.status(err.status).json({ error: err.message });
    if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'Ese comprobante ya esta registrado para el mismo proveedor o beneficiario' });
    }
    return res.status(500).json({ error: err.message });
};

const GASTO_ESTADO_PAGO_SQL = `
    CASE
        WHEN g.estado = 'anulado' THEN 'anulado'
        WHEN g.monto_pagado >= g.importe THEN 'pagado'
        WHEN g.fecha_vencimiento < CURDATE() THEN 'vencido'
        WHEN g.monto_pagado > 0 THEN 'parcial'
        ELSE 'pendiente'
    END`;

// DATE columns are formatted in SQL so the client receives plain strings (no timezone shifts).
const GASTO_SELECT_SQL = `
    SELECT g.id, CONCAT('G-', LPAD(g.id, 6, '0')) AS codigo, g.sede_id, s.nombre AS sede_nombre,
           g.categoria_id, cg.nombre AS categoria_nombre, g.proveedor_id, g.beneficiario, g.documento_identidad,
           DATE_FORMAT(g.fecha, '%Y-%m-%d') AS fecha, g.tipo_documento, g.serie, g.numero, g.descripcion,
           g.afectacion, g.tasa_igv, g.valor, g.igv, g.importe, g.condicion_pago,
           DATE_FORMAT(g.fecha_vencimiento, '%Y-%m-%d') AS fecha_vencimiento,
           g.monto_pagado, ROUND(g.importe - g.monto_pagado, 2) AS saldo,
           ${GASTO_ESTADO_PAGO_SQL} AS estado_pago,
           g.estado, g.observacion, g.usuario_id, u.nombre AS usuario_nombre,
           g.anulado_por, ua.nombre AS anulado_por_nombre, g.motivo_anulacion, g.fecha_anulacion, g.creado_en
    FROM gastos g
    JOIN sedes s ON s.id = g.sede_id
    JOIN categorias_gasto cg ON cg.id = g.categoria_id
    LEFT JOIN usuarios u ON u.id = g.usuario_id
    LEFT JOIN usuarios ua ON ua.id = g.anulado_por
`;

const PAGO_GASTO_SELECT_SQL = `
    SELECT p.id, p.gasto_id, CONCAT('G-', LPAD(g.id, 6, '0')) AS gasto_codigo, g.beneficiario, g.descripcion AS gasto_descripcion,
           cg.nombre AS categoria_nombre, p.sede_id, s.nombre AS sede_nombre, p.monto, p.metodo_pago, p.referencia,
           p.observacion, p.sesion_id, c.descripcion AS caja_descripcion, p.estado, p.fecha,
           p.usuario_id, u.nombre AS usuario_nombre, p.anulado_por, ua.nombre AS anulado_por_nombre,
           p.motivo_anulacion, p.fecha_anulacion
    FROM pagos_gasto p
    JOIN gastos g ON g.id = p.gasto_id
    JOIN categorias_gasto cg ON cg.id = g.categoria_id
    JOIN sedes s ON s.id = p.sede_id
    LEFT JOIN caja_sesiones cs ON cs.id = p.sesion_id
    LEFT JOIN cajas c ON c.id = cs.caja_id
    LEFT JOIN usuarios u ON u.id = p.usuario_id
    LEFT JOIN usuarios ua ON ua.id = p.anulado_por
`;

// The superadmin manages expenses of every sede; the rest only those of their own sede.
const gastoScope = (req, alias) => (isMultisede(req)
    ? { where: '1 = 1', params: [] }
    : { where: `${alias}.sede_id = ?`, params: [req.userContext.sedeUsuarioId] });

/** Sede to list: superadmin may pick one or "todas"; everybody else only sees their own. */
const resolveListSede = (req) => {
    if (!isMultisede(req)) return { sedeFilter: req.userContext.sedeUsuarioId };
    const { sede_id: sedeId } = req.query;
    if (sedeId === 'todas') return { sedeFilter: null };
    const sedeFilter = Number(sedeId) || sedeOf(req);
    if (!sedeFilter) return { error: 'Seleccione una sede para continuar' };
    return { sedeFilter };
};

const findGasto = async (connection, req, id, lock = false) => {
    const scope = gastoScope(req, 'g');
    const [rows] = await connection.query(
        `${GASTO_SELECT_SQL} WHERE g.id = ? AND ${scope.where} LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
        [id, ...scope.params]
    );
    return rows[0] || null;
};

const findPagosDeGasto = async (connection, gastoId) => {
    const [rows] = await connection.query(`${PAGO_GASTO_SELECT_SQL} WHERE p.gasto_id = ? ORDER BY p.fecha ASC, p.id ASC`, [gastoId]);
    return rows;
};

const parsePagoInput = (body) => {
    const data = {
        metodo_pago: String(body?.metodo_pago || '').trim().toLowerCase(),
        referencia: String(body?.referencia || '').trim().slice(0, 100) || null,
        observacion: String(body?.observacion || '').trim() || null
    };
    const errors = [];
    if (!METODOS_PAGO_GASTO.includes(data.metodo_pago)) errors.push('Metodo de pago invalido');
    return { data, errors };
};

const parseGastoInput = (body) => {
    const tipo = String(body?.tipo_documento || '').trim().toLowerCase();
    const sinComprobante = tipo === 'sin_comprobante';
    const data = {
        categoria_id: Number(body?.categoria_id),
        proveedor_id: body?.proveedor_id ? Number(body.proveedor_id) : null,
        beneficiario: String(body?.beneficiario || '').trim().replace(/\s+/g, ' '),
        documento_identidad: String(body?.documento_identidad || '').trim() || null,
        fecha: String(body?.fecha || '').trim(),
        tipo_documento: tipo,
        serie: sinComprobante ? null : (String(body?.serie || '').trim().toUpperCase() || null),
        numero: sinComprobante ? null : (String(body?.numero || '').trim() || null),
        descripcion: String(body?.descripcion || '').trim().replace(/\s+/g, ' '),
        afectacion: String(body?.afectacion || '').trim().toLowerCase(),
        tasa_igv: body?.tasa_igv === undefined || body?.tasa_igv === '' ? IGV_GASTO_DEFAULT : Number(body.tasa_igv),
        importe: roundMoney(body?.importe),
        condicion_pago: String(body?.condicion_pago || '').trim().toLowerCase(),
        fecha_vencimiento: String(body?.fecha_vencimiento || '').trim(),
        observacion: String(body?.observacion || '').trim() || null
    };

    const errors = [];
    if (!Number.isInteger(data.categoria_id) || data.categoria_id < 1) errors.push('Seleccione la categoria del gasto');
    if (!data.proveedor_id && data.beneficiario.length < 3) errors.push('Seleccione un proveedor o ingrese el beneficiario');
    if (data.documento_identidad && !/^(\d{8}|\d{11})$/.test(data.documento_identidad)) {
        errors.push('El DNI/RUC del beneficiario debe tener 8 u 11 digitos');
    }
    if (!isRealDate(data.fecha)) errors.push('Fecha del gasto invalida');
    else if (data.fecha > todayLocal()) errors.push('La fecha del gasto no puede ser futura');
    if (!GASTO_TIPOS_DOCUMENTO.includes(data.tipo_documento)) errors.push('Tipo de comprobante invalido');
    if (GASTO_DOCUMENTOS_CON_NUMERO.includes(data.tipo_documento) && !data.numero) {
        errors.push('Ingrese el numero del comprobante');
    }
    if (data.descripcion.length < 3) errors.push('Ingrese la descripcion del gasto');
    if (!(data.importe > 0)) errors.push('El importe debe ser mayor a 0');
    if (!GASTO_CONDICIONES.includes(data.condicion_pago)) errors.push('La condicion de pago debe ser contado o credito');

    if (sinComprobante) data.afectacion = 'sin_comprobante';
    if (data.afectacion && !GASTO_AFECTACIONES.includes(data.afectacion)) errors.push('Afectacion invalida');
    if (data.afectacion === 'sin_comprobante' && !sinComprobante) {
        errors.push('La afectacion "sin comprobante" solo aplica a gastos sin comprobante');
    }
    if (data.afectacion === 'gravado' && GASTO_DOCUMENTOS_SIN_IGV.includes(data.tipo_documento)) {
        errors.push('Los recibos por honorarios y tributos no llevan IGV');
    }
    if (data.afectacion === 'gravado' && !(data.tasa_igv > 0 && data.tasa_igv <= 100)) errors.push('Tasa de IGV invalida');

    if (data.condicion_pago === 'contado') {
        data.fecha_vencimiento = data.fecha;
    } else if (data.condicion_pago === 'credito') {
        if (!isRealDate(data.fecha_vencimiento)) errors.push('Ingrese la fecha de vencimiento del credito');
        else if (isRealDate(data.fecha) && data.fecha_vencimiento < data.fecha) {
            errors.push('El vencimiento no puede ser anterior a la fecha del gasto');
        }
    }
    return { data, errors };
};

/** Splits the total into base and IGV according to the document's tax treatment. */
const computeGastoMontos = (afectacion, tasa, importe) => {
    if (afectacion !== 'gravado') return { tasa_igv: 0, valor: importe, igv: 0 };
    const valor = roundMoney(importe / (1 + tasa / 100));
    return { tasa_igv: tasa, valor, igv: roundMoney(importe - valor) };
};

/**
 * Registers one payment of an expense inside the caller's transaction (the expense row must be locked).
 * It is not linked to any caja: the payment only keeps its method and reference.
 */
const registrarPagoGasto = async (connection, req, gasto, monto, pago) => {
    const amount = roundMoney(monto);
    const saldo = roundMoney(Number(gasto.importe) - Number(gasto.monto_pagado));
    if (gasto.estado !== 'registrado') throw new GastoError(409, 'El gasto esta anulado');
    if (!(amount > 0)) throw new GastoError(400, 'El monto del pago debe ser mayor a 0');
    if (amount > saldo) throw new GastoError(409, `El pago supera el saldo pendiente (${formatSoles(saldo)})`);

    // Expense payments are independent of the registers: they never touch a cash session, whatever the method.
    const sesionId = null;
    const movimientoId = null;

    // The conditional update is a second guard against paying more than the balance.
    const [updateResult] = await connection.query(
        `UPDATE gastos SET monto_pagado = monto_pagado + ?
         WHERE id = ? AND estado = 'registrado' AND monto_pagado + ? <= importe`,
        [amount, gasto.id, amount]
    );
    if (updateResult.affectedRows === 0) throw new GastoError(409, 'El pago supera el saldo pendiente');

    const [pagoResult] = await connection.query(
        `INSERT INTO pagos_gasto
            (gasto_id, sede_id, monto, metodo_pago, referencia, observacion, sesion_id, movimiento_caja_id, usuario_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [gasto.id, gasto.sede_id, amount, pago.metodo_pago, pago.referencia, pago.observacion,
            sesionId, movimientoId, req.userContext.id]
    );
    return pagoResult.insertId;
};

// Opciones del formulario de gastos (caja no tiene acceso al modulo de proveedores)
app.get('/api/gastos/opciones', allowGastos, async (req, res) => {
    try {
        const [categorias] = await pool.query('SELECT id, nombre, afectacion FROM categorias_gasto WHERE activo = 1 ORDER BY nombre ASC');
        const [proveedores] = await pool.query('SELECT id, razon_social, ruc FROM proveedores ORDER BY razon_social ASC');
        res.json({ categorias, proveedores, igv_default: IGV_GASTO_DEFAULT });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Categorias de gasto (compartidas entre sedes)
app.get('/api/categorias-gasto', allowGastos, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM categorias_gasto ORDER BY activo DESC, nombre ASC');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const parseCategoriaGasto = (body) => {
    const data = {
        nombre: String(body?.nombre || '').trim().replace(/\s+/g, ' '),
        afectacion: String(body?.afectacion || 'gravado').trim().toLowerCase(),
        activo: body?.activo === undefined ? 1 : (body.activo ? 1 : 0)
    };
    const errors = [];
    if (data.nombre.length < 3) errors.push('Ingrese el nombre de la categoria');
    if (!GASTO_AFECTACIONES.includes(data.afectacion)) errors.push('Afectacion invalida');
    return { data, errors };
};

app.post('/api/categorias-gasto', allowAdmin, async (req, res) => {
    const { data, errors } = parseCategoriaGasto(req.body);
    if (errors.length > 0) return res.status(400).json({ error: errors.join('. ') });
    try {
        const [result] = await pool.query(
            'INSERT INTO categorias_gasto (nombre, afectacion, activo) VALUES (?, ?, ?)',
            [data.nombre, data.afectacion, data.activo]
        );
        res.status(201).json({ id: result.insertId, ...data });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe una categoria con ese nombre' });
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/categorias-gasto/:id', allowAdmin, async (req, res) => {
    const { data, errors } = parseCategoriaGasto(req.body);
    if (errors.length > 0) return res.status(400).json({ error: errors.join('. ') });
    try {
        const [result] = await pool.query(
            'UPDATE categorias_gasto SET nombre = ?, afectacion = ?, activo = ? WHERE id = ?',
            [data.nombre, data.afectacion, data.activo, req.params.id]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Categoria no encontrada' });
        res.json({ id: Number(req.params.id), ...data });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe una categoria con ese nombre' });
        res.status(500).json({ error: err.message });
    }
});

// Gastos
app.get('/api/gastos', allowGastos, async (req, res) => {
    const { desde, hasta, categoria_id: categoriaId, estado_pago: estadoPago, condicion_pago: condicion, q } = req.query;
    const startDate = typeof desde === 'string' && isRealDate(desde) ? desde : todayLocal();
    const endDate = typeof hasta === 'string' && isRealDate(hasta) ? hasta : startDate;
    if (startDate > endDate) return res.status(400).json({ error: 'Rango de fechas invalido' });

    const { sedeFilter, error } = resolveListSede(req);
    if (error) return res.status(400).json({ error });

    const conditions = ['g.fecha BETWEEN ? AND ?'];
    const params = [startDate, endDate];
    if (sedeFilter) {
        conditions.push('g.sede_id = ?');
        params.push(sedeFilter);
    }
    if (Number(categoriaId)) {
        conditions.push('g.categoria_id = ?');
        params.push(Number(categoriaId));
    }
    if (GASTO_ESTADOS_PAGO.includes(estadoPago)) {
        conditions.push(`(${GASTO_ESTADO_PAGO_SQL}) = ?`);
        params.push(estadoPago);
    }
    if (GASTO_CONDICIONES.includes(condicion)) {
        conditions.push('g.condicion_pago = ?');
        params.push(condicion);
    }
    if (typeof q === 'string' && q.trim()) {
        const like = `%${q.trim()}%`;
        conditions.push('(g.beneficiario LIKE ? OR g.descripcion LIKE ? OR g.numero LIKE ? OR g.documento_identidad LIKE ?)');
        params.push(like, like, like, like);
    }

    try {
        const [gastos] = await pool.query(
            `${GASTO_SELECT_SQL} WHERE ${conditions.join(' AND ')} ORDER BY g.fecha DESC, g.id DESC`,
            params
        );

        const porCategoria = new Map();
        const resumen = gastos.reduce((acc, gasto) => {
            if (gasto.estado === 'anulado') {
                acc.anulados += 1;
                return acc;
            }
            acc.cantidad += 1;
            acc.importe_total += Number(gasto.importe);
            acc.pagado += Number(gasto.monto_pagado);
            acc.saldo_pendiente += Number(gasto.saldo);
            if (gasto.estado_pago === 'vencido') acc.vencido += Number(gasto.saldo);
            porCategoria.set(gasto.categoria_nombre, (porCategoria.get(gasto.categoria_nombre) || 0) + Number(gasto.importe));
            return acc;
        }, { cantidad: 0, anulados: 0, importe_total: 0, pagado: 0, saldo_pendiente: 0, vencido: 0 });

        ['importe_total', 'pagado', 'saldo_pendiente', 'vencido'].forEach((key) => { resumen[key] = roundMoney(resumen[key]); });
        resumen.por_categoria = [...porCategoria.entries()]
            .map(([categoria, importe]) => ({ categoria, importe: roundMoney(importe) }))
            .sort((a, b) => b.importe - a.importe);

        res.json({ periodo: { desde: startDate, hasta: endDate }, sede_id: sedeFilter, resumen, gastos });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/gastos/por-pagar', allowGastos, async (req, res) => {
    const { sedeFilter, error } = resolveListSede(req);
    if (error) return res.status(400).json({ error });

    const conditions = ["g.estado = 'registrado'", 'g.monto_pagado < g.importe'];
    const params = [];
    if (sedeFilter) {
        conditions.push('g.sede_id = ?');
        params.push(sedeFilter);
    }

    try {
        const [gastos] = await pool.query(
            `${GASTO_SELECT_SQL} WHERE ${conditions.join(' AND ')} ORDER BY g.fecha_vencimiento ASC, g.id ASC`,
            params
        );
        const limite = addDaysToDate(todayLocal(), 7);
        const resumen = gastos.reduce((acc, gasto) => {
            const saldo = Number(gasto.saldo);
            acc.cantidad += 1;
            acc.saldo_total += saldo;
            if (gasto.estado_pago === 'vencido') acc.vencido += saldo;
            else if (gasto.fecha_vencimiento <= limite) acc.vence_7_dias += saldo;
            return acc;
        }, { cantidad: 0, saldo_total: 0, vencido: 0, vence_7_dias: 0 });
        ['saldo_total', 'vencido', 'vence_7_dias'].forEach((key) => { resumen[key] = roundMoney(resumen[key]); });

        res.json({ sede_id: sedeFilter, resumen, gastos });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Reporte descargable de cuentas por pagar: gastos al credito del periodo con cada uno de sus pagos.
app.get('/api/gastos/por-pagar/reporte', allowGastos, async (req, res) => {
    const startDate = typeof req.query.desde === 'string' && isRealDate(req.query.desde) ? req.query.desde : todayLocal();
    const endDate = typeof req.query.hasta === 'string' && isRealDate(req.query.hasta) ? req.query.hasta : todayLocal();
    if (startDate > endDate) return res.status(400).json({ error: 'Rango de fechas invalido' });
    const { sedeFilter, error } = resolveListSede(req);
    if (error) return res.status(400).json({ error });
    const conditions = ["g.estado = 'registrado'", "g.condicion_pago = 'credito'", 'g.fecha BETWEEN ? AND ?'];
    const params = [startDate, endDate];
    if (sedeFilter) { conditions.push('g.sede_id = ?'); params.push(sedeFilter); }
    try {
        const [gastos] = await pool.query(`${GASTO_SELECT_SQL} WHERE ${conditions.join(' AND ')} ORDER BY g.fecha ASC, g.id ASC`, params);
        const pagosPorGasto = new Map();
        if (gastos.length > 0) {
            const [pagos] = await pool.query(`${PAGO_GASTO_SELECT_SQL} WHERE p.gasto_id IN (?) AND p.estado = 'activo' ORDER BY p.fecha ASC, p.id ASC`, [gastos.map((g) => g.id)]);
            pagos.forEach((p) => pagosPorGasto.set(p.gasto_id, [...(pagosPorGasto.get(p.gasto_id) || []), p]));
        }
        const config = await getEmpresaConfig();
        res.json({
            empresa: config.razon_social || config.nombre_comercial || '',
            periodo: { desde: startDate, hasta: endDate },
            gastos: gastos.map((g) => ({ ...g, pagos: pagosPorGasto.get(g.id) || [] }))
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/gastos/:id', allowGastos, async (req, res) => {
    try {
        const gasto = await findGasto(pool, req, req.params.id);
        if (!gasto) return res.status(404).json({ error: 'Gasto no encontrado' });
        res.json({ ...gasto, pagos: await findPagosDeGasto(pool, gasto.id) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * Validates and registers an expense inside the caller's transaction (a cash expense with its payment).
 * Shared by the expenses screen and by equipment maintenance. Returns the new expense id.
 */
const insertarGasto = async (connection, req, sedeId, body) => {
    const { data, errors } = parseGastoInput(body);
    let pago = null;
    if (data.condicion_pago === 'contado') {
        const parsedPago = parsePagoInput(body?.pago);
        pago = parsedPago.data;
        errors.push(...parsedPago.errors);
    }
    if (errors.length > 0) throw new GastoError(400, errors.join('. '));

    const [catRows] = await connection.query('SELECT id, afectacion, activo FROM categorias_gasto WHERE id = ? LIMIT 1', [data.categoria_id]);
    if (catRows.length === 0 || !Number(catRows[0].activo)) throw new GastoError(400, 'La categoria no existe o esta desactivada');

    if (data.proveedor_id) {
        const [provRows] = await connection.query('SELECT razon_social, ruc FROM proveedores WHERE id = ? LIMIT 1', [data.proveedor_id]);
        if (provRows.length === 0) throw new GastoError(400, 'Proveedor no encontrado');
        data.beneficiario = provRows[0].razon_social;
        data.documento_identidad = provRows[0].ruc;
    }

    let afectacion = data.afectacion || catRows[0].afectacion;
    if (afectacion === 'sin_comprobante' && data.tipo_documento !== 'sin_comprobante') afectacion = 'inafecto';
    if (afectacion === 'gravado' && GASTO_DOCUMENTOS_SIN_IGV.includes(data.tipo_documento)) afectacion = 'inafecto';
    const montos = computeGastoMontos(afectacion, data.tasa_igv, data.importe);

    const emisor = data.proveedor_id ? `p${data.proveedor_id}` : `n:${data.beneficiario.toLowerCase()}`;
    const documentoClave = data.numero
        ? `${emisor}|${data.tipo_documento}|${(data.serie || '').toLowerCase()}|${data.numero.toLowerCase()}`.slice(0, 320)
        : null;

    const [result] = await connection.query(
        `INSERT INTO gastos
            (sede_id, categoria_id, proveedor_id, beneficiario, documento_identidad, fecha, tipo_documento, serie, numero,
             documento_clave, descripcion, afectacion, tasa_igv, valor, igv, importe, condicion_pago, fecha_vencimiento,
             observacion, usuario_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [sedeId, data.categoria_id, data.proveedor_id, data.beneficiario, data.documento_identidad, data.fecha,
            data.tipo_documento, data.serie, data.numero, documentoClave, data.descripcion, afectacion,
            montos.tasa_igv, montos.valor, montos.igv, data.importe, data.condicion_pago, data.fecha_vencimiento,
            data.observacion, req.userContext.id]
    );

    // A cash expense is registered together with its full payment: if the payment fails nothing is saved.
    if (pago) {
        const gasto = await findGasto(connection, req, result.insertId, true);
        await registrarPagoGasto(connection, req, gasto, data.importe, pago);
    }
    return result.insertId;
};

app.post('/api/gastos', allowGastos, requireSede, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const gastoId = await insertarGasto(connection, req, sedeOf(req), req.body);
        await connection.commit();
        const gasto = await findGasto(pool, req, gastoId);
        res.status(201).json({ ...gasto, pagos: await findPagosDeGasto(pool, gasto.id) });
    } catch (err) {
        await connection.rollback();
        sendGastoError(res, err);
    } finally {
        connection.release();
    }
});

app.post('/api/gastos/:id/anular', allowAdmin, async (req, res) => {
    const motivo = String(req.body?.motivo || '').trim();
    if (motivo.length < 3) return res.status(400).json({ error: 'Ingrese el motivo de la anulacion' });

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const gasto = await findGasto(connection, req, req.params.id, true);
        if (!gasto) throw new GastoError(404, 'Gasto no encontrado');
        if (gasto.estado === 'anulado') throw new GastoError(409, 'El gasto ya esta anulado');

        const [activos] = await connection.query("SELECT COUNT(*) AS total FROM pagos_gasto WHERE gasto_id = ? AND estado = 'activo'", [gasto.id]);
        if (Number(activos[0].total) > 0) {
            throw new GastoError(409, 'El gasto tiene pagos activos: anulalos primero');
        }

        // The document key is released so a corrected expense can reuse the same voucher.
        await connection.query(
            `UPDATE gastos
             SET estado = 'anulado', documento_clave = NULL, anulado_por = ?, motivo_anulacion = ?, fecha_anulacion = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [req.userContext.id, motivo.slice(0, 200), gasto.id]
        );
        await connection.commit();
        res.json(await findGasto(pool, req, gasto.id));
    } catch (err) {
        await connection.rollback();
        sendGastoError(res, err);
    } finally {
        connection.release();
    }
});

// Pagos de gastos
app.get('/api/pagos-gastos', allowGastos, async (req, res) => {
    const { desde, hasta, metodo_pago: metodo, estado } = req.query;
    const startDate = typeof desde === 'string' && isRealDate(desde) ? desde : todayLocal();
    const endDate = typeof hasta === 'string' && isRealDate(hasta) ? hasta : startDate;
    if (startDate > endDate) return res.status(400).json({ error: 'Rango de fechas invalido' });

    const { sedeFilter, error } = resolveListSede(req);
    if (error) return res.status(400).json({ error });

    const conditions = ['p.fecha >= ?', 'p.fecha < DATE_ADD(?, INTERVAL 1 DAY)'];
    const params = [startDate, endDate];
    if (sedeFilter) {
        conditions.push('p.sede_id = ?');
        params.push(sedeFilter);
    }
    if (METODOS_PAGO_GASTO.includes(metodo)) {
        conditions.push('p.metodo_pago = ?');
        params.push(metodo);
    }
    if (['activo', 'anulado'].includes(estado)) {
        conditions.push('p.estado = ?');
        params.push(estado);
    }

    try {
        const [pagos] = await pool.query(
            `${PAGO_GASTO_SELECT_SQL} WHERE ${conditions.join(' AND ')} ORDER BY p.fecha DESC, p.id DESC`,
            params
        );
        const resumen = pagos.reduce((acc, pago) => {
            if (pago.estado !== 'activo') {
                acc.anulados += 1;
                return acc;
            }
            acc.cantidad += 1;
            acc.total += Number(pago.monto);
            acc.por_metodo[pago.metodo_pago] = roundMoney((acc.por_metodo[pago.metodo_pago] || 0) + Number(pago.monto));
            return acc;
        }, { cantidad: 0, anulados: 0, total: 0, por_metodo: {} });
        resumen.total = roundMoney(resumen.total);

        res.json({ periodo: { desde: startDate, hasta: endDate }, sede_id: sedeFilter, resumen, pagos });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/pagos-gastos', allowGastos, async (req, res) => {
    const gastoId = Number(req.body?.gasto_id);
    const { data: pago, errors } = parsePagoInput(req.body);
    if (!gastoId) errors.unshift('Seleccione el gasto a pagar');
    if (!(roundMoney(req.body?.monto) > 0)) errors.push('El monto del pago debe ser mayor a 0');
    if (errors.length > 0) return res.status(400).json({ error: errors.join('. ') });

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const gasto = await findGasto(connection, req, gastoId, true);
        if (!gasto) throw new GastoError(404, 'Gasto no encontrado');
        const pagoId = await registrarPagoGasto(connection, req, gasto, req.body.monto, pago);
        await connection.commit();

        const [rows] = await pool.query(`${PAGO_GASTO_SELECT_SQL} WHERE p.id = ?`, [pagoId]);
        res.status(201).json({ pago: rows[0], gasto: await findGasto(pool, req, gastoId) });
    } catch (err) {
        await connection.rollback();
        sendGastoError(res, err);
    } finally {
        connection.release();
    }
});

app.post('/api/pagos-gastos/:id/anular', allowAdmin, async (req, res) => {
    const motivo = String(req.body?.motivo || '').trim();
    if (motivo.length < 3) return res.status(400).json({ error: 'Ingrese el motivo de la anulacion' });

    const scope = gastoScope(req, 'p');
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [pagoRows] = await connection.query(
            `SELECT p.* FROM pagos_gasto p WHERE p.id = ? AND ${scope.where} LIMIT 1 FOR UPDATE`,
            [req.params.id, ...scope.params]
        );
        const pago = pagoRows[0];
        if (!pago) throw new GastoError(404, 'Pago no encontrado');
        if (pago.estado !== 'activo') throw new GastoError(409, 'El pago ya esta anulado');

        const gasto = await findGasto(connection, req, pago.gasto_id, true);
        let reversaId = null;
        if (pago.metodo_pago === 'efectivo' && pago.sesion_id) {
            // A closed session is never reopened silently: the cash returns to the same open session.
            const [sessionRows] = await connection.query(
                'SELECT id, caja_id, estado FROM caja_sesiones WHERE id = ? LIMIT 1 FOR UPDATE',
                [pago.sesion_id]
            );
            const session = sessionRows[0];
            if (!session || session.estado !== 'abierta') {
                throw new GastoError(409, 'La caja de ese pago ya se cerro: registra la devolucion como movimiento manual de caja');
            }
            const [movResult] = await connection.query(
                `INSERT INTO movimientos_caja (caja_id, sesion_id, tipo, monto, descripcion, usuario_id)
                 VALUES (?, ?, 'ingreso', ?, ?, ?)`,
                [session.caja_id, session.id, pago.monto, `Anulacion pago #${pago.id} de ${gasto.codigo}`.slice(0, 255), req.userContext.id]
            );
            await connection.query('UPDATE cajas SET saldo = saldo + ? WHERE id = ?', [pago.monto, session.caja_id]);
            reversaId = movResult.insertId;
        }

        await connection.query(
            `UPDATE pagos_gasto
             SET estado = 'anulado', movimiento_reversa_id = ?, anulado_por = ?, motivo_anulacion = ?, fecha_anulacion = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [reversaId, req.userContext.id, motivo.slice(0, 200), pago.id]
        );
        await connection.query('UPDATE gastos SET monto_pagado = monto_pagado - ? WHERE id = ?', [pago.monto, pago.gasto_id]);
        await connection.commit();

        const [rows] = await pool.query(`${PAGO_GASTO_SELECT_SQL} WHERE p.id = ?`, [pago.id]);
        res.json({ pago: rows[0], gasto: await findGasto(pool, req, pago.gasto_id) });
    } catch (err) {
        await connection.rollback();
        sendGastoError(res, err);
    } finally {
        connection.release();
    }
});

// --- Inventario de equipos y mantenimiento ---
// El administrador gestiona equipos, planes y mantenimientos; cualquier perfil de la sede reporta averias.
const EQUIPO_CATEGORIAS = ['coccion', 'refrigeracion', 'preparacion', 'lavado', 'bar_cafeteria', 'ventilacion', 'electronica', 'mobiliario', 'otro'];
const EQUIPO_AREAS = ['cocina', 'bar', 'salon', 'almacen', 'caja', 'otro'];
const MANTENIMIENTO_TIPOS = ['preventivo', 'correctivo'];
const MANTENIMIENTO_PRIORIDADES = ['baja', 'media', 'alta'];
const MANTENIMIENTO_ACTIVOS = ['programado', 'en_ejecucion'];
const CATEGORIA_GASTO_MANTENIMIENTO = 'Mantenimiento y reparaciones';

class EquipoError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

const sendEquipoError = (res, err) => {
    if (err.status && err.status < 600) return res.status(err.status).json({ error: err.message });
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe un equipo con ese codigo' });
    return res.status(500).json({ error: err.message });
};

const equipoScope = (req, alias) => (isMultisede(req)
    ? { where: '1 = 1', params: [] }
    : { where: `${alias}.sede_id = ?`, params: [req.userContext.sedeUsuarioId] });

const EQUIPO_SELECT_SQL = `
    SELECT e.id, e.sede_id, s.nombre AS sede_nombre, e.almacen_id, al.nombre AS almacen_nombre, e.codigo, e.nombre, e.categoria, e.area, e.marca, e.modelo, e.serie,
           e.proveedor_id, pr.razon_social AS proveedor_nombre, DATE_FORMAT(e.fecha_compra, '%Y-%m-%d') AS fecha_compra,
           e.costo_compra, DATE_FORMAT(e.garantia_hasta, '%Y-%m-%d') AS garantia_hasta,
           (e.garantia_hasta IS NOT NULL AND e.garantia_hasta >= CURDATE()) AS en_garantia,
           e.estado, e.observacion, e.motivo_baja, e.fecha_baja, e.creado_en,
           (SELECT DATE_FORMAT(MIN(m.fecha_programada), '%Y-%m-%d') FROM mantenimientos m
             WHERE m.equipo_id = e.id AND m.estado IN ('programado', 'en_ejecucion')) AS proximo_mantenimiento,
           (SELECT COUNT(*) FROM mantenimientos m WHERE m.equipo_id = e.id AND m.estado IN ('programado', 'en_ejecucion')) AS mantenimientos_pendientes,
           (SELECT COALESCE(SUM(m.costo_material + m.costo_servicio), 0) FROM mantenimientos m
             WHERE m.equipo_id = e.id AND m.estado = 'ejecutado') AS costo_mantenimiento
    FROM equipos e
    JOIN sedes s ON s.id = e.sede_id
    LEFT JOIN almacenes al ON al.id = e.almacen_id
    LEFT JOIN proveedores pr ON pr.id = e.proveedor_id
`;

const MANTENIMIENTO_SELECT_SQL = `
    SELECT m.id, CONCAT('MT-', LPAD(m.id, 6, '0')) AS codigo, m.sede_id, s.nombre AS sede_nombre, m.equipo_id,
           e.codigo AS equipo_codigo, e.nombre AS equipo_nombre, e.area AS equipo_area, e.estado AS equipo_estado,
           m.plan_id, mp.nombre AS plan_nombre, mp.frecuencia_dias, m.tipo, m.estado, m.prioridad,
           DATE_FORMAT(m.fecha_programada, '%Y-%m-%d') AS fecha_programada,
           (m.estado = 'programado' AND m.fecha_programada < CURDATE()) AS vencido,
           m.descripcion, m.reportado_por, ur.nombre AS reportado_por_nombre, m.diagnostico, m.trabajo_realizado, m.tecnico,
           m.proveedor_id, pr.razon_social AS proveedor_nombre, m.fecha_inicio,
           DATE_FORMAT(m.fecha_ejecucion, '%Y-%m-%d') AS fecha_ejecucion, m.costo_material, m.costo_servicio,
           ROUND(m.costo_material + m.costo_servicio, 2) AS costo_total, m.gasto_id,
           CASE WHEN m.gasto_id IS NULL THEN NULL ELSE CONCAT('G-', LPAD(m.gasto_id, 6, '0')) END AS gasto_codigo,
           m.motivo_anulacion, m.usuario_id, u.nombre AS usuario_nombre, m.creado_en
    FROM mantenimientos m
    JOIN equipos e ON e.id = m.equipo_id
    JOIN sedes s ON s.id = m.sede_id
    LEFT JOIN mantenimiento_planes mp ON mp.id = m.plan_id
    LEFT JOIN usuarios ur ON ur.id = m.reportado_por
    LEFT JOIN usuarios u ON u.id = m.usuario_id
    LEFT JOIN proveedores pr ON pr.id = m.proveedor_id
`;

const findEquipo = async (connection, req, id, lock = false) => {
    const scope = equipoScope(req, 'e');
    const [rows] = await connection.query(
        `${EQUIPO_SELECT_SQL} WHERE e.id = ? AND ${scope.where} LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
        [id, ...scope.params]
    );
    return rows[0] || null;
};

const findMantenimiento = async (connection, req, id, lock = false) => {
    const scope = equipoScope(req, 'm');
    const [rows] = await connection.query(
        `${MANTENIMIENTO_SELECT_SQL} WHERE m.id = ? AND ${scope.where} LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
        [id, ...scope.params]
    );
    return rows[0] || null;
};

const registrarHistorial = (connection, mantenimientoId, estado, detalle, usuarioId) => connection.query(
    'INSERT INTO mantenimiento_historial (mantenimiento_id, estado, detalle, usuario_id) VALUES (?, ?, ?, ?)',
    [mantenimientoId, estado, detalle ? String(detalle).slice(0, 1000) : null, usuarioId]
);

const textoOpcional = (value, max) => {
    const clean = String(value ?? '').trim().replace(/\s+/g, ' ');
    return clean ? clean.slice(0, max) : null;
};

const parseEquipoInput = (body) => {
    const data = {
        codigo: textoOpcional(body?.codigo, 30)?.toUpperCase() || null,
        nombre: textoOpcional(body?.nombre, 150),
        categoria: String(body?.categoria || 'otro'),
        area: String(body?.area || 'cocina'),
        marca: textoOpcional(body?.marca, 80),
        modelo: textoOpcional(body?.modelo, 80),
        serie: textoOpcional(body?.serie, 80),
        proveedor_id: body?.proveedor_id ? Number(body.proveedor_id) : null,
        fecha_compra: textoOpcional(body?.fecha_compra, 10),
        costo_compra: body?.costo_compra === '' || body?.costo_compra === undefined || body?.costo_compra === null ? null : roundMoney(body.costo_compra),
        garantia_hasta: textoOpcional(body?.garantia_hasta, 10),
        observacion: textoOpcional(body?.observacion, 500)
    };
    const errors = [];
    if (!data.nombre || data.nombre.length < 3) errors.push('Ingrese el nombre del equipo');
    if (data.codigo && !/^[A-Z0-9-]{2,30}$/.test(data.codigo)) errors.push('El codigo solo admite letras, numeros y guiones');
    if (!EQUIPO_CATEGORIAS.includes(data.categoria)) errors.push('Categoria invalida');
    if (!EQUIPO_AREAS.includes(data.area)) errors.push('Area invalida');
    if (data.fecha_compra && (!isRealDate(data.fecha_compra) || data.fecha_compra > todayLocal())) errors.push('Fecha de compra invalida');
    if (data.garantia_hasta && !isRealDate(data.garantia_hasta)) errors.push('Fecha de garantia invalida');
    if (data.costo_compra !== null && !(data.costo_compra >= 0)) errors.push('Costo de compra invalido');
    return { data, errors };
};

const crearMantenimiento = async (connection, req, { sedeId, equipoId, planId = null, tipo, prioridad = 'media', fecha, descripcion, reportadoPor = null, tecnico = null }) => {
    const [result] = await connection.query(
        `INSERT INTO mantenimientos (sede_id, equipo_id, plan_id, tipo, prioridad, fecha_programada, descripcion, reportado_por, tecnico, usuario_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [sedeId, equipoId, planId, tipo, prioridad, fecha, descripcion.slice(0, 1000), reportadoPor, tecnico, req.userContext.id]
    );
    await registrarHistorial(connection, result.insertId, 'programado', descripcion, req.userContext.id);
    return result.insertId;
};

// Equipos
app.get('/api/equipos/opciones', allowAnyProfile, async (req, res) => {
    try {
        const [proveedores] = await pool.query('SELECT id, razon_social, ruc FROM proveedores ORDER BY razon_social');
        res.json({ categorias: EQUIPO_CATEGORIAS, areas: EQUIPO_AREAS, proveedores });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/equipos', allowAnyProfile, async (req, res) => {
    const { estado, area, categoria, q } = req.query;
    const { sedeFilter, error } = resolveListSede(req);
    if (error) return res.status(400).json({ error });

    const conditions = [];
    const params = [];
    if (sedeFilter) { conditions.push('e.sede_id = ?'); params.push(sedeFilter); }
    if (estado === 'activos') conditions.push("e.estado <> 'baja'");
    else if (['operativo', 'en_mantenimiento', 'averiado', 'baja'].includes(estado)) { conditions.push('e.estado = ?'); params.push(estado); }
    if (EQUIPO_AREAS.includes(area)) { conditions.push('e.area = ?'); params.push(area); }
    if (EQUIPO_CATEGORIAS.includes(categoria)) { conditions.push('e.categoria = ?'); params.push(categoria); }
    if (typeof q === 'string' && q.trim()) {
        const like = `%${q.trim()}%`;
        conditions.push('(e.codigo LIKE ? OR e.nombre LIKE ? OR e.marca LIKE ? OR e.modelo LIKE ? OR e.serie LIKE ?)');
        params.push(like, like, like, like, like);
    }

    try {
        const [equipos] = await pool.query(
            `${EQUIPO_SELECT_SQL} ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY e.estado = 'baja', e.area, e.nombre`,
            params
        );
        const resumen = equipos.reduce((acc, e) => {
            acc[e.estado] = (acc[e.estado] || 0) + 1;
            if (e.estado !== 'baja') {
                acc.total += 1;
                acc.valor_compra += Number(e.costo_compra) || 0;
                if (e.proximo_mantenimiento && e.proximo_mantenimiento < todayLocal()) acc.con_mantenimiento_vencido += 1;
            }
            return acc;
        }, { total: 0, operativo: 0, en_mantenimiento: 0, averiado: 0, baja: 0, valor_compra: 0, con_mantenimiento_vencido: 0 });
        resumen.valor_compra = roundMoney(resumen.valor_compra);
        res.json({ sede_id: sedeFilter, resumen, equipos });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/equipos/:id', allowAnyProfile, async (req, res) => {
    try {
        const equipo = await findEquipo(pool, req, req.params.id);
        if (!equipo) return res.status(404).json({ error: 'Equipo no encontrado' });
        const [planes] = await pool.query(
            `SELECT id, equipo_id, nombre, frecuencia_dias, DATE_FORMAT(proxima_fecha, '%Y-%m-%d') AS proxima_fecha, responsable,
                    instrucciones, activo FROM mantenimiento_planes WHERE equipo_id = ? ORDER BY activo DESC, proxima_fecha`,
            [equipo.id]
        );
        const [mantenimientos] = await pool.query(
            `${MANTENIMIENTO_SELECT_SQL} WHERE m.equipo_id = ? ORDER BY COALESCE(m.fecha_ejecucion, m.fecha_programada) DESC, m.id DESC`,
            [equipo.id]
        );
        res.json({ ...equipo, planes, mantenimientos });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/equipos', allowAdmin, requireSede, async (req, res) => {
    const { data, errors } = parseEquipoInput(req.body);
    if (errors.length > 0) return res.status(400).json({ error: errors.join('. ') });
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        // The equipment is located in a warehouse of the sede (purchases warehouse by default); it moves by transfers.
        let almacenId = await almacenPorDefecto(connection, sedeOf(req), 'compras');
        if (req.body?.almacen_id) {
            const [almRows] = await connection.query('SELECT id FROM almacenes WHERE id = ? AND sede_id = ? AND activo = 1', [req.body.almacen_id, sedeOf(req)]);
            if (almRows.length === 0) throw new EquipoError(400, 'El almacen no pertenece a la sede');
            almacenId = almRows[0].id;
        }
        const [result] = await connection.query(
            `INSERT INTO equipos (sede_id, almacen_id, codigo, nombre, categoria, area, marca, modelo, serie, proveedor_id, fecha_compra,
                                  costo_compra, garantia_hasta, observacion, usuario_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [sedeOf(req), almacenId, data.codigo || `TMP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, data.nombre, data.categoria,
                data.area, data.marca, data.modelo, data.serie, data.proveedor_id, data.fecha_compra, data.costo_compra,
                data.garantia_hasta, data.observacion, req.userContext.id]
        );
        // Without a code of its own the equipment gets a sequential one.
        if (!data.codigo) await connection.query('UPDATE equipos SET codigo = ? WHERE id = ?', [`EQ-${String(result.insertId).padStart(4, '0')}`, result.insertId]);
        await connection.commit();
        res.status(201).json(await findEquipo(pool, req, result.insertId));
    } catch (err) {
        await connection.rollback();
        sendEquipoError(res, err);
    } finally {
        connection.release();
    }
});

app.put('/api/equipos/:id', allowAdmin, async (req, res) => {
    const { data, errors } = parseEquipoInput(req.body);
    const estado = req.body?.estado;
    if (estado !== undefined && !['operativo', 'averiado'].includes(estado)) errors.push('Solo se puede marcar el equipo como operativo o averiado');
    if (errors.length > 0) return res.status(400).json({ error: errors.join('. ') });
    try {
        const equipo = await findEquipo(pool, req, req.params.id);
        if (!equipo) return res.status(404).json({ error: 'Equipo no encontrado' });
        if (equipo.estado === 'baja') return res.status(409).json({ error: 'El equipo esta dado de baja' });
        if (estado && equipo.estado === 'en_mantenimiento') return res.status(409).json({ error: 'El equipo esta en mantenimiento: termine o anule el mantenimiento' });
        await pool.query(
            `UPDATE equipos SET codigo = ?, nombre = ?, categoria = ?, area = ?, marca = ?, modelo = ?, serie = ?, proveedor_id = ?,
                    fecha_compra = ?, costo_compra = ?, garantia_hasta = ?, observacion = ?, estado = COALESCE(?, estado)
             WHERE id = ?`,
            [data.codigo || equipo.codigo, data.nombre, data.categoria, data.area, data.marca, data.modelo, data.serie, data.proveedor_id,
                data.fecha_compra, data.costo_compra, data.garantia_hasta, data.observacion, estado || null, equipo.id]
        );
        res.json(await findEquipo(pool, req, equipo.id));
    } catch (err) {
        sendEquipoError(res, err);
    }
});

app.post('/api/equipos/:id/baja', allowAdmin, async (req, res) => {
    const motivo = String(req.body?.motivo || '').trim();
    if (motivo.length < 3) return res.status(400).json({ error: 'Ingrese el motivo de la baja' });
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const equipo = await findEquipo(connection, req, req.params.id, true);
        if (!equipo) throw new EquipoError(404, 'Equipo no encontrado');
        if (equipo.estado === 'baja') throw new EquipoError(409, 'El equipo ya esta dado de baja');
        const [enCurso] = await connection.query("SELECT COUNT(*) AS total FROM mantenimientos WHERE equipo_id = ? AND estado = 'en_ejecucion'", [equipo.id]);
        if (Number(enCurso[0].total) > 0) throw new EquipoError(409, 'El equipo tiene un mantenimiento en ejecucion: terminelo o anulelo primero');

        // Pending scheduled work no longer applies to an equipment that leaves the inventory.
        const [programados] = await connection.query("SELECT id FROM mantenimientos WHERE equipo_id = ? AND estado = 'programado' FOR UPDATE", [equipo.id]);
        for (const { id } of programados) {
            await connection.query("UPDATE mantenimientos SET estado = 'anulado', motivo_anulacion = 'Equipo dado de baja' WHERE id = ?", [id]);
            await registrarHistorial(connection, id, 'anulado', 'Equipo dado de baja', req.userContext.id);
        }
        await connection.query('UPDATE mantenimiento_planes SET activo = 0 WHERE equipo_id = ?', [equipo.id]);
        await connection.query(
            "UPDATE equipos SET estado = 'baja', motivo_baja = ?, fecha_baja = CURRENT_TIMESTAMP WHERE id = ?",
            [motivo.slice(0, 200), equipo.id]
        );
        await connection.commit();
        res.json(await findEquipo(pool, req, equipo.id));
    } catch (err) {
        await connection.rollback();
        sendEquipoError(res, err);
    } finally {
        connection.release();
    }
});

// Any profile of the sede reports a failure: it becomes a pending corrective maintenance.
app.post('/api/equipos/:id/reportar-falla', allowAnyProfile, async (req, res) => {
    const descripcion = String(req.body?.descripcion || '').trim().replace(/\s+/g, ' ');
    const prioridad = MANTENIMIENTO_PRIORIDADES.includes(req.body?.prioridad) ? req.body.prioridad : 'media';
    const fueraDeServicio = Boolean(req.body?.fuera_de_servicio);
    if (descripcion.length < 5) return res.status(400).json({ error: 'Describa la falla (al menos 5 caracteres)' });
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const equipo = await findEquipo(connection, req, req.params.id, true);
        if (!equipo) throw new EquipoError(404, 'Equipo no encontrado');
        if (equipo.estado === 'baja') throw new EquipoError(409, 'El equipo esta dado de baja');
        const id = await crearMantenimiento(connection, req, {
            sedeId: equipo.sede_id, equipoId: equipo.id, tipo: 'correctivo', prioridad, fecha: todayLocal(),
            descripcion: `Falla reportada: ${descripcion}`, reportadoPor: req.userContext.id
        });
        if (fueraDeServicio && equipo.estado === 'operativo') {
            await connection.query("UPDATE equipos SET estado = 'averiado' WHERE id = ?", [equipo.id]);
        }
        await connection.commit();
        res.status(201).json(await findMantenimiento(pool, req, id));
    } catch (err) {
        await connection.rollback();
        sendEquipoError(res, err);
    } finally {
        connection.release();
    }
});

// Planes de mantenimiento preventivo
const parsePlanInput = (body) => {
    const data = {
        nombre: textoOpcional(body?.nombre, 150),
        frecuencia_dias: Number(body?.frecuencia_dias),
        proxima_fecha: String(body?.proxima_fecha || '').trim(),
        responsable: textoOpcional(body?.responsable, 150),
        instrucciones: textoOpcional(body?.instrucciones, 2000),
        activo: body?.activo === undefined ? true : Boolean(body.activo)
    };
    const errors = [];
    if (!data.nombre || data.nombre.length < 3) errors.push('Ingrese el nombre del plan');
    if (!Number.isInteger(data.frecuencia_dias) || data.frecuencia_dias < 1 || data.frecuencia_dias > 3650) errors.push('La frecuencia debe estar entre 1 y 3650 dias');
    if (!isRealDate(data.proxima_fecha)) errors.push('Ingrese la fecha del proximo mantenimiento');
    return { data, errors };
};

app.post('/api/mantenimiento-planes', allowAdmin, async (req, res) => {
    const { data, errors } = parsePlanInput(req.body);
    if (errors.length > 0) return res.status(400).json({ error: errors.join('. ') });
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const equipo = await findEquipo(connection, req, req.body?.equipo_id, true);
        if (!equipo) throw new EquipoError(404, 'Equipo no encontrado');
        if (equipo.estado === 'baja') throw new EquipoError(409, 'El equipo esta dado de baja');
        const [result] = await connection.query(
            `INSERT INTO mantenimiento_planes (equipo_id, nombre, frecuencia_dias, proxima_fecha, responsable, instrucciones, usuario_id)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [equipo.id, data.nombre, data.frecuencia_dias, data.proxima_fecha, data.responsable, data.instrucciones, req.userContext.id]
        );
        await crearMantenimiento(connection, req, {
            sedeId: equipo.sede_id, equipoId: equipo.id, planId: result.insertId, tipo: 'preventivo', fecha: data.proxima_fecha,
            descripcion: data.instrucciones ? `${data.nombre}: ${data.instrucciones}` : data.nombre, tecnico: data.responsable
        });
        await connection.commit();
        res.status(201).json({ id: result.insertId, equipo_id: equipo.id, ...data });
    } catch (err) {
        await connection.rollback();
        sendEquipoError(res, err);
    } finally {
        connection.release();
    }
});

app.put('/api/mantenimiento-planes/:id', allowAdmin, async (req, res) => {
    const { data, errors } = parsePlanInput(req.body);
    if (errors.length > 0) return res.status(400).json({ error: errors.join('. ') });
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [planRows] = await connection.query('SELECT * FROM mantenimiento_planes WHERE id = ? FOR UPDATE', [req.params.id]);
        const plan = planRows[0];
        if (!plan) throw new EquipoError(404, 'Plan no encontrado');
        const equipo = await findEquipo(connection, req, plan.equipo_id, true);
        if (!equipo) throw new EquipoError(404, 'Plan no encontrado');
        if (equipo.estado === 'baja' && data.activo) throw new EquipoError(409, 'El equipo esta dado de baja');

        await connection.query(
            'UPDATE mantenimiento_planes SET nombre = ?, frecuencia_dias = ?, proxima_fecha = ?, responsable = ?, instrucciones = ?, activo = ? WHERE id = ?',
            [data.nombre, data.frecuencia_dias, data.proxima_fecha, data.responsable, data.instrucciones, data.activo ? 1 : 0, plan.id]
        );
        const [pendiente] = await connection.query(
            "SELECT id, estado FROM mantenimientos WHERE plan_id = ? AND estado IN ('programado', 'en_ejecucion') FOR UPDATE",
            [plan.id]
        );
        const actual = pendiente[0];
        if (!data.activo && actual?.estado === 'programado') {
            await connection.query("UPDATE mantenimientos SET estado = 'anulado', motivo_anulacion = 'Plan desactivado' WHERE id = ?", [actual.id]);
            await registrarHistorial(connection, actual.id, 'anulado', 'Plan desactivado', req.userContext.id);
        } else if (data.activo && actual?.estado === 'programado') {
            await connection.query('UPDATE mantenimientos SET fecha_programada = ?, tecnico = ? WHERE id = ?', [data.proxima_fecha, data.responsable, actual.id]);
        } else if (data.activo && !actual) {
            await crearMantenimiento(connection, req, {
                sedeId: equipo.sede_id, equipoId: equipo.id, planId: plan.id, tipo: 'preventivo', fecha: data.proxima_fecha,
                descripcion: data.instrucciones ? `${data.nombre}: ${data.instrucciones}` : data.nombre, tecnico: data.responsable
            });
        }
        await connection.commit();
        res.json({ id: plan.id, equipo_id: equipo.id, ...data });
    } catch (err) {
        await connection.rollback();
        sendEquipoError(res, err);
    } finally {
        connection.release();
    }
});

// Mantenimientos
app.get('/api/mantenimientos', allowAnyProfile, async (req, res) => {
    const { vista = 'pendientes', desde, hasta, tipo } = req.query;
    const { sedeFilter, error } = resolveListSede(req);
    if (error) return res.status(400).json({ error });

    const conditions = [];
    const params = [];
    if (sedeFilter) { conditions.push('m.sede_id = ?'); params.push(sedeFilter); }
    if (MANTENIMIENTO_TIPOS.includes(tipo)) { conditions.push('m.tipo = ?'); params.push(tipo); }
    let startDate = null;
    let endDate = null;
    if (vista === 'historial') {
        startDate = typeof desde === 'string' && isRealDate(desde) ? desde : todayLocal();
        endDate = typeof hasta === 'string' && isRealDate(hasta) ? hasta : startDate;
        if (startDate > endDate) return res.status(400).json({ error: 'Rango de fechas invalido' });
        conditions.push("m.estado IN ('ejecutado', 'anulado')", 'COALESCE(m.fecha_ejecucion, m.fecha_programada) BETWEEN ? AND ?');
        params.push(startDate, endDate);
    } else {
        conditions.push("m.estado IN ('programado', 'en_ejecucion')");
    }

    try {
        const [mantenimientos] = await pool.query(
            `${MANTENIMIENTO_SELECT_SQL} WHERE ${conditions.join(' AND ')}
             ORDER BY ${vista === 'historial' ? 'COALESCE(m.fecha_ejecucion, m.fecha_programada) DESC' : "m.estado = 'en_ejecucion' DESC, m.fecha_programada ASC, FIELD(m.prioridad, 'alta', 'media', 'baja')"}, m.id`,
            params
        );
        const resumen = mantenimientos.reduce((acc, m) => {
            acc.cantidad += 1;
            if (m.estado === 'programado') acc.programados += 1;
            if (m.estado === 'en_ejecucion') acc.en_ejecucion += 1;
            if (Number(m.vencido)) acc.vencidos += 1;
            if (m.tipo === 'correctivo' && MANTENIMIENTO_ACTIVOS.includes(m.estado)) acc.averias_abiertas += 1;
            if (m.estado === 'ejecutado') { acc.ejecutados += 1; acc.costo_total += Number(m.costo_total); }
            return acc;
        }, { cantidad: 0, programados: 0, en_ejecucion: 0, vencidos: 0, averias_abiertas: 0, ejecutados: 0, costo_total: 0 });
        resumen.costo_total = roundMoney(resumen.costo_total);
        res.json({ vista, periodo: startDate ? { desde: startDate, hasta: endDate } : null, sede_id: sedeFilter, resumen, mantenimientos });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/mantenimientos/:id', allowAnyProfile, async (req, res) => {
    try {
        const mantenimiento = await findMantenimiento(pool, req, req.params.id);
        if (!mantenimiento) return res.status(404).json({ error: 'Mantenimiento no encontrado' });
        const [historial] = await pool.query(
            `SELECT h.id, h.estado, h.detalle, h.fecha, u.nombre AS usuario_nombre
             FROM mantenimiento_historial h LEFT JOIN usuarios u ON u.id = h.usuario_id
             WHERE h.mantenimiento_id = ? ORDER BY h.fecha, h.id`,
            [mantenimiento.id]
        );
        res.json({ ...mantenimiento, historial });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/mantenimientos', allowAdmin, async (req, res) => {
    const tipo = String(req.body?.tipo || '');
    const prioridad = MANTENIMIENTO_PRIORIDADES.includes(req.body?.prioridad) ? req.body.prioridad : 'media';
    const fecha = String(req.body?.fecha_programada || '').trim();
    const descripcion = String(req.body?.descripcion || '').trim().replace(/\s+/g, ' ');
    const errors = [];
    if (!MANTENIMIENTO_TIPOS.includes(tipo)) errors.push('El tipo debe ser preventivo o correctivo');
    if (!isRealDate(fecha)) errors.push('Ingrese la fecha programada');
    if (descripcion.length < 5) errors.push('Describa el mantenimiento');
    if (errors.length > 0) return res.status(400).json({ error: errors.join('. ') });
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const equipo = await findEquipo(connection, req, req.body?.equipo_id, true);
        if (!equipo) throw new EquipoError(404, 'Equipo no encontrado');
        if (equipo.estado === 'baja') throw new EquipoError(409, 'El equipo esta dado de baja');
        const id = await crearMantenimiento(connection, req, {
            sedeId: equipo.sede_id, equipoId: equipo.id, tipo, prioridad, fecha, descripcion, tecnico: textoOpcional(req.body?.tecnico, 150)
        });
        await connection.commit();
        res.status(201).json(await findMantenimiento(pool, req, id));
    } catch (err) {
        await connection.rollback();
        sendEquipoError(res, err);
    } finally {
        connection.release();
    }
});

app.post('/api/mantenimientos/:id/iniciar', allowAdmin, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const mantenimiento = await findMantenimiento(connection, req, req.params.id, true);
        if (!mantenimiento) throw new EquipoError(404, 'Mantenimiento no encontrado');
        if (mantenimiento.estado !== 'programado') throw new EquipoError(409, 'Solo se inicia un mantenimiento programado');
        await connection.query("UPDATE mantenimientos SET estado = 'en_ejecucion', fecha_inicio = CURRENT_TIMESTAMP WHERE id = ?", [mantenimiento.id]);
        await connection.query("UPDATE equipos SET estado = 'en_mantenimiento' WHERE id = ? AND estado <> 'baja'", [mantenimiento.equipo_id]);
        await registrarHistorial(connection, mantenimiento.id, 'en_ejecucion', textoOpcional(req.body?.detalle, 1000), req.userContext.id);
        await connection.commit();
        res.json(await findMantenimiento(pool, req, mantenimiento.id));
    } catch (err) {
        await connection.rollback();
        sendEquipoError(res, err);
    } finally {
        connection.release();
    }
});

app.post('/api/mantenimientos/:id/ejecutar', allowAdmin, async (req, res) => {
    const body = req.body || {};
    const trabajo = textoOpcional(body.trabajo_realizado, 2000);
    const fechaEjecucion = String(body.fecha_ejecucion || todayLocal()).trim();
    const costoMaterial = body.costo_material === '' || body.costo_material === undefined ? 0 : roundMoney(body.costo_material);
    const costoServicio = body.costo_servicio === '' || body.costo_servicio === undefined ? 0 : roundMoney(body.costo_servicio);
    const estadoEquipo = body.estado_equipo === 'averiado' ? 'averiado' : 'operativo';
    const proveedorId = body.proveedor_id ? Number(body.proveedor_id) : null;
    const tecnico = textoOpcional(body.tecnico, 150);
    const errors = [];
    if (!trabajo || trabajo.length < 5) errors.push('Describa el trabajo realizado');
    if (!isRealDate(fechaEjecucion) || fechaEjecucion > todayLocal()) errors.push('La fecha de ejecucion no puede ser futura');
    if (!(costoMaterial >= 0) || !(costoServicio >= 0)) errors.push('Los costos no pueden ser negativos');
    if (body.gasto && !(costoMaterial + costoServicio > 0)) errors.push('Para registrar el gasto ingrese el costo del mantenimiento');
    if (errors.length > 0) return res.status(400).json({ error: errors.join('. ') });

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const mantenimiento = await findMantenimiento(connection, req, req.params.id, true);
        if (!mantenimiento) throw new EquipoError(404, 'Mantenimiento no encontrado');
        if (!MANTENIMIENTO_ACTIVOS.includes(mantenimiento.estado)) throw new EquipoError(409, 'El mantenimiento ya fue ejecutado o anulado');

        // Optional expense for the cost, in the same transaction: if it fails nothing is saved.
        let gastoId = null;
        if (body.gasto) {
            const [catRows] = await connection.query(
                'SELECT id FROM categorias_gasto WHERE nombre = ? AND activo = 1 LIMIT 1',
                [CATEGORIA_GASTO_MANTENIMIENTO]
            );
            if (catRows.length === 0) throw new EquipoError(409, `Active la categoria de gasto "${CATEGORIA_GASTO_MANTENIMIENTO}"`);
            let beneficiario = tecnico || 'Servicio de mantenimiento';
            if (proveedorId) {
                const [prov] = await connection.query('SELECT razon_social FROM proveedores WHERE id = ?', [proveedorId]);
                if (prov.length === 0) throw new EquipoError(400, 'Proveedor no encontrado');
                beneficiario = prov[0].razon_social;
            }
            gastoId = await insertarGasto(connection, req, mantenimiento.sede_id, {
                ...body.gasto,
                categoria_id: catRows[0].id,
                proveedor_id: proveedorId,
                beneficiario,
                fecha: fechaEjecucion,
                descripcion: `Mantenimiento ${mantenimiento.tipo} ${mantenimiento.codigo} - ${mantenimiento.equipo_codigo} ${mantenimiento.equipo_nombre}`,
                importe: roundMoney(costoMaterial + costoServicio)
            });
        }

        await connection.query(
            `UPDATE mantenimientos
             SET estado = 'ejecutado', diagnostico = ?, trabajo_realizado = ?, tecnico = COALESCE(?, tecnico), proveedor_id = ?,
                 fecha_inicio = COALESCE(fecha_inicio, CURRENT_TIMESTAMP), fecha_ejecucion = ?, costo_material = ?, costo_servicio = ?, gasto_id = ?
             WHERE id = ?`,
            [textoOpcional(body.diagnostico, 2000), trabajo, tecnico, proveedorId, fechaEjecucion, costoMaterial, costoServicio, gastoId, mantenimiento.id]
        );
        await connection.query('UPDATE equipos SET estado = ? WHERE id = ? AND estado <> ?', [estadoEquipo, mantenimiento.equipo_id, 'baja']);
        await registrarHistorial(connection, mantenimiento.id, 'ejecutado', trabajo, req.userContext.id);

        // A preventive plan schedules its next maintenance counting from the real execution date.
        if (mantenimiento.plan_id) {
            const [planRows] = await connection.query('SELECT * FROM mantenimiento_planes WHERE id = ? FOR UPDATE', [mantenimiento.plan_id]);
            const plan = planRows[0];
            if (plan && Number(plan.activo)) {
                const proxima = addDaysToDate(fechaEjecucion, plan.frecuencia_dias);
                await connection.query('UPDATE mantenimiento_planes SET proxima_fecha = ? WHERE id = ?', [proxima, plan.id]);
                await crearMantenimiento(connection, req, {
                    sedeId: mantenimiento.sede_id, equipoId: mantenimiento.equipo_id, planId: plan.id, tipo: 'preventivo', fecha: proxima,
                    descripcion: plan.instrucciones ? `${plan.nombre}: ${plan.instrucciones}` : plan.nombre, tecnico: plan.responsable
                });
            }
        }
        await connection.commit();
        res.json(await findMantenimiento(pool, req, mantenimiento.id));
    } catch (err) {
        await connection.rollback();
        if (err instanceof GastoError) return sendGastoError(res, err);
        sendEquipoError(res, err);
    } finally {
        connection.release();
    }
});

app.post('/api/mantenimientos/:id/anular', allowAdmin, async (req, res) => {
    const motivo = String(req.body?.motivo || '').trim();
    if (motivo.length < 3) return res.status(400).json({ error: 'Ingrese el motivo de la anulacion' });
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const mantenimiento = await findMantenimiento(connection, req, req.params.id, true);
        if (!mantenimiento) throw new EquipoError(404, 'Mantenimiento no encontrado');
        if (!MANTENIMIENTO_ACTIVOS.includes(mantenimiento.estado)) throw new EquipoError(409, 'Solo se anula un mantenimiento pendiente');

        await connection.query("UPDATE mantenimientos SET estado = 'anulado', motivo_anulacion = ? WHERE id = ?", [motivo.slice(0, 200), mantenimiento.id]);
        await registrarHistorial(connection, mantenimiento.id, 'anulado', motivo, req.userContext.id);
        if (mantenimiento.estado === 'en_ejecucion') {
            // Work stopped: a corrective job leaves the equipment broken, a preventive one leaves it working.
            await connection.query(
                "UPDATE equipos SET estado = ? WHERE id = ? AND estado = 'en_mantenimiento'",
                [mantenimiento.tipo === 'correctivo' ? 'averiado' : 'operativo', mantenimiento.equipo_id]
            );
        }
        // Skipping a planned maintenance schedules the following one of the plan.
        if (mantenimiento.plan_id) {
            const [planRows] = await connection.query('SELECT * FROM mantenimiento_planes WHERE id = ? FOR UPDATE', [mantenimiento.plan_id]);
            const plan = planRows[0];
            if (plan && Number(plan.activo)) {
                const proxima = addDaysToDate(mantenimiento.fecha_programada, plan.frecuencia_dias);
                await connection.query('UPDATE mantenimiento_planes SET proxima_fecha = ? WHERE id = ?', [proxima, plan.id]);
                await crearMantenimiento(connection, req, {
                    sedeId: mantenimiento.sede_id, equipoId: mantenimiento.equipo_id, planId: plan.id, tipo: 'preventivo', fecha: proxima,
                    descripcion: plan.instrucciones ? `${plan.nombre}: ${plan.instrucciones}` : plan.nombre, tecnico: plan.responsable
                });
            }
        }
        await connection.commit();
        res.json(await findMantenimiento(pool, req, mantenimiento.id));
    } catch (err) {
        await connection.rollback();
        sendEquipoError(res, err);
    } finally {
        connection.release();
    }
});

// --- Almacenes, transferencias y guias de remision ---
// Each sede has warehouses. Transfers move supplies, products and equipment: dispatch takes them out of the
// origin (in transit) and reception adds what arrived to the destination; the difference is recorded as loss.
// Every dispatch issues an internal guide; the electronic sender guide (GRE) goes to SUNAT through the billing API.

class AlmacenError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

const sendAlmacenError = (res, err) => {
    if (err.status && err.status < 600) return res.status(err.status).json({ error: err.message });
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe un registro con ese codigo o numero' });
    return res.status(500).json({ error: err.message });
};

const TIPOS_ITEM = ['insumo', 'producto', 'equipo'];
// SUNAT catalog 20 (motivos de traslado). The sender guide issued "libre" accepts the ones in MOTIVOS_LIBRES; 01 and 04 also come from a sale or a transfer.
const MOTIVOS_TRASLADO = {
    '01': 'Venta', '02': 'Compra', '03': 'Venta con entrega a terceros', '04': 'Traslado entre establecimientos de la misma empresa',
    '05': 'Consignacion', '06': 'Devolucion', '07': 'Recojo de bienes transformados', '13': 'Otros', '14': 'Venta sujeta a confirmacion del comprador',
    '17': 'Traslado de bienes para transformacion'
};
const MOTIVOS_LIBRES = Object.keys(MOTIVOS_TRASLADO);
const DOC_DESTINATARIO = {
    '6': { nombre: 'RUC', regex: /^(10|15|16|17|20)\d{9}$/, mensaje: 'El RUC del destinatario debe tener 11 digitos' },
    '1': { nombre: 'DNI', regex: /^\d{8}$/, mensaje: 'El DNI del destinatario debe tener 8 digitos' },
    '4': { nombre: 'CE', regex: /^[A-Z0-9]{9,12}$/, mensaje: 'El carnet de extranjeria debe tener de 9 a 12 caracteres' },
    '7': { nombre: 'PAS', regex: /^[A-Z0-9]{5,12}$/, mensaje: 'El pasaporte debe tener de 5 a 12 caracteres' }
};
const UBIGEO_REGEX = /^\d{6}$/;
const ESTABLECIMIENTO_REGEX = /^\d{4}$/;
const allowAdminOrKitchenRecibir = requireProfiles('administrador', 'cocina');
const startOfMonth = () => `${todayLocal().slice(0, 8)}01`;

// SUNAT unit codes (catalog 03) for the units used by the restaurant.
const unidadSunat = (unidad) => {
    const u = String(unidad || '').trim().toLowerCase();
    // The unit catalog decides first; the fixed rules below only cover texts that predate it.
    if (unidadesSunatPorTexto.has(u)) return unidadesSunatPorTexto.get(u);
    if (['kg', 'kilo', 'kilos', 'kilogramo', 'kilogramos'].includes(u)) return 'KGM';
    if (['g', 'gr', 'gramo', 'gramos'].includes(u)) return 'GRM';
    if (['l', 'lt', 'litro', 'litros'].includes(u)) return 'LTR';
    if (['ml', 'mililitro', 'mililitros'].includes(u)) return 'MLT';
    if (['caja', 'cajas'].includes(u)) return 'BX';
    if (['paquete', 'paquetes'].includes(u)) return 'PK';
    return 'NIU';
};

const sedeVisible = (req, sedeId) => isMultisede(req) || Number(sedeId) === Number(req.userContext.sedeUsuarioId);

const ALMACEN_SELECT_SQL = `
    SELECT a.id, a.sede_id, s.nombre AS sede_nombre, a.codigo, a.nombre, a.direccion, a.ubigeo, a.cod_establecimiento,
           a.para_ventas, a.para_compras, a.activo, a.creado_en,
           (SELECT COUNT(*) FROM stock_productos sp WHERE sp.almacen_id = a.id AND sp.stock <> 0) AS productos_con_stock,
           (SELECT COUNT(*) FROM stock_insumos si WHERE si.almacen_id = a.id AND si.stock_actual <> 0) AS insumos_con_stock,
           (SELECT COUNT(*) FROM equipos e WHERE e.almacen_id = a.id AND e.estado <> 'baja') AS equipos
    FROM almacenes a
    JOIN sedes s ON s.id = a.sede_id
`;

const findAlmacen = async (connection, id, lock = false) => {
    const [rows] = await connection.query(`${ALMACEN_SELECT_SQL} WHERE a.id = ? LIMIT 1${lock ? ' FOR UPDATE' : ''}`, [id]);
    return rows[0] || null;
};

const parseAlmacenInput = (body) => {
    const data = {
        nombre: textoOpcional(body?.nombre, 120),
        codigo: textoOpcional(body?.codigo, 20)?.toUpperCase() || null,
        direccion: textoOpcional(body?.direccion, 255),
        ubigeo: textoOpcional(body?.ubigeo, 6),
        cod_establecimiento: textoOpcional(body?.cod_establecimiento, 4),
        para_ventas: body?.para_ventas ? 1 : 0,
        para_compras: body?.para_compras ? 1 : 0,
        activo: body?.activo === undefined ? 1 : (body.activo ? 1 : 0)
    };
    const errors = [];
    if (!data.nombre || data.nombre.length < 3) errors.push('Ingrese el nombre del almacen');
    if (data.codigo && !/^[A-Z0-9-]{2,20}$/.test(data.codigo)) errors.push('El codigo solo admite letras, numeros y guiones');
    if (data.ubigeo && !UBIGEO_REGEX.test(data.ubigeo)) errors.push('El ubigeo debe tener 6 digitos');
    if (data.cod_establecimiento && !ESTABLECIMIENTO_REGEX.test(data.cod_establecimiento)) errors.push('El codigo de establecimiento SUNAT tiene 4 digitos (0000 es el domicilio fiscal)');
    return { data, errors };
};

// Only one sales and one purchases warehouse per sede: setting the flag moves it.
const asignarUsosAlmacen = async (connection, sedeId, almacenId, data) => {
    if (data.para_ventas) await connection.query('UPDATE almacenes SET para_ventas = (id = ?) WHERE sede_id = ?', [almacenId, sedeId]);
    if (data.para_compras) await connection.query('UPDATE almacenes SET para_compras = (id = ?) WHERE sede_id = ?', [almacenId, sedeId]);
};

app.get('/api/almacenes', allowAnyProfile, async (req, res) => {
    const { sedeFilter, error } = resolveListSede(req);
    if (error) return res.status(400).json({ error });
    try {
        const [rows] = await pool.query(
            `${ALMACEN_SELECT_SQL} ${sedeFilter ? 'WHERE a.sede_id = ?' : ''} ORDER BY a.sede_id, a.activo DESC, a.para_compras DESC, a.nombre`,
            sedeFilter ? [sedeFilter] : []
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Destinations of a transfer: active warehouses of every sede.
app.get('/api/almacenes/destinos', allowAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query(`${ALMACEN_SELECT_SQL} WHERE a.activo = 1 AND s.estado = 1 ORDER BY s.nombre, a.nombre`);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/almacenes', allowAdmin, requireSede, async (req, res) => {
    const { data, errors } = parseAlmacenInput(req.body);
    if (errors.length > 0) return res.status(400).json({ error: errors.join('. ') });
    const sedeId = sedeOf(req);
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [result] = await connection.query(
            `INSERT INTO almacenes (sede_id, codigo, nombre, direccion, ubigeo, cod_establecimiento, para_ventas, para_compras)
             VALUES (?, ?, ?, ?, ?, ?, 0, 0)`,
            [sedeId, data.codigo || `TMP-${Date.now()}`, data.nombre, data.direccion, data.ubigeo, data.cod_establecimiento]
        );
        if (!data.codigo) await connection.query('UPDATE almacenes SET codigo = ? WHERE id = ?', [`ALM-${String(result.insertId).padStart(3, '0')}`, result.insertId]);
        await asignarUsosAlmacen(connection, sedeId, result.insertId, data);
        await connection.commit();
        res.status(201).json(await findAlmacen(pool, result.insertId));
    } catch (err) {
        await connection.rollback();
        sendAlmacenError(res, err);
    } finally {
        connection.release();
    }
});

app.put('/api/almacenes/:id', allowAdmin, async (req, res) => {
    const { data, errors } = parseAlmacenInput(req.body);
    if (errors.length > 0) return res.status(400).json({ error: errors.join('. ') });
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const almacen = await findAlmacen(connection, req.params.id, true);
        if (!almacen || !sedeVisible(req, almacen.sede_id)) throw new AlmacenError(404, 'Almacen no encontrado');
        if (!data.activo) {
            if (Number(almacen.para_ventas) || Number(almacen.para_compras)) throw new AlmacenError(409, 'Asigne primero otro almacen de ventas/compras para la sede');
            if (Number(almacen.productos_con_stock) || Number(almacen.insumos_con_stock) || Number(almacen.equipos)) {
                throw new AlmacenError(409, 'El almacen tiene stock o equipos: transfieralos antes de desactivarlo');
            }
            const [abiertas] = await connection.query(
                "SELECT COUNT(*) AS total FROM transferencias WHERE estado IN ('borrador', 'en_transito') AND (almacen_origen_id = ? OR almacen_destino_id = ?)",
                [almacen.id, almacen.id]
            );
            if (Number(abiertas[0].total) > 0) throw new AlmacenError(409, 'El almacen tiene transferencias pendientes');
        }
        // Removing the flag from the only sales/purchases warehouse would leave the sede without one.
        if ((Number(almacen.para_ventas) && !data.para_ventas) || (Number(almacen.para_compras) && !data.para_compras)) {
            throw new AlmacenError(409, 'Para cambiar el almacen de ventas o compras, marquelo en otro almacen de la sede');
        }
        await connection.query(
            'UPDATE almacenes SET codigo = ?, nombre = ?, direccion = ?, ubigeo = ?, cod_establecimiento = ?, activo = ? WHERE id = ?',
            [data.codigo || almacen.codigo, data.nombre, data.direccion, data.ubigeo, data.cod_establecimiento, data.activo, almacen.id]
        );
        await asignarUsosAlmacen(connection, almacen.sede_id, almacen.id, data);
        await connection.commit();
        res.json(await findAlmacen(pool, almacen.id));
    } catch (err) {
        await connection.rollback();
        sendAlmacenError(res, err);
    } finally {
        connection.release();
    }
});

/** Stock of a warehouse: supplies, products and the equipment located there. */
const stockDeAlmacen = async (connection, almacenId, soloDisponibles = false) => {
    const [insumos] = await connection.query(
        `SELECT i.id AS item_id, 'insumo' AS tipo_item, i.nombre AS descripcion, i.unidad_medida AS unidad, si.stock_actual AS stock
         FROM stock_insumos si JOIN insumos i ON i.id = si.insumo_id
         WHERE si.almacen_id = ? ${soloDisponibles ? 'AND si.stock_actual > 0' : 'AND si.stock_actual <> 0'} ORDER BY i.nombre`,
        [almacenId]
    );
    const [productos] = await connection.query(
        `SELECT p.id AS item_id, 'producto' AS tipo_item, p.nombre AS descripcion, COALESCE(um.abreviatura, 'Unidad') AS unidad, COALESCE(um.permite_decimales, 0) AS decimales, sp.stock AS stock
         FROM stock_productos sp JOIN productos p ON p.id = sp.producto_id
         LEFT JOIN unidades_medida um ON um.id = p.unidad_id
         WHERE sp.almacen_id = ? ${soloDisponibles ? 'AND sp.stock > 0' : 'AND sp.stock <> 0'} ORDER BY p.nombre`,
        [almacenId]
    );
    // Equipment can be moved when it is not in another open transfer nor under maintenance.
    const [equipos] = await connection.query(
        `SELECT e.id AS item_id, 'equipo' AS tipo_item, CONCAT(e.codigo, ' - ', e.nombre) AS descripcion, 'Unidad' AS unidad, 1 AS stock, e.estado
         FROM equipos e
         WHERE e.almacen_id = ? AND e.estado <> 'baja'
           ${soloDisponibles ? `AND e.estado <> 'en_mantenimiento' AND NOT EXISTS (
                SELECT 1 FROM transferencia_detalle td JOIN transferencias t ON t.id = td.transferencia_id
                WHERE td.tipo_item = 'equipo' AND td.item_id = e.id AND t.estado IN ('borrador', 'en_transito'))` : ''}
         ORDER BY e.codigo`,
        [almacenId]
    );
    return [...insumos, ...productos, ...equipos].map((row) => ({ ...row, stock: Number(row.stock) }));
};

app.get('/api/almacenes/:id/stock', allowAnyProfile, async (req, res) => {
    try {
        const almacen = await findAlmacen(pool, req.params.id);
        if (!almacen || !sedeVisible(req, almacen.sede_id)) return res.status(404).json({ error: 'Almacen no encontrado' });
        res.json({ almacen, items: await stockDeAlmacen(pool, almacen.id, req.query.disponibles === '1') });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Transferencias
const TRANSFERENCIA_SELECT_SQL = `
    SELECT t.id, CONCAT('TR-', LPAD(t.id, 6, '0')) AS codigo, t.estado, t.observacion, t.observacion_recepcion, t.motivo_anulacion,
           t.almacen_origen_id, ao.nombre AS almacen_origen_nombre, ao.direccion AS almacen_origen_direccion,
           t.sede_origen_id, so.nombre AS sede_origen_nombre,
           t.almacen_destino_id, ad.nombre AS almacen_destino_nombre, ad.direccion AS almacen_destino_direccion,
           t.sede_destino_id, sd.nombre AS sede_destino_nombre,
           (t.sede_origen_id = t.sede_destino_id) AS interna,
           t.usuario_id, u.nombre AS usuario_nombre, t.despachado_por, ud.nombre AS despachado_por_nombre, t.fecha_despacho,
           t.recibido_por, ur.nombre AS recibido_por_nombre, t.fecha_recepcion, t.creado_en,
           (SELECT COUNT(*) FROM transferencia_detalle td WHERE td.transferencia_id = t.id) AS lineas,
           (SELECT COUNT(*) FROM transferencia_detalle td WHERE td.transferencia_id = t.id AND td.cantidad_recibida < td.cantidad) AS lineas_con_diferencia
    FROM transferencias t
    JOIN almacenes ao ON ao.id = t.almacen_origen_id
    JOIN almacenes ad ON ad.id = t.almacen_destino_id
    JOIN sedes so ON so.id = t.sede_origen_id
    JOIN sedes sd ON sd.id = t.sede_destino_id
    LEFT JOIN usuarios u ON u.id = t.usuario_id
    LEFT JOIN usuarios ud ON ud.id = t.despachado_por
    LEFT JOIN usuarios ur ON ur.id = t.recibido_por
`;

const transferenciaScope = (req) => (isMultisede(req)
    ? { where: '1 = 1', params: [] }
    : { where: '(t.sede_origen_id = ? OR t.sede_destino_id = ?)', params: [req.userContext.sedeUsuarioId, req.userContext.sedeUsuarioId] });

const findTransferencia = async (connection, req, id, lock = false) => {
    const scope = transferenciaScope(req);
    const [rows] = await connection.query(
        `${TRANSFERENCIA_SELECT_SQL} WHERE t.id = ? AND ${scope.where} LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
        [id, ...scope.params]
    );
    return rows[0] || null;
};

const detalleTransferencia = async (connection, id) => {
    // `decimales`: whether the quantity of the line may have decimals (products follow their unit; supplies always do).
    const [rows] = await connection.query(
        `SELECT td.*, CASE WHEN td.tipo_item = 'producto' THEN COALESCE(um.permite_decimales, 0) WHEN td.tipo_item = 'equipo' THEN 0 ELSE 1 END AS decimales
         FROM transferencia_detalle td
         LEFT JOIN productos p ON td.tipo_item = 'producto' AND p.id = td.item_id
         LEFT JOIN unidades_medida um ON um.id = p.unidad_id
         WHERE td.transferencia_id = ? ORDER BY td.id`,
        [id]
    );
    return rows.map((row) => ({ ...row, decimales: Number(row.decimales) === 1, cantidad: Number(row.cantidad), cantidad_recibida: row.cantidad_recibida === null ? null : Number(row.cantidad_recibida) }));
};

/** Validates the lines against the catalog (descriptions and units are taken from it, never from the client). */
const prepararLineas = async (connection, almacenOrigenId, items) => {
    if (!Array.isArray(items) || items.length === 0) throw new AlmacenError(400, 'Agregue al menos un item a la transferencia');
    const lineas = [];
    const vistos = new Set();
    for (const item of items) {
        const tipo = String(item?.tipo_item || '');
        const itemId = Number(item?.item_id);
        const cantidad = Math.round(Number(item?.cantidad) * 1000) / 1000;
        if (!TIPOS_ITEM.includes(tipo) || !itemId) throw new AlmacenError(400, 'Item invalido');
        if (vistos.has(`${tipo}-${itemId}`)) throw new AlmacenError(400, 'Hay items repetidos en la transferencia');
        vistos.add(`${tipo}-${itemId}`);
        if (!(cantidad > 0)) throw new AlmacenError(400, 'Las cantidades deben ser mayores a 0');
        if (tipo === 'equipo') {
            if (cantidad !== 1) throw new AlmacenError(400, 'Un equipo se transfiere con cantidad 1');
            const [rows] = await connection.query('SELECT codigo, nombre, almacen_id, estado FROM equipos WHERE id = ?', [itemId]);
            const equipo = rows[0];
            if (!equipo || Number(equipo.almacen_id) !== Number(almacenOrigenId)) throw new AlmacenError(400, 'El equipo no esta en el almacen de origen');
            if (equipo.estado === 'baja') throw new AlmacenError(409, `El equipo ${equipo.codigo} esta dado de baja`);
            lineas.push({ tipo_item: tipo, item_id: itemId, descripcion: `${equipo.codigo} - ${equipo.nombre}`, unidad: 'Unidad', cantidad: 1 });
        } else if (tipo === 'insumo') {
            const [rows] = await connection.query('SELECT nombre, unidad_medida FROM insumos WHERE id = ?', [itemId]);
            if (!rows[0]) throw new AlmacenError(400, 'Insumo no encontrado');
            lineas.push({ tipo_item: tipo, item_id: itemId, descripcion: rows[0].nombre, unidad: rows[0].unidad_medida || 'Unidad', cantidad });
        } else {
            const [rows] = await connection.query(
                "SELECT p.nombre, COALESCE(um.abreviatura, 'Unidad') AS unidad, um.permite_decimales FROM productos p LEFT JOIN unidades_medida um ON um.id = p.unidad_id WHERE p.id = ?", [itemId]
            );
            if (!rows[0]) throw new AlmacenError(400, 'Producto no encontrado');
            if (esEntero('producto', rows[0]) && !Number.isInteger(cantidad)) throw new AlmacenError(400, `${rows[0].nombre} se transfiere en unidades enteras`);
            lineas.push({ tipo_item: tipo, item_id: itemId, descripcion: rows[0].nombre, unidad: rows[0].unidad, cantidad });
        }
    }
    return lineas;
};

const guardarLineas = async (connection, transferenciaId, lineas) => {
    await connection.query('DELETE FROM transferencia_detalle WHERE transferencia_id = ?', [transferenciaId]);
    for (const l of lineas) {
        await connection.query(
            'INSERT INTO transferencia_detalle (transferencia_id, tipo_item, item_id, descripcion, unidad, cantidad) VALUES (?, ?, ?, ?, ?, ?)',
            [transferenciaId, l.tipo_item, l.item_id, l.descripcion, l.unidad, l.cantidad]
        );
    }
};

app.get('/api/transferencias', allowAnyProfile, async (req, res) => {
    const { estado, desde, hasta } = req.query;
    const scope = transferenciaScope(req);
    const conditions = [scope.where];
    const params = [...scope.params];
    if (['borrador', 'en_transito', 'recibida', 'anulada'].includes(estado)) { conditions.push('t.estado = ?'); params.push(estado); }
    if (typeof desde === 'string' && isRealDate(desde)) { conditions.push('t.creado_en >= ?'); params.push(desde); }
    if (typeof hasta === 'string' && isRealDate(hasta)) { conditions.push('t.creado_en < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(hasta); }
    try {
        const [rows] = await pool.query(`${TRANSFERENCIA_SELECT_SQL} WHERE ${conditions.join(' AND ')} ORDER BY t.estado = 'en_transito' DESC, t.id DESC`, params);
        const resumen = rows.reduce((acc, t) => { acc[t.estado] = (acc[t.estado] || 0) + 1; return acc; }, { borrador: 0, en_transito: 0, recibida: 0, anulada: 0 });
        res.json({ resumen, transferencias: rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/transferencias/:id', allowAnyProfile, async (req, res) => {
    try {
        const transferencia = await findTransferencia(pool, req, req.params.id);
        if (!transferencia) return res.status(404).json({ error: 'Transferencia no encontrada' });
        const [guias] = await pool.query(
            'SELECT id, tipo, numero_guia, estado, estado_sunat, fecha_emision FROM guias WHERE transferencia_id = ? ORDER BY id',
            [transferencia.id]
        );
        res.json({ ...transferencia, detalle: await detalleTransferencia(pool, transferencia.id), guias });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/transferencias', allowAdmin, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const origen = await findAlmacen(connection, req.body?.almacen_origen_id);
        const destino = await findAlmacen(connection, req.body?.almacen_destino_id);
        if (!origen || !sedeVisible(req, origen.sede_id)) throw new AlmacenError(404, 'Almacen de origen no encontrado');
        if (!destino) throw new AlmacenError(404, 'Almacen de destino no encontrado');
        if (origen.id === destino.id) throw new AlmacenError(400, 'El origen y el destino deben ser distintos');
        if (!Number(origen.activo) || !Number(destino.activo)) throw new AlmacenError(409, 'Los almacenes deben estar activos');
        const lineas = await prepararLineas(connection, origen.id, req.body?.items);
        const [result] = await connection.query(
            `INSERT INTO transferencias (almacen_origen_id, almacen_destino_id, sede_origen_id, sede_destino_id, observacion, usuario_id)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [origen.id, destino.id, origen.sede_id, destino.sede_id, textoOpcional(req.body?.observacion, 500), req.userContext.id]
        );
        await guardarLineas(connection, result.insertId, lineas);
        await connection.commit();
        const transferencia = await findTransferencia(pool, req, result.insertId);
        res.status(201).json({ ...transferencia, detalle: await detalleTransferencia(pool, result.insertId), guias: [] });
    } catch (err) {
        await connection.rollback();
        sendAlmacenError(res, err);
    } finally {
        connection.release();
    }
});

app.put('/api/transferencias/:id', allowAdmin, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const transferencia = await findTransferencia(connection, req, req.params.id, true);
        if (!transferencia || !sedeVisible(req, transferencia.sede_origen_id)) throw new AlmacenError(404, 'Transferencia no encontrada');
        if (transferencia.estado !== 'borrador') throw new AlmacenError(409, 'Solo se edita una transferencia en borrador');
        const lineas = await prepararLineas(connection, transferencia.almacen_origen_id, req.body?.items);
        await connection.query('UPDATE transferencias SET observacion = ? WHERE id = ?', [textoOpcional(req.body?.observacion, 500), transferencia.id]);
        await guardarLineas(connection, transferencia.id, lineas);
        await connection.commit();
        res.json({ ...(await findTransferencia(pool, req, transferencia.id)), detalle: await detalleTransferencia(pool, transferencia.id) });
    } catch (err) {
        await connection.rollback();
        sendAlmacenError(res, err);
    } finally {
        connection.release();
    }
});

app.post('/api/transferencias/:id/anular', allowAdmin, async (req, res) => {
    const motivo = String(req.body?.motivo || '').trim();
    if (motivo.length < 3) return res.status(400).json({ error: 'Ingrese el motivo de la anulacion' });
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const transferencia = await findTransferencia(connection, req, req.params.id, true);
        if (!transferencia || !sedeVisible(req, transferencia.sede_origen_id)) throw new AlmacenError(404, 'Transferencia no encontrada');
        if (transferencia.estado !== 'borrador') throw new AlmacenError(409, 'Solo se anula una transferencia en borrador: una despachada debe recibirse');
        await connection.query("UPDATE transferencias SET estado = 'anulada', motivo_anulacion = ? WHERE id = ?", [motivo.slice(0, 200), transferencia.id]);
        await connection.commit();
        res.json(await findTransferencia(pool, req, transferencia.id));
    } catch (err) {
        await connection.rollback();
        sendAlmacenError(res, err);
    } finally {
        connection.release();
    }
});

const registrarMovimiento = (connection, { almacenId, sedeId, tipo, itemId, cantidad, motivo, transferenciaId, detalle, usuarioId }) => connection.query(
    `INSERT INTO inventario_movimientos (almacen_id, sede_id, tipo_item, item_id, cantidad, motivo, transferencia_id, detalle, usuario_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [almacenId, sedeId, tipo, itemId, cantidad, motivo, transferenciaId, detalle ? String(detalle).slice(0, 255) : null, usuarioId]
);

// The kardex columns arrive with the database migration: until then the listing keeps working without them.
let movimientosConCostosCache = null;
const movimientosConCostos = async () => {
    if (movimientosConCostosCache === true) return true;
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS total FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventario_movimientos' AND COLUMN_NAME IN ('referencia', 'costo_unitario', 'costo_total')`
    );
    movimientosConCostosCache = Number(rows[0].total) === 3;
    return movimientosConCostosCache;
};

// --- Ingresos y egresos manuales de almacen (kardex) ---
const MOTIVOS_MANUALES = {
    ingreso: { ajuste_inventario: 'Ajuste de inventario', donacion: 'Donación / obsequio', devolucion: 'Devolución', stock_inicial: 'Stock inicial', otro: 'Otro' },
    egreso: { merma: 'Merma', consumo_interno: 'Consumo interno', vencimiento: 'Vencimiento / deterioro', ajuste_inventario: 'Ajuste de inventario', otro: 'Otro' }
};

app.post('/api/inventario/movimientos', allowAdmin, async (req, res) => {
    const { almacen_id: almacenId, tipo, tipo_item: tipoItem, item_id: itemId, motivo } = req.body || {};
    const cantidad = Math.round(Number(req.body?.cantidad) * 1000) / 1000;
    const observacion = textoOpcional(req.body?.observacion, 200);
    const connection = await pool.getConnection();
    try {
        if (!MOTIVOS_MANUALES[tipo]) throw new AlmacenError(400, 'Indique si es ingreso o egreso');
        if (!['insumo', 'producto'].includes(tipoItem) || !Number(itemId)) throw new AlmacenError(400, 'Item invalido');
        if (!(cantidad > 0)) throw new AlmacenError(400, 'La cantidad debe ser mayor a 0');
        if (!MOTIVOS_MANUALES[tipo][motivo]) throw new AlmacenError(400, 'Seleccione el motivo del movimiento');

        await connection.beginTransaction();
        const almacen = await findAlmacen(connection, almacenId);
        if (!almacen || !sedeVisible(req, almacen.sede_id)) throw new AlmacenError(404, 'Almacen no encontrado');
        if (!Number(almacen.activo)) throw new AlmacenError(409, 'El almacen esta inactivo');

        const [items] = await connection.query(
            `SELECT t.nombre, um.permite_decimales FROM ${tipoItem === 'insumo' ? 'insumos' : 'productos'} t LEFT JOIN unidades_medida um ON um.id = t.unidad_id WHERE t.id = ?`, [itemId]
        );
        if (!items[0]) throw new AlmacenError(404, 'Item no encontrado');
        if (esEntero(tipoItem, items[0]) && !Number.isInteger(cantidad)) throw new AlmacenError(400, `${items[0].nombre} se mueve en unidades enteras`);

        const delta = tipo === 'ingreso' ? cantidad : -cantidad;
        if (tipo === 'egreso') {
            // The row is locked so two exits cannot take the same stock.
            const { table, column, amount } = STOCK_TABLES[tipoItem];
            const [rows] = await connection.query(`SELECT ${amount} AS stock FROM ${table} WHERE almacen_id = ? AND ${column} = ? FOR UPDATE`, [almacen.id, itemId]);
            const disponible = Number(rows[0]?.stock || 0);
            if (disponible < cantidad) throw new AlmacenError(409, `Stock insuficiente de ${items[0].nombre} en ${almacen.nombre}: hay ${disponible}`);
        }
        await adjustStockAlmacen(connection, tipoItem, almacen.id, almacen.sede_id, itemId, delta);
        await registrarMovimiento(connection, {
            almacenId: almacen.id, sedeId: almacen.sede_id, tipo: tipoItem, itemId, cantidad: delta,
            motivo: `${tipo}_manual`, transferenciaId: null,
            detalle: `${MOTIVOS_MANUALES[tipo][motivo]}${observacion ? `: ${observacion}` : ''}`, usuarioId: req.userContext.id
        });
        await connection.commit();
        res.status(201).json({ message: `${tipo === 'ingreso' ? 'Ingreso' : 'Egreso'} registrado`, item: items[0].nombre, cantidad: delta });
    } catch (err) {
        await connection.rollback();
        sendAlmacenError(res, err);
    } finally {
        connection.release();
    }
});

// Registro de movimientos por lote (como el modulo de movimientos de Cealka): una entrada, una salida o un ajuste
// de varios items en un almacen, con referencia (N° de guia, orden de compra o motivo).
//   entrada: suma al almacen; con costo unitario (solo insumos) recalcula el costo promedio del insumo.
//   salida:  resta del almacen y no permite dejarlo en negativo.
//   ajuste:  el sistema toma el stock real del almacen y registra la diferencia contra el conteo fisico.
app.post('/api/inventario/movimientos/lote', allowAdmin, async (req, res) => {
    const { almacen_id: almacenId, tipo } = req.body || {};
    const referencia = String(req.body?.referencia ?? '').trim().replace(/\s+/g, ' ');
    const motivoClave = String(req.body?.motivo ?? '').trim();
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const connection = await pool.getConnection();
    try {
        if (!['entrada', 'salida', 'ajuste'].includes(tipo)) throw new AlmacenError(400, 'Indique si es entrada, salida o ajuste');
        // La referencia es opcional en entradas y salidas; en ajustes sigue siendo obligatoria.
        if (referencia.length > 100 || (tipo === 'ajuste' && referencia.length < 3)) throw new AlmacenError(400, 'Ingrese la referencia (N° de guia, orden de compra o motivo)');
        if (items.length === 0 || items.length > 100) throw new AlmacenError(400, 'Agregue entre 1 y 100 items al movimiento');
        const motivoTexto = tipo === 'ajuste' ? 'Ajuste de inventario' : MOTIVOS_MANUALES[tipo === 'entrada' ? 'ingreso' : 'egreso'][motivoClave];
        if (!motivoTexto) throw new AlmacenError(400, 'Seleccione el motivo del movimiento');
        const vistos = new Set();
        for (const item of items) {
            const clave = `${item?.tipo_item}-${Number(item?.item_id)}`;
            if (!['insumo', 'producto'].includes(item?.tipo_item) || !(Number(item?.item_id) > 0)) throw new AlmacenError(400, 'Hay un item invalido en el movimiento');
            if (vistos.has(clave)) throw new AlmacenError(400, 'Hay items repetidos: junta las cantidades en una sola fila');
            vistos.add(clave);
        }

        await connection.beginTransaction();
        const almacen = await findAlmacen(connection, almacenId);
        if (!almacen || !sedeVisible(req, almacen.sede_id)) throw new AlmacenError(404, 'Almacen no encontrado');
        if (!Number(almacen.activo)) throw new AlmacenError(409, 'El almacen esta inactivo');

        const registrados = [];
        for (const item of items) {
            const tipoItem = item.tipo_item;
            const itemId = Number(item.item_id);
            const [catalogo] = await connection.query(
                tipoItem === 'insumo'
                    ? 'SELECT i.nombre, i.costo_unitario, i.unidad_id, um.permite_decimales FROM insumos i LEFT JOIN unidades_medida um ON um.id = i.unidad_id WHERE i.id = ?'
                    : 'SELECT p.nombre, p.unidad_id, um.permite_decimales FROM productos p LEFT JOIN unidades_medida um ON um.id = p.unidad_id WHERE p.id = ?',
                [itemId]
            );
            if (!catalogo[0]) throw new AlmacenError(404, 'Un item del movimiento ya no existe en el catalogo');
            const nombre = catalogo[0].nombre;
            const { table, column, amount } = STOCK_TABLES[tipoItem];
            const [filas] = await connection.query(`SELECT ${amount} AS stock FROM ${table} WHERE almacen_id = ? AND ${column} = ? FOR UPDATE`, [almacen.id, itemId]);
            const actual = Number(filas[0]?.stock || 0);
            // Adjustments count the stock unit; entries and exits may be typed in another unit that converts to it.
            const entero = esEntero(tipoItem, catalogo[0]);

            let delta;
            let costoUnitario = null;
            if (tipo === 'ajuste') {
                const fisico = Math.round(Number(item.cantidad_fisica) * 1000) / 1000;
                if (!(fisico >= 0)) throw new AlmacenError(400, `Ingrese el conteo fisico de ${nombre}`);
                if (entero && !Number.isInteger(fisico)) throw new AlmacenError(400, `${nombre} se cuenta en unidades enteras`);
                delta = Math.round((fisico - actual) * 1000) / 1000;
                if (delta === 0) continue;
            } else {
                const cantidadIngresada = Math.round(Number(item.cantidad) * 1000) / 1000;
                if (!(cantidadIngresada > 0)) throw new AlmacenError(400, `La cantidad de ${nombre} debe ser mayor a 0`);
                const linea = await unidadDeLinea(connection, tipoItem, catalogo[0], item.unidad_id, nombre);
                if (linea.entero && !Number.isInteger(cantidadIngresada)) throw new AlmacenError(400, `${nombre} se mueve en unidades enteras`);
                const cantidad = Math.round(cantidadIngresada * linea.factor * 1000) / 1000;
                if (tipo === 'salida') {
                    if (actual < cantidad) throw new AlmacenError(409, `Stock insuficiente de ${nombre} en ${almacen.nombre}: hay ${actual}`);
                    delta = -cantidad;
                } else {
                    delta = cantidad;
                    const costoIngresado = item.costo_unitario === undefined || item.costo_unitario === null || item.costo_unitario === '' ? null : Number(item.costo_unitario);
                    if (costoIngresado !== null && !(costoIngresado >= 0)) throw new AlmacenError(400, `El costo de ${nombre} no es valido`);
                    // The cost is typed per unit of the line; the supply keeps it per stock unit.
                    const costo = costoIngresado === null ? null : Math.round((costoIngresado / linea.factor) * 10000) / 10000;
                    if (tipoItem === 'insumo' && costo > 0) {
                        costoUnitario = costo;
                        // Weighted average over the stock of the supply in every warehouse, before this entry.
                        const [total] = await connection.query('SELECT COALESCE(SUM(stock_actual), 0) AS stock FROM stock_insumos WHERE insumo_id = ?', [itemId]);
                        const previo = Math.max(0, Number(total[0].stock));
                        const promedio = previo > 0 ? ((previo * Number(catalogo[0].costo_unitario || 0)) + (cantidad * costo)) / (previo + cantidad) : costo;
                        await connection.query('UPDATE insumos SET costo_unitario = ? WHERE id = ?', [round2(promedio), itemId]);
                    }
                }
            }

            await adjustStockAlmacen(connection, tipoItem, almacen.id, almacen.sede_id, itemId, delta);
            await connection.query(
                `INSERT INTO inventario_movimientos (almacen_id, sede_id, tipo_item, item_id, cantidad, motivo, detalle, referencia, costo_unitario, costo_total, usuario_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [almacen.id, almacen.sede_id, tipoItem, itemId, delta, tipo === 'entrada' ? 'ingreso_manual' : tipo === 'salida' ? 'egreso_manual' : 'ajuste_manual',
                    motivoTexto, referencia || null, costoUnitario, costoUnitario === null ? null : round2(costoUnitario * delta), req.userContext.id]
            );
            registrados.push({ item: nombre, cantidad: delta });
        }
        if (registrados.length === 0) throw new AlmacenError(409, 'El conteo fisico coincide con el stock del sistema: no hay diferencias que ajustar');
        await connection.commit();
        res.status(201).json({ message: `${tipo === 'entrada' ? 'Entrada' : tipo === 'salida' ? 'Salida' : 'Ajuste'} registrada`, items: registrados.length, detalle: registrados });
    } catch (err) {
        await connection.rollback();
        sendAlmacenError(res, err);
    } finally {
        connection.release();
    }
});

app.get('/api/inventario/movimientos', allowAnyProfile, async (req, res) => {
    const { sedeFilter, error } = resolveListSede(req);
    if (error) return res.status(400).json({ error });
    const { almacen_id: almacenId, desde, hasta, tipo_item: tipoItem, motivo } = req.query;
    const conditions = [];
    const params = [];
    if (sedeFilter) { conditions.push('m.sede_id = ?'); params.push(sedeFilter); }
    if (Number(almacenId)) { conditions.push('m.almacen_id = ?'); params.push(Number(almacenId)); }
    if (['insumo', 'producto', 'equipo'].includes(tipoItem)) { conditions.push('m.tipo_item = ?'); params.push(tipoItem); }
    if (['transferencia_salida', 'transferencia_entrada', 'merma_transferencia', 'ingreso_manual', 'egreso_manual', 'venta', 'anulacion_venta', 'ajuste_manual', 'compra'].includes(motivo)) { conditions.push('m.motivo = ?'); params.push(motivo); }
    if (typeof desde === 'string' && isRealDate(desde)) { conditions.push('m.fecha >= ?'); params.push(desde); }
    if (typeof hasta === 'string' && isRealDate(hasta)) { conditions.push('m.fecha < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(hasta); }
    try {
        const [rows] = await pool.query(
            `SELECT m.id, m.fecha, m.motivo, m.tipo_item, m.item_id, m.cantidad, m.detalle,
                    ${(await movimientosConCostos()) ? 'm.referencia, m.costo_unitario, m.costo_total,' : ''}
                    a.nombre AS almacen_nombre, s.nombre AS sede_nombre, u.nombre AS usuario_nombre,
                    CASE m.tipo_item WHEN 'insumo' THEN i.nombre WHEN 'producto' THEN p.nombre ELSE e.nombre END AS item_nombre,
                    CASE m.tipo_item WHEN 'insumo' THEN i.unidad_medida WHEN 'producto' THEN COALESCE(pu.abreviatura, 'Unidad') ELSE 'Unidad' END AS unidad
             FROM inventario_movimientos m
             LEFT JOIN unidades_medida pu ON pu.id = (SELECT unidad_id FROM productos WHERE id = m.item_id AND m.tipo_item = 'producto')
             JOIN almacenes a ON a.id = m.almacen_id
             JOIN sedes s ON s.id = m.sede_id
             LEFT JOIN usuarios u ON u.id = m.usuario_id
             LEFT JOIN insumos i ON m.tipo_item = 'insumo' AND i.id = m.item_id
             LEFT JOIN productos p ON m.tipo_item = 'producto' AND p.id = m.item_id
             LEFT JOIN equipos e ON m.tipo_item = 'equipo' AND e.id = m.item_id
             ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
             ORDER BY m.fecha DESC, m.id DESC LIMIT 500`,
            params
        );
        res.json(rows.map((r) => ({ ...r, cantidad: Number(r.cantidad), costo_unitario: r.costo_unitario == null ? null : Number(r.costo_unitario), costo_total: r.costo_total == null ? null : Number(r.costo_total) })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const siguienteCorrelativo = async (connection, sedeId, tipo) => {
    const [rows] = await connection.query('SELECT serie, siguiente_numero FROM correlativos WHERE sede_id = ? AND tipo = ? FOR UPDATE', [sedeId, tipo]);
    if (rows.length === 0) throw new AlmacenError(409, `No hay serie configurada para ${tipo.replace('_', ' ')} en la sede`);
    await connection.query('UPDATE correlativos SET siguiente_numero = siguiente_numero + 1 WHERE sede_id = ? AND tipo = ?', [sedeId, tipo]);
    return { serie: rows[0].serie, numero: rows[0].siguiente_numero, numeroGuia: `${rows[0].serie}-${String(rows[0].siguiente_numero).padStart(8, '0')}` };
};

const insertarGuia = async (connection, req, guia, items) => {
    const [result] = await connection.query(
        `INSERT INTO guias (sede_id, almacen_id, tipo, origen, transferencia_id, factura_id, serie, numero, numero_guia, fecha_emision,
            fecha_traslado, motivo_traslado, partida_direccion, partida_ubigeo, partida_establecimiento, llegada_direccion, llegada_ubigeo,
            llegada_establecimiento, destinatario_tipo_doc, destinatario_num_doc, destinatario_nombre, modalidad, peso_bruto, unidad_peso,
            bultos, placa, conductor_dni, conductor_nombres, conductor_apellidos, conductor_licencia, transportista_ruc, transportista_nombre,
            transportista_mtc, comentario, observaciones, estado_sunat, ambiente, nubefact_payload, empresa_snapshot, usuario_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [guia.sede_id, guia.almacen_id, guia.tipo, guia.origen, guia.transferencia_id || null, guia.factura_id || null, guia.serie, guia.numero,
            guia.numero_guia, guia.fecha_emision, guia.fecha_traslado, guia.motivo_traslado || null, guia.partida_direccion, guia.partida_ubigeo || null,
            guia.partida_establecimiento || null, guia.llegada_direccion, guia.llegada_ubigeo || null, guia.llegada_establecimiento || null,
            guia.destinatario_tipo_doc || null, guia.destinatario_num_doc || null, guia.destinatario_nombre || null, guia.modalidad || null,
            guia.peso_bruto || null, guia.unidad_peso || null, guia.bultos || null, guia.placa || null, guia.conductor_dni || null,
            guia.conductor_nombres || null, guia.conductor_apellidos || null, guia.conductor_licencia || null, guia.transportista_ruc || null,
            guia.transportista_nombre || null, guia.transportista_mtc || null, guia.comentario || null, guia.observaciones || null,
            guia.estado_sunat || 'no_aplica', guia.ambiente || null, guia.payload ? JSON.stringify(guia.payload) : null,
            JSON.stringify(guia.empresa_snapshot || null), req.userContext.id]
    );
    for (const item of items) {
        await connection.query(
            'INSERT INTO guia_detalle (guia_id, codigo, descripcion, cantidad, unidad_medida) VALUES (?, ?, ?, ?, ?)',
            [result.insertId, item.codigo || null, String(item.descripcion).slice(0, 250), item.cantidad, item.unidad_medida || 'NIU']
        );
    }
    return result.insertId;
};

const empresaParaGuia = async (connection, sedeId) => {
    const config = await getEmpresaConfig(connection);
    const [sedeRows] = await connection.query('SELECT direccion, telefono FROM sedes WHERE id = ?', [sedeId]);
    return {
        config,
        snapshot: {
            ruc: config.ruc, razon_social: config.razon_social, nombre_comercial: config.nombre_comercial,
            direccion: sedeRows[0]?.direccion || config.direccion, telefono: sedeRows[0]?.telefono || config.telefono
        }
    };
};

const codigoItem = (tipo, id) => `${{ insumo: 'I', producto: 'P', equipo: 'E' }[tipo]}${id}`;

app.post('/api/transferencias/:id/despachar', allowAdmin, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const transferencia = await findTransferencia(connection, req, req.params.id, true);
        if (!transferencia || !sedeVisible(req, transferencia.sede_origen_id)) throw new AlmacenError(404, 'Transferencia no encontrada');
        if (transferencia.estado !== 'borrador') throw new AlmacenError(409, 'La transferencia ya fue despachada o anulada');
        const detalle = await detalleTransferencia(connection, transferencia.id);
        const sedeOrigen = transferencia.sede_origen_id;

        for (const linea of detalle) {
            if (linea.tipo_item === 'equipo') {
                const [rows] = await connection.query('SELECT codigo, almacen_id, estado FROM equipos WHERE id = ? FOR UPDATE', [linea.item_id]);
                const equipo = rows[0];
                if (!equipo || Number(equipo.almacen_id) !== Number(transferencia.almacen_origen_id) || equipo.estado === 'baja') {
                    throw new AlmacenError(409, `El equipo ${linea.descripcion} ya no esta disponible en el almacen de origen`);
                }
                if (equipo.estado === 'en_mantenimiento') throw new AlmacenError(409, `El equipo ${equipo.codigo} esta en mantenimiento`);
                const [otras] = await connection.query(
                    `SELECT COUNT(*) AS total FROM transferencia_detalle td JOIN transferencias t ON t.id = td.transferencia_id
                     WHERE td.tipo_item = 'equipo' AND td.item_id = ? AND t.estado = 'en_transito'`,
                    [linea.item_id]
                );
                if (Number(otras[0].total) > 0) throw new AlmacenError(409, `El equipo ${equipo.codigo} ya esta en transito`);
            } else {
                // The origin row is locked so two dispatches cannot take the same stock.
                const { table, column, amount } = STOCK_TABLES[linea.tipo_item];
                const [rows] = await connection.query(
                    `SELECT ${amount} AS stock FROM ${table} WHERE almacen_id = ? AND ${column} = ? FOR UPDATE`,
                    [transferencia.almacen_origen_id, linea.item_id]
                );
                const disponible = Number(rows[0]?.stock || 0);
                if (disponible < linea.cantidad) {
                    throw new AlmacenError(409, `Stock insuficiente de ${linea.descripcion} en ${transferencia.almacen_origen_nombre}: hay ${disponible}`);
                }
                await adjustStockAlmacen(connection, linea.tipo_item, transferencia.almacen_origen_id, sedeOrigen, linea.item_id, -linea.cantidad);
            }
            await registrarMovimiento(connection, {
                almacenId: transferencia.almacen_origen_id, sedeId: sedeOrigen, tipo: linea.tipo_item, itemId: linea.item_id,
                cantidad: -linea.cantidad, motivo: 'transferencia_salida', transferenciaId: transferencia.id,
                detalle: `Hacia ${transferencia.almacen_destino_nombre}`, usuarioId: req.userContext.id
            });
        }

        await connection.query(
            "UPDATE transferencias SET estado = 'en_transito', despachado_por = ?, fecha_despacho = CURRENT_TIMESTAMP WHERE id = ?",
            [req.userContext.id, transferencia.id]
        );

        // Internal guide that travels with the goods (not declared to SUNAT).
        const { snapshot } = await empresaParaGuia(connection, sedeOrigen);
        const correlativo = await siguienteCorrelativo(connection, sedeOrigen, 'guia_interna');
        const hoy = todayLocal();
        await insertarGuia(connection, req, {
            sede_id: sedeOrigen, almacen_id: transferencia.almacen_origen_id, tipo: 'interna', origen: 'transferencia',
            transferencia_id: transferencia.id, serie: correlativo.serie, numero: correlativo.numero, numero_guia: correlativo.numeroGuia,
            fecha_emision: hoy, fecha_traslado: hoy,
            partida_direccion: `${transferencia.almacen_origen_nombre} (${transferencia.sede_origen_nombre}) - ${transferencia.almacen_origen_direccion || 'sin direccion'}`.slice(0, 255),
            llegada_direccion: `${transferencia.almacen_destino_nombre} (${transferencia.sede_destino_nombre}) - ${transferencia.almacen_destino_direccion || 'sin direccion'}`.slice(0, 255),
            destinatario_nombre: `${transferencia.almacen_destino_nombre} - ${transferencia.sede_destino_nombre}`,
            comentario: `Transferencia ${transferencia.codigo}${transferencia.observacion ? `: ${transferencia.observacion}` : ''}`,
            empresa_snapshot: snapshot
        }, detalle.map((l) => ({ codigo: codigoItem(l.tipo_item, l.item_id), descripcion: l.descripcion, cantidad: l.cantidad, unidad_medida: unidadSunat(l.unidad) })));

        await connection.commit();
        const actualizada = await findTransferencia(pool, req, transferencia.id);
        const [guias] = await pool.query('SELECT id, tipo, numero_guia, estado, estado_sunat FROM guias WHERE transferencia_id = ?', [transferencia.id]);
        res.json({ ...actualizada, detalle: await detalleTransferencia(pool, transferencia.id), guias });
    } catch (err) {
        await connection.rollback();
        sendAlmacenError(res, err);
    } finally {
        connection.release();
    }
});

app.post('/api/transferencias/:id/recibir', allowAdminOrKitchenRecibir, async (req, res) => {
    const lineasInput = Array.isArray(req.body?.lineas) ? req.body.lineas : [];
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const transferencia = await findTransferencia(connection, req, req.params.id, true);
        if (!transferencia || !sedeVisible(req, transferencia.sede_destino_id)) throw new AlmacenError(404, 'Transferencia no encontrada');
        if (transferencia.estado !== 'en_transito') throw new AlmacenError(409, 'Solo se recibe una transferencia en transito');
        const detalle = await detalleTransferencia(connection, transferencia.id);
        const sedeDestino = transferencia.sede_destino_id;

        for (const linea of detalle) {
            const input = lineasInput.find((l) => Number(l.detalle_id) === Number(linea.id));
            const recibida = input && input.cantidad_recibida !== undefined && input.cantidad_recibida !== '' ? Math.round(Number(input.cantidad_recibida) * 1000) / 1000 : linea.cantidad;
            const motivo = textoOpcional(input?.motivo_diferencia, 200);
            if (!(recibida >= 0) || recibida > linea.cantidad) throw new AlmacenError(400, `Cantidad recibida invalida para ${linea.descripcion} (enviado ${linea.cantidad})`);
            if (linea.tipo_item === 'equipo' && ![0, 1].includes(recibida)) throw new AlmacenError(400, 'Un equipo se recibe completo (1) o no se recibe (0)');
            if (linea.tipo_item === 'producto' && !Number.isInteger(recibida)) {
                const [unidadProducto] = await connection.query(
                    'SELECT um.permite_decimales FROM productos p LEFT JOIN unidades_medida um ON um.id = p.unidad_id WHERE p.id = ?', [linea.item_id]
                );
                if (esEntero('producto', unidadProducto[0] || {})) throw new AlmacenError(400, `${linea.descripcion} se recibe en unidades enteras`);
            }
            const diferencia = Math.round((linea.cantidad - recibida) * 1000) / 1000;
            if (diferencia > 0 && (!motivo || motivo.length < 3)) throw new AlmacenError(400, `Indique el motivo de la diferencia de ${linea.descripcion}`);

            if (linea.tipo_item === 'equipo') {
                if (recibida === 1) {
                    await connection.query('UPDATE equipos SET sede_id = ?, almacen_id = ? WHERE id = ?', [sedeDestino, transferencia.almacen_destino_id, linea.item_id]);
                    // Pending maintenance follows the equipment to its new sede.
                    await connection.query("UPDATE mantenimientos SET sede_id = ? WHERE equipo_id = ? AND estado IN ('programado', 'en_ejecucion')", [sedeDestino, linea.item_id]);
                } else {
                    await connection.query(
                        "UPDATE equipos SET estado = 'baja', motivo_baja = ?, fecha_baja = CURRENT_TIMESTAMP WHERE id = ?",
                        [`No recibido en ${transferencia.codigo}: ${motivo}`.slice(0, 200), linea.item_id]
                    );
                    await connection.query("UPDATE mantenimientos SET estado = 'anulado', motivo_anulacion = 'Equipo no recibido en transferencia' WHERE equipo_id = ? AND estado = 'programado'", [linea.item_id]);
                    await connection.query('UPDATE mantenimiento_planes SET activo = 0 WHERE equipo_id = ?', [linea.item_id]);
                }
            } else if (recibida > 0) {
                await adjustStockAlmacen(connection, linea.tipo_item, transferencia.almacen_destino_id, sedeDestino, linea.item_id, recibida);
            }
            if (recibida > 0) {
                await registrarMovimiento(connection, {
                    almacenId: transferencia.almacen_destino_id, sedeId: sedeDestino, tipo: linea.tipo_item, itemId: linea.item_id,
                    cantidad: recibida, motivo: 'transferencia_entrada', transferenciaId: transferencia.id,
                    detalle: `Desde ${transferencia.almacen_origen_nombre}`, usuarioId: req.userContext.id
                });
            }
            if (diferencia > 0) {
                await registrarMovimiento(connection, {
                    almacenId: transferencia.almacen_destino_id, sedeId: sedeDestino, tipo: linea.tipo_item, itemId: linea.item_id,
                    cantidad: -diferencia, motivo: 'merma_transferencia', transferenciaId: transferencia.id, detalle: motivo, usuarioId: req.userContext.id
                });
            }
            await connection.query('UPDATE transferencia_detalle SET cantidad_recibida = ?, motivo_diferencia = ? WHERE id = ?', [recibida, diferencia > 0 ? motivo : null, linea.id]);
        }

        await connection.query(
            "UPDATE transferencias SET estado = 'recibida', recibido_por = ?, fecha_recepcion = CURRENT_TIMESTAMP, observacion_recepcion = ? WHERE id = ?",
            [req.userContext.id, textoOpcional(req.body?.observacion, 500), transferencia.id]
        );
        // The internal guide of the transfer gets its receipt signature.
        await connection.query(
            "UPDATE guias SET estado = 'recibida', cargo = ?, cargo_por = ?, cargo_fecha = CURRENT_TIMESTAMP WHERE transferencia_id = ? AND tipo = 'interna' AND estado = 'emitida'",
            [`Recibido por ${req.userContext.nombre} en ${transferencia.almacen_destino_nombre}`, req.userContext.id, transferencia.id]
        );
        await connection.commit();
        res.json({ ...(await findTransferencia(pool, req, transferencia.id)), detalle: await detalleTransferencia(pool, transferencia.id) });
    } catch (err) {
        await connection.rollback();
        sendAlmacenError(res, err);
    } finally {
        connection.release();
    }
});

// Guias (internas y remitente electronica)
const GUIA_SELECT_SQL = `
    SELECT g.*, DATE_FORMAT(g.fecha_emision, '%Y-%m-%d') AS fecha_emision, DATE_FORMAT(g.fecha_traslado, '%Y-%m-%d') AS fecha_traslado,
           s.nombre AS sede_nombre, a.nombre AS almacen_nombre, u.nombre AS usuario_nombre, uc.nombre AS cargo_por_nombre,
           CASE WHEN g.transferencia_id IS NULL THEN NULL ELSE CONCAT('TR-', LPAD(g.transferencia_id, 6, '0')) END AS transferencia_codigo,
           f.numero_comprobante AS factura_numero, f.tipo_comprobante AS factura_tipo
    FROM guias g
    JOIN sedes s ON s.id = g.sede_id
    LEFT JOIN almacenes a ON a.id = g.almacen_id
    LEFT JOIN usuarios u ON u.id = g.usuario_id
    LEFT JOIN usuarios uc ON uc.id = g.cargo_por
    LEFT JOIN facturas f ON f.id = g.factura_id
`;

const guiaScope = (req) => (isMultisede(req) ? { where: '1 = 1', params: [] } : { where: 'g.sede_id = ?', params: [req.userContext.sedeUsuarioId] });

const findGuia = async (connection, req, id, lock = false) => {
    const scope = guiaScope(req);
    const [rows] = await connection.query(`${GUIA_SELECT_SQL} WHERE g.id = ? AND ${scope.where} LIMIT 1${lock ? ' FOR UPDATE' : ''}`, [id, ...scope.params]);
    if (!rows[0]) return null;
    const { nubefact_payload: _payload, nubefact_respuesta: _respuesta, ...guia } = rows[0];
    return guia;
};

const findGuiaDetalle = async (req, id) => {
    const guia = await findGuia(pool, req, id);
    if (!guia) return null;
    const [items] = await pool.query('SELECT codigo, descripcion, cantidad, unidad_medida FROM guia_detalle WHERE guia_id = ? ORDER BY id', [id]);
    return { ...guia, items: items.map((i) => ({ ...i, cantidad: Number(i.cantidad) })) };
};

app.get('/api/guias', allowAdmin, async (req, res) => {
    const { tipo, desde, hasta, q } = req.query;
    const { sedeFilter, error } = resolveListSede(req);
    if (error) return res.status(400).json({ error });
    const startDate = typeof desde === 'string' && isRealDate(desde) ? desde : startOfMonth();
    const endDate = typeof hasta === 'string' && isRealDate(hasta) ? hasta : todayLocal();
    const conditions = ['g.fecha_emision BETWEEN ? AND ?'];
    const params = [startDate, endDate];
    if (sedeFilter) { conditions.push('g.sede_id = ?'); params.push(sedeFilter); }
    if (['interna', 'remitente'].includes(tipo)) { conditions.push('g.tipo = ?'); params.push(tipo); }
    if (typeof q === 'string' && q.trim()) {
        const like = `%${q.trim()}%`;
        conditions.push('(g.numero_guia LIKE ? OR g.destinatario_nombre LIKE ? OR g.comentario LIKE ?)');
        params.push(like, like, like);
    }
    try {
        const [rows] = await pool.query(`${GUIA_SELECT_SQL} WHERE ${conditions.join(' AND ')} ORDER BY g.id DESC`, params);
        res.json({ periodo: { desde: startDate, hasta: endDate }, guias: rows.map(({ nubefact_payload: _p, nubefact_respuesta: _r, ...g }) => g) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/guias/opciones', allowAdmin, requireSede, async (req, res) => {
    const sedeId = sedeOf(req);
    try {
        const config = await getEmpresaConfig();
        const [almacenes] = await pool.query(`${ALMACEN_SELECT_SQL} WHERE a.sede_id = ? AND a.activo = 1 ORDER BY a.nombre`, [sedeId]);
        // Dispatched transfers of the sede without a valid sender guide.
        const [transferencias] = await pool.query(
            `${TRANSFERENCIA_SELECT_SQL}
             WHERE t.sede_origen_id = ? AND t.estado IN ('en_transito', 'recibida')
               AND NOT EXISTS (SELECT 1 FROM guias g WHERE g.transferencia_id = t.id AND g.tipo = 'remitente' AND g.estado <> 'anulada')
             ORDER BY t.id DESC LIMIT 50`,
            [sedeId]
        );
        const [destinoRows] = transferencias.length
            ? await pool.query(`SELECT id, direccion, ubigeo, cod_establecimiento FROM almacenes WHERE id IN (?)`, [transferencias.flatMap((t) => [t.almacen_origen_id, t.almacen_destino_id])])
            : [[]];
        // Electronic receipts with an identified customer, valid and sent to SUNAT, without a valid sender guide.
        const [facturas] = await pool.query(
            `SELECT f.id, f.tipo_comprobante, f.numero_comprobante, f.cliente_tipo_doc, f.cliente_num_doc, f.cliente_nombre, f.cliente_direccion,
                    f.total_venta, DATE_FORMAT(f.fecha_emision, '%Y-%m-%d') AS fecha
             FROM facturas f
             WHERE f.sede_id = ? AND f.tipo_comprobante IN ('boleta', 'factura') AND f.estado_comercial = 'vigente'
               AND f.estado_sunat IN ('aceptado', 'observado', 'enviado') AND f.cliente_tipo_doc IN ('RUC', 'DNI')
               AND NOT EXISTS (SELECT 1 FROM guias g WHERE g.factura_id = f.id AND g.tipo = 'remitente' AND g.estado <> 'anulada')
             ORDER BY f.id DESC LIMIT 50`,
            [sedeId]
        );
        res.json({
            ambiente: config.nubefact_ambiente,
            almacenes,
            transferencias: transferencias.map((t) => ({
                ...t,
                origen: destinoRows.find((a) => a.id === t.almacen_origen_id) || null,
                destino: destinoRows.find((a) => a.id === t.almacen_destino_id) || null
            })),
            facturas,
            motivos: MOTIVOS_TRASLADO,
            motivos_libres: MOTIVOS_LIBRES.map((codigo) => ({ codigo, nombre: MOTIVOS_TRASLADO[codigo] })),
            documentos_destinatario: Object.entries(DOC_DESTINATARIO).map(([codigo, d]) => ({ codigo, nombre: d.nombre }))
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/guias/remitente/:origen/:id/items', allowAdmin, requireSede, async (req, res) => {
    const { origen } = req.params;
    const sedeId = sedeOf(req);
    try {
        let items = [];
        if (origen === 'transferencia') {
            const transferencia = await findTransferencia(pool, req, req.params.id);
            if (!transferencia || Number(transferencia.sede_origen_id) !== Number(sedeId)) return res.status(404).json({ error: 'Transferencia no encontrada.' });
            if (!['en_transito', 'recibida'].includes(transferencia.estado)) return res.status(409).json({ error: 'La transferencia debe estar despachada.' });
            const [previa] = await pool.query("SELECT id FROM guias WHERE transferencia_id = ? AND tipo = 'remitente' AND estado <> 'anulada' LIMIT 1", [transferencia.id]);
            if (previa.length) return res.status(409).json({ error: 'La transferencia ya tiene una guía remitente.' });
            items = (await detalleTransferencia(pool, transferencia.id)).map((item) => ({
                codigo: codigoItem(item.tipo_item, item.item_id), descripcion: item.descripcion,
                cantidad: item.cantidad, unidad_medida: unidadSunat(item.unidad)
            }));
        } else if (origen === 'venta') {
            const [rows] = await pool.query(
                `SELECT id, tipo_comprobante, estado_sunat, estado_comercial, sede_id, cliente_tipo_doc
                 FROM facturas WHERE id = ? AND sede_id = ? LIMIT 1`,
                [req.params.id, sedeId]
            );
            const factura = rows[0];
            if (!factura || !['boleta', 'factura'].includes(factura.tipo_comprobante)) return res.status(404).json({ error: 'Comprobante no encontrado.' });
            if (factura.estado_comercial !== 'vigente' || !['aceptado', 'observado', 'enviado'].includes(factura.estado_sunat)
                || !['RUC', 'DNI'].includes(factura.cliente_tipo_doc)) return res.status(409).json({ error: 'El comprobante no cumple los requisitos para emitir la guía.' });
            const [previa] = await pool.query("SELECT id FROM guias WHERE factura_id = ? AND tipo = 'remitente' AND estado <> 'anulada' LIMIT 1", [factura.id]);
            if (previa.length) return res.status(409).json({ error: 'El comprobante ya tiene una guía remitente.' });
            items = (await facturaItems(factura.id)).map((item) => ({
                codigo: `P${item.producto_id}`, descripcion: item.descripcion,
                cantidad: Number(item.cantidad), unidad_medida: item.unidad_sunat || 'NIU'
            }));
        } else {
            return res.status(400).json({ error: 'El origen debe ser transferencia o venta.' });
        }
        if (!items.length) return res.status(409).json({ error: 'El documento de origen no tiene productos para trasladar.' });
        res.json({ items });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/guias/:id', allowAdmin, async (req, res) => {
    try {
        const guia = await findGuiaDetalle(req, req.params.id);
        if (!guia) return res.status(404).json({ error: 'Guia no encontrada' });
        res.json(guia);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Free internal guide: goods written by hand, never declared to SUNAT and it moves no stock.
app.post('/api/guias/interna', allowAdmin, requireSede, async (req, res) => {
    const body = req.body || {};
    const items = Array.isArray(body.items) ? body.items : [];
    const errors = [];
    const fechaTraslado = String(body.fecha_traslado || todayLocal());
    if (!isRealDate(fechaTraslado)) errors.push('Fecha de traslado invalida');
    if (!textoOpcional(body.partida_direccion, 255)) errors.push('Ingrese el punto de partida');
    if (!textoOpcional(body.llegada_direccion, 255)) errors.push('Ingrese el punto de llegada');
    if (!textoOpcional(body.destinatario_nombre, 200)) errors.push('Ingrese quien recibe');
    const lineas = items
        .map((i) => ({ descripcion: textoOpcional(i?.descripcion, 250), cantidad: Number(i?.cantidad), unidad_medida: textoOpcional(i?.unidad_medida, 5) || 'NIU', codigo: textoOpcional(i?.codigo, 30) }))
        .filter((i) => i.descripcion);
    if (lineas.length === 0) errors.push('Agregue al menos un bien');
    if (lineas.some((i) => !(i.cantidad > 0))) errors.push('Las cantidades deben ser mayores a 0');
    if (errors.length > 0) return res.status(400).json({ error: errors.join('. ') });

    const sedeId = sedeOf(req);
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        let almacenId = null;
        if (body.almacen_id) {
            const almacen = await findAlmacen(connection, body.almacen_id);
            if (!almacen || almacen.sede_id !== sedeId) throw new AlmacenError(400, 'El almacen no pertenece a la sede');
            almacenId = almacen.id;
        }
        const { snapshot } = await empresaParaGuia(connection, sedeId);
        const correlativo = await siguienteCorrelativo(connection, sedeId, 'guia_interna');
        const id = await insertarGuia(connection, req, {
            sede_id: sedeId, almacen_id: almacenId, tipo: 'interna', origen: 'libre', serie: correlativo.serie, numero: correlativo.numero,
            numero_guia: correlativo.numeroGuia, fecha_emision: todayLocal(), fecha_traslado: fechaTraslado,
            partida_direccion: textoOpcional(body.partida_direccion, 255), llegada_direccion: textoOpcional(body.llegada_direccion, 255),
            destinatario_nombre: textoOpcional(body.destinatario_nombre, 200), comentario: textoOpcional(body.comentario, 2000),
            empresa_snapshot: snapshot
        }, lineas.map((l, n) => ({ ...l, codigo: l.codigo || String(n + 1).padStart(3, '0') })));
        await connection.commit();
        res.status(201).json(await findGuiaDetalle(req, id));
    } catch (err) {
        await connection.rollback();
        sendAlmacenError(res, err);
    } finally {
        connection.release();
    }
});

const ddmm = (ymd) => ymd.split('-').reverse().join('-');

// Electronic sender guide (GRE remitente): from a dispatched transfer (motive 04) or an electronic sale (motive 01).
app.post('/api/guias/remitente', allowAdmin, requireSede, async (req, res) => {
    const body = req.body || {};
    const sedeId = sedeOf(req);
    const origen = body.origen === 'venta' ? 'venta' : body.origen === 'libre' ? 'libre' : 'transferencia';
    const fechaTraslado = String(body.fecha_traslado || todayLocal());
    // Free guide: the user chooses the reason, the recipient and the goods (nothing comes from a sale or a transfer).
    const motivoLibre = String(body.motivo || '');
    const motivoDescripcion = textoOpcional(body.motivo_descripcion, 200);
    const docDestinatario = DOC_DESTINATARIO[String(body.destinatario_tipo || '6')];
    const destinatarioNumero = String(body.destinatario_numero || '').trim().toUpperCase();
    const itemsLibres = (Array.isArray(body.items) ? body.items : []).map((i, n) => ({
        codigo: textoOpcional(i?.codigo, 30) || String(n + 1).padStart(3, '0'),
        descripcion: textoOpcional(i?.descripcion, 250),
        cantidad: Math.round(Number(i?.cantidad) * 1000) / 1000,
        unidad_medida: CODIGOS_SUNAT[String(i?.unidad_medida || 'NIU').toUpperCase()] ? String(i?.unidad_medida || 'NIU').toUpperCase() : null
    }));
    const partida = { direccion: textoOpcional(body.partida?.direccion, 255), ubigeo: textoOpcional(body.partida?.ubigeo, 6), establecimiento: textoOpcional(body.partida?.establecimiento, 4) };
    const llegada = { direccion: textoOpcional(body.llegada?.direccion, 255), ubigeo: textoOpcional(body.llegada?.ubigeo, 6), establecimiento: textoOpcional(body.llegada?.establecimiento, 4) };
    const modalidad = body.modalidad === '01' ? '01' : '02';
    const placa = String(body.placa || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const pesoBruto = Math.round(Number(body.peso_bruto) * 1000) / 1000;
    const bultos = Number(body.bultos);
    const errors = [];
    if (!isRealDate(fechaTraslado) || fechaTraslado < todayLocal()) errors.push('La fecha de traslado no puede ser anterior a hoy');
    for (const [nombre, punto] of [['partida', partida], ['llegada', llegada]]) {
        if (!punto.direccion || punto.direccion.length < 5) errors.push(`Ingrese la direccion de ${nombre}`);
        if (!UBIGEO_REGEX.test(punto.ubigeo || '')) errors.push(`El ubigeo de ${nombre} debe tener 6 digitos`);
    }
    if (origen === 'transferencia' || (origen === 'libre' && motivoLibre === '04')) {
        if (!ESTABLECIMIENTO_REGEX.test(partida.establecimiento || '') || !ESTABLECIMIENTO_REGEX.test(llegada.establecimiento || '')) {
            errors.push('El traslado entre establecimientos requiere los codigos SUNAT de establecimiento (4 digitos) de partida y llegada');
        }
    }
    if (origen === 'libre') {
        if (!MOTIVOS_LIBRES.includes(motivoLibre)) errors.push('Seleccione el motivo del traslado');
        if (motivoLibre === '13' && (motivoDescripcion || '').length < 3) errors.push('El motivo "Otros" requiere describir el motivo del traslado');
        if (!docDestinatario || !docDestinatario.regex.test(destinatarioNumero)) errors.push(docDestinatario?.mensaje || 'Seleccione el tipo de documento del destinatario');
        if (!textoOpcional(body.destinatario_nombre, 200)) errors.push('Ingrese el nombre o razon social del destinatario');
        if (itemsLibres.length === 0) errors.push('Agregue al menos un bien');
        if (itemsLibres.some((i) => !i.descripcion)) errors.push('Todos los bienes necesitan descripcion');
        if (itemsLibres.some((i) => !(i.cantidad > 0))) errors.push('Las cantidades de los bienes deben ser mayores a 0');
        if (itemsLibres.some((i) => !i.unidad_medida)) errors.push('Hay un bien con una unidad de medida no valida');
    }
    if (!(pesoBruto > 0)) errors.push('Ingrese el peso bruto total');
    if (!Number.isInteger(bultos) || bultos < 1) errors.push('Ingrese el numero de bultos');
    if (!/^[A-Z0-9]{6,8}$/.test(placa)) errors.push('Placa invalida (6 a 8 letras o numeros, sin guiones)');
    if (modalidad === '02') {
        if (!/^\d{8}$/.test(String(body.conductor_dni || ''))) errors.push('El DNI del conductor debe tener 8 digitos');
        if (!textoOpcional(body.conductor_nombres, 100) || !textoOpcional(body.conductor_apellidos, 100)) errors.push('Ingrese nombres y apellidos del conductor');
        if (!/^[A-Z0-9]{9,10}$/.test(String(body.conductor_licencia || '').trim().toUpperCase())) errors.push('Licencia de conducir invalida (9 a 10 caracteres)');
    } else {
        if (!/^(10|15|16|17|20)\d{9}$/.test(String(body.transportista_ruc || ''))) errors.push('RUC del transportista invalido');
        if (!textoOpcional(body.transportista_nombre, 200)) errors.push('Ingrese la razon social del transportista');
    }
    if (errors.length > 0) return res.status(400).json({ error: errors.join('. ') });

    const connection = await pool.getConnection();
    let guiaId;
    try {
        await connection.beginTransaction();
        const { config, snapshot } = await empresaParaGuia(connection, sedeId);
        if (!config.ruc || !config.razon_social) throw new AlmacenError(409, 'Configure el RUC y la razon social de la empresa');
        facturacion.validarCredenciales(config);

        let items;
        let destinatario;
        let refs;
        if (origen === 'transferencia') {
            const transferencia = await findTransferencia(connection, req, body.transferencia_id, true);
            if (!transferencia || transferencia.sede_origen_id !== sedeId) throw new AlmacenError(404, 'Transferencia no encontrada en la sede');
            if (!['en_transito', 'recibida'].includes(transferencia.estado)) throw new AlmacenError(409, 'La transferencia debe estar despachada');
            const [previa] = await connection.query("SELECT id FROM guias WHERE transferencia_id = ? AND tipo = 'remitente' AND estado <> 'anulada'", [transferencia.id]);
            if (previa.length > 0) throw new AlmacenError(409, 'La transferencia ya tiene una guia remitente');
            items = (await detalleTransferencia(connection, transferencia.id)).map((l) => ({
                codigo: codigoItem(l.tipo_item, l.item_id), descripcion: l.descripcion, cantidad: l.cantidad, unidad_medida: unidadSunat(l.unidad)
            }));
            // Between establishments of the same company the recipient is the issuer itself (the test account RUC in PRUEBAS).
            const rucEmisor = config.nubefact_ambiente === 'PRUEBAS' && config.nubefact_ruc_pruebas ? config.nubefact_ruc_pruebas : config.ruc;
            destinatario = { tipo: '6', numero: rucEmisor, nombre: config.razon_social, direccion: llegada.direccion };
            refs = { transferencia_id: transferencia.id, almacen_id: transferencia.almacen_origen_id, motivo: '04', texto: `Transferencia ${transferencia.codigo}` };
        } else if (origen === 'libre') {
            items = itemsLibres.map(({ codigo, descripcion, cantidad, unidad_medida }) => ({ codigo, descripcion, cantidad, unidad_medida }));
            destinatario = { tipo: String(body.destinatario_tipo || '6'), numero: destinatarioNumero, nombre: textoOpcional(body.destinatario_nombre, 200), direccion: llegada.direccion };
            refs = { almacen_id: null, motivo: motivoLibre, texto: `Traslado: ${MOTIVOS_TRASLADO[motivoLibre]}` };
        } else {
            const [rows] = await connection.query(
                `SELECT id, tipo_comprobante, serie, numero, numero_comprobante, cliente_tipo_doc, cliente_num_doc, cliente_nombre, cliente_direccion,
                        estado_sunat, estado_comercial, sede_id
                 FROM facturas WHERE id = ? AND sede_id = ? FOR UPDATE`,
                [body.factura_id, sedeId]
            );
            const factura = rows[0];
            if (!factura || !['boleta', 'factura'].includes(factura.tipo_comprobante)) throw new AlmacenError(404, 'Comprobante no encontrado en la sede');
            if (factura.estado_comercial !== 'vigente' || !['aceptado', 'observado', 'enviado'].includes(factura.estado_sunat)) {
                throw new AlmacenError(409, 'El comprobante debe estar vigente y enviado o aceptado por SUNAT');
            }
            if (!['RUC', 'DNI'].includes(factura.cliente_tipo_doc)) throw new AlmacenError(409, 'La guia requiere un comprobante con cliente identificado (DNI o RUC)');
            const [previa] = await connection.query("SELECT id FROM guias WHERE factura_id = ? AND tipo = 'remitente' AND estado <> 'anulada'", [factura.id]);
            if (previa.length > 0) throw new AlmacenError(409, 'El comprobante ya tiene una guia remitente');
            items = (await facturaItems(factura.id)).map((i) => ({
                codigo: `P${i.producto_id}`, descripcion: i.descripcion, cantidad: Number(i.cantidad), unidad_medida: i.unidad_sunat || 'NIU'
            }));
            destinatario = { tipo: factura.cliente_tipo_doc === 'RUC' ? '6' : '1', numero: factura.cliente_num_doc, nombre: factura.cliente_nombre, direccion: llegada.direccion };
            refs = { factura_id: factura.id, almacen_id: await almacenPorDefecto(connection, sedeId, 'ventas'), motivo: '01', texto: `${factura.tipo_comprobante === 'factura' ? 'Factura' : 'Boleta'} ${factura.numero_comprobante}`, factura };
        }

        if (origen !== 'libre' && Array.isArray(body.items)) {
            if (body.items.length !== items.length) throw new AlmacenError(400, 'Las descripciones deben corresponder a los productos del documento de origen');
            items = items.map((item, index) => {
                const descripcion = textoOpcional(body.items[index]?.descripcion, 250);
                if (!descripcion) throw new AlmacenError(400, `Ingrese la descripcion del producto ${index + 1}`);
                return { ...item, descripcion };
            });
        }

        const correlativo = await siguienteCorrelativo(connection, sedeId, 'guia_remitente');
        if (!/^T[A-Z0-9]{3}$/.test(correlativo.serie)) throw new AlmacenError(409, 'La serie de la guia remitente debe ser Txxx (4 caracteres)');
        const observaciones = [refs.texto, motivoDescripcion && `Motivo: ${motivoDescripcion}`, textoOpcional(body.observaciones, 300)].filter(Boolean).join(' - ').slice(0, 500);
        const payload = {
            operacion: 'generar_guia',
            tipo_de_comprobante: 7,
            serie: correlativo.serie,
            numero: correlativo.numero,
            cliente_tipo_de_documento: Number(destinatario.tipo),
            cliente_numero_de_documento: destinatario.numero,
            cliente_denominacion: destinatario.nombre,
            cliente_direccion: destinatario.direccion,
            fecha_de_emision: ddmm(todayLocal()),
            fecha_de_inicio_de_traslado: ddmm(fechaTraslado),
            observaciones,
            motivo_de_traslado: refs.motivo,
            ...(refs.motivo === '13' ? { motivo_de_traslado_otros_descripcion: motivoDescripcion } : {}),
            peso_bruto_total: pesoBruto,
            peso_bruto_unidad_de_medida: body.unidad_peso === 'TNE' ? 'TNE' : 'KGM',
            numero_de_bultos: bultos,
            tipo_de_transporte: modalidad,
            transportista_placa_numero: placa,
            punto_de_partida_ubigeo: partida.ubigeo,
            punto_de_partida_direccion: partida.direccion,
            punto_de_partida_codigo_establecimiento_sunat: partida.establecimiento || '',
            punto_de_llegada_ubigeo: llegada.ubigeo,
            punto_de_llegada_direccion: llegada.direccion,
            punto_de_llegada_codigo_establecimiento_sunat: llegada.establecimiento || '',
            enviar_automaticamente_al_cliente: false,
            formato_de_pdf: 'A4',
            items: items.map((i) => ({ codigo: i.codigo, descripcion: i.descripcion, cantidad: i.cantidad, unidad_de_medida: i.unidad_medida }))
        };
        // The sale guide carries its related electronic receipt (SUNAT catalog 61: 01 factura, 03 boleta).
        if (refs.factura) {
            payload.documento_relacionado = [{
                tipo: refs.factura.tipo_comprobante === 'factura' ? '01' : '03',
                serie: refs.factura.serie,
                numero: refs.factura.numero
            }];
        }
        if (modalidad === '02') {
            Object.assign(payload, {
                conductor_documento_tipo: '1', conductor_documento_numero: String(body.conductor_dni),
                conductor_nombre: textoOpcional(body.conductor_nombres, 100), conductor_apellidos: textoOpcional(body.conductor_apellidos, 100),
                conductor_numero_licencia: String(body.conductor_licencia).trim().toUpperCase()
            });
        } else {
            Object.assign(payload, {
                transportista_documento_tipo: '6', transportista_documento_numero: String(body.transportista_ruc),
                transportista_denominacion: textoOpcional(body.transportista_nombre, 200), transportista_numero_mtc: textoOpcional(body.transportista_mtc, 20) || '',
                fecha_de_entrega_al_transportista: ddmm(fechaTraslado)
            });
        }

        guiaId = await insertarGuia(connection, req, {
            sede_id: sedeId, almacen_id: refs.almacen_id, tipo: 'remitente', origen, transferencia_id: refs.transferencia_id, factura_id: refs.factura_id,
            serie: correlativo.serie, numero: correlativo.numero, numero_guia: correlativo.numeroGuia, fecha_emision: todayLocal(), fecha_traslado: fechaTraslado,
            motivo_traslado: refs.motivo, partida_direccion: partida.direccion, partida_ubigeo: partida.ubigeo, partida_establecimiento: partida.establecimiento,
            llegada_direccion: llegada.direccion, llegada_ubigeo: llegada.ubigeo, llegada_establecimiento: llegada.establecimiento,
            destinatario_tipo_doc: DOC_DESTINATARIO[destinatario.tipo]?.nombre || 'DNI', destinatario_num_doc: destinatario.numero, destinatario_nombre: destinatario.nombre,
            modalidad, peso_bruto: pesoBruto, unidad_peso: payload.peso_bruto_unidad_de_medida, bultos, placa,
            conductor_dni: modalidad === '02' ? String(body.conductor_dni) : null, conductor_nombres: payload.conductor_nombre,
            conductor_apellidos: payload.conductor_apellidos, conductor_licencia: payload.conductor_numero_licencia,
            transportista_ruc: payload.transportista_documento_numero, transportista_nombre: payload.transportista_denominacion,
            transportista_mtc: payload.transportista_numero_mtc, observaciones, estado_sunat: 'pendiente', ambiente: config.nubefact_ambiente,
            payload, empresa_snapshot: snapshot
        }, items);
        await connection.commit();
    } catch (err) {
        await connection.rollback();
        connection.release();
        return sendAlmacenError(res, err);
    }
    connection.release();

    let envioError = null;
    try {
        const config = await getEmpresaConfig();
        if (Number(config.envio_automatico)) await procesarGuiaSunat(guiaId, 'enviar');
    } catch (err) {
        envioError = err.message;
    }
    res.status(201).json({ ...(await findGuiaDetalle(req, guiaId)), envio_error: envioError });
});

/** Sends or reconciles a GRE with the billing API (same rules as the receipts: reserve, identity check, uncertainty). */
const procesarGuiaSunat = async (guiaId, accion) => {
    const [rows] = await pool.query('SELECT id, tipo, serie, numero, estado, estado_sunat, nubefact_payload FROM guias WHERE id = ?', [guiaId]);
    const guia = rows[0];
    if (!guia || guia.tipo !== 'remitente') throw new AlmacenError(409, 'Las guias internas no se envian a SUNAT');
    if (guia.estado === 'anulada') throw new AlmacenError(409, 'La guia esta anulada');
    const permitidos = accion === 'enviar' ? ['pendiente', 'error'] : ESTADOS_SUNAT.filter((e) => e !== 'no_aplica');
    if (!permitidos.includes(guia.estado_sunat)) {
        throw new AlmacenError(409, accion === 'enviar' ? `No se puede enviar una guia en estado ${guia.estado_sunat}. Consultela antes de reenviarla.` : 'La guia se esta enviando');
    }
    const config = await getEmpresaConfig();
    facturacion.validarCredenciales(config);
    await facturacion.verificarCuenta(config);
    const [reserva] = await pool.query("UPDATE guias SET estado_sunat = 'enviando' WHERE id = ? AND estado_sunat = ?", [guia.id, guia.estado_sunat]);
    if (reserva.affectedRows === 0) throw new AlmacenError(409, 'Otro usuario esta procesando esta guia');

    const payload = accion === 'enviar'
        ? (typeof guia.nubefact_payload === 'string' ? JSON.parse(guia.nubefact_payload) : guia.nubefact_payload)
        : { operacion: 'consultar_guia', tipo_de_comprobante: 7, serie: guia.serie, numero: guia.numero };
    let response;
    let estado;
    try {
        response = await facturacion.request(config, payload);
        estado = facturacion.estadoDesdeRespuesta(response, accion);
        const mismatch = !response.errors && (Number(response.tipo_de_comprobante) !== 7 || response.serie !== guia.serie || Number(response.numero) !== Number(guia.numero));
        if (mismatch) {
            estado = 'incierto';
            response = { errors: 'La respuesta de la API de facturacion no corresponde a esta guia. Consultela antes de reenviarla.' };
        }
    } catch (err) {
        if (!err.incierto) {
            await pool.query('UPDATE guias SET estado_sunat = ? WHERE id = ?', [guia.estado_sunat, guia.id]);
            throw err;
        }
        estado = 'incierto';
        response = { errors: err.message };
    }
    const textoEstado = { enviado: 'Recibida por la API de facturacion; pendiente de respuesta de SUNAT.', aceptado: 'Aceptada por SUNAT.', pendiente: 'No registrada en la API de facturacion: puede enviarla.' };
    await pool.query(
        `UPDATE guias SET estado_sunat = ?, nubefact_respuesta = ?, sunat_descripcion = ?, codigo_hash = COALESCE(?, codigo_hash),
                cadena_qr = COALESCE(?, cadena_qr), enlace_pdf = COALESCE(?, enlace_pdf), enlace_xml = COALESCE(?, enlace_xml),
                enlace_cdr = COALESCE(?, enlace_cdr), envios = envios + ?
         WHERE id = ?`,
        [estado, JSON.stringify(response), String(response.errors || response.sunat_description || response.sunat_note || textoEstado[estado] || estado).slice(0, 1000),
            response.codigo_hash || null, response.cadena_para_codigo_qr || null, response.enlace_del_pdf || null, response.enlace_del_xml || null,
            response.enlace_del_cdr || null, accion === 'enviar' ? 1 : 0, guia.id]
    );
    if (accion === 'enviar' && Number(response.codigo) === 23) return procesarGuiaSunat(guia.id, 'consultar');
    return estado;
};

for (const accion of ['enviar', 'consultar']) {
    app.post(`/api/guias/:id/${accion}`, allowAdmin, async (req, res) => {
        try {
            const guia = await findGuia(pool, req, req.params.id);
            if (!guia) return res.status(404).json({ error: 'Guia no encontrada' });
            await procesarGuiaSunat(guia.id, accion);
            res.json(await findGuiaDetalle(req, guia.id));
        } catch (err) {
            sendAlmacenError(res, err);
        }
    });
}

// Receipt signature of an internal guide.
app.post('/api/guias/:id/recibir', allowAdminOrKitchenRecibir, async (req, res) => {
    const cargo = textoOpcional(req.body?.cargo, 500);
    if (!cargo || cargo.length < 3) return res.status(400).json({ error: 'Indique quien recibio y cualquier observacion' });
    try {
        const guia = await findGuia(pool, req, req.params.id);
        if (!guia) return res.status(404).json({ error: 'Guia no encontrada' });
        if (guia.tipo !== 'interna') return res.status(409).json({ error: 'El cargo se registra en guias internas' });
        if (guia.estado !== 'emitida') return res.status(409).json({ error: 'La guia ya tiene cargo o esta anulada' });
        await pool.query("UPDATE guias SET estado = 'recibida', cargo = ?, cargo_por = ?, cargo_fecha = CURRENT_TIMESTAMP WHERE id = ?", [cargo, req.userContext.id, guia.id]);
        res.json(await findGuiaDetalle(req, guia.id));
    } catch (err) {
        sendAlmacenError(res, err);
    }
});

app.post('/api/guias/:id/anular', allowAdmin, async (req, res) => {
    const motivo = String(req.body?.motivo || '').trim();
    if (motivo.length < 3) return res.status(400).json({ error: 'Ingrese el motivo de la anulacion' });
    try {
        const guia = await findGuia(pool, req, req.params.id);
        if (!guia) return res.status(404).json({ error: 'Guia no encontrada' });
        if (guia.estado !== 'emitida') return res.status(409).json({ error: 'Solo se anula una guia emitida sin cargo' });
        if (guia.tipo === 'remitente' && !['pendiente', 'error', 'rechazado'].includes(guia.estado_sunat)) {
            return res.status(409).json({ error: 'Una GRE registrada en SUNAT se da de baja en el portal SOL; aqui solo se anulan las no registradas' });
        }
        if (guia.tipo === 'interna' && guia.origen === 'transferencia') {
            return res.status(409).json({ error: 'La guia interna de una transferencia se cierra al recibir la transferencia' });
        }
        await pool.query("UPDATE guias SET estado = 'anulada', motivo_anulacion = ? WHERE id = ?", [motivo.slice(0, 200), guia.id]);
        res.json(await findGuiaDetalle(req, guia.id));
    } catch (err) {
        sendAlmacenError(res, err);
    }
});

app.get('/api/guias/:id/formato/a4', allowAdmin, async (req, res) => {
    try {
        const guia = await findGuiaDetalle(req, req.params.id);
        if (!guia) return res.status(404).json({ error: 'Guia no encontrada' });
        const snapshot = typeof guia.empresa_snapshot === 'string' ? JSON.parse(guia.empresa_snapshot) : guia.empresa_snapshot;
        const pdf = await formatos.guiaPdf({ ...guia, motivo_nombre: MOTIVOS_TRASLADO[guia.motivo_traslado] || null }, snapshot || await getEmpresaConfig());
        res.type('application/pdf').set('Content-Disposition', `inline; filename="${pdf.filename}"`).send(pdf.buffer);
    } catch (err) {
        sendAlmacenError(res, err);
    }
});

// --- Estadísticas ---
app.get('/api/stats/ventas-hoy', allowAnyProfile, requireSede, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT COALESCE(SUM(${VENTA_NETA_SQL}), 0) as total
            FROM facturas
            WHERE sede_id = ? AND DATE(fecha_emision) = CURDATE()
        `, [sedeOf(req)]);
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/stats/ventas-tiempo', allowAnyProfile, requireSede, async (req, res) => {
    const { desde, hasta } = req.query;
    const today = todayLocal();
    const startDate = typeof desde === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(desde) ? desde : today;
    const endDate = typeof hasta === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(hasta) ? hasta : today;

    if (startDate > endDate) {
        return res.status(400).json({ error: 'Rango de fechas invalido' });
    }

    try {
        const [rows] = await pool.query(`
            SELECT
                DATE_FORMAT(fecha_emision, '%Y-%m-%d') as fecha,
                SUM(tipo_comprobante IN ('boleta', 'factura', 'nota_venta') AND NOT ${NOTA_VENTA_ANULADA_SQL}) as cantidad,
                COALESCE(SUM(${VENTA_NETA_SQL}), 0) as total
            FROM facturas
            WHERE sede_id = ? AND fecha_emision >= ? AND fecha_emision < DATE_ADD(?, INTERVAL 1 DAY)
            GROUP BY DATE_FORMAT(fecha_emision, '%Y-%m-%d')
            ORDER BY DATE_FORMAT(fecha_emision, '%Y-%m-%d') ASC
        `, [sedeOf(req), startDate, endDate]);

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

// Reporte de ventas en el formato "Ventas · modelo Excel" (32 columnas, una fila por comprobante).
// El servidor arma las filas completas; el cliente solo las escribe en el .xlsx.
const VENTAS_EXCEL_COLUMNAS = [
    'Razón Social', 'Empleado Nombre', 'Tienda', 'Punto de Venta', 'Cliente Nombre', 'Cliente Doc.', 'Telefono', 'Correo', 'Dirección', 'Tip. Doc.',
    'Serie', '# Correlativo', '#-DOC', 'Fecha', 'Hora', '# Doc. Relacionado', 'Fecha Doc. Relacionado', 'E. Despacho', 'E. Pago', 'Estado de Sunat',
    'M. Pago', 'T. Pago', 'Fecha de Vencimiento Pago', 'Monto deuda', 'Descuento', 'Costo de Envio', 'SubTotal', 'IGV', 'Total', 'Moneda',
    'Descuento Global', 'Comentarios'
];
const VENTAS_EXCEL_TIPO_DOC = { boleta: 'BOLETA', factura: 'FACTURA', nota_venta: 'NOTA_VENTA', nota_credito: 'NOTA_CREDITO', nota_debito: 'NOTA_DEBITO' };

app.get('/api/reportes/ventas/excel', allowAdminOrCashier, requireSede, async (req, res) => {
    const hoy = todayLocal();
    const desde = typeof req.query.desde === 'string' && isRealDate(req.query.desde) ? req.query.desde : hoy;
    const hasta = typeof req.query.hasta === 'string' && isRealDate(req.query.hasta) ? req.query.hasta : hoy;
    if (desde > hasta) return res.status(400).json({ error: 'Rango de fechas invalido' });
    try {
        const config = await getEmpresaConfig();
        const [rows] = await pool.query(
            `SELECT f.id, f.tipo_comprobante, f.serie, f.numero, f.numero_comprobante,
                    DATE_FORMAT(f.fecha_emision, '%Y-%m-%d') AS fecha, DATE_FORMAT(f.fecha_emision, '%H:%i:%s') AS hora,
                    f.cliente_num_doc, COALESCE(f.cliente_nombre, cl.nombre) AS cliente_nombre, f.cliente_direccion,
                    cl.telefono AS cliente_telefono, cl.email AS cliente_email,
                    pd.telefono AS delivery_telefono, pd.direccion AS delivery_direccion, pd.estado AS delivery_estado,
                    u.nombre AS usuario_nombre, s.nombre AS sede_nombre, cj.descripcion AS caja_descripcion,
                    o.numero_comprobante AS origen_numero, DATE_FORMAT(o.fecha_emision, '%Y-%m-%d') AS origen_fecha,
                    f.condicion_pago, DATE_FORMAT(f.fecha_vencimiento, '%Y-%m-%d') AS fecha_vencimiento,
                    f.estado_sunat, f.estado_comercial, f.total_venta, f.subtotal, f.impuesto, f.monto_cobrado, f.monto_nc, f.monto_nd, f.observacion,
                    (SELECT GROUP_CONCAT(DISTINCT UPPER(cv.metodo_pago) ORDER BY cv.metodo_pago SEPARATOR ' + ')
                     FROM cobros_venta cv WHERE cv.factura_id = f.id AND cv.estado = 'activo' AND cv.tipo = 'cobro') AS metodos
             FROM facturas f
             JOIN sedes s ON s.id = f.sede_id
             LEFT JOIN usuarios u ON u.id = f.usuario_id
             LEFT JOIN clientes cl ON cl.id = f.cliente_id
             LEFT JOIN pedidos_delivery pd ON pd.pedido_id = f.pedido_id
             LEFT JOIN caja_sesiones cs ON cs.id = f.sesion_caja_id
             LEFT JOIN cajas cj ON cj.id = cs.caja_id
             LEFT JOIN facturas o ON o.id = f.documento_origen_id
             WHERE f.sede_id = ? AND DATE(f.fecha_emision) BETWEEN ? AND ?
               AND NOT (f.tipo_comprobante = 'nota_venta' AND f.estado_comercial = 'anulado')
             ORDER BY f.fecha_emision ASC, f.id ASC`,
            [sedeOf(req), desde, hasta]
        );

        const razonSocial = config.razon_social || config.nombre_comercial || '';
        const filas = rows.map((f) => {
            const esNota = ['nota_credito', 'nota_debito'].includes(f.tipo_comprobante);
            const signo = f.tipo_comprobante === 'nota_credito' ? -1 : 1;
            const anonimo = !f.cliente_num_doc;
            const credito = f.condicion_pago === 'credito';
            const vigente = round2(Number(f.total_venta) + Number(f.monto_nd) - Number(f.monto_nc));
            const cobrado = Number(f.monto_cobrado);
            const deuda = !esNota && credito ? Math.max(round2(vigente - cobrado), 0) : 0;
            const ePago = esNota ? '' : cobrado >= vigente ? 'Pagado' : cobrado > 0 ? 'Parcial' : 'Pendiente';
            const money = (v) => round2(signo * Number(v || 0));
            return [
                razonSocial,
                f.usuario_nombre || '',
                f.sede_nombre,
                f.caja_descripcion || (f.delivery_estado ? 'Delivery' : 'Sin caja'),
                anonimo ? 'Consumidor final' : f.cliente_nombre,
                anonimo ? (f.tipo_comprobante === 'nota_venta' ? '' : '-') : f.cliente_num_doc,
                f.cliente_telefono || f.delivery_telefono || '',
                f.cliente_email || '',
                f.cliente_direccion || f.delivery_direccion || (anonimo ? '' : '-'),
                VENTAS_EXCEL_TIPO_DOC[f.tipo_comprobante] || String(f.tipo_comprobante).toUpperCase(),
                f.serie || '',
                Number(f.numero) || 0,
                f.tipo_comprobante === 'nota_venta' ? f.numero_comprobante : `${f.serie}-${f.numero}`,
                f.fecha,
                f.hora,
                f.origen_numero || '',
                f.origen_fecha || '',
                f.estado_comercial === 'anulado' ? 'ANULADO' : (f.delivery_estado && f.delivery_estado !== 'entregado' ? 'PENDIENTE' : 'FINALIZADO'),
                ePago,
                f.estado_sunat === 'no_aplica' ? 'SIN COMPROBANTE' : String(f.estado_sunat).toUpperCase(),
                credito ? 'CREDITO' : 'CONTADO',
                f.metodos || '',
                credito && f.fecha_vencimiento ? f.fecha_vencimiento : f.fecha,
                deuda,
                0,
                0,
                money(f.subtotal),
                money(f.impuesto),
                money(f.total_venta),
                'PEN',
                0,
                f.observacion || ''
            ];
        });
        res.json({ periodo: { desde, hasta }, columnas: VENTAS_EXCEL_COLUMNAS, filas });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/reportes/ventas', allowAdminOrCashier, requireSede, async (req, res) => {
    const { desde, hasta } = req.query;
    const today = todayLocal();
    const startDate = typeof desde === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(desde) ? desde : today;
    const endDate = typeof hasta === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(hasta) ? hasta : today;
    const sedeId = sedeOf(req);

    if (startDate > endDate) {
        return res.status(400).json({ error: 'Rango de fechas invalido' });
    }

    try {
        const [comprobantes] = await pool.query(`
            SELECT
                f.id,
                f.numero_comprobante,
                f.tipo_comprobante,
                CASE WHEN f.tipo_comprobante = 'nota_credito' THEN -f.total_venta ELSE f.total_venta END AS total_venta,
                CASE WHEN f.tipo_comprobante = 'nota_credito' THEN -f.impuesto ELSE f.impuesto END AS impuesto,
                f.fecha_emision,
                p.id as pedido_id,
                m.numero as mesa_numero,
                COALESCE(f.cliente_nombre, c.nombre, 'PUBLICO EN GENERAL') as cliente_nombre
            FROM facturas f
            LEFT JOIN pedidos p ON p.id = f.pedido_id
            LEFT JOIN mesas m ON m.id = p.mesa_id
            LEFT JOIN clientes c ON c.id = f.cliente_id
            WHERE f.sede_id = ? AND DATE(f.fecha_emision) BETWEEN ? AND ?
              AND NOT (f.tipo_comprobante = 'nota_venta' AND f.estado_comercial = 'anulado')
            ORDER BY f.fecha_emision DESC
        `, [sedeId, startDate, endDate]);

        const [porTipo] = await pool.query(`
            SELECT
                tipo_comprobante,
                COUNT(*) as cantidad,
                COALESCE(SUM(${VENTA_NETA_SQL}), 0) as total
            FROM facturas
            WHERE sede_id = ? AND DATE(fecha_emision) BETWEEN ? AND ?
              AND NOT ${NOTA_VENTA_ANULADA_SQL}
            GROUP BY tipo_comprobante
        `, [sedeId, startDate, endDate]);

        const [topProductos] = await pool.query(`
            SELECT
                COALESCE(prod.nombre, 'Producto') as producto_nombre,
                SUM(dp.cantidad) as cantidad_vendida,
                COALESCE(SUM(dp.subtotal), 0) as total_vendido
            FROM facturas f
            JOIN pedidos p ON p.id = f.pedido_id
            JOIN detalles_pedido dp ON dp.pedido_id = p.id
            LEFT JOIN productos prod ON prod.id = dp.producto_id
            WHERE f.sede_id = ? AND DATE(f.fecha_emision) BETWEEN ? AND ?
              AND NOT (f.tipo_comprobante = 'nota_venta' AND f.estado_comercial = 'anulado')
            GROUP BY dp.producto_id, prod.nombre
            ORDER BY total_vendido DESC
            LIMIT 10
        `, [sedeId, startDate, endDate]);

        const resumen = comprobantes.reduce((acc, row) => {
            acc.totalVentas += Number(row.total_venta) || 0;
            acc.totalIGV += Number(row.impuesto) || 0;
            return acc;
        }, { totalVentas: 0, totalIGV: 0 });

        const totalComprobantes = comprobantes.filter((row) => TIPOS_VENTA.includes(row.tipo_comprobante)).length;
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

// --- Pedidos delivery ---
// A delivery order is a regular order (pedidos) without table plus its delivery data (pedidos_delivery), so the kitchen,
// the billing screen and the stock deduction treat it like any sale. Stages:
//   solicitado -> enviado -> facturado -> entregado (rechazado ends it before it is invoiced).
// "facturado" is set by billing when the receipt is issued; an invoiced order may still be dispatched afterwards.
const DELIVERY_ESTADOS = ['solicitado', 'enviado', 'facturado', 'entregado', 'rechazado'];

const DELIVERY_SELECT_SQL = `
    SELECT pd.pedido_id AS id, pd.pedido_id, pd.sede_id, s.nombre AS sede_nombre, pd.cliente_id, pd.cliente_nombre, pd.telefono,
           pd.direccion, pd.referencia, pd.observacion, pd.estado, pd.repartidor, pd.motivo_rechazo,
           pd.fecha_solicitado, pd.fecha_enviado, pd.fecha_facturado, pd.fecha_entregado, pd.fecha_rechazado,
           pd.usuario_id, u.nombre AS usuario_nombre, p.total, p.estado AS estado_pedido,
           (SELECT COUNT(*) FROM detalles_pedido dp WHERE dp.pedido_id = pd.pedido_id) AS lineas,
           f.id AS factura_id, f.numero_comprobante, f.tipo_comprobante, f.estado_comercial AS factura_estado
    FROM pedidos_delivery pd
    JOIN pedidos p ON p.id = pd.pedido_id
    JOIN sedes s ON s.id = pd.sede_id
    LEFT JOIN usuarios u ON u.id = pd.usuario_id
    LEFT JOIN facturas f ON f.pedido_id = pd.pedido_id
`;

const registrarEtapaDelivery = (connection, pedidoId, estado, nota, usuarioId) => connection.query(
    'INSERT INTO pedidos_delivery_historial (pedido_id, estado, nota, usuario_id) VALUES (?, ?, ?, ?)',
    [pedidoId, estado, nota ? String(nota).slice(0, 255) : null, usuarioId || null]
);

/** Billing hook: issuing the receipt of a delivery order moves it to "facturado" (no-op for table orders). */
const marcarDeliveryFacturado = async (connection, pedidoId, numeroComprobante, usuarioId) => {
    const [result] = await connection.query(
        "UPDATE pedidos_delivery SET estado = 'facturado', fecha_facturado = CURRENT_TIMESTAMP WHERE pedido_id = ? AND estado IN ('solicitado', 'enviado')",
        [pedidoId]
    );
    if (result.affectedRows > 0) await registrarEtapaDelivery(connection, pedidoId, 'facturado', `Comprobante ${numeroComprobante}`, usuarioId);
};

/** Voiding the sale note of a delivery order closes it as rejected. */
const rechazarDeliveryPorAnulacion = async (connection, pedidoId, numeroComprobante, usuarioId) => {
    const motivo = `Anulación de ${numeroComprobante}`;
    const [result] = await connection.query(
        "UPDATE pedidos_delivery SET estado = 'rechazado', motivo_rechazo = ?, fecha_rechazado = CURRENT_TIMESTAMP WHERE pedido_id = ? AND estado <> 'rechazado'",
        [motivo, pedidoId]
    );
    if (result.affectedRows > 0) await registrarEtapaDelivery(connection, pedidoId, 'rechazado', motivo, usuarioId);
};

const findDelivery = async (connection, req, id, lock = false) => {
    const [rows] = await connection.query(
        `${DELIVERY_SELECT_SQL} WHERE pd.pedido_id = ? ${isMultisede(req) ? '' : 'AND pd.sede_id = ?'} LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
        isMultisede(req) ? [id] : [id, sedeOf(req)]
    );
    return rows[0] || null;
};

const detalleDelivery = async (connection, delivery) => {
    const [detalles] = await connection.query(
        `SELECT dp.id, dp.producto_id, pr.nombre AS producto_nombre, dp.cantidad, dp.precio_unitario, dp.subtotal, dp.notas, dp.estado_comanda
         FROM detalles_pedido dp JOIN productos pr ON pr.id = dp.producto_id WHERE dp.pedido_id = ? ORDER BY dp.id`,
        [delivery.pedido_id]
    );
    const [historial] = await connection.query(
        `SELECT h.id, h.estado, h.nota, h.fecha, u.nombre AS usuario_nombre
         FROM pedidos_delivery_historial h LEFT JOIN usuarios u ON u.id = h.usuario_id WHERE h.pedido_id = ? ORDER BY h.id`,
        [delivery.pedido_id]
    );
    return { ...delivery, detalles, historial };
};

const parseDeliveryInput = (body) => {
    const data = {
        cliente_id: body?.cliente_id ? Number(body.cliente_id) : null,
        cliente_nombre: String(body?.cliente_nombre ?? '').trim().replace(/\s+/g, ' '),
        telefono: String(body?.telefono ?? '').trim(),
        direccion: String(body?.direccion ?? '').trim().replace(/\s+/g, ' '),
        referencia: String(body?.referencia ?? '').trim().slice(0, 255) || null,
        observacion: String(body?.observacion ?? '').trim().slice(0, 255) || null
    };
    const errors = [];
    if (data.cliente_nombre.length < 3 || data.cliente_nombre.length > 150) errors.push('Ingrese el nombre del cliente');
    if (!/^[0-9+() -]{6,30}$/.test(data.telefono)) errors.push('Ingrese un telefono valido');
    if (data.direccion.length < 5 || data.direccion.length > 255) errors.push('Ingrese la direccion de entrega');
    return { data, errors };
};

app.get('/api/delivery', allowAdminWaiterCashier, async (req, res) => {
    const { sedeFilter, error } = resolveListSede(req);
    if (error) return res.status(400).json({ error });
    const hoy = todayLocal();
    const desde = typeof req.query.desde === 'string' && isRealDate(req.query.desde) ? req.query.desde : addDaysToDate(hoy, -7);
    const hasta = typeof req.query.hasta === 'string' && isRealDate(req.query.hasta) ? req.query.hasta : hoy;
    if (desde > hasta) return res.status(400).json({ error: 'Rango de fechas invalido' });
    // Open orders (not delivered or rejected yet) are always listed, whatever their date; the report (estricto=1) keeps the range only.
    const conditions = [req.query.estricto === '1'
        ? 'DATE(pd.fecha_solicitado) BETWEEN ? AND ?'
        : "(DATE(pd.fecha_solicitado) BETWEEN ? AND ? OR pd.estado IN ('solicitado', 'enviado', 'facturado'))"];
    const params = [desde, hasta];
    if (sedeFilter) { conditions.push('pd.sede_id = ?'); params.push(sedeFilter); }
    if (typeof req.query.q === 'string' && req.query.q.trim()) {
        const like = `%${req.query.q.trim()}%`;
        conditions.push('(pd.cliente_nombre LIKE ? OR pd.telefono LIKE ? OR pd.direccion LIKE ? OR pd.pedido_id = ?)');
        params.push(like, like, like, Number(req.query.q.trim().replace(/^#/, '')) || 0);
    }
    try {
        const [pedidos] = await pool.query(`${DELIVERY_SELECT_SQL} WHERE ${conditions.join(' AND ')} ORDER BY pd.fecha_solicitado DESC, pd.pedido_id DESC`, params);
        const resumen = pedidos.reduce((acc, p) => {
            acc[p.estado] += 1;
            if (!['rechazado'].includes(p.estado)) acc.monto = round2(acc.monto + Number(p.total));
            return acc;
        }, { solicitado: 0, enviado: 0, facturado: 0, entregado: 0, rechazado: 0, monto: 0 });
        // detalle=1 adds the product lines of every order (Excel report).
        if (req.query.detalle === '1' && pedidos.length > 0) {
            const [lineas] = await pool.query(
                `SELECT dp.pedido_id, pr.nombre AS producto_nombre, dp.cantidad, dp.precio_unitario, dp.subtotal, dp.notas
                 FROM detalles_pedido dp JOIN productos pr ON pr.id = dp.producto_id WHERE dp.pedido_id IN (?) ORDER BY dp.pedido_id, dp.id`,
                [pedidos.map((p) => p.pedido_id)]
            );
            const porPedido = new Map();
            lineas.forEach((l) => porPedido.set(l.pedido_id, [...(porPedido.get(l.pedido_id) || []), l]));
            pedidos.forEach((p) => { p.detalles = porPedido.get(p.pedido_id) || []; });
        }
        res.json({ periodo: { desde, hasta }, resumen, pedidos });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/delivery/:id', allowAdminWaiterCashier, async (req, res) => {
    try {
        const delivery = await findDelivery(pool, req, req.params.id);
        if (!delivery) return res.status(404).json({ error: 'Pedido delivery no encontrado' });
        res.json(await detalleDelivery(pool, delivery));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/delivery', allowAdminWaiterCashier, requireSede, async (req, res) => {
    const { data, errors } = parseDeliveryInput(req.body);
    const items = Array.isArray(req.body?.detalles) ? req.body.detalles : [];
    if (items.length === 0 || items.length > 100) errors.push('Agregue entre 1 y 100 productos al pedido');
    const invalido = items.find((i) => !Number.isInteger(Number(i?.producto_id)) || Number(i.producto_id) <= 0 || !Number.isInteger(Number(i?.cantidad)) || Number(i.cantidad) <= 0 || Number(i.cantidad) > 999);
    if (invalido) errors.push('Cada producto debe tener una cantidad entera valida');
    if (errors.length > 0) return res.status(400).json({ error: errors.join('. ') });

    const sedeId = sedeOf(req);
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        if (data.cliente_id) {
            const [clientes] = await connection.query('SELECT id FROM clientes WHERE id = ?', [data.cliente_id]);
            if (clientes.length === 0) data.cliente_id = null;
        }
        const lineas = [];
        for (const item of items) {
            const [productos] = await connection.query('SELECT id, nombre, precio FROM productos WHERE id = ? AND disponible = 1', [Number(item.producto_id)]);
            if (productos.length === 0) throw Object.assign(new Error('Uno de los productos ya no esta disponible'), { status: 409 });
            const cantidad = Number(item.cantidad);
            lineas.push({ producto_id: productos[0].id, cantidad, precio: Number(productos[0].precio), subtotal: round2(Number(productos[0].precio) * cantidad), notas: String(item.notas ?? '').trim().slice(0, 255) });
        }
        const total = round2(lineas.reduce((acc, l) => acc + l.subtotal, 0));
        const [pedido] = await connection.query(
            "INSERT INTO pedidos (sede_id, mesa_id, cliente_id, usuario_id, estado, total) VALUES (?, NULL, ?, ?, 'pendiente', ?)",
            [sedeId, data.cliente_id, req.userContext.id, total]
        );
        for (const l of lineas) {
            await connection.query(
                'INSERT INTO detalles_pedido (pedido_id, producto_id, cantidad, precio_unitario, subtotal, notas) VALUES (?, ?, ?, ?, ?, ?)',
                [pedido.insertId, l.producto_id, l.cantidad, l.precio, l.subtotal, l.notas]
            );
        }
        await connection.query(
            `INSERT INTO pedidos_delivery (pedido_id, sede_id, cliente_id, cliente_nombre, telefono, direccion, referencia, observacion, usuario_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [pedido.insertId, sedeId, data.cliente_id, data.cliente_nombre, data.telefono, data.direccion, data.referencia, data.observacion, req.userContext.id]
        );
        await registrarEtapaDelivery(connection, pedido.insertId, 'solicitado', 'Pedido registrado', req.userContext.id);
        await connection.commit();
        res.status(201).json(await detalleDelivery(pool, await findDelivery(pool, req, pedido.insertId)));
    } catch (err) {
        await connection.rollback();
        res.status(err.status || 500).json({ error: err.message });
    } finally {
        connection.release();
    }
});

app.put('/api/delivery/:id', allowAdminWaiterCashier, async (req, res) => {
    const { data, errors } = parseDeliveryInput(req.body);
    if (errors.length > 0) return res.status(400).json({ error: errors.join('. ') });
    try {
        const delivery = await findDelivery(pool, req, req.params.id);
        if (!delivery) return res.status(404).json({ error: 'Pedido delivery no encontrado' });
        if (['entregado', 'rechazado'].includes(delivery.estado)) return res.status(409).json({ error: 'El pedido ya esta cerrado y no se puede editar' });
        await pool.query(
            'UPDATE pedidos_delivery SET cliente_nombre = ?, telefono = ?, direccion = ?, referencia = ?, observacion = ? WHERE pedido_id = ?',
            [data.cliente_nombre, data.telefono, data.direccion, data.referencia, data.observacion, delivery.pedido_id]
        );
        res.json(await detalleDelivery(pool, await findDelivery(pool, req, delivery.pedido_id)));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Manual stage changes: enviado, entregado and rechazado. "facturado" is set by billing.
app.post('/api/delivery/:id/estado', allowAdminWaiterCashier, async (req, res) => {
    const nuevo = String(req.body?.estado || '');
    const repartidor = String(req.body?.repartidor ?? '').trim().slice(0, 100) || null;
    const motivo = String(req.body?.motivo ?? '').trim().replace(/\s+/g, ' ').slice(0, 200);
    if (!['enviado', 'entregado', 'rechazado'].includes(nuevo)) return res.status(400).json({ error: 'La etapa debe ser enviado, entregado o rechazado (facturado se registra al emitir el comprobante)' });
    if (nuevo === 'rechazado' && motivo.length < 3) return res.status(400).json({ error: 'Ingrese el motivo del rechazo' });

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const delivery = await findDelivery(connection, req, req.params.id, true);
        if (!delivery) throw Object.assign(new Error('Pedido delivery no encontrado'), { status: 404 });
        const facturado = Boolean(delivery.factura_id) && delivery.factura_estado !== 'anulado';
        const permitido = {
            solicitado: ['enviado', 'rechazado'],
            enviado: ['entregado', 'rechazado'],
            facturado: ['enviado', 'entregado']
        }[delivery.estado] || [];
        if (!permitido.includes(nuevo)) throw Object.assign(new Error(`Un pedido ${delivery.estado} no puede pasar a ${nuevo}`), { status: 409 });
        if (nuevo === 'rechazado' && facturado) throw Object.assign(new Error('El pedido ya tiene comprobante: emite una nota de credito o anula la nota de venta'), { status: 409 });
        if (nuevo === 'entregado' && !facturado) throw Object.assign(new Error('Factura el pedido antes de marcarlo como entregado'), { status: 409 });

        if (nuevo === 'enviado') {
            await connection.query("UPDATE pedidos_delivery SET estado = 'enviado', fecha_enviado = CURRENT_TIMESTAMP, repartidor = COALESCE(?, repartidor) WHERE pedido_id = ?", [repartidor, delivery.pedido_id]);
        } else if (nuevo === 'entregado') {
            await connection.query("UPDATE pedidos_delivery SET estado = 'entregado', fecha_entregado = CURRENT_TIMESTAMP, repartidor = COALESCE(?, repartidor) WHERE pedido_id = ?", [repartidor, delivery.pedido_id]);
        } else {
            await connection.query("UPDATE pedidos_delivery SET estado = 'rechazado', fecha_rechazado = CURRENT_TIMESTAMP, motivo_rechazo = ? WHERE pedido_id = ?", [motivo, delivery.pedido_id]);
            await connection.query("UPDATE pedidos SET estado = 'cancelado' WHERE id = ? AND estado <> 'pagado'", [delivery.pedido_id]);
        }
        const nota = nuevo === 'rechazado' ? motivo : (repartidor ? `Repartidor: ${repartidor}` : null);
        await registrarEtapaDelivery(connection, delivery.pedido_id, nuevo, nota, req.userContext.id);
        await connection.commit();
        res.json(await detalleDelivery(pool, await findDelivery(pool, req, delivery.pedido_id)));
    } catch (err) {
        await connection.rollback();
        res.status(err.status || 500).json({ error: err.message });
    } finally {
        connection.release();
    }
});

// --- Recordatorios y vencimientos (pagos de servicios, documentos, licencias) ---
// Cada recordatorio vence en una fecha fija o un dia de cada mes y avisa "dias_aviso" antes.
// Atenderlo (pagarlo, renovarlo) lo saca de las alertas hasta el siguiente vencimiento.
const allowRecordatorios = requireProfiles('administrador');
const RECORDATORIO_CATEGORIAS = ['pago', 'documento', 'licencia', 'otro'];
const RECORDATORIO_TIPOS = ['fecha', 'periodico'];

const RECORDATORIO_SELECT_SQL = `
    SELECT r.id, r.sede_id, s.nombre AS sede_nombre, r.nombre, r.categoria, r.monto, r.tipo_vencimiento,
           DATE_FORMAT(r.fecha_vencimiento, '%Y-%m-%d') AS fecha_vencimiento, r.dia_pago, r.dias_aviso, r.notas, r.activo,
           DATE_FORMAT(r.fecha_ultimo_pago, '%Y-%m-%d') AS fecha_ultimo_pago, r.usuario_id, u.nombre AS usuario_nombre, r.creado_en
    FROM recordatorios r
    JOIN sedes s ON s.id = r.sede_id
    LEFT JOIN usuarios u ON u.id = r.usuario_id
`;

const diasEntreFechas = (desde, hasta) => Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 86400000);
const fechaDelMes = (anio, mes, dia) => {
    const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate(); // mes 1-12
    return `${anio}-${String(mes).padStart(2, '0')}-${String(Math.min(dia, ultimo)).padStart(2, '0')}`;
};

/** Next due date, days left and state of a reminder. A day-of-month reminder clamps to the month's last day (31 -> 30/28). */
const calcularRecordatorio = (r, hoy) => {
    const base = { ...r, activo: Boolean(Number(r.activo)), monto: Number(r.monto) };
    let proxima;
    let atendido;
    if (r.tipo_vencimiento === 'periodico') {
        const [anio, mes] = hoy.split('-').map(Number);
        atendido = Boolean(r.fecha_ultimo_pago) && r.fecha_ultimo_pago >= `${hoy.slice(0, 7)}-01`;
        const ciclo = atendido ? (mes === 12 ? [anio + 1, 1] : [anio, mes + 1]) : [anio, mes];
        proxima = fechaDelMes(ciclo[0], ciclo[1], Number(r.dia_pago));
    } else {
        atendido = Boolean(r.fecha_ultimo_pago);
        proxima = r.fecha_vencimiento;
    }
    const dias = proxima ? diasEntreFechas(hoy, proxima) : null;
    let estado;
    if (!base.activo) estado = 'deshabilitado';
    else if (atendido) estado = 'atendido';
    else if (dias === null) estado = 'sin_fecha';
    else if (dias < 0) estado = 'vencido';
    else if (dias <= Number(r.dias_aviso)) estado = 'por_vencer';
    else estado = 'al_dia';
    return { ...base, proxima_fecha: proxima, dias_restantes: dias, atendido, estado };
};

const ORDEN_ESTADO_RECORDATORIO = { vencido: 0, por_vencer: 1, al_dia: 2, sin_fecha: 3, atendido: 4, deshabilitado: 5 };
const ordenarRecordatorios = (lista) => lista.sort((a, b) => (ORDEN_ESTADO_RECORDATORIO[a.estado] - ORDEN_ESTADO_RECORDATORIO[b.estado])
    || String(a.proxima_fecha || '9999').localeCompare(String(b.proxima_fecha || '9999')) || a.nombre.localeCompare(b.nombre, 'es'));

const cargarRecordatorios = async (connection, sedeFilter, extraWhere = '') => {
    const [rows] = await connection.query(
        `${RECORDATORIO_SELECT_SQL} WHERE r.eliminado = 0 ${sedeFilter ? 'AND r.sede_id = ?' : ''} ${extraWhere}`,
        sedeFilter ? [sedeFilter] : []
    );
    const hoy = todayLocal();
    return ordenarRecordatorios(rows.map((r) => calcularRecordatorio(r, hoy)));
};

const findRecordatorio = async (connection, req, id) => {
    const [rows] = await connection.query(
        `${RECORDATORIO_SELECT_SQL} WHERE r.id = ? AND r.eliminado = 0 ${isMultisede(req) ? '' : 'AND r.sede_id = ?'} LIMIT 1`,
        isMultisede(req) ? [id] : [id, sedeOf(req)]
    );
    return rows[0] || null;
};

const parseRecordatorioInput = (body) => {
    const data = {
        nombre: String(body?.nombre ?? '').trim().replace(/\s+/g, ' '),
        categoria: String(body?.categoria ?? 'pago').trim().toLowerCase(),
        monto: round2(body?.monto || 0),
        tipo_vencimiento: String(body?.tipo_vencimiento ?? 'fecha').trim().toLowerCase(),
        fecha_vencimiento: body?.fecha_vencimiento ? String(body.fecha_vencimiento).slice(0, 10) : null,
        dia_pago: body?.dia_pago ? Number(body.dia_pago) : null,
        dias_aviso: body?.dias_aviso === undefined || body?.dias_aviso === '' ? 7 : Number(body.dias_aviso),
        notas: String(body?.notas ?? '').trim().slice(0, 255) || null
    };
    const errors = [];
    if (data.nombre.length < 3 || data.nombre.length > 100) errors.push('El nombre debe tener entre 3 y 100 caracteres');
    if (!RECORDATORIO_CATEGORIAS.includes(data.categoria)) errors.push('La categoria no es valida');
    if (!RECORDATORIO_TIPOS.includes(data.tipo_vencimiento)) errors.push('El tipo de vencimiento no es valido');
    if (data.categoria === 'pago' && !(data.monto > 0)) errors.push('Ingrese el monto del pago');
    if (data.categoria !== 'pago') data.monto = 0;
    if (data.tipo_vencimiento === 'fecha') {
        if (!data.fecha_vencimiento || !isRealDate(data.fecha_vencimiento)) errors.push('Ingrese la fecha de vencimiento');
        data.dia_pago = null;
    } else {
        if (!Number.isInteger(data.dia_pago) || data.dia_pago < 1 || data.dia_pago > 31) errors.push('El dia del mes debe estar entre 1 y 31');
        data.fecha_vencimiento = null;
    }
    if (!Number.isInteger(data.dias_aviso) || data.dias_aviso < 0 || data.dias_aviso > 365) errors.push('Los dias de aviso deben estar entre 0 y 365');
    return { data, errors };
};

app.get('/api/recordatorios', allowRecordatorios, async (req, res) => {
    const { sedeFilter, error } = resolveListSede(req);
    if (error) return res.status(400).json({ error });
    try {
        const recordatorios = await cargarRecordatorios(pool, sedeFilter);
        const resumen = recordatorios.reduce((acc, r) => {
            acc[r.estado] = (acc[r.estado] || 0) + 1;
            if (['vencido', 'por_vencer'].includes(r.estado) && r.categoria === 'pago') acc.monto_pendiente = round2(acc.monto_pendiente + r.monto);
            return acc;
        }, { total: recordatorios.length, vencido: 0, por_vencer: 0, al_dia: 0, atendido: 0, deshabilitado: 0, monto_pendiente: 0 });
        res.json({ sede_id: sedeFilter, resumen, recordatorios });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Avisos para la campana: vencidos y proximos a vencer de la sede.
app.get('/api/recordatorios/alertas', allowRecordatorios, async (req, res) => {
    const { sedeFilter, error } = resolveListSede(req);
    if (error) return res.status(400).json({ error });
    try {
        const alertas = (await cargarRecordatorios(pool, sedeFilter)).filter((r) => ['vencido', 'por_vencer'].includes(r.estado));
        res.json({
            total: alertas.length,
            vencidos: alertas.filter((r) => r.estado === 'vencido'),
            por_vencer: alertas.filter((r) => r.estado === 'por_vencer')
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/recordatorios', allowRecordatorios, requireSede, async (req, res) => {
    const { data, errors } = parseRecordatorioInput(req.body);
    if (errors.length > 0) return res.status(400).json({ error: errors.join('. ') });
    try {
        const [result] = await pool.query(
            `INSERT INTO recordatorios (sede_id, nombre, categoria, monto, tipo_vencimiento, fecha_vencimiento, dia_pago, dias_aviso, notas, usuario_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [sedeOf(req), data.nombre, data.categoria, data.monto, data.tipo_vencimiento, data.fecha_vencimiento, data.dia_pago, data.dias_aviso, data.notas, req.userContext.id]
        );
        res.status(201).json(calcularRecordatorio(await findRecordatorio(pool, req, result.insertId), todayLocal()));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/recordatorios/:id', allowRecordatorios, async (req, res) => {
    const { data, errors } = parseRecordatorioInput(req.body);
    if (errors.length > 0) return res.status(400).json({ error: errors.join('. ') });
    try {
        const actual = await findRecordatorio(pool, req, req.params.id);
        if (!actual) return res.status(404).json({ error: 'Recordatorio no encontrado' });
        // A new due date (or a different schedule) starts a new cycle: it is pending again.
        const reinicia = data.tipo_vencimiento !== actual.tipo_vencimiento || data.fecha_vencimiento !== actual.fecha_vencimiento;
        await pool.query(
            `UPDATE recordatorios SET nombre = ?, categoria = ?, monto = ?, tipo_vencimiento = ?, fecha_vencimiento = ?, dia_pago = ?, dias_aviso = ?, notas = ?
                    ${reinicia ? ', fecha_ultimo_pago = NULL' : ''} WHERE id = ?`,
            [data.nombre, data.categoria, data.monto, data.tipo_vencimiento, data.fecha_vencimiento, data.dia_pago, data.dias_aviso, data.notas, actual.id]
        );
        res.json(calcularRecordatorio(await findRecordatorio(pool, req, actual.id), todayLocal()));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const accionRecordatorio = (ruta, sql, validar) => app.post(`/api/recordatorios/:id/${ruta}`, allowRecordatorios, async (req, res) => {
    try {
        const actual = await findRecordatorio(pool, req, req.params.id);
        if (!actual) return res.status(404).json({ error: 'Recordatorio no encontrado' });
        const params = validar ? validar(req, actual) : [];
        if (params.error) return res.status(params.status || 400).json({ error: params.error });
        await pool.query(sql, [...params, actual.id]);
        res.json(calcularRecordatorio(await findRecordatorio(pool, req, actual.id), todayLocal()));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
accionRecordatorio('atender', 'UPDATE recordatorios SET fecha_ultimo_pago = CURDATE() WHERE id = ?');
accionRecordatorio('revertir', 'UPDATE recordatorios SET fecha_ultimo_pago = NULL WHERE id = ?');
accionRecordatorio('alternar', 'UPDATE recordatorios SET activo = NOT activo WHERE id = ?');
accionRecordatorio('fecha', 'UPDATE recordatorios SET fecha_vencimiento = ?, fecha_ultimo_pago = NULL WHERE id = ?', (req, actual) => {
    const fecha = String(req.body?.fecha_vencimiento || '').slice(0, 10);
    if (actual.tipo_vencimiento !== 'fecha') return { error: 'Solo los recordatorios de fecha fija cambian de fecha', status: 409 };
    if (!isRealDate(fecha)) return { error: 'Ingrese una fecha valida' };
    return [fecha];
});

app.delete('/api/recordatorios/:id', allowRecordatorios, async (req, res) => {
    try {
        const actual = await findRecordatorio(pool, req, req.params.id);
        if (!actual) return res.status(404).json({ error: 'Recordatorio no encontrado' });
        await pool.query('UPDATE recordatorios SET eliminado = 1 WHERE id = ?', [actual.id]);
        res.json({ message: 'Recordatorio eliminado' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

if (hasClientBuild) {
    // Express 5 (path-to-regexp v6+) rejects a bare '*' route pattern,
    // so the SPA fallback is a path-less middleware instead.
    app.use((req, res, next) => {
        if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
        res.sendFile(path.join(clientBuildPath, 'index.html'));
    });
}

// Boletas y guias llegan a la API de facturacion como "enviado" y SUNAT responde despues (resumen diario / GRE asincrona):
// se consultan solos hasta traer estado, XML y CDR, sin que nadie pulse "Consultar SUNAT".
const SUNAT_SYNC_INTERVAL_MS = Math.max(30, Number(process.env.SUNAT_SYNC_INTERVAL_SECONDS) || 120) * 1000;
const SUNAT_SYNC_BATCH = 20;
let sunatSyncRunning = false;

const sincronizarSunatPendientes = async () => {
    if (sunatSyncRunning) return;
    sunatSyncRunning = true;
    try {
        const config = await getEmpresaConfig();
        facturacion.validarCredenciales(config);
        await facturacion.verificarCuenta(config);

        const [facturas] = await pool.query(
            `SELECT id FROM facturas WHERE tipo_comprobante IN (?) AND estado_sunat IN ('enviado', 'incierto')
             ORDER BY id DESC LIMIT ?`, [TIPOS_SUNAT, SUNAT_SYNC_BATCH]);
        const [guias] = await pool.query(
            `SELECT id FROM guias WHERE tipo = 'remitente' AND estado <> 'anulada' AND estado_sunat IN ('enviado', 'incierto')
             ORDER BY id DESC LIMIT ?`, [SUNAT_SYNC_BATCH]);

        for (const { id } of facturas) {
            try { await procesarSunat(id, 'consultar'); } catch (err) { console.warn(`SUNAT sync comprobante ${id}: ${err.message}`); }
        }
        for (const { id } of guias) {
            try { await procesarGuiaSunat(id, 'consultar'); } catch (err) { console.warn(`SUNAT sync guia ${id}: ${err.message}`); }
        }
    } catch (err) {
        // Sin credenciales o ambiente distinto: no hay nada que consultar todavia.
    } finally {
        sunatSyncRunning = false;
    }
};

// El stock de productos admite decimales (cerveza por litros): la columna era INT en bases antiguas. Idempotente.
const asegurarStockDecimal = async () => {
    try {
        const [rows] = await pool.query(
            "SELECT DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stock_productos' AND COLUMN_NAME = 'stock'"
        );
        if (rows[0] && String(rows[0].DATA_TYPE).toLowerCase() !== 'decimal') {
            await pool.query('ALTER TABLE stock_productos MODIFY stock DECIMAL(12,3) NOT NULL DEFAULT 0');
            console.log('stock_productos.stock convertido a DECIMAL(12,3)');
        }
    } catch (err) {
        console.error('No se pudo convertir el stock de productos a decimal:', err.message);
    }
    // Unidades de stock que descuenta cada unidad vendida (botella de 620 ml en un stock por litros: 0.62).
    const [factor] = await pool.query(
        "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'factor_venta'"
    );
    if (factor.length === 0) {
        await pool.query('ALTER TABLE productos ADD COLUMN factor_venta DECIMAL(12,4) NOT NULL DEFAULT 1');
        console.log('productos.factor_venta agregado');
    }
    tieneFactorVenta = true;
};

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    permisos.iniciar();
    asegurarStockDecimal().catch((err) => console.error('No se pudo preparar el stock decimal de productos:', err.message));
    cargarUnidadesSunat().catch((err) => console.error('No se pudo cargar el catalogo de unidades:', err.message));
    setTimeout(sincronizarSunatPendientes, 15000).unref();
    setInterval(sincronizarSunatPendientes, SUNAT_SYNC_INTERVAL_MS).unref();
});
