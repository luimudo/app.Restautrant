const pool = require('./db');

async function test() {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [compraResult] = await connection.query(
            'INSERT INTO compras (proveedor_id, total, numero_factura_proveedor, estado) VALUES (?, ?, ?, ?)',
            [1, 10.5, 'TEST-001', 'recibido']
        );
        const compraId = compraResult.insertId;
        console.log('Compra Header OK, ID:', compraId);

        await connection.query(
            'INSERT INTO detalles_compra (compra_id, insumo_id, producto_id, cantidad, precio_unitario, subtotal) VALUES (?, ?, ?, ?, ?, ?)',
            [compraId, null, 3, 1, 10.5, 10.5] // Assuming 3 is Inka Kola
        );
        console.log('Detalle OK');

        await connection.query(
            'UPDATE productos SET stock = stock + ? WHERE id = ?',
            [1, 3]
        );
        console.log('Stock Update OK');

        await connection.rollback();
        console.log('Test Transaction Rollbacked (Manual)');
        process.exit(0);
    } catch (err) {
        console.error('TEST FAILED:', err);
        await connection.rollback();
        process.exit(1);
    } finally {
        connection.release();
    }
}

test();
