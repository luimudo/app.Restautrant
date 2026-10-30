-- Actualizacion del 2026-10-30: costo unitario de los productos (bebidas)
-- Ejecutar UNA vez en el administrador MySQL del hosting (base de datos de la aplicacion).
-- Es seguro repetirlo: la columna se agrega solo si falta. No borra datos.
-- La aplicacion tambien la crea sola al iniciar; este script solo evita depender de que el usuario de MySQL tenga permiso de ALTER.
--
--   productos.costo_unitario: costo por unidad de stock. Se actualiza con el promedio ponderado de cada entrada con costo
--   y se puede escribir a mano en la carta. Los reportes lo usan en lugar del 40% estimado del precio de venta.

SET @sql = (SELECT IF(COUNT(*) = 0,
                      'ALTER TABLE productos ADD COLUMN costo_unitario DECIMAL(12,4) NOT NULL DEFAULT 0',
                      'SELECT ''costo_unitario ya existe'' AS aviso')
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'costo_unitario');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Comprobacion: debe devolver una fila con DATA_TYPE = decimal
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TYPE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'costo_unitario';
