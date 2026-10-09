const pool = require('./db');

async function migrate() {
    try {
        console.log('Running migrations...');

        // Helper: add a column only if it does not exist yet
        const safeAddColumn = async (table, column, definition) => {
            try {
                await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
                console.log(`Added column ${column} to ${table}`);
            } catch (err) {
                if (err.message && err.message.toLowerCase().includes('duplicate column name')) {
                    console.log(`Column ${column} already exists in ${table}, skipping.`);
                } else {
                    throw err;
                }
            }
        };

        // Ensure all optional columns exist (safe for already-migrated databases)
        await safeAddColumn('productos',       'stock',          'INTEGER DEFAULT 0');
        await safeAddColumn('tipos_producto',  'es_barra',       'INTEGER DEFAULT 0');
        await safeAddColumn('detalles_compra', 'producto_id',    'INTEGER');
        await safeAddColumn('movimientos_caja','sesion_id',      'INTEGER');
        await safeAddColumn('facturas',        'sesion_caja_id', 'INTEGER');

        // Ensure caja_sesiones table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS caja_sesiones (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                caja_id INTEGER NOT NULL,
                usuario_apertura_id INTEGER,
                usuario_cierre_id INTEGER,
                fecha_apertura TEXT DEFAULT (datetime('now')),
                fecha_cierre TEXT,
                monto_inicial REAL DEFAULT 0.00,
                monto_teorico_cierre REAL,
                monto_contado_cierre REAL,
                diferencia REAL,
                estado TEXT NOT NULL DEFAULT 'abierta' CHECK(estado IN ('abierta', 'cerrada')),
                observaciones_apertura TEXT,
                observaciones_cierre TEXT,
                FOREIGN KEY (caja_id) REFERENCES cajas(id),
                FOREIGN KEY (usuario_apertura_id) REFERENCES usuarios(id),
                FOREIGN KEY (usuario_cierre_id) REFERENCES usuarios(id)
            )
        `);
        console.log('Ensured table caja_sesiones');

        // Ensure correlativos table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS correlativos (
                tipo TEXT PRIMARY KEY,
                serie TEXT NOT NULL DEFAULT 'B001',
                siguiente_numero INTEGER NOT NULL DEFAULT 1
            )
        `);
        await pool.query("INSERT OR IGNORE INTO correlativos (tipo, serie, siguiente_numero) VALUES (?, ?, ?)", ['boleta',  'B001', 1]);
        await pool.query("INSERT OR IGNORE INTO correlativos (tipo, serie, siguiente_numero) VALUES (?, ?, ?)", ['factura', 'F001', 1]);
        console.log('Ensured table correlativos');

        // Ensure default provider
        const [provs] = await pool.query('SELECT id FROM proveedores LIMIT 1');
        if (provs.length === 0) {
            await pool.query(
                "INSERT INTO proveedores (razon_social, ruc, contacto, telefono) VALUES (?, ?, ?, ?)",
                ['Proveedor General', '00000000000', 'Admin', '000000000']
            );
            console.log('Created default provider.');
        }

        // Ensure default cash register
        const [cajas] = await pool.query('SELECT id FROM cajas LIMIT 1');
        if (cajas.length === 0) {
            await pool.query(
                "INSERT INTO cajas (descripcion, saldo, estado) VALUES (?, ?, ?)",
                ['Caja Principal', 0, 'cerrada']
            );
            console.log('Created default cash register.');
        }

        // Ensure default users (INSERT OR IGNORE to preserve existing passwords)
        const defaultUsers = [
            { nombre: 'Mozo Demo',     email: 'mozo@restaurant.com',    password_hash: 'mozo123',    rol: 'mozo' },
            { nombre: 'Caja Demo',     email: 'caja@restaurant.com',    password_hash: 'caja123',    rol: 'caja' },
            { nombre: 'Cocina Demo',   email: 'cocina@restaurant.com',  password_hash: 'cocina123',  rol: 'cocina' },
            { nombre: 'Administrador', email: 'admin@restaurant.com',   password_hash: 'admin123',   rol: 'administrador' }
        ];

        for (const user of defaultUsers) {
            await pool.query(
                `INSERT OR IGNORE INTO usuarios (nombre, email, password_hash, rol) VALUES (?, ?, ?, ?)`,
                [user.nombre, user.email, user.password_hash, user.rol]
            );
        }
        console.log('Default users ensured.');

        console.log('Migrations completed successfully.');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err.message);
        process.exit(1);
    }
}

migrate();
