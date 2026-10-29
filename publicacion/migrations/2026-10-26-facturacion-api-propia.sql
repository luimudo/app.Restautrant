-- Actualizacion del 2026-10-26: facturacion electronica con la API propia (reemplaza a Nubefact)
-- Ejecutar UNA vez en el administrador MySQL del hosting (base de datos de la aplicacion), antes de subir esta version.
-- Es seguro repetirla: cada cambio se aplica solo si todavia no existe. No borra ni modifica datos.
-- NO ejecutar database.sql: ese archivo recrea la base demo.
--
-- Agrega a configuracion_empresa:
--   * facturacion_url    URL de la API de facturacion electronica (https://...)
--   * facturacion_token  API key del sistema en esa API
-- Las columnas nubefact_url / nubefact_token quedan sin uso (no se borran).
-- Despues de subir la version, cargue la URL y la API key en Configuracion > Facturacion electronica.

-- configuracion_empresa.facturacion_url
SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE configuracion_empresa ADD COLUMN facturacion_url VARCHAR(255) NULL AFTER nubefact_ambiente', 'SELECT 1')
            FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'configuracion_empresa' AND COLUMN_NAME = 'facturacion_url');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- configuracion_empresa.facturacion_token
SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE configuracion_empresa ADD COLUMN facturacion_token VARCHAR(255) NULL AFTER facturacion_url', 'SELECT 1')
            FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'configuracion_empresa' AND COLUMN_NAME = 'facturacion_token');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
