-- Clientes: activar / desactivar. Un cliente con pedidos o comprobantes no se puede eliminar, solo desactivar.
-- OPCIONAL: la aplicacion crea esta columna sola al iniciar. Ejecutar solo si prefiere hacerlo a mano (una sola vez).
ALTER TABLE clientes ADD COLUMN activo TINYINT(1) NOT NULL DEFAULT 1;
