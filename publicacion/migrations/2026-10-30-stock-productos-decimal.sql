-- Actualizacion del 2026-10-30: productos por litros (stock decimal y descuento por unidad vendida)
-- Ejecutar UNA vez en el administrador MySQL del hosting (base de datos de la aplicacion), con la aplicacion detenida o no.
-- Es seguro repetirlo: cada cambio se aplica solo si todavia no existe. No borra datos.
-- NO ejecutar database.sql: ese archivo recrea la base demo.
--
--   1. stock_productos.stock pasa de INT a DECIMAL(12,3) (cerveza por litros: 12.5 L)
--   2. productos.factor_venta: unidades de stock que descuenta cada unidad vendida (botella de 620 ml con stock en litros = 0.62)

-- 1. Stock de productos con decimales (convertir un stock que ya es DECIMAL no cambia nada)
ALTER TABLE stock_productos MODIFY stock DECIMAL(12,3) NOT NULL DEFAULT 0;

-- 2. Columna factor_venta (solo si falta)
SET @sql = (SELECT IF(COUNT(*) = 0,
                      'ALTER TABLE productos ADD COLUMN factor_venta DECIMAL(12,4) NOT NULL DEFAULT 1',
                      'SELECT ''factor_venta ya existe'' AS aviso')
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'factor_venta');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3. Comprobacion: debe devolver stock = decimal y factor_venta = decimal
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TYPE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND ((TABLE_NAME = 'stock_productos' AND COLUMN_NAME = 'stock') OR (TABLE_NAME = 'productos' AND COLUMN_NAME = 'factor_venta'));
