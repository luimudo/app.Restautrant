const pool = require('./db');
const { hashPassword, isHashed } = require('./auth');

/**
 * Migraciones incrementales e idempotentes: llevan una base existente
 * (de una sola sede) al esquema multisede de database.sql sin perder datos.
 */

const columnExists = async (table, column) => {
    const [rows] = await pool.query(
        `SELECT 1 FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
        [table, column]
    );
    return rows.length > 0;
};

const indexColumns = async (table, indexName) => {
    const [rows] = await pool.query(
        `SELECT COLUMN_NAME FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
         ORDER BY SEQ_IN_INDEX`,
        [table, indexName]
    );
    return rows.map((row) => row.COLUMN_NAME);
};

const foreignKeyExists = async (table, column, referencedTable) => {
    const [rows] = await pool.query(
        `SELECT 1 FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
           AND REFERENCED_TABLE_NAME = ? LIMIT 1`,
        [table, column, referencedTable]
    );
    return rows.length > 0;
};

const ensureIndex = async (table, indexName, definition) => {
    if ((await indexColumns(table, indexName)).length === 0) {
        await pool.query(`ALTER TABLE ${table} ADD ${definition}`);
        console.log(`Added index ${indexName} to ${table}`);
    }
};

const dropIndexIfExists = async (table, indexName) => {
    if ((await indexColumns(table, indexName)).length > 0) {
        await pool.query(`ALTER TABLE ${table} DROP INDEX ${indexName}`);
        console.log(`Dropped index ${indexName} from ${table}`);
    }
};

/** Adds a NOT NULL sede_id column (backfilled with the main sede) plus its FK. */
const ensureSedeColumn = async (table, sedePrincipalId) => {
    if (!(await columnExists(table, 'sede_id'))) {
        await pool.query(`ALTER TABLE ${table} ADD COLUMN sede_id INT NULL AFTER id`);
        console.log(`Added column sede_id to ${table}`);
    }
    await pool.query(`UPDATE ${table} SET sede_id = ? WHERE sede_id IS NULL`, [sedePrincipalId]);
    await pool.query(`ALTER TABLE ${table} MODIFY sede_id INT NOT NULL`);
    if (!(await foreignKeyExists(table, 'sede_id', 'sedes'))) {
        await pool.query(`ALTER TABLE ${table} ADD CONSTRAINT fk_${table}_sede FOREIGN KEY (sede_id) REFERENCES sedes(id)`);
    }
};

async function migrate() {
    try {
        console.log('Running migrations...');

        // 1. Sedes
        await pool.query(`
            CREATE TABLE IF NOT EXISTS sedes (
                id INT AUTO_INCREMENT PRIMARY KEY,
                nombre VARCHAR(150) NOT NULL UNIQUE,
                direccion VARCHAR(255),
                telefono VARCHAR(30),
                estado TINYINT(1) NOT NULL DEFAULT 1,
                creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        const [sedeRows] = await pool.query('SELECT id FROM sedes ORDER BY id LIMIT 1');
        let sedePrincipalId = sedeRows[0]?.id;
        if (!sedePrincipalId) {
            const [result] = await pool.query(
                'INSERT INTO sedes (nombre, direccion) VALUES (?, ?)',
                ['Sede Principal', 'Jr. Los Pinos 123, Lima']
            );
            sedePrincipalId = result.insertId;
            console.log('Created sede "Sede Principal".');
        }

        // 2. Usuarios: rol superadmin, login por usuario y sede
        await pool.query(`ALTER TABLE usuarios MODIFY rol ENUM('superadmin', 'administrador', 'mozo', 'caja', 'cocina') NOT NULL DEFAULT 'mozo'`);

        if (!(await columnExists('usuarios', 'usuario'))) {
            await pool.query('ALTER TABLE usuarios ADD COLUMN usuario VARCHAR(50) NULL AFTER nombre');
            console.log('Added column usuario to usuarios');
        }
        const [sinUsuario] = await pool.query('SELECT id, email FROM usuarios WHERE usuario IS NULL OR usuario = ""');
        for (const row of sinUsuario) {
            const base = String(row.email || `usuario${row.id}`).split('@')[0].replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 40) || `usuario${row.id}`;
            const [taken] = await pool.query('SELECT id FROM usuarios WHERE usuario = ? AND id <> ? LIMIT 1', [base, row.id]);
            await pool.query('UPDATE usuarios SET usuario = ? WHERE id = ?', [taken.length > 0 ? `${base}${row.id}` : base, row.id]);
        }
        await pool.query('ALTER TABLE usuarios MODIFY usuario VARCHAR(50) NOT NULL');
        await ensureIndex('usuarios', 'uq_usuarios_usuario', 'UNIQUE KEY uq_usuarios_usuario (usuario)');

        if (!(await columnExists('usuarios', 'sede_id'))) {
            await pool.query('ALTER TABLE usuarios ADD COLUMN sede_id INT NULL AFTER rol');
            console.log('Added column sede_id to usuarios');
        }
        await pool.query(`UPDATE usuarios SET sede_id = ? WHERE sede_id IS NULL AND rol <> 'superadmin'`, [sedePrincipalId]);
        if (!(await foreignKeyExists('usuarios', 'sede_id', 'sedes'))) {
            await pool.query('ALTER TABLE usuarios ADD CONSTRAINT fk_usuarios_sede FOREIGN KEY (sede_id) REFERENCES sedes(id)');
        }

        // 3. Tablas operativas por sede
        for (const table of ['zonas', 'mesas', 'cajas', 'caja_sesiones', 'pedidos', 'facturas', 'compras']) {
            await ensureSedeColumn(table, sedePrincipalId);
        }

        // Numero de mesa y de comprobante: unicos por sede (antes globales)
        await ensureIndex('mesas', 'uq_mesas_sede_numero', 'UNIQUE KEY uq_mesas_sede_numero (sede_id, numero)');
        await dropIndexIfExists('mesas', 'numero');
        // Unico por sede (la clave definitiva incluye el tipo: ver 5.5, notas de credito/debito).
        if ((await indexColumns('facturas', 'uq_facturas_sede_tipo_numero')).length === 0) {
            await ensureIndex('facturas', 'uq_facturas_sede_numero', 'UNIQUE KEY uq_facturas_sede_numero (sede_id, numero_comprobante)');
        }
        await dropIndexIfExists('facturas', 'numero_comprobante');

        await ensureIndex('pedidos', 'idx_pedidos_sede_fecha', 'INDEX idx_pedidos_sede_fecha (sede_id, fecha_creacion)');
        // Juntar mesas: la comanda absorbida queda cancelada y apunta a la comanda que recibio sus lineas.
        if (!(await columnExists('pedidos', 'unido_a_pedido_id'))) {
            await pool.query('ALTER TABLE pedidos ADD COLUMN unido_a_pedido_id INT NULL');
            await pool.query('ALTER TABLE pedidos ADD CONSTRAINT fk_pedidos_unido_a FOREIGN KEY (unido_a_pedido_id) REFERENCES pedidos(id)');
            console.log('Added pedidos.unido_a_pedido_id');
        }
        await ensureIndex('facturas', 'idx_facturas_sede_fecha', 'INDEX idx_facturas_sede_fecha (sede_id, fecha_emision)');
        const cajaSesionesIdx = await indexColumns('caja_sesiones', 'idx_caja_sesiones_estado');
        if (cajaSesionesIdx.length > 0 && cajaSesionesIdx[0] !== 'sede_id') {
            await dropIndexIfExists('caja_sesiones', 'idx_caja_sesiones_estado');
        }
        await ensureIndex('caja_sesiones', 'idx_caja_sesiones_estado', 'INDEX idx_caja_sesiones_estado (sede_id, estado, caja_id)');

        // 4. Correlativos por sede
        await pool.query(`
            CREATE TABLE IF NOT EXISTS correlativos (
                sede_id INT NOT NULL,
                tipo VARCHAR(20) NOT NULL,
                serie VARCHAR(10) NOT NULL DEFAULT 'B003',
                siguiente_numero INT NOT NULL DEFAULT 1,
                PRIMARY KEY (sede_id, tipo),
                FOREIGN KEY (sede_id) REFERENCES sedes(id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        if (!(await columnExists('correlativos', 'sede_id'))) {
            await pool.query('ALTER TABLE correlativos ADD COLUMN sede_id INT NULL FIRST');
            await pool.query('UPDATE correlativos SET sede_id = ?', [sedePrincipalId]);
            await pool.query('ALTER TABLE correlativos MODIFY sede_id INT NOT NULL, DROP PRIMARY KEY, ADD PRIMARY KEY (sede_id, tipo)');
            await pool.query('ALTER TABLE correlativos ADD CONSTRAINT fk_correlativos_sede FOREIGN KEY (sede_id) REFERENCES sedes(id)');
            console.log('Correlativos now keyed by sede');
        }

        // 5. Stock por sede (la carta es compartida)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS stock_productos (
                sede_id INT NOT NULL,
                producto_id INT NOT NULL,
                stock INT NOT NULL DEFAULT 0,
                PRIMARY KEY (sede_id, producto_id),
                FOREIGN KEY (sede_id) REFERENCES sedes(id),
                FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS producto_imagenes (
                producto_id INT NOT NULL PRIMARY KEY,
                mime_type VARCHAR(24) NOT NULL,
                contenido MEDIUMBLOB NOT NULL,
                actualizado_en DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                CONSTRAINT fk_producto_imagenes_producto FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS stock_insumos (
                sede_id INT NOT NULL,
                insumo_id INT NOT NULL,
                stock_actual DECIMAL(12,3) NOT NULL DEFAULT 0.000,
                PRIMARY KEY (sede_id, insumo_id),
                FOREIGN KEY (sede_id) REFERENCES sedes(id),
                FOREIGN KEY (insumo_id) REFERENCES insumos(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        if (await columnExists('productos', 'stock')) {
            await pool.query(
                `INSERT INTO stock_productos (sede_id, producto_id, stock)
                 SELECT ?, id, COALESCE(stock, 0) FROM productos
                 ON DUPLICATE KEY UPDATE stock = VALUES(stock)`,
                [sedePrincipalId]
            );
            await pool.query('ALTER TABLE productos DROP COLUMN stock');
            console.log('Moved productos.stock to stock_productos');
        }
        if (await columnExists('insumos', 'stock_actual')) {
            await pool.query(
                `INSERT INTO stock_insumos (sede_id, insumo_id, stock_actual)
                 SELECT ?, id, COALESCE(stock_actual, 0) FROM insumos
                 ON DUPLICATE KEY UPDATE stock_actual = VALUES(stock_actual)`,
                [sedePrincipalId]
            );
            await pool.query('ALTER TABLE insumos DROP COLUMN stock_actual');
            console.log('Moved insumos.stock_actual to stock_insumos');
        }

        // 5.1 Reservas por sede
        await pool.query(`
            CREATE TABLE IF NOT EXISTS reservas (
                id INT AUTO_INCREMENT PRIMARY KEY,
                sede_id INT NOT NULL,
                nombre_completo VARCHAR(150) NOT NULL,
                dni CHAR(8) NOT NULL,
                fecha DATE NOT NULL,
                hora TIME NOT NULL,
                tipo ENUM('consumo', 'evento') NOT NULL DEFAULT 'consumo',
                numero_personas INT NOT NULL,
                comentario TEXT,
                estado ENUM('pendiente', 'confirmada', 'cancelada') NOT NULL DEFAULT 'pendiente',
                usuario_registro_id INT,
                usuario_confirmacion_id INT,
                fecha_confirmacion DATETIME,
                motivo_cancelacion VARCHAR(200) NULL,
                usuario_cancelacion_id INT NULL,
                fecha_cancelacion DATETIME NULL,
                creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (sede_id) REFERENCES sedes(id),
                FOREIGN KEY (usuario_registro_id) REFERENCES usuarios(id),
                FOREIGN KEY (usuario_confirmacion_id) REFERENCES usuarios(id),
                FOREIGN KEY (usuario_cancelacion_id) REFERENCES usuarios(id),
                INDEX idx_reservas_sede_fecha (sede_id, fecha, hora),
                INDEX idx_reservas_dni (dni)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        if (!(await columnExists('reservas', 'motivo_cancelacion'))) {
            await pool.query('ALTER TABLE reservas ADD COLUMN motivo_cancelacion VARCHAR(200) NULL AFTER fecha_confirmacion');
            await pool.query('ALTER TABLE reservas ADD COLUMN usuario_cancelacion_id INT NULL AFTER motivo_cancelacion');
            await pool.query('ALTER TABLE reservas ADD COLUMN fecha_cancelacion DATETIME NULL AFTER usuario_cancelacion_id');
            await pool.query('ALTER TABLE reservas ADD CONSTRAINT fk_reservas_usuario_cancelacion FOREIGN KEY (usuario_cancelacion_id) REFERENCES usuarios(id)');
            console.log('Added reservas cancellation columns');
        }

        // 5.1b Recordatorios y vencimientos (pagos de servicios, documentos y licencias) por sede
        await pool.query(`
            CREATE TABLE IF NOT EXISTS recordatorios (
                id INT AUTO_INCREMENT PRIMARY KEY,
                sede_id INT NOT NULL,
                nombre VARCHAR(100) NOT NULL,
                categoria ENUM('pago', 'documento', 'licencia', 'otro') NOT NULL DEFAULT 'pago',
                monto DECIMAL(10,2) NOT NULL DEFAULT 0.00,
                tipo_vencimiento ENUM('fecha', 'periodico') NOT NULL DEFAULT 'fecha',
                fecha_vencimiento DATE NULL,
                dia_pago TINYINT NULL,
                dias_aviso INT NOT NULL DEFAULT 7,
                notas VARCHAR(255) NULL,
                activo TINYINT(1) NOT NULL DEFAULT 1,
                eliminado TINYINT(1) NOT NULL DEFAULT 0,
                fecha_ultimo_pago DATE NULL,
                usuario_id INT NULL,
                creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
                actualizado_en DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (sede_id) REFERENCES sedes(id),
                FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
                INDEX idx_recordatorios_sede (sede_id, eliminado, activo)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // 5.1c Pedidos delivery (etapas: solicitado, enviado, facturado, entregado, rechazado)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pedidos_delivery (
                pedido_id INT NOT NULL PRIMARY KEY,
                sede_id INT NOT NULL,
                cliente_id INT NULL,
                cliente_nombre VARCHAR(150) NOT NULL,
                telefono VARCHAR(30) NOT NULL,
                direccion VARCHAR(255) NOT NULL,
                referencia VARCHAR(255) NULL,
                observacion VARCHAR(255) NULL,
                estado ENUM('solicitado', 'enviado', 'facturado', 'entregado', 'rechazado') NOT NULL DEFAULT 'solicitado',
                repartidor VARCHAR(100) NULL,
                motivo_rechazo VARCHAR(200) NULL,
                fecha_solicitado DATETIME DEFAULT CURRENT_TIMESTAMP,
                fecha_enviado DATETIME NULL,
                fecha_facturado DATETIME NULL,
                fecha_entregado DATETIME NULL,
                fecha_rechazado DATETIME NULL,
                usuario_id INT NULL,
                FOREIGN KEY (pedido_id) REFERENCES pedidos(id),
                FOREIGN KEY (sede_id) REFERENCES sedes(id),
                FOREIGN KEY (cliente_id) REFERENCES clientes(id),
                FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
                INDEX idx_pedidos_delivery_sede (sede_id, estado, fecha_solicitado)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pedidos_delivery_historial (
                id INT AUTO_INCREMENT PRIMARY KEY,
                pedido_id INT NOT NULL,
                estado VARCHAR(20) NOT NULL,
                nota VARCHAR(255) NULL,
                usuario_id INT NULL,
                fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (pedido_id) REFERENCES pedidos_delivery(pedido_id),
                FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
                INDEX idx_pedidos_delivery_historial (pedido_id, id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        // 5.2 Gastos y pagos de gastos
        await pool.query(`
                CREATE TABLE IF NOT EXISTS categorias_gasto (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    nombre VARCHAR(100) NOT NULL,
                    afectacion ENUM('gravado', 'inafecto', 'exonerado', 'sin_comprobante') NOT NULL DEFAULT 'gravado',
                    activo TINYINT(1) NOT NULL DEFAULT 1,
                    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY uq_categorias_gasto_nombre (nombre)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await pool.query(`
                CREATE TABLE IF NOT EXISTS gastos (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    sede_id INT NOT NULL,
                    categoria_id INT NOT NULL,
                    proveedor_id INT NULL,
                    beneficiario VARCHAR(200) NOT NULL,
                    documento_identidad VARCHAR(11) NULL,
                    fecha DATE NOT NULL,
                    tipo_documento ENUM('factura', 'boleta', 'ticket', 'recibo_servicios', 'recibo_honorarios', 'tributo', 'sin_comprobante') NOT NULL,
                    serie VARCHAR(20) NULL,
                    numero VARCHAR(30) NULL,
                    documento_clave VARCHAR(320) NULL,
                    descripcion VARCHAR(255) NOT NULL,
                    afectacion ENUM('gravado', 'inafecto', 'exonerado', 'sin_comprobante') NOT NULL,
                    tasa_igv DECIMAL(5,2) NOT NULL DEFAULT 0,
                    valor DECIMAL(12,2) NOT NULL,
                    igv DECIMAL(12,2) NOT NULL DEFAULT 0,
                    importe DECIMAL(12,2) NOT NULL,
                    condicion_pago ENUM('contado', 'credito') NOT NULL,
                    fecha_vencimiento DATE NOT NULL,
                    monto_pagado DECIMAL(12,2) NOT NULL DEFAULT 0,
                    estado ENUM('registrado', 'anulado') NOT NULL DEFAULT 'registrado',
                    observacion TEXT,
                    usuario_id INT,
                    anulado_por INT,
                    motivo_anulacion VARCHAR(200),
                    fecha_anulacion DATETIME,
                    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY uq_gastos_documento (documento_clave),
                    CONSTRAINT chk_gastos_importe CHECK (importe > 0 AND valor >= 0 AND igv >= 0),
                    CONSTRAINT chk_gastos_pagado CHECK (monto_pagado >= 0 AND monto_pagado <= importe),
                    CONSTRAINT chk_gastos_vencimiento CHECK (fecha_vencimiento >= fecha),
                    FOREIGN KEY (sede_id) REFERENCES sedes(id),
                    FOREIGN KEY (categoria_id) REFERENCES categorias_gasto(id),
                    FOREIGN KEY (proveedor_id) REFERENCES proveedores(id),
                    FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
                    FOREIGN KEY (anulado_por) REFERENCES usuarios(id),
                    INDEX idx_gastos_sede_fecha (sede_id, fecha),
                    INDEX idx_gastos_sede_vencimiento (sede_id, estado, fecha_vencimiento)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await pool.query(`
                CREATE TABLE IF NOT EXISTS pagos_gasto (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    gasto_id INT NOT NULL,
                    sede_id INT NOT NULL,
                    monto DECIMAL(12,2) NOT NULL,
                    metodo_pago ENUM('efectivo', 'yape', 'plin', 'tarjeta', 'transferencia', 'deposito') NOT NULL,
                    referencia VARCHAR(100) NULL,
                    observacion VARCHAR(255) NULL,
                    sesion_id INT NULL,
                    movimiento_caja_id INT NULL,
                    movimiento_reversa_id INT NULL,
                    estado ENUM('activo', 'anulado') NOT NULL DEFAULT 'activo',
                    usuario_id INT,
                    fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
                    anulado_por INT,
                    motivo_anulacion VARCHAR(200),
                    fecha_anulacion DATETIME,
                    CONSTRAINT chk_pagos_gasto_monto CHECK (monto > 0),
                    FOREIGN KEY (gasto_id) REFERENCES gastos(id),
                    FOREIGN KEY (sede_id) REFERENCES sedes(id),
                    FOREIGN KEY (sesion_id) REFERENCES caja_sesiones(id),
                    FOREIGN KEY (movimiento_caja_id) REFERENCES movimientos_caja(id),
                    FOREIGN KEY (movimiento_reversa_id) REFERENCES movimientos_caja(id),
                    FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
                    FOREIGN KEY (anulado_por) REFERENCES usuarios(id),
                    INDEX idx_pagos_gasto_sede_fecha (sede_id, fecha),
                    INDEX idx_pagos_gasto_gasto (gasto_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await pool.query(`
            INSERT IGNORE INTO categorias_gasto (nombre, afectacion) VALUES
                ('Alquiler del local', 'gravado'),
                ('Luz', 'gravado'),
                ('Agua', 'gravado'),
                ('Gas', 'gravado'),
                ('Internet y telefonía', 'gravado'),
                ('Planilla y personal', 'inafecto'),
                ('Mercado e insumos menores', 'gravado'),
                ('Limpieza y descartables', 'gravado'),
                ('Mantenimiento y reparaciones', 'gravado'),
                ('Delivery y movilidad', 'gravado'),
                ('Publicidad y marketing', 'gravado'),
                ('Tributos y licencias', 'inafecto'),
                ('Otros gastos', 'gravado')
        `);

        // 5.3 Facturacion electronica, notas de venta, ventas al credito y cobros
        await pool.query(`
            CREATE TABLE IF NOT EXISTS configuracion_empresa (
                id TINYINT PRIMARY KEY,
                ruc VARCHAR(11) NULL,
                razon_social VARCHAR(200) NULL,
                nombre_comercial VARCHAR(200) NULL,
                direccion VARCHAR(255) NULL,
                telefono VARCHAR(30) NULL,
                igv_porcentaje DECIMAL(5,2) NOT NULL DEFAULT 10.50,
                nubefact_ambiente ENUM('PRUEBAS', 'PRODUCCION') NOT NULL DEFAULT 'PRUEBAS',
                nubefact_url VARCHAR(255) NULL,
                nubefact_token VARCHAR(255) NULL,
                nubefact_ruc_pruebas VARCHAR(11) NULL,
                envio_automatico TINYINT(1) NOT NULL DEFAULT 1,
                actualizado_por INT NULL,
                actualizado_en DATETIME NULL,
                FOREIGN KEY (actualizado_por) REFERENCES usuarios(id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await pool.query('INSERT IGNORE INTO configuracion_empresa (id) VALUES (1)');
        await pool.query('ALTER TABLE configuracion_empresa MODIFY igv_porcentaje DECIMAL(5,2) NOT NULL DEFAULT 10.50');
        await pool.query('UPDATE configuracion_empresa SET igv_porcentaje = 10.50 WHERE id = 1 AND igv_porcentaje = 18.00');

        // API propia de facturacion electronica: URL y API key (reemplazan a nubefact_url / nubefact_token, que quedan sin uso).
        if (!(await columnExists('configuracion_empresa', 'facturacion_url'))) {
            await pool.query('ALTER TABLE configuracion_empresa ADD COLUMN facturacion_url VARCHAR(255) NULL AFTER nubefact_ambiente');
            console.log('Added configuracion_empresa.facturacion_url');
        }
        if (!(await columnExists('configuracion_empresa', 'facturacion_token'))) {
            await pool.query('ALTER TABLE configuracion_empresa ADD COLUMN facturacion_token VARCHAR(255) NULL AFTER facturacion_url');
            console.log('Added configuracion_empresa.facturacion_token');
        }

        if (!(await columnExists('clientes', 'tipo_documento'))) {
            await pool.query("ALTER TABLE clientes ADD COLUMN tipo_documento ENUM('DNI', 'RUC', 'CE', 'PAS') NULL AFTER email");
            await pool.query("UPDATE clientes SET tipo_documento = CASE WHEN documento REGEXP '^[0-9]{11}$' THEN 'RUC' WHEN documento REGEXP '^[0-9]{8}$' THEN 'DNI' ELSE NULL END");
            console.log('Added clientes.tipo_documento');
        }
        if (!(await columnExists('clientes', 'direccion'))) {
            await pool.query('ALTER TABLE clientes ADD COLUMN direccion VARCHAR(255) NULL');
            console.log('Added clientes.direccion');
        }

        await pool.query("ALTER TABLE facturas MODIFY tipo_comprobante ENUM('boleta', 'factura', 'nota_venta', 'nota_credito', 'nota_debito') NOT NULL");
        const facturaColumns = [
            ['serie', 'VARCHAR(10) NULL AFTER numero_comprobante'],
            ['numero', 'INT NULL AFTER serie'],
            ['subtotal', 'DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER fecha_emision'],
            ['igv_porcentaje', 'DECIMAL(5,2) NOT NULL DEFAULT 10.50 AFTER subtotal'],
            ['condicion_pago', "ENUM('contado', 'credito') NOT NULL DEFAULT 'contado'"],
            ['fecha_vencimiento', 'DATE NULL'],
            ['monto_cobrado', 'DECIMAL(12,2) NOT NULL DEFAULT 0.00'],
            ['cliente_tipo_doc', "VARCHAR(5) NOT NULL DEFAULT '-'"],
            ['cliente_num_doc', 'VARCHAR(15) NULL'],
            ['cliente_nombre', 'VARCHAR(200) NULL'],
            ['cliente_direccion', 'VARCHAR(255) NULL'],
            ['observacion', 'VARCHAR(255) NULL'],
            ['usuario_id', 'INT NULL'],
            ['estado_sunat', "ENUM('no_aplica', 'pendiente', 'enviando', 'enviado', 'aceptado', 'observado', 'rechazado', 'error', 'incierto', 'anulado') NOT NULL DEFAULT 'no_aplica'"],
            ['ambiente', 'VARCHAR(12) NULL'],
            ['nubefact_payload', 'JSON NULL'],
            ['nubefact_respuesta', 'JSON NULL'],
            ['sunat_descripcion', 'VARCHAR(1000) NULL'],
            ['codigo_hash', 'VARCHAR(100) NULL'],
            ['cadena_qr', 'VARCHAR(500) NULL'],
            ['enlace_pdf', 'VARCHAR(500) NULL'],
            ['enlace_xml', 'VARCHAR(500) NULL'],
            ['enlace_cdr', 'VARCHAR(500) NULL'],
            ['envios', 'INT NOT NULL DEFAULT 0'],
            ['enviado_en', 'DATETIME NULL'],
            ['empresa_snapshot', 'JSON NULL'],
            ['items_snapshot', 'JSON NULL']
        ];
        for (const [column, definition] of facturaColumns) {
            if (!(await columnExists('facturas', column))) {
                await pool.query(`ALTER TABLE facturas ADD COLUMN ${column} ${definition}`);
                console.log(`Added facturas.${column}`);
            }
        }
        await pool.query('ALTER TABLE facturas MODIFY igv_porcentaje DECIMAL(5,2) NOT NULL DEFAULT 10.50');
        await pool.query("ALTER TABLE facturas MODIFY estado_sunat ENUM('no_aplica', 'pendiente', 'enviando', 'enviado', 'aceptado', 'observado', 'rechazado', 'error', 'incierto', 'anulado') NOT NULL DEFAULT 'no_aplica'");
        // Comprobantes previos: el IGV estaba calculado como total x 18%; se recalcula como incluido en el precio.
        const [legacy] = await pool.query('SELECT COUNT(*) AS total FROM facturas WHERE serie IS NULL');
        if (Number(legacy[0].total) > 0) {
            await pool.query(`
                UPDATE facturas
                SET serie = SUBSTRING_INDEX(numero_comprobante, '-', 1),
                    numero = CAST(SUBSTRING_INDEX(numero_comprobante, '-', -1) AS UNSIGNED),
                    subtotal = ROUND(total_venta / 1.18, 2),
                    impuesto = ROUND(total_venta - ROUND(total_venta / 1.18, 2), 2),
                    monto_cobrado = total_venta
                WHERE serie IS NULL
            `);
            console.log(`Normalized ${legacy[0].total} legacy receipt(s).`);
        }
        await ensureIndex('facturas', 'idx_facturas_sede_estado_sunat', 'INDEX idx_facturas_sede_estado_sunat (sede_id, estado_sunat)');

        await pool.query(`
            CREATE TABLE IF NOT EXISTS cobros_venta (
                id INT AUTO_INCREMENT PRIMARY KEY,
                factura_id INT NOT NULL,
                sede_id INT NOT NULL,
                monto DECIMAL(12,2) NOT NULL,
                metodo_pago ENUM('efectivo', 'yape', 'plin', 'tarjeta', 'transferencia', 'deposito') NOT NULL,
                referencia VARCHAR(100) NULL,
                sesion_id INT NULL,
                estado ENUM('activo', 'anulado') NOT NULL DEFAULT 'activo',
                usuario_id INT NULL,
                fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
                anulado_por INT NULL,
                motivo_anulacion VARCHAR(200) NULL,
                fecha_anulacion DATETIME NULL,
                CONSTRAINT chk_cobros_venta_monto CHECK (monto > 0),
                FOREIGN KEY (factura_id) REFERENCES facturas(id),
                FOREIGN KEY (sede_id) REFERENCES sedes(id),
                FOREIGN KEY (sesion_id) REFERENCES caja_sesiones(id),
                FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
                FOREIGN KEY (anulado_por) REFERENCES usuarios(id),
                INDEX idx_cobros_venta_sesion (sesion_id, estado, metodo_pago),
                INDEX idx_cobros_venta_factura (factura_id),
                INDEX idx_cobros_venta_sede_fecha (sede_id, fecha)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        // Ventas anteriores a los cobros: se registran como cobradas en efectivo para conservar el arqueo.
        const [sinCobro] = await pool.query(`
            INSERT INTO cobros_venta (factura_id, sede_id, monto, metodo_pago, sesion_id, fecha)
            SELECT f.id, f.sede_id, f.total_venta, 'efectivo', f.sesion_caja_id, f.fecha_emision
            FROM facturas f
            WHERE f.condicion_pago = 'contado' AND f.total_venta > 0
              AND NOT EXISTS (SELECT 1 FROM cobros_venta c WHERE c.factura_id = f.id)
        `);
        if (sinCobro.affectedRows > 0) console.log(`Backfilled ${sinCobro.affectedRows} cash collection(s).`);

        // 5.4 Inventario de equipos y mantenimiento
        await pool.query(`
                CREATE TABLE IF NOT EXISTS equipos (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    sede_id INT NOT NULL,
                    codigo VARCHAR(30) NOT NULL,
                    nombre VARCHAR(150) NOT NULL,
                    categoria ENUM('coccion', 'refrigeracion', 'preparacion', 'lavado', 'bar_cafeteria', 'ventilacion', 'electronica', 'mobiliario', 'otro') NOT NULL DEFAULT 'otro',
                    area ENUM('cocina', 'bar', 'salon', 'almacen', 'caja', 'otro') NOT NULL DEFAULT 'cocina',
                    marca VARCHAR(80) NULL,
                    modelo VARCHAR(80) NULL,
                    serie VARCHAR(80) NULL,
                    proveedor_id INT NULL,
                    fecha_compra DATE NULL,
                    costo_compra DECIMAL(12,2) NULL,
                    garantia_hasta DATE NULL,
                    estado ENUM('operativo', 'en_mantenimiento', 'averiado', 'baja') NOT NULL DEFAULT 'operativo',
                    observacion VARCHAR(500) NULL,
                    motivo_baja VARCHAR(200) NULL,
                    fecha_baja DATETIME NULL,
                    usuario_id INT NULL,
                    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY uq_equipos_codigo (codigo),
                    CONSTRAINT chk_equipos_costo CHECK (costo_compra IS NULL OR costo_compra >= 0),
                    FOREIGN KEY (sede_id) REFERENCES sedes(id),
                    FOREIGN KEY (proveedor_id) REFERENCES proveedores(id),
                    FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
                    INDEX idx_equipos_sede_estado (sede_id, estado)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await pool.query(`
                CREATE TABLE IF NOT EXISTS mantenimiento_planes (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    equipo_id INT NOT NULL,
                    nombre VARCHAR(150) NOT NULL,
                    frecuencia_dias INT NOT NULL,
                    proxima_fecha DATE NOT NULL,
                    responsable VARCHAR(150) NULL,
                    instrucciones VARCHAR(2000) NULL,
                    activo TINYINT(1) NOT NULL DEFAULT 1,
                    usuario_id INT NULL,
                    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT chk_planes_frecuencia CHECK (frecuencia_dias BETWEEN 1 AND 3650),
                    FOREIGN KEY (equipo_id) REFERENCES equipos(id),
                    FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
                    INDEX idx_planes_equipo (equipo_id, activo)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await pool.query(`
                CREATE TABLE IF NOT EXISTS mantenimientos (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    sede_id INT NOT NULL,
                    equipo_id INT NOT NULL,
                    plan_id INT NULL,
                    tipo ENUM('preventivo', 'correctivo') NOT NULL,
                    estado ENUM('programado', 'en_ejecucion', 'ejecutado', 'anulado') NOT NULL DEFAULT 'programado',
                    prioridad ENUM('baja', 'media', 'alta') NOT NULL DEFAULT 'media',
                    fecha_programada DATE NOT NULL,
                    descripcion VARCHAR(1000) NOT NULL,
                    reportado_por INT NULL,
                    diagnostico VARCHAR(2000) NULL,
                    trabajo_realizado VARCHAR(2000) NULL,
                    tecnico VARCHAR(150) NULL,
                    proveedor_id INT NULL,
                    fecha_inicio DATETIME NULL,
                    fecha_ejecucion DATE NULL,
                    costo_material DECIMAL(12,2) NOT NULL DEFAULT 0,
                    costo_servicio DECIMAL(12,2) NOT NULL DEFAULT 0,
                    gasto_id INT NULL,
                    motivo_anulacion VARCHAR(200) NULL,
                    usuario_id INT NULL,
                    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
                    plan_activo INT GENERATED ALWAYS AS (CASE WHEN estado IN ('programado', 'en_ejecucion') THEN plan_id ELSE NULL END) STORED,
                    UNIQUE KEY uq_mantenimientos_plan_activo (plan_activo),
                    CONSTRAINT chk_mantenimientos_costos CHECK (costo_material >= 0 AND costo_servicio >= 0),
                    FOREIGN KEY (sede_id) REFERENCES sedes(id),
                    FOREIGN KEY (equipo_id) REFERENCES equipos(id),
                    FOREIGN KEY (plan_id) REFERENCES mantenimiento_planes(id),
                    FOREIGN KEY (reportado_por) REFERENCES usuarios(id),
                    FOREIGN KEY (proveedor_id) REFERENCES proveedores(id),
                    FOREIGN KEY (gasto_id) REFERENCES gastos(id),
                    FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
                    INDEX idx_mantenimientos_sede_estado (sede_id, estado, fecha_programada),
                    INDEX idx_mantenimientos_equipo (equipo_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await pool.query(`
                CREATE TABLE IF NOT EXISTS mantenimiento_historial (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    mantenimiento_id INT NOT NULL,
                    estado VARCHAR(20) NOT NULL,
                    detalle VARCHAR(1000) NULL,
                    usuario_id INT NULL,
                    fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (mantenimiento_id) REFERENCES mantenimientos(id),
                    FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
                    INDEX idx_mantenimiento_historial (mantenimiento_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // 5.5 Notas de credito y debito electronicas (vinculadas a su boleta o factura)
        await pool.query("ALTER TABLE facturas MODIFY tipo_comprobante ENUM('boleta', 'factura', 'nota_venta', 'nota_credito', 'nota_debito') NOT NULL");
        await pool.query('ALTER TABLE facturas MODIFY pedido_id INT NULL');
        const notaColumns = [
            ['documento_origen_id', 'INT NULL'],
            ['motivo_codigo', 'VARCHAR(2) NULL'],
            ['motivo_descripcion', 'VARCHAR(255) NULL'],
            ['monto_nc', 'DECIMAL(12,2) NOT NULL DEFAULT 0.00'],
            ['monto_nd', 'DECIMAL(12,2) NOT NULL DEFAULT 0.00'],
            ['estado_comercial', "ENUM('vigente', 'anulado') NOT NULL DEFAULT 'vigente'"],
            // Anulacion directa de la nota de venta (documento interno)
            ['motivo_anulacion', 'VARCHAR(200) NULL'],
            ['anulado_por', 'INT NULL'],
            ['fecha_anulacion', 'DATETIME NULL']
        ];
        for (const [column, definition] of notaColumns) {
            if (!(await columnExists('facturas', column))) {
                await pool.query(`ALTER TABLE facturas ADD COLUMN ${column} ${definition}`);
                console.log(`Added facturas.${column}`);
            }
        }
        if (!(await foreignKeyExists('facturas', 'anulado_por', 'usuarios'))) {
            await pool.query('ALTER TABLE facturas ADD CONSTRAINT fk_facturas_anulado_por FOREIGN KEY (anulado_por) REFERENCES usuarios(id)');
        }
        if (!(await foreignKeyExists('facturas', 'documento_origen_id', 'facturas'))) {
            await pool.query('ALTER TABLE facturas ADD CONSTRAINT fk_facturas_origen FOREIGN KEY (documento_origen_id) REFERENCES facturas(id)');
        }
        await ensureIndex('facturas', 'idx_facturas_origen', 'INDEX idx_facturas_origen (documento_origen_id)');

        // Una nota de credito y una de debito comparten serie (Fxxx/Bxxx) con numeracion propia: la clave incluye el tipo.
        await ensureIndex('facturas', 'uq_facturas_sede_tipo_numero', 'UNIQUE KEY uq_facturas_sede_tipo_numero (sede_id, tipo_comprobante, numero_comprobante)');
        await dropIndexIfExists('facturas', 'uq_facturas_sede_numero');

        // Las devoluciones al cliente (por nota de credito) se registran como movimientos negativos del cobro.
        if (!(await columnExists('cobros_venta', 'tipo'))) {
            await pool.query("ALTER TABLE cobros_venta ADD COLUMN tipo ENUM('cobro', 'devolucion') NOT NULL DEFAULT 'cobro' AFTER sede_id");
            console.log('Added cobros_venta.tipo');
        }
        if (!(await columnExists('cobros_venta', 'nota_id'))) {
            await pool.query('ALTER TABLE cobros_venta ADD COLUMN nota_id INT NULL AFTER tipo');
            await pool.query('ALTER TABLE cobros_venta ADD CONSTRAINT fk_cobros_venta_nota FOREIGN KEY (nota_id) REFERENCES facturas(id)');
            console.log('Added cobros_venta.nota_id');
        }

        // 5.6 Almacenes por sede, stock por almacen, transferencias y guias (internas y remitente electronica)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS almacenes (
                id INT AUTO_INCREMENT PRIMARY KEY,
                sede_id INT NOT NULL,
                codigo VARCHAR(20) NOT NULL,
                nombre VARCHAR(120) NOT NULL,
                direccion VARCHAR(255) NULL,
                ubigeo CHAR(6) NULL,
                cod_establecimiento CHAR(4) NULL,
                para_ventas TINYINT(1) NOT NULL DEFAULT 0,
                para_compras TINYINT(1) NOT NULL DEFAULT 0,
                activo TINYINT(1) NOT NULL DEFAULT 1,
                creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uq_almacenes_codigo (codigo),
                FOREIGN KEY (sede_id) REFERENCES sedes(id),
                INDEX idx_almacenes_sede (sede_id, activo)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        // Cada sede arranca con un almacen principal que recibe las compras y despacha las ventas.
        await pool.query(`
            INSERT INTO almacenes (sede_id, codigo, nombre, direccion, cod_establecimiento, para_ventas, para_compras)
            SELECT s.id, CONCAT('ALM-', LPAD(s.id, 2, '0')), 'Almacén principal', s.direccion, '0000', 1, 1
            FROM sedes s
            WHERE NOT EXISTS (SELECT 1 FROM almacenes a WHERE a.sede_id = s.id)
        `);

        const moverStockAAlmacen = async (tabla, itemColumn) => {
            if (!(await columnExists(tabla, 'almacen_id'))) {
                await pool.query(`ALTER TABLE ${tabla} ADD COLUMN almacen_id INT NULL FIRST`);
                await pool.query(`
                    UPDATE ${tabla} t
                    JOIN almacenes a ON a.sede_id = t.sede_id AND a.para_compras = 1
                    SET t.almacen_id = a.id
                `);
                await pool.query(`ALTER TABLE ${tabla} MODIFY almacen_id INT NOT NULL`);
            }
            // The sede foreign key needs its own index before the primary key changes.
            await ensureIndex(tabla, `idx_${tabla}_sede`, `INDEX idx_${tabla}_sede (sede_id, ${itemColumn})`);
            if ((await indexColumns(tabla, 'PRIMARY')).join(',') !== `almacen_id,${itemColumn}`) {
                await pool.query(`ALTER TABLE ${tabla} DROP PRIMARY KEY, ADD PRIMARY KEY (almacen_id, ${itemColumn})`);
                console.log(`Stock of ${tabla} now kept per warehouse`);
            }
            if (!(await foreignKeyExists(tabla, 'almacen_id', 'almacenes'))) {
                await pool.query(`ALTER TABLE ${tabla} ADD CONSTRAINT fk_${tabla}_almacen FOREIGN KEY (almacen_id) REFERENCES almacenes(id)`);
            }
        };
        await moverStockAAlmacen('stock_productos', 'producto_id');
        await moverStockAAlmacen('stock_insumos', 'insumo_id');

        if (!(await columnExists('equipos', 'almacen_id'))) {
            await pool.query('ALTER TABLE equipos ADD COLUMN almacen_id INT NULL AFTER sede_id');
            await pool.query('UPDATE equipos e JOIN almacenes a ON a.sede_id = e.sede_id AND a.para_compras = 1 SET e.almacen_id = a.id');
            await pool.query('ALTER TABLE equipos ADD CONSTRAINT fk_equipos_almacen FOREIGN KEY (almacen_id) REFERENCES almacenes(id)');
            console.log('Added equipos.almacen_id');
        }

        await pool.query(`
            CREATE TABLE IF NOT EXISTS transferencias (
                id INT AUTO_INCREMENT PRIMARY KEY,
                almacen_origen_id INT NOT NULL,
                almacen_destino_id INT NOT NULL,
                sede_origen_id INT NOT NULL,
                sede_destino_id INT NOT NULL,
                estado ENUM('borrador', 'en_transito', 'recibida', 'anulada') NOT NULL DEFAULT 'borrador',
                observacion VARCHAR(500) NULL,
                usuario_id INT NULL,
                despachado_por INT NULL,
                fecha_despacho DATETIME NULL,
                recibido_por INT NULL,
                fecha_recepcion DATETIME NULL,
                observacion_recepcion VARCHAR(500) NULL,
                motivo_anulacion VARCHAR(200) NULL,
                creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT chk_transferencias_almacenes CHECK (almacen_origen_id <> almacen_destino_id),
                FOREIGN KEY (almacen_origen_id) REFERENCES almacenes(id),
                FOREIGN KEY (almacen_destino_id) REFERENCES almacenes(id),
                FOREIGN KEY (sede_origen_id) REFERENCES sedes(id),
                FOREIGN KEY (sede_destino_id) REFERENCES sedes(id),
                FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
                FOREIGN KEY (despachado_por) REFERENCES usuarios(id),
                FOREIGN KEY (recibido_por) REFERENCES usuarios(id),
                INDEX idx_transferencias_origen (sede_origen_id, estado),
                INDEX idx_transferencias_destino (sede_destino_id, estado)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS transferencia_detalle (
                id INT AUTO_INCREMENT PRIMARY KEY,
                transferencia_id INT NOT NULL,
                tipo_item ENUM('insumo', 'producto', 'equipo') NOT NULL,
                item_id INT NOT NULL,
                descripcion VARCHAR(200) NOT NULL,
                unidad VARCHAR(30) NOT NULL DEFAULT 'Unidad',
                cantidad DECIMAL(12,3) NOT NULL,
                cantidad_recibida DECIMAL(12,3) NULL,
                motivo_diferencia VARCHAR(200) NULL,
                CONSTRAINT chk_transferencia_detalle_cantidad CHECK (cantidad > 0),
                FOREIGN KEY (transferencia_id) REFERENCES transferencias(id),
                UNIQUE KEY uq_transferencia_item (transferencia_id, tipo_item, item_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS inventario_movimientos (
                id INT AUTO_INCREMENT PRIMARY KEY,
                almacen_id INT NOT NULL,
                sede_id INT NOT NULL,
                tipo_item ENUM('insumo', 'producto', 'equipo') NOT NULL,
                item_id INT NOT NULL,
                cantidad DECIMAL(12,3) NOT NULL,
                motivo ENUM('transferencia_salida', 'transferencia_entrada', 'merma_transferencia', 'ingreso_manual', 'egreso_manual', 'venta', 'anulacion_venta', 'ajuste_manual', 'compra') NOT NULL,
                transferencia_id INT NULL,
                detalle VARCHAR(255) NULL,
                usuario_id INT NULL,
                fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (almacen_id) REFERENCES almacenes(id),
                FOREIGN KEY (sede_id) REFERENCES sedes(id),
                FOREIGN KEY (transferencia_id) REFERENCES transferencias(id),
                FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
                INDEX idx_inventario_movimientos_item (tipo_item, item_id, fecha),
                INDEX idx_inventario_movimientos_almacen (almacen_id, fecha)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        // Ingresos y egresos manuales del almacen se registran en el mismo kardex.
        const [motivoCol] = await pool.query(
            `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventario_movimientos' AND COLUMN_NAME = 'motivo'`
        );
        if (motivoCol[0] && !String(motivoCol[0].COLUMN_TYPE).includes("'compra'")) {
            await pool.query(
                `ALTER TABLE inventario_movimientos MODIFY motivo
                 ENUM('transferencia_salida', 'transferencia_entrada', 'merma_transferencia', 'ingreso_manual', 'egreso_manual', 'venta', 'anulacion_venta', 'ajuste_manual', 'compra') NOT NULL`
            );
            console.log('Added manual, sale, adjustment and purchase motivos to inventario_movimientos');
        }
        // Kardex: referencia (N° de guia, orden de compra o motivo) y costos de las entradas.
        for (const [column, definition] of [['referencia', 'VARCHAR(100) NULL'], ['costo_unitario', 'DECIMAL(12,4) NULL'], ['costo_total', 'DECIMAL(12,2) NULL']]) {
            if (!(await columnExists('inventario_movimientos', column))) {
                await pool.query(`ALTER TABLE inventario_movimientos ADD COLUMN ${column} ${definition}`);
                console.log(`Added inventario_movimientos.${column}`);
            }
        }
        await pool.query(`
            CREATE TABLE IF NOT EXISTS guias (
                id INT AUTO_INCREMENT PRIMARY KEY,
                sede_id INT NOT NULL,
                almacen_id INT NULL,
                tipo ENUM('interna', 'remitente') NOT NULL,
                origen ENUM('transferencia', 'venta', 'libre') NOT NULL,
                transferencia_id INT NULL,
                factura_id INT NULL,
                serie VARCHAR(10) NOT NULL,
                numero INT NOT NULL,
                numero_guia VARCHAR(20) NOT NULL,
                fecha_emision DATE NOT NULL,
                fecha_traslado DATE NOT NULL,
                motivo_traslado CHAR(2) NULL,
                partida_direccion VARCHAR(255) NOT NULL,
                partida_ubigeo CHAR(6) NULL,
                partida_establecimiento CHAR(4) NULL,
                llegada_direccion VARCHAR(255) NOT NULL,
                llegada_ubigeo CHAR(6) NULL,
                llegada_establecimiento CHAR(4) NULL,
                destinatario_tipo_doc VARCHAR(5) NULL,
                destinatario_num_doc VARCHAR(15) NULL,
                destinatario_nombre VARCHAR(200) NULL,
                modalidad ENUM('01', '02') NULL,
                peso_bruto DECIMAL(12,3) NULL,
                unidad_peso ENUM('KGM', 'TNE') NULL,
                bultos INT NULL,
                placa VARCHAR(10) NULL,
                conductor_dni VARCHAR(8) NULL,
                conductor_nombres VARCHAR(100) NULL,
                conductor_apellidos VARCHAR(100) NULL,
                conductor_licencia VARCHAR(20) NULL,
                transportista_ruc VARCHAR(11) NULL,
                transportista_nombre VARCHAR(200) NULL,
                transportista_mtc VARCHAR(20) NULL,
                comentario VARCHAR(2000) NULL,
                observaciones VARCHAR(500) NULL,
                estado ENUM('emitida', 'recibida', 'anulada') NOT NULL DEFAULT 'emitida',
                cargo VARCHAR(500) NULL,
                cargo_por INT NULL,
                cargo_fecha DATETIME NULL,
                motivo_anulacion VARCHAR(200) NULL,
                estado_sunat ENUM('no_aplica', 'pendiente', 'enviando', 'enviado', 'aceptado', 'observado', 'rechazado', 'error', 'incierto', 'anulado') NOT NULL DEFAULT 'no_aplica',
                ambiente VARCHAR(12) NULL,
                nubefact_payload JSON NULL,
                nubefact_respuesta JSON NULL,
                sunat_descripcion VARCHAR(1000) NULL,
                codigo_hash VARCHAR(100) NULL,
                cadena_qr VARCHAR(500) NULL,
                enlace_pdf VARCHAR(500) NULL,
                enlace_xml VARCHAR(500) NULL,
                enlace_cdr VARCHAR(500) NULL,
                envios INT NOT NULL DEFAULT 0,
                empresa_snapshot JSON NULL,
                usuario_id INT NULL,
                creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uq_guias_numero (sede_id, tipo, numero_guia),
                FOREIGN KEY (sede_id) REFERENCES sedes(id),
                FOREIGN KEY (almacen_id) REFERENCES almacenes(id),
                FOREIGN KEY (transferencia_id) REFERENCES transferencias(id),
                FOREIGN KEY (factura_id) REFERENCES facturas(id),
                FOREIGN KEY (cargo_por) REFERENCES usuarios(id),
                FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
                INDEX idx_guias_sede_fecha (sede_id, fecha_emision),
                INDEX idx_guias_transferencia (transferencia_id),
                INDEX idx_guias_factura (factura_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS guia_detalle (
                id INT AUTO_INCREMENT PRIMARY KEY,
                guia_id INT NOT NULL,
                codigo VARCHAR(30) NULL,
                descripcion VARCHAR(250) NOT NULL,
                cantidad DECIMAL(12,3) NOT NULL,
                unidad_medida VARCHAR(5) NOT NULL DEFAULT 'NIU',
                CONSTRAINT chk_guia_detalle_cantidad CHECK (cantidad > 0),
                FOREIGN KEY (guia_id) REFERENCES guias(id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // 6. Datos minimos por sede
        const [sedes] = await pool.query('SELECT id FROM sedes');
        for (const { id } of sedes) {
            const suffix = String(id).padStart(3, '0');
            const serieNubefact = id === sedePrincipalId ? '003' : suffix;
            await pool.query('INSERT IGNORE INTO correlativos (sede_id, tipo, serie, siguiente_numero) VALUES (?, ?, ?, 1)', [id, 'boleta', `B${serieNubefact}`]);
            await pool.query('INSERT IGNORE INTO correlativos (sede_id, tipo, serie, siguiente_numero) VALUES (?, ?, ?, 1)', [id, 'factura', `F${serieNubefact}`]);
            await pool.query('INSERT IGNORE INTO correlativos (sede_id, tipo, serie, siguiente_numero) VALUES (?, ?, ?, 1)', [id, 'nota_venta', `NV${String(id).padStart(2, '0')}`]);
            await pool.query('INSERT IGNORE INTO correlativos (sede_id, tipo, serie, siguiente_numero) VALUES (?, ?, ?, 1)', [id, 'guia_interna', `GI${String(id).padStart(2, '0')}`]);
            await pool.query('INSERT IGNORE INTO correlativos (sede_id, tipo, serie, siguiente_numero) VALUES (?, ?, ?, 1)', [id, 'guia_remitente', `T${serieNubefact}`]);
            // Notas: misma serie que su comprobante (Fxxx para facturas, Bxxx para boletas), numeracion propia.
            for (const [tipoNota, base] of [['nc_factura', 'factura'], ['nd_factura', 'factura'], ['nc_boleta', 'boleta'], ['nd_boleta', 'boleta']]) {
                await pool.query(
                    `INSERT IGNORE INTO correlativos (sede_id, tipo, serie, siguiente_numero)
                     SELECT sede_id, ?, serie, 1 FROM correlativos WHERE sede_id = ? AND tipo = ?`,
                    [tipoNota, id, base]
                );
            }

            const [cajas] = await pool.query('SELECT id FROM cajas WHERE sede_id = ? LIMIT 1', [id]);
            if (cajas.length === 0) {
                await pool.query("INSERT INTO cajas (sede_id, descripcion, saldo, estado) VALUES (?, 'Caja Principal', 0, 'cerrada')", [id]);
                console.log(`Created default cash register for sede ${id}.`);
            }
        }

        // Ubigeos (INEI/SUNAT): catalogo para elegir el ubigeo en guias de remision y almacenes. Se carga una sola vez.
        await pool.query(`
            CREATE TABLE IF NOT EXISTS ubigeos (
                codigo CHAR(6) NOT NULL PRIMARY KEY,
                distrito VARCHAR(100) NOT NULL,
                provincia VARCHAR(100) NOT NULL,
                departamento VARCHAR(100) NOT NULL,
                INDEX idx_ubigeos_distrito (distrito),
                INDEX idx_ubigeos_provincia (provincia),
                INDEX idx_ubigeos_departamento (departamento)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        const [ubigeoCount] = await pool.query('SELECT COUNT(*) AS total FROM ubigeos');
        if (Number(ubigeoCount[0].total) === 0) {
            const ubigeos = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'data', 'ubigeos.json'), 'utf8'));
            for (let i = 0; i < ubigeos.length; i += 500) {
                await pool.query('INSERT IGNORE INTO ubigeos (codigo, distrito, provincia, departamento) VALUES ?', [ubigeos.slice(i, i + 500)]);
            }
            console.log(`Loaded ${ubigeos.length} ubigeos`);
        }

        // Turno de la sesion de caja: el cuadre de caja se hace por turno (manana, tarde, noche).
        if (!(await columnExists('caja_sesiones', 'turno'))) {
            await pool.query('ALTER TABLE caja_sesiones ADD COLUMN turno VARCHAR(30) NULL AFTER caja_id');
            console.log('Added caja_sesiones.turno');
        }

        // Egresos manuales de caja: 'egreso' (gasto menor) o 'retiro' (entrega de caja al duenio); el informe los separa.
        if (!(await columnExists('movimientos_caja', 'categoria'))) {
            await pool.query('ALTER TABLE movimientos_caja ADD COLUMN categoria VARCHAR(20) NULL AFTER descripcion');
            console.log('Added movimientos_caja.categoria');
        }

        // Categorias de insumo (catalogo compartido) y categoria en cada insumo
        await pool.query(`
            CREATE TABLE IF NOT EXISTS categorias_insumo (
                id INT AUTO_INCREMENT PRIMARY KEY,
                nombre VARCHAR(80) NOT NULL,
                creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uq_categorias_insumo_nombre (nombre)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        if (!(await columnExists('insumos', 'categoria_id'))) {
            await pool.query('ALTER TABLE insumos ADD COLUMN categoria_id INT NULL');
            await pool.query('ALTER TABLE insumos ADD CONSTRAINT fk_insumos_categoria FOREIGN KEY (categoria_id) REFERENCES categorias_insumo(id)');
            console.log('Added insumos.categoria_id');
        }

        // Unidades de medida (catalogo compartido con codigo SUNAT) y conversiones entre ellas
        await pool.query(`
            CREATE TABLE IF NOT EXISTS unidades_medida (
                id INT AUTO_INCREMENT PRIMARY KEY,
                nombre VARCHAR(60) NOT NULL,
                abreviatura VARCHAR(20) NOT NULL,
                codigo_sunat VARCHAR(5) NOT NULL DEFAULT 'NIU',
                permite_decimales TINYINT(1) NOT NULL DEFAULT 1,
                activo TINYINT(1) NOT NULL DEFAULT 1,
                creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uq_unidades_medida_nombre (nombre),
                UNIQUE KEY uq_unidades_medida_abreviatura (abreviatura)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS unidad_conversiones (
                id INT AUTO_INCREMENT PRIMARY KEY,
                unidad_origen_id INT NOT NULL,
                unidad_destino_id INT NOT NULL,
                factor DECIMAL(14,6) NOT NULL,
                UNIQUE KEY uq_unidad_conversion (unidad_origen_id, unidad_destino_id),
                CONSTRAINT chk_unidad_conversion_factor CHECK (factor > 0),
                CONSTRAINT fk_unidad_conversion_origen FOREIGN KEY (unidad_origen_id) REFERENCES unidades_medida(id) ON DELETE CASCADE,
                CONSTRAINT fk_unidad_conversion_destino FOREIGN KEY (unidad_destino_id) REFERENCES unidades_medida(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        // [nombre, abreviatura, codigo SUNAT, permite decimales]. Las abreviaturas de las 6 primeras son los textos que ya usaban los insumos.
        await pool.query(
            'INSERT IGNORE INTO unidades_medida (nombre, abreviatura, codigo_sunat, permite_decimales) VALUES ?',
            [[
                ['Unidad', 'Unidad', 'NIU', 0], ['Kilogramo', 'Kg', 'KGM', 1], ['Gramo', 'Gr', 'GRM', 1], ['Litro', 'Lt', 'LTR', 1],
                ['Mililitro', 'Ml', 'MLT', 1], ['Paquete', 'Paquete', 'PK', 0], ['Caja', 'Caja', 'BX', 0], ['Docena', 'Docena', 'DZN', 0],
                ['Bolsa', 'Bolsa', 'BG', 0], ['Botella', 'Botella', 'BO', 0], ['Lata', 'Lata', 'CA', 0], ['Saco', 'Saco', 'SA', 0],
                ['Metro', 'Mt', 'MTR', 1], ['Libra', 'Lb', 'LBR', 1], ['Galon', 'Gal', 'GLL', 1]
            ]]
        );
        for (const table of ['insumos', 'productos']) {
            if (!(await columnExists(table, 'unidad_id'))) {
                await pool.query(`ALTER TABLE ${table} ADD COLUMN unidad_id INT NULL`);
                await pool.query(`ALTER TABLE ${table} ADD CONSTRAINT fk_${table}_unidad FOREIGN KEY (unidad_id) REFERENCES unidades_medida(id)`);
                console.log(`Added ${table}.unidad_id`);
            }
        }
        // Unidad en la que se compro cada linea (puede diferir de la unidad de stock del insumo)
        if (!(await columnExists('detalles_compra', 'unidad_id'))) {
            await pool.query('ALTER TABLE detalles_compra ADD COLUMN unidad_id INT NULL');
            await pool.query('ALTER TABLE detalles_compra ADD CONSTRAINT fk_detalles_compra_unidad FOREIGN KEY (unidad_id) REFERENCES unidades_medida(id)');
            console.log('Added detalles_compra.unidad_id');
        }
        // Textos de unidad que ya tenian los insumos y no estan en el catalogo: se crean como unidades nuevas.
        const [textosNuevos] = await pool.query(
            `SELECT DISTINCT TRIM(unidad_medida) AS texto FROM insumos
             WHERE unidad_id IS NULL AND TRIM(unidad_medida) <> ''
               AND NOT EXISTS (SELECT 1 FROM unidades_medida u WHERE LOWER(u.abreviatura) = LOWER(TRIM(insumos.unidad_medida)) OR LOWER(u.nombre) = LOWER(TRIM(insumos.unidad_medida)))`
        );
        for (const { texto } of textosNuevos) {
            await pool.query('INSERT IGNORE INTO unidades_medida (nombre, abreviatura, codigo_sunat, permite_decimales) VALUES (?, ?, ?, 1)', [texto.slice(0, 60), texto.slice(0, 20), 'NIU']);
        }
        await pool.query(
            `UPDATE insumos i JOIN unidades_medida u ON LOWER(u.abreviatura) = LOWER(TRIM(i.unidad_medida)) OR LOWER(u.nombre) = LOWER(TRIM(i.unidad_medida))
             SET i.unidad_id = u.id, i.unidad_medida = u.abreviatura WHERE i.unidad_id IS NULL`
        );
        await pool.query("UPDATE insumos SET unidad_id = (SELECT id FROM unidades_medida WHERE nombre = 'Unidad') WHERE unidad_id IS NULL");
        await pool.query("UPDATE productos SET unidad_id = (SELECT id FROM unidades_medida WHERE nombre = 'Unidad') WHERE unidad_id IS NULL");
        // Conversiones habituales (1 origen = factor destino)
        await pool.query(
            `INSERT IGNORE INTO unidad_conversiones (unidad_origen_id, unidad_destino_id, factor)
             SELECT o.id, d.id, c.factor FROM (
                 SELECT 'Kilogramo' AS origen, 'Gramo' AS destino, 1000 AS factor UNION ALL
                 SELECT 'Litro', 'Mililitro', 1000 UNION ALL
                 SELECT 'Docena', 'Unidad', 12 UNION ALL
                 SELECT 'Libra', 'Gramo', 453.592 UNION ALL
                 SELECT 'Galon', 'Litro', 3.785
             ) c JOIN unidades_medida o ON o.nombre = c.origen JOIN unidades_medida d ON d.nombre = c.destino`
        );

        // Proveedores: numero de cuenta (para los pagos) y observaciones
        for (const [column, definition] of [['nro_cuenta', 'VARCHAR(60) NULL'], ['observaciones', 'VARCHAR(500) NULL']]) {
            if (!(await columnExists('proveedores', column))) {
                await pool.query(`ALTER TABLE proveedores ADD COLUMN ${column} ${definition}`);
                console.log(`Added proveedores.${column}`);
            }
        }

        const [provs] = await pool.query('SELECT id FROM proveedores LIMIT 1');
        if (provs.length === 0) {
            await pool.query(
                "INSERT INTO proveedores (razon_social, ruc, contacto, telefono) VALUES (?, ?, ?, ?)",
                ['Proveedor General', '00000000000', 'Admin', '000000000']
            );
            console.log('Created default provider.');
        }

        // 7. Super administrador general
        const [superRows] = await pool.query("SELECT id FROM usuarios WHERE usuario = 'admingeneral' LIMIT 1");
        if (superRows.length === 0) {
            await pool.query(
                `INSERT INTO usuarios (nombre, usuario, email, password_hash, rol, sede_id)
                 VALUES (?, ?, ?, ?, 'superadmin', NULL)`,
                ['Administrador General', 'admingeneral', 'admingeneral@restaurant.com', hashPassword('123456')]
            );
            console.log('Created superadmin user "admingeneral".');
        }

        // 8. Claves en texto plano -> scrypt
        const [usuarios] = await pool.query('SELECT id, password_hash FROM usuarios');
        let rehashed = 0;
        for (const user of usuarios) {
            if (!isHashed(user.password_hash)) {
                await pool.query('UPDATE usuarios SET password_hash = ? WHERE id = ?', [hashPassword(user.password_hash), user.id]);
                rehashed += 1;
            }
        }
        if (rehashed > 0) console.log(`Hashed ${rehashed} plain-text password(s).`);

        console.log('Migrations completed successfully.');
        await pool.end();
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err.message);
        process.exit(1);
    }
}

migrate();
