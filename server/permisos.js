const pool = require('./db');

/**
 * Perfiles y permisos por modulo.
 *
 * Cada perfil tiene un alcance (una sola sede o multisede), un perfil "base" (administrador, mozo, caja o cocina: define
 * que operaciones puede hacer dentro de un modulo, segun las reglas de cada ruta) y la lista de modulos a los que entra.
 * La tabla perfil_modulos es editable desde la pantalla de permisos; las semillas de abajo vienen de "usuarios secundarios
 * modulos.xlsx" (hoja RESTAURANTE) y de los perfiles que ya existian.
 */

const SUPERADMIN = 'superadmin';

// Claves iguales a las de client/src/security/accessControl.js
const MODULOS = [
    { clave: 'dashboard', nombre: 'Inicio' },
    { clave: 'pos', nombre: 'Punto de venta' },
    { clave: 'delivery', nombre: 'Pedidos delivery' },
    { clave: 'reservations', nombre: 'Reservas' },
    { clave: 'menu', nombre: 'Carta / Menú' },
    { clave: 'kitchen', nombre: 'Cocina' },
    { clave: 'bar', nombre: 'Bar / Bebidas' },
    { clave: 'inventory', nombre: 'Inventario' },
    { clave: 'purchases', nombre: 'Compras' },
    { clave: 'warehouses', nombre: 'Almacenes y guías' },
    { clave: 'equipment', nombre: 'Equipos' },
    { clave: 'expenses', nombre: 'Gastos y pagos' },
    { clave: 'reminders', nombre: 'Recordatorios' },
    { clave: 'suppliers', nombre: 'Proveedores' },
    { clave: 'clients', nombre: 'Clientes' },
    { clave: 'billing', nombre: 'Facturación' },
    { clave: 'receivables', nombre: 'Cuentas por cobrar' },
    { clave: 'sedes', nombre: 'Sedes' },
    { clave: 'settings', nombre: 'Configuración y usuarios' },
    { clave: 'help', nombre: 'Ayuda' }
];
const MODULO_CLAVES = MODULOS.map((m) => m.clave);
const BASES = ['administrador', 'mozo', 'caja', 'cocina'];

const SEMILLA = [
    {
        codigo: 'administrador', nombre: 'Administrador', base: 'administrador', alcance: 'sede', sistema: 1,
        descripcion: 'Acceso a todo el sistema de su sede.',
        modulos: MODULO_CLAVES.filter((m) => m !== 'sedes')
    },
    {
        codigo: 'mozo', nombre: 'Mozo', base: 'mozo', alcance: 'sede', sistema: 1,
        descripcion: 'Atiende mesas, delivery y reservas.',
        modulos: ['dashboard', 'pos', 'delivery', 'reservations', 'equipment', 'clients', 'help']
    },
    {
        codigo: 'caja', nombre: 'Cajero', base: 'caja', alcance: 'sede', sistema: 1,
        descripcion: 'Solo información de su sede.',
        modulos: ['dashboard', 'pos', 'delivery', 'reservations', 'kitchen', 'bar', 'billing']
    },
    {
        codigo: 'cocina', nombre: 'Cocina', base: 'cocina', alcance: 'sede', sistema: 1,
        descripcion: 'Prepara comandas y despacha el bar.',
        modulos: ['dashboard', 'kitchen', 'bar', 'equipment', 'warehouses', 'help']
    },
    {
        codigo: 'contador', nombre: 'Contador', base: 'administrador', alcance: 'multisede', sistema: 0,
        descripcion: 'Acceso a todas las sedes: como un administrador con algunos módulos no incluidos.',
        modulos: ['dashboard', 'pos', 'delivery', 'reservations', 'menu', 'inventory', 'purchases', 'expenses', 'suppliers', 'clients', 'billing', 'receivables', 'sedes']
    },
    {
        codigo: 'supervisor', nombre: 'Supervisor', base: 'administrador', alcance: 'sede', sistema: 0,
        descripcion: 'Acceso solo a su sede.',
        modulos: ['dashboard', 'pos', 'delivery', 'reservations', 'menu', 'kitchen', 'bar', 'inventory', 'purchases', 'warehouses', 'equipment', 'expenses', 'reminders', 'suppliers', 'clients', 'billing']
    },
    {
        codigo: 'repartidor', nombre: 'Repartidor', base: 'mozo', alcance: 'sede', sistema: 0,
        descripcion: 'Solo los pedidos delivery de su sede.',
        modulos: ['delivery']
    }
];

// Modulos que cada perfil base ya tenia antes de existir los permisos editables: dentro de ellos rigen las reglas de cada ruta
// (p. ej. solo el administrador emite notas de credito); un modulo agregado fuera de esta lista da acceso completo a sus rutas.
const BASE_NATIVOS = {
    administrador: new Set(MODULO_CLAVES.filter((m) => m !== 'sedes')),
    mozo: new Set(['dashboard', 'pos', 'delivery', 'reservations', 'equipment', 'clients', 'help']),
    caja: new Set(['dashboard', 'delivery', 'billing', 'receivables', 'expenses', 'equipment', 'reservations', 'clients', 'help']),
    cocina: new Set(['dashboard', 'kitchen', 'bar', 'equipment', 'warehouses', 'help'])
};

// Rutas de la API -> modulos que las usan (basta con tener uno). Las rutas compartidas (catalogos, mesas, clientes, etc.)
// no figuran: se rigen solo por las reglas de perfil de cada ruta. El orden importa: gana la primera coincidencia.
const RUTAS_MODULO = [
    // [ruta, condicion, modulos que pueden entrar (compuerta), modulos que ademas abren la ruta a un perfil base distinto (concesion)]
    [/^\/pedidos\/bar(\/|$)|^\/pedidos\/\d+\/despachar-bar$/, null, ['bar', 'kitchen']],
    [/^\/pedidos\/cocina$|^\/pedidos\/detalle\/\d+\/estado$|^\/pedidos\/\d+\/estado$/, null, ['kitchen', 'bar']],
    [/^\/pedidos(\/|$)/, null, ['pos', 'delivery', 'billing', 'kitchen', 'bar'], ['pos']],
    [/^\/delivery(\/|$)/, null, ['delivery']],
    [/^\/reservas(\/|$)/, null, ['reservations']],
    [/^\/(gastos|pagos-gastos|categorias-gasto)(\/|$)/, null, ['expenses']],
    [/^\/recordatorios(\/|$)/, null, ['reminders']],
    [/^\/(cuentas-por-cobrar|cobros)(\/|$)/, null, ['receivables', 'billing'], ['receivables']],
    [/^\/facturas(\/|$)/, null, ['billing', 'pos', 'delivery', 'receivables'], ['billing']],
    [/^\/(caja|cajas)(\/|$)/, null, ['billing', 'pos', 'delivery', 'receivables', 'expenses'], ['billing']],
    [/^\/reportes(\/|$)/, null, ['billing', 'receivables'], ['billing']],
    [/^\/compras(\/|$)/, null, ['purchases']],
    [/^\/inventario(\/|$)/, null, ['inventory', 'warehouses'], ['inventory']],
    [/^\/(guias|transferencias)(\/|$)/, null, ['warehouses', 'inventory', 'billing'], ['warehouses']],
    [/^\/(equipos|mantenimientos|mantenimiento-planes)(\/|$)/, null, ['equipment']],
    [/^\/proveedores(\/|$)/, null, ['suppliers', 'purchases', 'expenses', 'inventory'], ['suppliers', 'purchases']],
    [/^\/sedes(\/|$)/, 'ESCRITURA', ['sedes']],
    // Usuarios y permisos exigen el perfil base administrador: ningun modulo los abre a otro perfil base.
    [/^\/(usuarios|permisos)(\/|$)/, null, ['settings'], []],
    [/^\/configuracion(\/|$)/, null, ['settings', 'billing'], ['settings']]
];

const cache = new Map();
let esquemaListo = false;

const cargarSemilla = () => {
    cache.clear();
    for (const p of SEMILLA) cache.set(p.codigo, { ...p, modulos: new Set(p.modulos) });
};
cargarSemilla(); // mientras no haya tablas, el sistema funciona con los perfiles por defecto

const columnaEsEnum = async () => {
    const [rows] = await pool.query(
        `SELECT DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'rol' LIMIT 1`
    );
    return rows.length > 0 && String(rows[0].DATA_TYPE).toLowerCase() === 'enum';
};

/** Crea las tablas si faltan, siembra los perfiles y carga todo en memoria. Idempotente; seguro de repetir. */
const iniciar = async () => {
    try {
        if (await columnaEsEnum()) {
            await pool.query("ALTER TABLE usuarios MODIFY rol VARCHAR(30) NOT NULL DEFAULT 'mozo'");
        }
        await pool.query(
            `CREATE TABLE IF NOT EXISTS perfiles (
                codigo VARCHAR(30) NOT NULL PRIMARY KEY,
                nombre VARCHAR(60) NOT NULL,
                descripcion VARCHAR(255) NULL,
                base VARCHAR(20) NOT NULL,
                alcance VARCHAR(10) NOT NULL DEFAULT 'sede',
                sistema TINYINT(1) NOT NULL DEFAULT 0,
                creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
        );
        await pool.query(
            `CREATE TABLE IF NOT EXISTS perfil_modulos (
                perfil VARCHAR(30) NOT NULL,
                modulo VARCHAR(30) NOT NULL,
                PRIMARY KEY (perfil, modulo),
                CONSTRAINT fk_perfil_modulos_perfil FOREIGN KEY (perfil) REFERENCES perfiles(codigo) ON DELETE CASCADE ON UPDATE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
        );
        for (const p of SEMILLA) {
            const [result] = await pool.query(
                'INSERT IGNORE INTO perfiles (codigo, nombre, descripcion, base, alcance, sistema) VALUES (?, ?, ?, ?, ?, ?)',
                [p.codigo, p.nombre, p.descripcion, p.base, p.alcance, p.sistema]
            );
            // Los modulos se siembran solo la primera vez: despues mandan los cambios hechos en la pantalla de permisos.
            if (result.affectedRows > 0 && p.modulos.length > 0) {
                await pool.query('INSERT IGNORE INTO perfil_modulos (perfil, modulo) VALUES ?', [p.modulos.map((m) => [p.codigo, m])]);
            }
        }
        await recargar();
        esquemaListo = true;
    } catch (err) {
        console.error('Permisos: se usan los perfiles por defecto (no se pudo preparar la base):', err.message);
    }
};

const recargar = async () => {
    const [perfiles] = await pool.query('SELECT codigo, nombre, descripcion, base, alcance, sistema FROM perfiles');
    const [modulos] = await pool.query('SELECT perfil, modulo FROM perfil_modulos');
    const porPerfil = new Map();
    for (const m of modulos) {
        if (!porPerfil.has(m.perfil)) porPerfil.set(m.perfil, new Set());
        porPerfil.get(m.perfil).add(m.modulo);
    }
    cache.clear();
    for (const p of perfiles) {
        cache.set(p.codigo, {
            codigo: p.codigo, nombre: p.nombre, descripcion: p.descripcion, base: BASES.includes(p.base) ? p.base : 'mozo',
            alcance: p.alcance === 'multisede' ? 'multisede' : 'sede', sistema: Number(p.sistema),
            modulos: porPerfil.get(p.codigo) || new Set()
        });
    }
};

const get = (codigo) => cache.get(String(codigo || '').toLowerCase().trim());
const todos = () => [...cache.values()];
const estaListo = () => esquemaListo;

/** Contexto de permisos de un usuario a partir de su codigo de perfil. */
const contextoDe = (codigo) => {
    if (codigo === SUPERADMIN) {
        return { base: 'administrador', multisede: true, modulos: new Set(MODULO_CLAVES) };
    }
    const perfil = get(codigo);
    if (!perfil) return { base: null, multisede: false, modulos: new Set() };
    return { base: perfil.base, multisede: perfil.alcance === 'multisede', modulos: perfil.modulos };
};

const entradaDeRuta = (metodo, ruta) => {
    const esLectura = metodo === 'GET' || metodo === 'HEAD' || metodo === 'OPTIONS';
    for (const [regex, condicion, compuerta, concesion] of RUTAS_MODULO) {
        if (!regex.test(ruta)) continue;
        if (condicion === 'ESCRITURA' && esLectura) return null;
        return { compuerta, concesion: concesion || compuerta };
    }
    return null;
};

const modulosDeRuta = (metodo, ruta) => entradaDeRuta(metodo, ruta)?.compuerta || null;

/** Ruta de la API sin el prefijo /api ni la query. */
const rutaDe = (req) => String(req.originalUrl || req.url || '').split('?')[0].replace(/^\/api/, '') || '/';

/** Bloquea una ruta de un modulo cuando el perfil no tiene ninguno de los modulos que la usan. */
const compuerta = (req, res, next) => {
    const ctx = req.userContext;
    if (!ctx || ctx.perfil === SUPERADMIN) return next();
    const modulos = modulosDeRuta(req.method, rutaDe(req));
    if (modulos && !modulos.some((m) => ctx.modulos.has(m))) {
        return res.status(403).json({ error: 'Su perfil no tiene acceso a este modulo' });
    }
    next();
};

/** Un modulo agregado al perfil (fuera de los que su perfil base ya tenia) abre todas las rutas de ese modulo. */
const concedeRuta = (req) => {
    const ctx = req.userContext;
    if (!ctx?.base) return false;
    const entrada = entradaDeRuta(req.method, rutaDe(req));
    if (!entrada) return false;
    const nativos = BASE_NATIVOS[ctx.base] || new Set();
    return entrada.concesion.some((m) => ctx.modulos.has(m) && !nativos.has(m));
};

module.exports = {
    SUPERADMIN, MODULOS, MODULO_CLAVES, BASES, SEMILLA,
    iniciar, recargar, get, todos, estaListo, contextoDe, compuerta, concedeRuta, modulosDeRuta
};
