const pool = require('./db');

async function check() {
    try {
        const [categorias] = await pool.query('SELECT * FROM tipos_producto');
        console.log('Categorias:', categorias);

        const [productos] = await pool.query(`
            SELECT p.id, p.nombre, p.tipo_id, t.es_barra 
            FROM productos p 
            LEFT JOIN tipos_producto t ON p.tipo_id = t.id
        `);
        console.log('Productos:', productos);
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

check();
