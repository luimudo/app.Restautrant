-- Actualizacion del 2026-10-27: unidades de medida, conversiones, compras en el kardex y retiros de caja
-- Ejecutar UNA vez en el administrador MySQL del hosting (base de datos de la aplicacion), antes de subir esta version.
-- Es seguro repetirla: cada cambio se aplica solo si todavia no existe. No borra datos.
-- NO ejecutar database.sql: ese archivo recrea la base demo.
--
--   * unidades_medida y unidad_conversiones (catalogo con codigo SUNAT) + unidad_id en insumos, productos y detalles_compra
--   * inventario_movimientos.motivo admite 'compra' (las compras se ven en Movimientos del inventario y en Almacenes)
--   * movimientos_caja.categoria ('egreso' o 'retiro') para separar los retiros / entrega de caja en el informe de caja

-- 1. Unidades de medida
CREATE TABLE IF NOT EXISTS unidades_medida (id INT AUTO_INCREMENT PRIMARY KEY, nombre VARCHAR(60) NOT NULL, abreviatura VARCHAR(20) NOT NULL, codigo_sunat VARCHAR(5) NOT NULL DEFAULT 'NIU', permite_decimales TINYINT(1) NOT NULL DEFAULT 1, activo TINYINT(1) NOT NULL DEFAULT 1, creado_en DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uq_unidades_medida_nombre (nombre), UNIQUE KEY uq_unidades_medida_abreviatura (abreviatura)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci; 
CREATE TABLE IF NOT EXISTS unidad_conversiones (id INT AUTO_INCREMENT PRIMARY KEY, unidad_origen_id INT NOT NULL, unidad_destino_id INT NOT NULL, factor DECIMAL(14,6) NOT NULL, UNIQUE KEY uq_unidad_conversion (unidad_origen_id, unidad_destino_id), CONSTRAINT chk_unidad_conversion_factor CHECK (factor > 0), CONSTRAINT fk_unidad_conversion_origen FOREIGN KEY (unidad_origen_id) REFERENCES unidades_medida(id) ON DELETE CASCADE, CONSTRAINT fk_unidad_conversion_destino FOREIGN KEY (unidad_destino_id) REFERENCES unidades_medida(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci; 
INSERT IGNORE INTO unidades_medida (nombre, abreviatura, codigo_sunat, permite_decimales) VALUES
    ('Unidad', 'Unidad', 'NIU', 0), ('Kilogramo', 'Kg', 'KGM', 1), ('Gramo', 'Gr', 'GRM', 1), ('Litro', 'Lt', 'LTR', 1),
    ('Mililitro', 'Ml', 'MLT', 1), ('Paquete', 'Paquete', 'PK', 0), ('Caja', 'Caja', 'BX', 0), ('Docena', 'Docena', 'DZN', 0),
    ('Bolsa', 'Bolsa', 'BG', 0), ('Botella', 'Botella', 'BO', 0), ('Lata', 'Lata', 'CA', 0), ('Saco', 'Saco', 'SA', 0),
    ('Metro', 'Mt', 'MTR', 1), ('Libra', 'Lb', 'LBR', 1), ('Galon', 'Gal', 'GLL', 1);

-- 2. unidad_id en insumos, productos y detalles_compra (con su llave foranea)
SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE insumos ADD COLUMN unidad_id INT NULL', 'SELECT 1')
            FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'insumos' AND COLUMN_NAME = 'unidad_id');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE insumos ADD CONSTRAINT fk_insumos_unidad FOREIGN KEY (unidad_id) REFERENCES unidades_medida(id)', 'SELECT 1')
            FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'insumos' AND CONSTRAINT_NAME = 'fk_insumos_unidad');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE productos ADD COLUMN unidad_id INT NULL', 'SELECT 1')
            FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'unidad_id');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE productos ADD CONSTRAINT fk_productos_unidad FOREIGN KEY (unidad_id) REFERENCES unidades_medida(id)', 'SELECT 1')
            FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND CONSTRAINT_NAME = 'fk_productos_unidad');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE detalles_compra ADD COLUMN unidad_id INT NULL', 'SELECT 1')
            FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'detalles_compra' AND COLUMN_NAME = 'unidad_id');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE detalles_compra ADD CONSTRAINT fk_detalles_compra_unidad FOREIGN KEY (unidad_id) REFERENCES unidades_medida(id)', 'SELECT 1')
            FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'detalles_compra' AND CONSTRAINT_NAME = 'fk_detalles_compra_unidad');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3. Los textos de unidad que ya tenian los insumos y no estan en el catalogo se crean como unidades nuevas (codigo NIU: ajustelo luego en Inventario > Unidades)
INSERT IGNORE INTO unidades_medida (nombre, abreviatura, codigo_sunat, permite_decimales)
SELECT DISTINCT LEFT(TRIM(i.unidad_medida), 60), LEFT(TRIM(i.unidad_medida), 20), 'NIU', 1
FROM insumos i
WHERE i.unidad_id IS NULL AND TRIM(i.unidad_medida) <> ''
  AND NOT EXISTS (SELECT 1 FROM unidades_medida u WHERE LOWER(u.abreviatura) = LOWER(TRIM(i.unidad_medida)) OR LOWER(u.nombre) = LOWER(TRIM(i.unidad_medida)));

UPDATE insumos i
JOIN unidades_medida u ON LOWER(u.abreviatura) = LOWER(TRIM(i.unidad_medida)) OR LOWER(u.nombre) = LOWER(TRIM(i.unidad_medida))
SET i.unidad_id = u.id, i.unidad_medida = u.abreviatura
WHERE i.unidad_id IS NULL;

UPDATE insumos SET unidad_id = (SELECT id FROM (SELECT id FROM unidades_medida WHERE nombre = 'Unidad') x) WHERE unidad_id IS NULL;
UPDATE productos SET unidad_id = (SELECT id FROM (SELECT id FROM unidades_medida WHERE nombre = 'Unidad') x) WHERE unidad_id IS NULL;

-- 4. Conversiones habituales (1 origen = factor destino)
INSERT IGNORE INTO unidad_conversiones (unidad_origen_id, unidad_destino_id, factor)
SELECT o.id, d.id, c.factor FROM unidades_medida o JOIN unidades_medida d
JOIN (SELECT 'Kilogramo' AS origen, 'Gramo' AS destino, 1000 AS factor UNION ALL SELECT 'Litro', 'Mililitro', 1000 UNION ALL SELECT 'Docena', 'Unidad', 12 UNION ALL SELECT 'Libra', 'Gramo', 453.592 UNION ALL SELECT 'Galon', 'Litro', 3.785) c
ON o.nombre = c.origen AND d.nombre = c.destino;

-- 5. Las compras entran al kardex: nuevo motivo 'compra'
SET @sql = (SELECT IF(COLUMN_TYPE LIKE '%''compra''%', 'SELECT 1',
            'ALTER TABLE inventario_movimientos MODIFY motivo ENUM(''transferencia_salida'', ''transferencia_entrada'', ''merma_transferencia'', ''ingreso_manual'', ''egreso_manual'', ''venta'', ''anulacion_venta'', ''ajuste_manual'', ''compra'') NOT NULL')
            FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventario_movimientos' AND COLUMN_NAME = 'motivo');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 6. Retiros / entrega de caja en los egresos manuales de caja
SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE movimientos_caja ADD COLUMN categoria VARCHAR(20) NULL AFTER descripcion', 'SELECT 1')
            FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'movimientos_caja' AND COLUMN_NAME = 'categoria');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
