-- Actualizacion del 2026-10-30: el stock de productos admite decimales (p. ej. cerveza por litros)
-- OPCIONAL: la aplicacion hace este cambio sola al iniciar. Ejecutar solo si el usuario de MySQL de la aplicacion no puede hacer ALTER.
-- Es seguro repetirlo: convertir a DECIMAL un stock que ya es DECIMAL no cambia nada. No borra datos.
ALTER TABLE stock_productos MODIFY stock DECIMAL(12,3) NOT NULL DEFAULT 0;

-- Descuento de stock por unidad vendida (botella de 620 ml con stock en litros = 0.62). La aplicacion tambien lo agrega sola al iniciar.
SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE productos ADD COLUMN factor_venta DECIMAL(12,4) NOT NULL DEFAULT 1', 'SELECT 1')
            FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'factor_venta');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
