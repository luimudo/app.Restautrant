const crypto = require('crypto');
const express = require('express');
const pool = require('./db');

/**
 * R-01 Modulo Personal (propuesta COT-2026-0010), tomado del modulo Personal del Sistema de Distribucion de Bebidas:
 *   - Trabajadores: ficha, vinculo laboral, funciones, contacto y documentos adjuntos (hasta 15 MB).
 *   - Uniforme y EPP: entregas por trabajador y devoluciones.
 *   - Control diario C/NC por fecha, turno y area.
 *   - Elementos de EPP (catalogo), costos por trabajador y area, y cargos / areas / turnos.
 *
 * El hosting usa MySQL 5.7 con max_allowed_packet de 4 MB: cada adjunto se guarda en partes de 1 MB.
 */

const MAX_ADJUNTO = 15 * 1024 * 1024;
const PARTE_ADJUNTO = 1024 * 1024;
const MIMES_ADJUNTO = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };
const TIPOS_ADJUNTO = ['contrato', 'dni', 'certificado', 'antecedentes', 'otro'];
const VINCULOS = ['planilla', 'honorarios', 'locacion', 'practicante'];
const ESTADOS = ['activo', 'vacaciones', 'suspendido', 'cesado'];
// Funciones del trabajador: texto libre (como el sistema concesionario). Estas etiquetas solo convierten los codigos antiguos.
const FUNCIONES_ANTIGUAS = { mozo: 'Mozo', cocina: 'Cocina', bar: 'Bar', caja: 'Caja', delivery: 'Delivery', limpieza: 'Limpieza', administracion: 'Administración' };
const TIPOS_MOVIMIENTO = ['devolucion', 'baja'];
const ESTADOS_ELEMENTO = ['nuevo', 'bueno', 'regular', 'danado'];
const CATALOGOS = {
    cargos: { tabla: 'personal_cargos', columna: 'cargo_id' },
    areas: { tabla: 'personal_areas', columna: 'area_id' },
    turnos: { tabla: 'personal_turnos', columna: 'turno_id' }
};

let listo = false;

class PersonalError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
const fail = (status, message) => { throw new PersonalError(status, message); };

const enviarError = (res, err) => {
    if (err instanceof PersonalError) return res.status(err.status).json({ error: err.message });
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe un registro con ese dato (DNI, codigo o nombre)' });
    console.error('Personal:', err);
    return res.status(500).json({ error: err.message });
};

const hoyLima = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());
const esFecha = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`))
    && new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v;
const texto = (v, max) => {
    const t = String(v ?? '').trim().replace(/\s+/g, ' ');
    return t ? t.slice(0, max) : null;
};
const fechaOpcional = (v, etiqueta) => {
    if (v === undefined || v === null || v === '') return null;
    const f = String(v).slice(0, 10);
    if (!esFecha(f)) fail(400, `${etiqueta} no es una fecha valida`);
    return f;
};
const idOpcional = (v) => (v === undefined || v === null || v === '' || Number(v) === 0 ? null : Number(v));
const redondear = (v, d = 2) => Math.round((Number(v) + Number.EPSILON) * 10 ** d) / 10 ** d;
const sumarMeses = (ymd, meses) => {
    const [a, m, d] = ymd.split('-').map(Number);
    const total = a * 12 + (m - 1) + meses;
    const anio = Math.floor(total / 12);
    const mes = (total % 12) + 1;
    const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
    return `${anio}-${String(mes).padStart(2, '0')}-${String(Math.min(d, ultimo)).padStart(2, '0')}`;
};

// --- Esquema ---
const asegurarEsquema = async () => {
    const q = (sql) => pool.query(sql);
    const tabla = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
    for (const [nombre, extra] of [['personal_cargos', ''], ['personal_areas', ''], ['personal_turnos', 'hora_inicio TIME NULL, hora_fin TIME NULL,']]) {
        await q(`CREATE TABLE IF NOT EXISTS ${nombre} (
            id INT AUTO_INCREMENT PRIMARY KEY,
            nombre VARCHAR(100) NOT NULL,
            descripcion VARCHAR(255) NULL,
            ${extra}
            activo TINYINT(1) NOT NULL DEFAULT 1,
            creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_${nombre}_nombre (nombre)
        ) ${tabla}`);
    }
    await q(`CREATE TABLE IF NOT EXISTS personal (
        id INT AUTO_INCREMENT PRIMARY KEY,
        sede_id INT NOT NULL,
        dni VARCHAR(8) NOT NULL,
        codigo VARCHAR(30) NULL,
        nombres VARCHAR(120) NOT NULL,
        apellidos VARCHAR(120) NOT NULL,
        fecha_nacimiento DATE NULL,
        fecha_ingreso DATE NULL,
        fecha_cese DATE NULL,
        cargo_id INT NULL,
        area_id INT NULL,
        turno_id INT NULL,
        vinculo VARCHAR(20) NOT NULL DEFAULT 'planilla',
        ruc VARCHAR(11) NULL,
        sistema_pension VARCHAR(60) NULL,
        cuspp VARCHAR(30) NULL,
        remuneracion DECIMAL(12,2) NULL,
        funciones TEXT NULL,
        telefono VARCHAR(40) NULL,
        email VARCHAR(120) NULL,
        direccion VARCHAR(300) NULL,
        contacto_emergencia VARCHAR(150) NULL,
        telefono_emergencia VARCHAR(40) NULL,
        usuario_id INT NULL,
        estado VARCHAR(15) NOT NULL DEFAULT 'activo',
        talla_polo VARCHAR(20) NULL,
        talla_pantalon VARCHAR(20) NULL,
        talla_calzado VARCHAR(20) NULL,
        observacion VARCHAR(2000) NULL,
        usuario_registro_id INT NULL,
        creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
        actualizado_en DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_personal_dni (dni),
        UNIQUE KEY uq_personal_codigo (codigo),
        KEY idx_personal_sede_estado (sede_id, estado),
        CONSTRAINT fk_personal_sede FOREIGN KEY (sede_id) REFERENCES sedes(id),
        CONSTRAINT fk_personal_cargo FOREIGN KEY (cargo_id) REFERENCES personal_cargos(id),
        CONSTRAINT fk_personal_area FOREIGN KEY (area_id) REFERENCES personal_areas(id),
        CONSTRAINT fk_personal_turno FOREIGN KEY (turno_id) REFERENCES personal_turnos(id),
        CONSTRAINT fk_personal_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    ) ${tabla}`);
    await q(`CREATE TABLE IF NOT EXISTS personal_adjuntos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        personal_id INT NOT NULL,
        tipo VARCHAR(20) NOT NULL DEFAULT 'otro',
        nombre VARCHAR(180) NOT NULL,
        mime VARCHAR(50) NOT NULL,
        tamano INT NOT NULL,
        partes INT NOT NULL,
        sha256 CHAR(64) NOT NULL,
        eliminado TINYINT(1) NOT NULL DEFAULT 0,
        usuario_id INT NULL,
        creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
        KEY idx_personal_adjuntos (personal_id, eliminado),
        CONSTRAINT fk_padjuntos_personal FOREIGN KEY (personal_id) REFERENCES personal(id)
    ) ${tabla}`);
    await q(`CREATE TABLE IF NOT EXISTS personal_adjunto_partes (
        adjunto_id INT NOT NULL,
        parte INT NOT NULL,
        datos MEDIUMBLOB NOT NULL,
        PRIMARY KEY (adjunto_id, parte),
        CONSTRAINT fk_padjpartes_adjunto FOREIGN KEY (adjunto_id) REFERENCES personal_adjuntos(id) ON DELETE CASCADE
    ) ${tabla}`);
    await q(`CREATE TABLE IF NOT EXISTS epp_elementos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nombre VARCHAR(150) NOT NULL,
        tipo VARCHAR(10) NOT NULL DEFAULT 'epp',
        unidad VARCHAR(20) NOT NULL DEFAULT 'UND',
        frecuencia_meses INT NOT NULL DEFAULT 0,
        costo_unitario DECIMAL(12,2) NULL,
        area_id INT NULL,
        control_diario TINYINT(1) NOT NULL DEFAULT 1,
        activo TINYINT(1) NOT NULL DEFAULT 1,
        creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_epp_elementos_nombre (nombre),
        CONSTRAINT fk_epp_elementos_area FOREIGN KEY (area_id) REFERENCES personal_areas(id)
    ) ${tabla}`);
    await q(`CREATE TABLE IF NOT EXISTS epp_entregas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        sede_id INT NOT NULL,
        personal_id INT NOT NULL,
        elemento_id INT NOT NULL,
        elemento_nombre VARCHAR(150) NOT NULL,
        area_id INT NULL,
        fecha DATE NOT NULL,
        cantidad DECIMAL(12,2) NOT NULL,
        devuelta DECIMAL(12,2) NOT NULL DEFAULT 0,
        talla VARCHAR(30) NULL,
        estado VARCHAR(10) NOT NULL DEFAULT 'nuevo',
        motivo VARCHAR(500) NOT NULL,
        proximo_cambio DATE NULL,
        costo_unitario DECIMAL(12,2) NOT NULL DEFAULT 0,
        costo_total DECIMAL(14,2) NOT NULL DEFAULT 0,
        control_detalle_id INT NULL,
        anulada TINYINT(1) NOT NULL DEFAULT 0,
        motivo_anulacion VARCHAR(255) NULL,
        usuario_id INT NULL,
        creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
        KEY idx_epp_entregas_personal (personal_id, fecha),
        KEY idx_epp_entregas_sede (sede_id, fecha),
        CONSTRAINT fk_eppent_sede FOREIGN KEY (sede_id) REFERENCES sedes(id),
        CONSTRAINT fk_eppent_personal FOREIGN KEY (personal_id) REFERENCES personal(id),
        CONSTRAINT fk_eppent_elemento FOREIGN KEY (elemento_id) REFERENCES epp_elementos(id)
    ) ${tabla}`);
    await q(`CREATE TABLE IF NOT EXISTS epp_devoluciones (
        id INT AUTO_INCREMENT PRIMARY KEY,
        entrega_id INT NOT NULL,
        cantidad DECIMAL(12,2) NOT NULL,
        fecha DATE NOT NULL,
        estado VARCHAR(10) NOT NULL,
        motivo VARCHAR(500) NOT NULL,
        usuario_id INT NULL,
        creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_eppdev_entrega FOREIGN KEY (entrega_id) REFERENCES epp_entregas(id)
    ) ${tabla}`);
    await q(`CREATE TABLE IF NOT EXISTS epp_controles (
        id INT AUTO_INCREMENT PRIMARY KEY,
        sede_id INT NOT NULL,
        area_id INT NULL,
        area_key INT NOT NULL DEFAULT 0,
        turno_id INT NOT NULL,
        fecha DATE NOT NULL,
        estado VARCHAR(10) NOT NULL DEFAULT 'abierto',
        cumplimiento DECIMAL(5,2) NULL,
        observacion VARCHAR(500) NULL,
        usuario_id INT NULL,
        creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
        cerrado_en DATETIME NULL,
        UNIQUE KEY uq_epp_control_jornada (sede_id, area_key, turno_id, fecha),
        CONSTRAINT fk_eppctl_sede FOREIGN KEY (sede_id) REFERENCES sedes(id),
        CONSTRAINT fk_eppctl_turno FOREIGN KEY (turno_id) REFERENCES personal_turnos(id)
    ) ${tabla}`);
    await q(`CREATE TABLE IF NOT EXISTS epp_control_detalle (
        id INT AUTO_INCREMENT PRIMARY KEY,
        control_id INT NOT NULL,
        personal_id INT NOT NULL,
        elemento_id INT NOT NULL,
        elemento_nombre VARCHAR(150) NOT NULL,
        resultado VARCHAR(2) NULL,
        observacion VARCHAR(500) NULL,
        reposicion_id INT NULL,
        UNIQUE KEY uq_epp_control_item (control_id, personal_id, elemento_id),
        CONSTRAINT fk_eppdet_control FOREIGN KEY (control_id) REFERENCES epp_controles(id),
        CONSTRAINT fk_eppdet_personal FOREIGN KEY (personal_id) REFERENCES personal(id)
    ) ${tabla}`);

    // Catalogos iniciales (solo si estan vacios): despues se editan desde la pantalla.
    const semilla = async (nombreTabla, columnas, filas) => {
        const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM ${nombreTabla}`);
        if (Number(total) === 0) await pool.query(`INSERT IGNORE INTO ${nombreTabla} (${columnas}) VALUES ?`, [filas]);
    };
    await semilla('personal_cargos', 'nombre', [['Administrador'], ['Cajero'], ['Mozo'], ['Jefe de cocina'], ['Cocinero'], ['Ayudante de cocina'], ['Bartender'], ['Repartidor'], ['Limpieza']]);
    await semilla('personal_areas', 'nombre', [['Cocina'], ['Bar'], ['Salón'], ['Caja'], ['Delivery'], ['Limpieza'], ['Administración']]);
    await semilla('personal_turnos', 'nombre, hora_inicio, hora_fin', [['Mañana', '07:00:00', '15:00:00'], ['Tarde', '15:00:00', '23:00:00'], ['Noche', '18:00:00', '02:00:00']]);
    await semilla('epp_elementos', 'nombre, tipo, unidad, frecuencia_meses, control_diario', [
        ['Chaqueta / polo de trabajo', 'uniforme', 'UND', 6, 1],
        ['Pantalón de trabajo', 'uniforme', 'UND', 6, 0],
        ['Mandil', 'uniforme', 'UND', 6, 1],
        ['Gorro / malla para cabello', 'epp', 'UND', 0, 1],
        ['Mascarilla', 'epp', 'UND', 0, 1],
        ['Guantes descartables', 'epp', 'PAR', 0, 1],
        ['Calzado antideslizante', 'epp', 'PAR', 12, 1],
        ['Guantes anticorte', 'epp', 'PAR', 6, 0]
    ]);
    await actualizarEsquema();
    listo = true;
};

/**
 * Observaciones del cliente (nov. 2026), idempotente:
 *   - funciones pasa de codigos fijos (VARCHAR) a texto libre (TEXT); los codigos antiguos se convierten a texto ("Mozo, Caja").
 *   - devoluciones y bajas: epp_devoluciones.tipo y epp_entregas.baja (saldo vigente = cantidad - devuelta - baja).
 *   - tallas del trabajador (polo/camisa, pantalon, calzado) como referencia al entregar uniforme, igual que el sistema concesionario.
 */
const actualizarEsquema = async () => {
    const tipoColumna = async (tablaNombre, col) => {
        const [rows] = await pool.query(
            'SELECT DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [tablaNombre, col]);
        return rows[0] ? String(rows[0].DATA_TYPE).toLowerCase() : null;
    };
    if ((await tipoColumna('personal', 'funciones')) === 'varchar') {
        await pool.query('ALTER TABLE personal MODIFY funciones TEXT NULL');
        console.log('personal.funciones ahora es texto libre');
    }
    // Codigos antiguos ("mozo,caja") -> texto ("Mozo, Caja"). Solo filas cuyas partes son todas codigos antiguos.
    const [rows] = await pool.query("SELECT id, funciones FROM personal WHERE funciones REGEXP '^[a-z]+(,[a-z]+)*$'");
    for (const r of rows) {
        const partes = String(r.funciones).split(',').map((f) => f.trim()).filter(Boolean);
        if (partes.length && partes.every((f) => FUNCIONES_ANTIGUAS[f])) {
            await pool.query('UPDATE personal SET funciones = ? WHERE id = ?', [partes.map((f) => FUNCIONES_ANTIGUAS[f]).join(', '), r.id]);
        }
    }
    if (!(await tipoColumna('epp_devoluciones', 'tipo'))) {
        await pool.query("ALTER TABLE epp_devoluciones ADD COLUMN tipo VARCHAR(12) NOT NULL DEFAULT 'devolucion' AFTER entrega_id");
        console.log('epp_devoluciones.tipo agregado');
    }
    if (!(await tipoColumna('epp_entregas', 'baja'))) {
        await pool.query('ALTER TABLE epp_entregas ADD COLUMN baja DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER devuelta');
        console.log('epp_entregas.baja agregado');
    }
    for (const col of ['talla_polo', 'talla_pantalon', 'talla_calzado']) {
        if (!(await tipoColumna('personal', col))) {
            await pool.query(`ALTER TABLE personal ADD COLUMN ${col} VARCHAR(20) NULL AFTER estado`);
            console.log(`personal.${col} agregado`);
        }
    }
};

// --- Contexto del usuario ---
const puedeVerRemuneracion = (req) => req.userContext?.perfil === 'superadmin' || req.userContext?.base === 'administrador';
const sedeDe = (req) => req.userContext?.sedeId ?? null;

const requiereListo = (req, res, next) => {
    if (!listo) return res.status(503).json({ error: 'El modulo Personal se esta preparando: intente en unos segundos' });
    if (!sedeDe(req)) return res.status(400).json({ error: 'Seleccione una sede para continuar' });
    next();
};

// --- Trabajadores ---
const TRABAJADOR_SQL = `
    SELECT x.*, DATE_FORMAT(x.fecha_nacimiento, '%Y-%m-%d') AS fecha_nacimiento, DATE_FORMAT(x.fecha_ingreso, '%Y-%m-%d') AS fecha_ingreso,
           DATE_FORMAT(x.fecha_cese, '%Y-%m-%d') AS fecha_cese, CONCAT(x.nombres, ' ', x.apellidos) AS nombre_completo,
           c.nombre AS cargo, a.nombre AS area, t.nombre AS turno, s.nombre AS sede_nombre, u.nombre AS usuario_nombre,
           (SELECT COUNT(*) FROM personal_adjuntos pa WHERE pa.personal_id = x.id AND pa.eliminado = 0) AS adjuntos
    FROM personal x
    JOIN sedes s ON s.id = x.sede_id
    LEFT JOIN personal_cargos c ON c.id = x.cargo_id
    LEFT JOIN personal_areas a ON a.id = x.area_id
    LEFT JOIN personal_turnos t ON t.id = x.turno_id
    LEFT JOIN usuarios u ON u.id = x.usuario_id
`;

const limpiarTrabajador = (req, row) => {
    if (!row) return row;
    const r = { ...row, remuneracion: row.remuneracion === null ? null : Number(row.remuneracion), adjuntos: Number(row.adjuntos || 0) };
    r.funciones = row.funciones ? String(row.funciones) : '';
    if (!puedeVerRemuneracion(req)) delete r.remuneracion;
    return r;
};

const buscarTrabajador = async (connection, req, id, lock = false) => {
    const [rows] = await connection.query(`${TRABAJADOR_SQL} WHERE x.id = ? AND x.sede_id = ?${lock ? ' FOR UPDATE' : ''}`, [id, sedeDe(req)]);
    if (!rows[0]) fail(404, 'Trabajador no encontrado en esta sede');
    return rows[0];
};

const catalogoActivo = async (connection, tipo, id) => {
    if (!id) return;
    const { tabla } = CATALOGOS[tipo];
    const [rows] = await connection.query(`SELECT activo FROM ${tabla} WHERE id = ?`, [id]);
    if (!rows[0]) fail(400, `El registro de ${tipo} seleccionado no existe`);
};

const parseTrabajador = (body, req) => {
    const d = {
        dni: String(body?.dni ?? '').trim(),
        codigo: texto(body?.codigo, 30),
        nombres: texto(body?.nombres, 120),
        apellidos: texto(body?.apellidos, 120),
        fecha_nacimiento: fechaOpcional(body?.fecha_nacimiento, 'La fecha de nacimiento'),
        fecha_ingreso: fechaOpcional(body?.fecha_ingreso, 'La fecha de ingreso'),
        fecha_cese: fechaOpcional(body?.fecha_cese, 'La fecha de cese'),
        cargo_id: idOpcional(body?.cargo_id),
        area_id: idOpcional(body?.area_id),
        turno_id: idOpcional(body?.turno_id),
        vinculo: String(body?.vinculo || 'planilla').toLowerCase(),
        ruc: texto(body?.ruc, 11),
        sistema_pension: texto(body?.sistema_pension, 60),
        cuspp: texto(body?.cuspp, 30),
        funciones: (() => {
            const v = Array.isArray(body?.funciones) ? body.funciones.join(', ') : String(body?.funciones ?? '');
            const t = v.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').trim();
            return t ? t.slice(0, 4000) : null;
        })(),
        telefono: texto(body?.telefono, 40),
        email: texto(body?.email, 120),
        direccion: texto(body?.direccion, 300),
        contacto_emergencia: texto(body?.contacto_emergencia, 150),
        telefono_emergencia: texto(body?.telefono_emergencia, 40),
        usuario_id: idOpcional(body?.usuario_id),
        estado: String(body?.estado || 'activo').toLowerCase(),
        talla_polo: texto(body?.talla_polo, 20),
        talla_pantalon: texto(body?.talla_pantalon, 20),
        talla_calzado: texto(body?.talla_calzado, 20),
        observacion: texto(body?.observacion, 2000)
    };
    const errores = [];
    if (!/^\d{8}$/.test(d.dni)) errores.push('El DNI debe tener 8 digitos');
    if (!d.nombres || d.nombres.length < 2) errores.push('Ingrese los nombres');
    if (!d.apellidos || d.apellidos.length < 2) errores.push('Ingrese los apellidos');
    if (!VINCULOS.includes(d.vinculo)) errores.push('El tipo de vinculo no es valido');
    if (!ESTADOS.includes(d.estado)) errores.push('El estado no es valido');
    if (d.ruc && !/^\d{11}$/.test(d.ruc)) errores.push('El RUC debe tener 11 digitos');
    if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) errores.push('El correo no es valido');
    if (d.fecha_cese) d.estado = 'cesado';
    if (d.estado === 'cesado' && !d.fecha_cese) errores.push('Indique la fecha de cese');
    if (d.fecha_nacimiento && d.fecha_ingreso && d.fecha_nacimiento >= d.fecha_ingreso) errores.push('El ingreso debe ser posterior al nacimiento');
    if (d.fecha_cese && d.fecha_ingreso && d.fecha_cese < d.fecha_ingreso) errores.push('El cese no puede ser anterior al ingreso');
    if (d.fecha_ingreso && d.fecha_ingreso > hoyLima()) errores.push('La fecha de ingreso no puede ser futura');
    // La remuneracion solo la registra quien puede verla; los demas conservan la que tenga.
    if (puedeVerRemuneracion(req) && Object.prototype.hasOwnProperty.call(body || {}, 'remuneracion')) {
        if (body.remuneracion === '' || body.remuneracion === null) d.remuneracion = null;
        else {
            d.remuneracion = redondear(body.remuneracion);
            if (!(d.remuneracion >= 0) || d.remuneracion > 1000000) errores.push('La remuneracion no es valida');
        }
    }
    if (errores.length) fail(400, errores.join('. '));
    return d;
};

const guardarTrabajador = async (req, id) => {
    const d = parseTrabajador(req.body, req);
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        if (id) await buscarTrabajador(connection, req, id, true);
        for (const tipo of Object.keys(CATALOGOS)) await catalogoActivo(connection, tipo, d[CATALOGOS[tipo].columna]);
        if (d.usuario_id) {
            const [u] = await connection.query('SELECT id, sede_id FROM usuarios WHERE id = ?', [d.usuario_id]);
            if (!u[0] || (u[0].sede_id !== null && Number(u[0].sede_id) !== Number(sedeDe(req)))) fail(400, 'El usuario del sistema debe pertenecer a la sede');
            const [otro] = await connection.query('SELECT id FROM personal WHERE usuario_id = ? AND id <> ?', [d.usuario_id, id || 0]);
            if (otro[0]) fail(409, 'Ese usuario del sistema ya esta vinculado a otro trabajador');
        }
        const campos = Object.keys(d);
        if (id) {
            await connection.query(`UPDATE personal SET ${campos.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [...campos.map((c) => d[c]), id]);
        } else {
            const [r] = await connection.query(
                `INSERT INTO personal (sede_id, ${campos.join(', ')}, usuario_registro_id) VALUES (?, ${campos.map(() => '?').join(', ')}, ?)`,
                [sedeDe(req), ...campos.map((c) => d[c]), req.userContext.id]
            );
            id = r.insertId;
        }
        await connection.commit();
        return limpiarTrabajador(req, await buscarTrabajador(pool, req, id));
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
};

// --- Adjuntos (hasta 15 MB, en partes de 1 MB) ---
const detectarMime = (buffer) => {
    if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
    return null;
};

const subirAdjunto = async (req, personalId) => {
    const buffer = req.body;
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) fail(400, 'Seleccione un archivo');
    if (buffer.length > MAX_ADJUNTO) fail(413, 'El archivo supera los 15 MB');
    const mime = detectarMime(buffer);
    if (!mime) fail(400, 'Solo se admiten archivos PDF, JPG o PNG');
    let nombre = String(req.query.nombre || '').replace(/[\\/:*?"<>|\r\n]+/g, '_').trim().slice(0, 180);
    if (!nombre) nombre = `documento.${MIMES_ADJUNTO[mime]}`;
    const tipo = TIPOS_ADJUNTO.includes(String(req.query.tipo)) ? String(req.query.tipo) : 'otro';
    const partes = Math.ceil(buffer.length / PARTE_ADJUNTO);
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        await buscarTrabajador(connection, req, personalId, true);
        const [r] = await connection.query(
            'INSERT INTO personal_adjuntos (personal_id, tipo, nombre, mime, tamano, partes, sha256, usuario_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [personalId, tipo, nombre, mime, buffer.length, partes, crypto.createHash('sha256').update(buffer).digest('hex'), req.userContext.id]
        );
        for (let i = 0; i < partes; i += 1) {
            await connection.query('INSERT INTO personal_adjunto_partes (adjunto_id, parte, datos) VALUES (?, ?, ?)',
                [r.insertId, i, buffer.subarray(i * PARTE_ADJUNTO, (i + 1) * PARTE_ADJUNTO)]);
        }
        await connection.commit();
        return { id: r.insertId, personal_id: personalId, tipo, nombre, mime, tamano: buffer.length };
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
};

const listarAdjuntos = async (personalId) => {
    const [rows] = await pool.query(
        `SELECT a.id, a.personal_id, a.tipo, a.nombre, a.mime, a.tamano, a.creado_en, u.nombre AS usuario_nombre
         FROM personal_adjuntos a LEFT JOIN usuarios u ON u.id = a.usuario_id
         WHERE a.personal_id = ? AND a.eliminado = 0 ORDER BY a.id DESC`,
        [personalId]
    );
    return rows;
};

const buscarAdjunto = async (req, adjuntoId) => {
    const [rows] = await pool.query(
        `SELECT a.* FROM personal_adjuntos a JOIN personal p ON p.id = a.personal_id
         WHERE a.id = ? AND a.eliminado = 0 AND p.sede_id = ?`,
        [adjuntoId, sedeDe(req)]
    );
    if (!rows[0]) fail(404, 'Documento no encontrado');
    return rows[0];
};

// --- Elementos de EPP ---
const parseElemento = (body) => {
    const d = {
        nombre: texto(body?.nombre, 150),
        tipo: String(body?.tipo || 'epp').toLowerCase(),
        unidad: texto(body?.unidad, 20) || 'UND',
        frecuencia_meses: body?.frecuencia_meses === '' || body?.frecuencia_meses === undefined ? 0 : Number(body.frecuencia_meses),
        costo_unitario: body?.costo_unitario === '' || body?.costo_unitario === undefined || body?.costo_unitario === null ? null : redondear(body.costo_unitario),
        area_id: idOpcional(body?.area_id),
        control_diario: body?.control_diario === undefined ? 1 : (body.control_diario && body.control_diario !== '0' ? 1 : 0),
        activo: body?.activo === undefined ? 1 : (body.activo && body.activo !== '0' ? 1 : 0)
    };
    const errores = [];
    if (!d.nombre || d.nombre.length < 2) errores.push('Ingrese el nombre del elemento');
    if (!['epp', 'uniforme'].includes(d.tipo)) errores.push('El tipo debe ser EPP o uniforme');
    if (!Number.isInteger(d.frecuencia_meses) || d.frecuencia_meses < 0 || d.frecuencia_meses > 120) errores.push('La frecuencia de cambio debe estar entre 0 y 120 meses');
    if (d.costo_unitario !== null && !(d.costo_unitario >= 0)) errores.push('El costo no es valido');
    if (errores.length) fail(400, errores.join('. '));
    return d;
};

// --- Entregas ---
const ENTREGA_SQL = `
    SELECT e.*, DATE_FORMAT(e.fecha, '%Y-%m-%d') AS fecha, DATE_FORMAT(e.proximo_cambio, '%Y-%m-%d') AS proximo_cambio,
           p.dni, CONCAT(p.nombres, ' ', p.apellidos) AS trabajador, el.tipo AS elemento_tipo, el.unidad, a.nombre AS area,
           ROUND(e.cantidad - e.devuelta - e.baja, 2) AS pendiente, u.nombre AS usuario_nombre,
           (SELECT DATE_FORMAT(MAX(d.fecha), '%Y-%m-%d') FROM epp_devoluciones d WHERE d.entrega_id = e.id AND d.tipo = 'devolucion') AS fecha_devolucion,
           (SELECT DATE_FORMAT(MAX(d.fecha), '%Y-%m-%d') FROM epp_devoluciones d WHERE d.entrega_id = e.id AND d.tipo = 'baja') AS fecha_baja
    FROM epp_entregas e
    JOIN personal p ON p.id = e.personal_id
    JOIN epp_elementos el ON el.id = e.elemento_id
    LEFT JOIN personal_areas a ON a.id = e.area_id
    LEFT JOIN usuarios u ON u.id = e.usuario_id
`;
const numerosEntrega = (e) => ({ ...e, cantidad: Number(e.cantidad), devuelta: Number(e.devuelta), baja: Number(e.baja || 0), pendiente: Number(e.pendiente),
    costo_unitario: Number(e.costo_unitario), costo_total: Number(e.costo_total) });

const registrarEntrega = async (req) => {
    const b = req.body || {};
    const personalId = Number(b.personal_id);
    const elementoId = Number(b.elemento_id);
    const fecha = String(b.fecha || hoyLima()).slice(0, 10);
    const cantidad = redondear(b.cantidad);
    const estado = String(b.estado || 'nuevo').toLowerCase();
    const motivo = texto(b.motivo, 500);
    const errores = [];
    if (!personalId) errores.push('Seleccione el trabajador');
    if (!elementoId) errores.push('Seleccione el elemento');
    if (!esFecha(fecha) || fecha > hoyLima()) errores.push('La fecha de entrega no puede ser futura');
    if (!(cantidad > 0)) errores.push('La cantidad debe ser mayor a 0');
    if (!ESTADOS_ELEMENTO.includes(estado)) errores.push('El estado del elemento no es valido');
    if (!motivo || motivo.length < 3) errores.push('Indique el motivo de la entrega');
    if (errores.length) fail(400, errores.join('. '));

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const p = await buscarTrabajador(connection, req, personalId, true);
        if (p.estado === 'cesado') fail(409, 'El trabajador esta cesado');
        const [els] = await connection.query('SELECT * FROM epp_elementos WHERE id = ? AND activo = 1', [elementoId]);
        const el = els[0];
        if (!el) fail(400, 'Seleccione un elemento activo');
        const costo = b.costo_unitario === undefined || b.costo_unitario === '' || b.costo_unitario === null ? Number(el.costo_unitario || 0) : redondear(b.costo_unitario);
        if (!(costo >= 0)) fail(400, 'El costo no es valido');
        let proximo = fechaOpcional(b.proximo_cambio, 'El proximo cambio');
        if (!proximo && Number(el.frecuencia_meses) > 0) proximo = sumarMeses(fecha, Number(el.frecuencia_meses));
        if (proximo && proximo < fecha) fail(400, 'El proximo cambio no puede ser anterior a la entrega');

        // Reposicion de una no conformidad del control diario (opcional).
        let controlDetalleId = idOpcional(b.control_detalle_id);
        if (controlDetalleId) {
            const [nc] = await connection.query(
                `SELECT d.* FROM epp_control_detalle d JOIN epp_controles c ON c.id = d.control_id
                 WHERE d.id = ? AND c.sede_id = ? FOR UPDATE`, [controlDetalleId, sedeDe(req)]);
            if (!nc[0] || Number(nc[0].personal_id) !== personalId || Number(nc[0].elemento_id) !== elementoId || nc[0].resultado !== 'NC' || nc[0].reposicion_id) {
                fail(400, 'La no conformidad seleccionada no corresponde o ya fue repuesta');
            }
        } else controlDetalleId = null;

        const [r] = await connection.query(
            `INSERT INTO epp_entregas (sede_id, personal_id, elemento_id, elemento_nombre, area_id, fecha, cantidad, talla, estado, motivo,
                proximo_cambio, costo_unitario, costo_total, control_detalle_id, usuario_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [sedeDe(req), personalId, elementoId, el.nombre, p.area_id || null, fecha, cantidad, texto(b.talla, 30), estado, motivo,
                proximo, costo, redondear(cantidad * costo), controlDetalleId, req.userContext.id]
        );
        if (controlDetalleId) await connection.query('UPDATE epp_control_detalle SET reposicion_id = ? WHERE id = ?', [r.insertId, controlDetalleId]);
        await connection.commit();
        const [rows] = await pool.query(`${ENTREGA_SQL} WHERE e.id = ?`, [r.insertId]);
        return numerosEntrega(rows[0]);
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
};

const buscarEntrega = async (connection, req, id) => {
    const [rows] = await connection.query(`${ENTREGA_SQL} WHERE e.id = ? AND e.sede_id = ? FOR UPDATE`, [id, sedeDe(req)]);
    if (!rows[0]) fail(404, 'Entrega no encontrada');
    return numerosEntrega(rows[0]);
};

// --- Control diario C/NC ---
const CONTROL_SQL = `
    SELECT c.*, DATE_FORMAT(c.fecha, '%Y-%m-%d') AS fecha, t.nombre AS turno, a.nombre AS area, u.nombre AS usuario_nombre,
           (SELECT COUNT(*) FROM epp_control_detalle d WHERE d.control_id = c.id) AS items,
           (SELECT COUNT(*) FROM epp_control_detalle d WHERE d.control_id = c.id AND d.resultado = 'NC') AS no_conformes,
           (SELECT COUNT(*) FROM epp_control_detalle d WHERE d.control_id = c.id AND d.resultado IS NULL) AS sin_marcar
    FROM epp_controles c
    JOIN personal_turnos t ON t.id = c.turno_id
    LEFT JOIN personal_areas a ON a.id = c.area_id
    LEFT JOIN usuarios u ON u.id = c.usuario_id
`;

const detalleControl = async (connection, req, id, lock = false) => {
    const [rows] = await connection.query(`${CONTROL_SQL} WHERE c.id = ? AND c.sede_id = ?${lock ? ' FOR UPDATE' : ''}`, [id, sedeDe(req)]);
    if (!rows[0]) fail(404, 'Control no encontrado');
    const control = { ...rows[0], cumplimiento: rows[0].cumplimiento === null ? null : Number(rows[0].cumplimiento) };
    const [items] = await connection.query(
        `SELECT d.*, p.dni, CONCAT(p.nombres, ' ', p.apellidos) AS trabajador, a.nombre AS area
         FROM epp_control_detalle d JOIN personal p ON p.id = d.personal_id LEFT JOIN personal_areas a ON a.id = p.area_id
         WHERE d.control_id = ? ORDER BY trabajador, d.elemento_nombre`,
        [id]
    );
    control.items = items;
    return control;
};

const abrirControl = async (req) => {
    const b = req.body || {};
    const fecha = String(b.fecha || hoyLima()).slice(0, 10);
    const turnoId = Number(b.turno_id);
    const areaId = idOpcional(b.area_id);
    if (!esFecha(fecha) || fecha > hoyLima()) fail(400, 'No se registra un control con fecha futura');
    if (!turnoId) fail(400, 'Seleccione el turno');
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        await catalogoActivo(connection, 'turnos', turnoId);
        await catalogoActivo(connection, 'areas', areaId);
        const [mismo] = await connection.query(
            'SELECT id FROM epp_controles WHERE sede_id = ? AND area_key = ? AND turno_id = ? AND fecha = ? FOR UPDATE',
            [sedeDe(req), areaId || 0, turnoId, fecha]
        );
        if (mismo[0]) {
            await connection.commit();
            return detalleControl(pool, req, mismo[0].id);
        }
        const [r] = await connection.query(
            'INSERT INTO epp_controles (sede_id, area_id, area_key, turno_id, fecha, usuario_id) VALUES (?, ?, ?, ?, ?, ?)',
            [sedeDe(req), areaId, areaId || 0, turnoId, fecha, req.userContext.id]
        );
        // Trabajadores activos del turno (y del area, si se eligio) x elementos de control diario de su area (o de todas).
        const [ins] = await connection.query(
            `INSERT INTO epp_control_detalle (control_id, personal_id, elemento_id, elemento_nombre)
             SELECT ?, p.id, e.id, e.nombre
             FROM personal p
             JOIN epp_elementos e ON e.activo = 1 AND e.control_diario = 1 AND (e.area_id IS NULL OR e.area_id = p.area_id)
             WHERE p.sede_id = ? AND p.estado = 'activo' AND p.turno_id = ? ${areaId ? 'AND p.area_id = ?' : ''}`,
            areaId ? [r.insertId, sedeDe(req), turnoId, areaId] : [r.insertId, sedeDe(req), turnoId]
        );
        if (ins.affectedRows === 0) fail(409, 'No hay trabajadores activos en ese turno/area o elementos marcados para el control diario');
        await connection.commit();
        return detalleControl(pool, req, r.insertId);
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
};

const marcarControl = async (req, id) => {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (items.length === 0) fail(400, 'No hay casillas para guardar');
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const control = await detalleControl(connection, req, id, true);
        if (control.estado !== 'abierto') fail(409, 'El control ya esta cerrado');
        const ids = new Set(control.items.map((x) => Number(x.id)));
        for (const item of items) {
            const itemId = Number(item.id);
            const resultado = item.resultado === 'C' || item.resultado === 'NC' ? item.resultado : null;
            const observacion = texto(item.observacion, 500);
            if (!ids.has(itemId)) fail(400, 'Una casilla no corresponde a este control');
            if (resultado === 'NC' && (!observacion || observacion.length < 3)) fail(400, 'Cada no conformidad (NC) requiere una observacion');
            await connection.query('UPDATE epp_control_detalle SET resultado = ?, observacion = ? WHERE id = ?', [resultado, observacion, itemId]);
        }
        await connection.commit();
        return detalleControl(pool, req, id);
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
};

const cerrarControl = async (req, id) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const control = await detalleControl(connection, req, id, true);
        if (control.estado === 'cerrado') fail(409, 'El control ya esta cerrado');
        if (control.items.some((x) => !x.resultado)) fail(409, 'Marque todas las casillas C/NC antes de cerrar');
        const conformes = control.items.filter((x) => x.resultado === 'C').length;
        const cumplimiento = control.items.length ? redondear((100 * conformes) / control.items.length) : 100;
        await connection.query(
            "UPDATE epp_controles SET estado = 'cerrado', cumplimiento = ?, observacion = ?, cerrado_en = CURRENT_TIMESTAMP WHERE id = ?",
            [cumplimiento, texto(req.body?.observacion, 500), id]
        );
        await connection.commit();
        return detalleControl(pool, req, id);
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
};

// --- Costos por trabajador y area ---
/**
 * Como el sistema concesionario: solo el costo de los uniformes y EPP que el trabajador tiene en su poder
 * (saldo vigente = cantidad - devuelto - dado de baja, entregas no anuladas). El area es la que tenia al recibirlos.
 * El periodo (fecha de entrega) es opcional: sin fechas se toma todo lo vigente.
 */
const costos = async (req) => {
    const desde = esFecha(req.query.desde) ? req.query.desde : null;
    const hasta = esFecha(req.query.hasta) ? req.query.hasta : null;
    if (desde && hasta && desde > hasta) fail(400, 'Rango de fechas invalido');
    const areaId = idOpcional(req.query.area_id);
    const cond = ['e.sede_id = ?', 'e.anulada = 0', '(e.cantidad - e.devuelta - e.baja) > 0'];
    const params = [sedeDe(req)];
    if (desde) { cond.push('e.fecha >= ?'); params.push(desde); }
    if (hasta) { cond.push('e.fecha <= ?'); params.push(hasta); }
    if (areaId) { cond.push('COALESCE(e.area_id, p.area_id) = ?'); params.push(areaId); }
    const [rows] = await pool.query(
        `SELECT p.id AS personal_id, p.dni, CONCAT(p.apellidos, ', ', p.nombres) AS trabajador, p.estado, c.nombre AS cargo,
                COALESCE(e.area_id, p.area_id) AS area_id, COALESCE(a.nombre, 'Sin área') AS area,
                ROUND(SUM(e.cantidad - e.devuelta - e.baja), 2) AS cantidad,
                ROUND(SUM(CASE WHEN el.tipo = 'epp' THEN (e.cantidad - e.devuelta - e.baja) * e.costo_unitario ELSE 0 END), 2) AS costo_epp,
                ROUND(SUM(CASE WHEN el.tipo = 'uniforme' THEN (e.cantidad - e.devuelta - e.baja) * e.costo_unitario ELSE 0 END), 2) AS costo_uniforme
         FROM epp_entregas e
         JOIN personal p ON p.id = e.personal_id
         JOIN epp_elementos el ON el.id = e.elemento_id
         LEFT JOIN personal_areas a ON a.id = COALESCE(e.area_id, p.area_id)
         LEFT JOIN personal_cargos c ON c.id = p.cargo_id
         WHERE ${cond.join(' AND ')}
         GROUP BY p.id, p.dni, p.apellidos, p.nombres, p.estado, c.nombre, COALESCE(e.area_id, p.area_id), a.nombre
         ORDER BY area, trabajador`,
        params
    );
    const filas = rows.map((r) => {
        const fila = { ...r, cantidad: Number(r.cantidad), costo_epp: Number(r.costo_epp), costo_uniforme: Number(r.costo_uniforme) };
        fila.costo_total = redondear(fila.costo_epp + fila.costo_uniforme);
        return fila;
    });
    // Una sola fila por trabajador (si cambio de area, sus entregas se suman; las areas se listan juntas).
    const trabajadores = [];
    for (const f of filas) {
        const t = trabajadores.find((x) => x.personal_id === f.personal_id);
        if (!t) { trabajadores.push({ ...f }); continue; }
        if (!String(t.area).split(' / ').includes(f.area)) t.area = `${t.area} / ${f.area}`;
        for (const k of ['cantidad', 'costo_epp', 'costo_uniforme', 'costo_total']) t[k] = redondear(t[k] + f[k]);
    }
    trabajadores.sort((a, b) => String(a.trabajador).localeCompare(String(b.trabajador), 'es'));
    const areas = [];
    for (const f of filas) {
        let a = areas.find((x) => x.area === f.area);
        if (!a) areas.push(a = { area_id: f.area_id, area: f.area, trabajadores: 0, cantidad: 0, costo_epp: 0, costo_uniforme: 0, costo_total: 0 });
        a.trabajadores += 1;
        for (const k of ['cantidad', 'costo_epp', 'costo_uniforme', 'costo_total']) a[k] = redondear(a[k] + f[k]);
    }
    return { periodo: { desde, hasta }, trabajadores, areas };
};

// --- Consulta de DNI (RENIEC via Decolecta, como el sistema de bebidas) ---
const consultarDni = async (req) => {
    const dni = String(req.params.dni || '').trim();
    if (!/^\d{8}$/.test(dni)) fail(400, 'El DNI debe tener 8 digitos');
    const [existe] = await pool.query(
        "SELECT p.id, p.sede_id, CONCAT(p.apellidos, ', ', p.nombres) AS trabajador, s.nombre AS sede FROM personal p JOIN sedes s ON s.id = p.sede_id WHERE p.dni = ?", [dni]);
    if (existe[0]) {
        const mismaSede = Number(existe[0].sede_id) === Number(sedeDe(req));
        return { existe: true, personal_id: mismaSede ? existe[0].id : null, trabajador: existe[0].trabajador, sede: existe[0].sede, misma_sede: mismaSede };
    }
    const token = process.env.DECOLECTA_TOKEN || process.env.APISPERU_TOKEN;
    if (!token) fail(503, 'La consulta a RENIEC no esta configurada (DECOLECTA_TOKEN). Registre los datos manualmente.');
    let respuesta;
    try {
        respuesta = await fetch(`https://api.decolecta.com/v1/reniec/dni?numero=${dni}`, {
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(8000), redirect: 'error'
        });
    } catch {
        fail(502, 'No se pudo conectar con RENIEC. Registre los datos manualmente.');
    }
    if (respuesta.status === 404 || respuesta.status === 422) fail(404, 'RENIEC no encontro ese DNI');
    if (!respuesta.ok) fail(502, 'El servicio de consulta no esta disponible. Registre los datos manualmente.');
    const datos = await respuesta.json().catch(() => null);
    if (!datos || String(datos.document_number || dni) !== dni) fail(502, 'El servicio devolvio datos de otro documento');
    const nombres = texto(datos.first_name, 120);
    const apellidos = texto([datos.first_last_name, datos.second_last_name].filter(Boolean).join(' '), 120);
    if (!nombres && !datos.full_name) fail(404, 'RENIEC no encontro ese DNI');
    return { existe: false, dni, nombres: nombres || texto(datos.full_name, 120), apellidos: apellidos || '', fuente: 'RENIEC' };
};

// --- Rutas ---
const registrar = (app, { allowAdmin }) => {
    const ruta = (metodo, path, fn, ...middlewares) => app[metodo](`/api/personal${path}`, allowAdmin, requiereListo, ...middlewares, async (req, res) => {
        try {
            const out = await fn(req, res);
            if (out !== undefined && !res.headersSent) res.json(out);
        } catch (err) {
            enviarError(res, err);
        }
    });

    ruta('get', '/opciones', async (req) => {
        const [[cargos], [areas], [turnos], [elementos], [usuarios]] = await Promise.all([
            pool.query('SELECT * FROM personal_cargos ORDER BY activo DESC, nombre'),
            pool.query('SELECT * FROM personal_areas ORDER BY activo DESC, nombre'),
            pool.query("SELECT id, nombre, descripcion, TIME_FORMAT(hora_inicio, '%H:%i') AS hora_inicio, TIME_FORMAT(hora_fin, '%H:%i') AS hora_fin, activo FROM personal_turnos ORDER BY activo DESC, nombre"),
            pool.query('SELECT e.*, a.nombre AS area FROM epp_elementos e LEFT JOIN personal_areas a ON a.id = e.area_id ORDER BY e.activo DESC, e.tipo, e.nombre'),
            pool.query('SELECT id, nombre, usuario FROM usuarios WHERE sede_id = ? OR sede_id IS NULL ORDER BY nombre', [sedeDe(req)])
        ]);
        return {
            cargos, areas, turnos, usuarios,
            elementos: elementos.map((e) => ({ ...e, costo_unitario: e.costo_unitario === null ? null : Number(e.costo_unitario) })),
            vinculos: VINCULOS, estados: ESTADOS, tipos_adjunto: TIPOS_ADJUNTO, estados_elemento: ESTADOS_ELEMENTO,
            puede_ver_remuneracion: puedeVerRemuneracion(req), max_adjunto: MAX_ADJUNTO
        };
    });

    // Cargos, areas y turnos
    ruta('post', '/catalogos/:tipo', async (req, res) => guardarCatalogo(req, res, null));
    ruta('put', '/catalogos/:tipo/:id', async (req, res) => guardarCatalogo(req, res, Number(req.params.id)));

    // Trabajadores
    ruta('get', '/trabajadores', async (req) => {
        const cond = ['x.sede_id = ?'];
        const params = [sedeDe(req)];
        if (req.query.q) {
            cond.push("CONCAT_WS(' ', x.dni, x.codigo, x.nombres, x.apellidos, x.funciones) LIKE ?");
            params.push(`%${String(req.query.q).trim()}%`);
        }
        if (ESTADOS.includes(req.query.estado)) { cond.push('x.estado = ?'); params.push(req.query.estado); }
        for (const [k, col] of [['area_id', 'x.area_id'], ['cargo_id', 'x.cargo_id'], ['turno_id', 'x.turno_id']]) {
            if (Number(req.query[k])) { cond.push(`${col} = ?`); params.push(Number(req.query[k])); }
        }
        if (req.query.funcion) { cond.push('x.funciones LIKE ?'); params.push(`%${String(req.query.funcion).trim()}%`); }
        const [rows] = await pool.query(`${TRABAJADOR_SQL} WHERE ${cond.join(' AND ')} ORDER BY x.estado = 'cesado', x.apellidos, x.nombres LIMIT 2000`, params);
        return rows.map((r) => limpiarTrabajador(req, r));
    });
    ruta('get', '/trabajadores/:id', async (req) => {
        const t = limpiarTrabajador(req, await buscarTrabajador(pool, req, Number(req.params.id)));
        const [entregas] = await pool.query(`${ENTREGA_SQL} WHERE e.personal_id = ? ORDER BY e.fecha DESC, e.id DESC`, [t.id]);
        t.entregas = entregas.map(numerosEntrega);
        t.documentos = await listarAdjuntos(t.id);
        return t;
    });
    ruta('get', '/consulta-dni/:dni', async (req) => consultarDni(req));
    ruta('post', '/trabajadores', async (req, res) => { res.status(201); return guardarTrabajador(req, null); });
    ruta('put', '/trabajadores/:id', async (req) => guardarTrabajador(req, Number(req.params.id)));

    // Documentos adjuntos
    ruta('get', '/trabajadores/:id/adjuntos', async (req) => {
        await buscarTrabajador(pool, req, Number(req.params.id));
        return listarAdjuntos(Number(req.params.id));
    });
    ruta('post', '/trabajadores/:id/adjuntos', async (req, res) => { res.status(201); return subirAdjunto(req, Number(req.params.id)); },
        express.raw({ type: () => true, limit: MAX_ADJUNTO + 1024 }));
    ruta('get', '/adjuntos/:id', async (req, res) => {
        const adj = await buscarAdjunto(req, Number(req.params.id));
        const partes = [];
        for (let i = 0; i < adj.partes; i += 1) {
            const [rows] = await pool.query('SELECT datos FROM personal_adjunto_partes WHERE adjunto_id = ? AND parte = ?', [adj.id, i]);
            if (!rows[0]) fail(500, 'El documento esta incompleto');
            partes.push(rows[0].datos);
        }
        const contenido = Buffer.concat(partes);
        res.set({
            'Content-Type': adj.mime,
            'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(adj.nombre)}`,
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'no-store'
        });
        res.send(contenido);
    });
    ruta('delete', '/adjuntos/:id', async (req) => {
        const adj = await buscarAdjunto(req, Number(req.params.id));
        await pool.query('UPDATE personal_adjuntos SET eliminado = 1 WHERE id = ?', [adj.id]);
        await pool.query('DELETE FROM personal_adjunto_partes WHERE adjunto_id = ?', [adj.id]);
        return { message: 'Documento eliminado' };
    });

    // Elementos de EPP (catalogo compartido entre sedes)
    ruta('post', '/elementos', async (req, res) => {
        const d = parseElemento(req.body);
        if (d.area_id) await catalogoActivo(pool, 'areas', d.area_id);
        const [r] = await pool.query('INSERT INTO epp_elementos SET ?', [d]);
        res.status(201);
        return { id: r.insertId, ...d };
    });
    ruta('put', '/elementos/:id', async (req) => {
        const d = parseElemento(req.body);
        if (d.area_id) await catalogoActivo(pool, 'areas', d.area_id);
        const [r] = await pool.query('UPDATE epp_elementos SET ? WHERE id = ?', [d, Number(req.params.id)]);
        if (r.affectedRows === 0) fail(404, 'Elemento no encontrado');
        return { id: Number(req.params.id), ...d };
    });

    // Entregas de uniforme y EPP
    ruta('get', '/entregas', async (req) => {
        const cond = ['e.sede_id = ?'];
        const params = [sedeDe(req)];
        if (esFecha(req.query.desde)) { cond.push('e.fecha >= ?'); params.push(req.query.desde); }
        if (esFecha(req.query.hasta)) { cond.push('e.fecha <= ?'); params.push(req.query.hasta); }
        if (Number(req.query.personal_id)) { cond.push('e.personal_id = ?'); params.push(Number(req.query.personal_id)); }
        if (Number(req.query.elemento_id)) { cond.push('e.elemento_id = ?'); params.push(Number(req.query.elemento_id)); }
        if (req.query.tipo === 'epp' || req.query.tipo === 'uniforme') { cond.push('el.tipo = ?'); params.push(req.query.tipo); }
        if (req.query.vista === 'por_cambiar') {
            cond.push('e.anulada = 0 AND (e.devuelta + e.baja) < e.cantidad AND e.proximo_cambio IS NOT NULL AND e.proximo_cambio <= DATE_ADD(CURDATE(), INTERVAL 15 DAY)');
        }
        if (req.query.vista === 'por_devolver') cond.push('e.anulada = 0 AND (e.devuelta + e.baja) < e.cantidad');
        const [rows] = await pool.query(`${ENTREGA_SQL} WHERE ${cond.join(' AND ')} ORDER BY e.fecha DESC, e.id DESC LIMIT 3000`, params);
        return rows.map(numerosEntrega);
    });
    ruta('post', '/entregas', async (req, res) => { res.status(201); return registrarEntrega(req); });
    // Devolucion o baja (tipo = 'devolucion' | 'baja'), con su fecha: ambas descuentan del saldo vigente de la entrega.
    ruta('post', '/entregas/:id/devolver', async (req) => {
        const b = req.body || {};
        const tipo = TIPOS_MOVIMIENTO.includes(b.tipo) ? b.tipo : 'devolucion';
        const accion = tipo === 'baja' ? 'La baja' : 'La devolucion';
        const cantidad = redondear(b.cantidad);
        const fecha = String(b.fecha || hoyLima()).slice(0, 10);
        const estado = String(b.estado || 'bueno').toLowerCase();
        const motivo = texto(b.motivo, 500);
        if (!(cantidad > 0)) fail(400, `${accion} debe tener una cantidad mayor a 0`);
        if (!ESTADOS_ELEMENTO.includes(estado)) fail(400, 'El estado no es valido');
        if (!motivo || motivo.length < 3) fail(400, `Indique el motivo de ${tipo === 'baja' ? 'la baja' : 'la devolucion'}`);
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const e = await buscarEntrega(connection, req, Number(req.params.id));
            if (Number(e.anulada)) fail(409, 'La entrega esta anulada');
            if (cantidad > e.pendiente) fail(409, `${accion} supera lo pendiente (${e.pendiente})`);
            if (!esFecha(fecha) || fecha < e.fecha || fecha > hoyLima()) fail(400, `${accion} debe ser entre la entrega y hoy`);
            await connection.query('INSERT INTO epp_devoluciones (entrega_id, tipo, cantidad, fecha, estado, motivo, usuario_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [e.id, tipo, cantidad, fecha, estado, motivo, req.userContext.id]);
            await connection.query(`UPDATE epp_entregas SET ${tipo === 'baja' ? 'baja = baja' : 'devuelta = devuelta'} + ? WHERE id = ?`, [cantidad, e.id]);
            await connection.commit();
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
        const [rows] = await pool.query(`${ENTREGA_SQL} WHERE e.id = ?`, [Number(req.params.id)]);
        return numerosEntrega(rows[0]);
    });
    // Historial de devoluciones y bajas de una entrega.
    ruta('get', '/entregas/:id/movimientos', async (req) => {
        const [rows] = await pool.query(
            `SELECT d.id, d.tipo, d.cantidad, DATE_FORMAT(d.fecha, '%Y-%m-%d') AS fecha, d.estado, d.motivo, u.nombre AS usuario_nombre, d.creado_en
             FROM epp_devoluciones d JOIN epp_entregas e ON e.id = d.entrega_id LEFT JOIN usuarios u ON u.id = d.usuario_id
             WHERE d.entrega_id = ? AND e.sede_id = ? ORDER BY d.fecha, d.id`, [Number(req.params.id), sedeDe(req)]);
        return rows.map((r) => ({ ...r, cantidad: Number(r.cantidad) }));
    });
    ruta('post', '/entregas/:id/anular', async (req) => {
        const motivo = texto(req.body?.motivo, 255);
        if (!motivo || motivo.length < 3) fail(400, 'Indique el motivo de la anulacion');
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const e = await buscarEntrega(connection, req, Number(req.params.id));
            if (Number(e.anulada)) fail(409, 'La entrega ya esta anulada');
            if (e.devuelta > 0 || e.baja > 0) fail(409, 'La entrega tiene devoluciones o bajas registradas');
            await connection.query('UPDATE epp_entregas SET anulada = 1, motivo_anulacion = ? WHERE id = ?', [motivo, e.id]);
            if (e.control_detalle_id) await connection.query('UPDATE epp_control_detalle SET reposicion_id = NULL WHERE id = ?', [e.control_detalle_id]);
            await connection.commit();
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
        const [rows] = await pool.query(`${ENTREGA_SQL} WHERE e.id = ?`, [Number(req.params.id)]);
        return numerosEntrega(rows[0]);
    });

    // Control diario C/NC
    ruta('get', '/controles', async (req) => {
        const hoy = hoyLima();
        const desde = esFecha(req.query.desde) ? req.query.desde : `${hoy.slice(0, 7)}-01`;
        const hasta = esFecha(req.query.hasta) ? req.query.hasta : hoy;
        const [rows] = await pool.query(`${CONTROL_SQL} WHERE c.sede_id = ? AND c.fecha BETWEEN ? AND ? ORDER BY c.fecha DESC, c.id DESC`, [sedeDe(req), desde, hasta]);
        return rows.map((c) => ({ ...c, cumplimiento: c.cumplimiento === null ? null : Number(c.cumplimiento) }));
    });
    ruta('post', '/controles', async (req, res) => { res.status(201); return abrirControl(req); });
    ruta('get', '/controles/:id', async (req) => detalleControl(pool, req, Number(req.params.id)));
    ruta('post', '/controles/:id/marcar', async (req) => marcarControl(req, Number(req.params.id)));
    ruta('post', '/controles/:id/cerrar', async (req) => cerrarControl(req, Number(req.params.id)));

    // Costos por trabajador y area
    ruta('get', '/costos', async (req) => costos(req));
};

const guardarCatalogo = async (req, res, id) => {
    const def = CATALOGOS[req.params.tipo];
    if (!def) fail(404, 'Catalogo no encontrado');
    const nombre = texto(req.body?.nombre, 100);
    if (!nombre || nombre.length < 2) fail(400, 'Ingrese el nombre');
    const datos = {
        nombre,
        descripcion: texto(req.body?.descripcion, 255),
        activo: req.body?.activo === undefined ? 1 : (req.body.activo && req.body.activo !== '0' ? 1 : 0)
    };
    if (req.params.tipo === 'turnos') {
        const hora = (v, etiqueta) => {
            if (v === undefined || v === null || v === '') return null;
            if (!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(String(v))) fail(400, `${etiqueta} no es valida (HH:MM)`);
            return String(v).slice(0, 5);
        };
        datos.hora_inicio = hora(req.body?.hora_inicio, 'La hora de inicio');
        datos.hora_fin = hora(req.body?.hora_fin, 'La hora de fin');
    }
    if (id) {
        const [r] = await pool.query(`UPDATE ${def.tabla} SET ? WHERE id = ?`, [datos, id]);
        if (r.affectedRows === 0) fail(404, 'Registro no encontrado');
        return { id, ...datos };
    }
    const [r] = await pool.query(`INSERT INTO ${def.tabla} SET ?`, [datos]);
    res.status(201);
    return { id: r.insertId, ...datos };
};

module.exports = { asegurarEsquema, registrar, estaListo: () => listo, MAX_ADJUNTO };
