-- Descuento % en el punto de venta: por plato (detalles_pedido) y global de la cuenta (pedidos).
-- OPCIONAL: la aplicacion crea estas columnas sola al iniciar. Ejecutar solo si prefiere hacerlo a mano (una sola vez).
ALTER TABLE detalles_pedido ADD COLUMN descuento_pct DECIMAL(5,2) NOT NULL DEFAULT 0;
ALTER TABLE pedidos ADD COLUMN descuento_global_pct DECIMAL(5,2) NOT NULL DEFAULT 0;
