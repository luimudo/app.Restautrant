-- Actualizacion del 2026-10-23
-- Ejecutar UNA vez en el administrador MySQL del hosting (base de datos de la aplicacion), antes de subir esta version.
-- Es seguro repetirla: cada cambio se aplica solo si todavia no existe. No borra ni modifica datos.
-- NO ejecutar database.sql: ese archivo recrea la base demo.
--
-- Agrega:
--   * reservas: motivo, usuario y fecha de cancelacion
--   * facturas: motivo, usuario y fecha de anulacion de notas de venta
--   * pedidos: union de mesas (unido_a_pedido_id)
--   * proveedores: numero de cuenta y observaciones
--   * inventario_movimientos: motivos de ingreso/egreso manual, venta y anulacion de venta
--   * recordatorios: nueva tabla de recordatorios y vencimientos
--   * inventario_movimientos: referencia, costos y motivo de ajuste (movimientos de entrada, salida y ajuste)
--   * caja_sesiones: turno de la sesion de caja
--   * insumos: categorias de insumo (nueva tabla categorias_insumo y columna insumos.categoria_id)
--   * pedidos_delivery: pedidos para delivery con etapas (solicitado, enviado, facturado, entregado, rechazado)

-- reservas.motivo_cancelacion
SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE reservas ADD COLUMN motivo_cancelacion VARCHAR(200) NULL', 'SELECT 1')
            FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reservas' AND COLUMN_NAME = 'motivo_cancelacion');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- reservas.usuario_cancelacion_id
SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE reservas ADD COLUMN usuario_cancelacion_id INT NULL', 'SELECT 1')
            FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reservas' AND COLUMN_NAME = 'usuario_cancelacion_id');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- reservas.fecha_cancelacion
SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE reservas ADD COLUMN fecha_cancelacion DATETIME NULL', 'SELECT 1')
            FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reservas' AND COLUMN_NAME = 'fecha_cancelacion');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- facturas.motivo_anulacion
SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE facturas ADD COLUMN motivo_anulacion VARCHAR(200) NULL', 'SELECT 1')
            FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'facturas' AND COLUMN_NAME = 'motivo_anulacion');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- facturas.anulado_por
SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE facturas ADD COLUMN anulado_por INT NULL', 'SELECT 1')
            FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'facturas' AND COLUMN_NAME = 'anulado_por');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- facturas.fecha_anulacion
SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE facturas ADD COLUMN fecha_anulacion DATETIME NULL', 'SELECT 1')
            FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'facturas' AND COLUMN_NAME = 'fecha_anulacion');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- pedidos.unido_a_pedido_id
SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE pedidos ADD COLUMN unido_a_pedido_id INT NULL', 'SELECT 1')
            FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pedidos' AND COLUMN_NAME = 'unido_a_pedido_id');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- proveedores.nro_cuenta
SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE proveedores ADD COLUMN nro_cuenta VARCHAR(60) NULL', 'SELECT 1')
            FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'proveedores' AND COLUMN_NAME = 'nro_cuenta');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- proveedores.observaciones
SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE proveedores ADD COLUMN observaciones VARCHAR(500) NULL', 'SELECT 1')
            FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'proveedores' AND COLUMN_NAME = 'observaciones');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- reservas.usuario_cancelacion_id -> usuarios
SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE reservas ADD CONSTRAINT fk_reservas_usuario_cancelacion FOREIGN KEY (usuario_cancelacion_id) REFERENCES usuarios(id)', 'SELECT 1')
            FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reservas' AND COLUMN_NAME = 'usuario_cancelacion_id' AND REFERENCED_TABLE_NAME = 'usuarios');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- facturas.anulado_por -> usuarios
SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE facturas ADD CONSTRAINT fk_facturas_anulado_por FOREIGN KEY (anulado_por) REFERENCES usuarios(id)', 'SELECT 1')
            FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'facturas' AND COLUMN_NAME = 'anulado_por' AND REFERENCED_TABLE_NAME = 'usuarios');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- pedidos.unido_a_pedido_id -> pedidos
SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE pedidos ADD CONSTRAINT fk_pedidos_unido_a FOREIGN KEY (unido_a_pedido_id) REFERENCES pedidos(id)', 'SELECT 1')
            FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pedidos' AND COLUMN_NAME = 'unido_a_pedido_id' AND REFERENCED_TABLE_NAME = 'pedidos');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- inventario_movimientos.motivo (se amplia la lista de motivos)
SET @sql = (SELECT IF(COUNT(*) = 0 OR MAX(COLUMN_TYPE) LIKE '%ajuste_manual%', 'SELECT 1',
            'ALTER TABLE inventario_movimientos MODIFY motivo ENUM(''transferencia_salida'', ''transferencia_entrada'', ''merma_transferencia'', ''ingreso_manual'', ''egreso_manual'', ''venta'', ''anulacion_venta'', ''ajuste_manual'') NOT NULL')
            FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventario_movimientos' AND COLUMN_NAME = 'motivo');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- recordatorios (tabla nueva)
CREATE TABLE IF NOT EXISTS recordatorios (
    id INT AUTO_INCREMENT PRIMARY KEY,
    sede_id INT NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    categoria ENUM('pago', 'documento', 'licencia', 'otro') NOT NULL DEFAULT 'pago',
    monto DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    tipo_vencimiento ENUM('fecha', 'periodico') NOT NULL DEFAULT 'fecha',
    fecha_vencimiento DATE NULL,
    dia_pago TINYINT NULL,
    dias_aviso INT NOT NULL DEFAULT 7,
    notas VARCHAR(255) NULL,
    activo TINYINT(1) NOT NULL DEFAULT 1,
    eliminado TINYINT(1) NOT NULL DEFAULT 0,
    fecha_ultimo_pago DATE NULL,
    usuario_id INT NULL,
    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
    actualizado_en DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (sede_id) REFERENCES sedes(id),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
    INDEX idx_recordatorios_sede (sede_id, eliminado, activo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- pedidos_delivery y su historial (modulo de pedidos delivery)
CREATE TABLE IF NOT EXISTS pedidos_delivery (
    pedido_id INT NOT NULL PRIMARY KEY,
    sede_id INT NOT NULL,
    cliente_id INT NULL,
    cliente_nombre VARCHAR(150) NOT NULL,
    telefono VARCHAR(30) NOT NULL,
    direccion VARCHAR(255) NOT NULL,
    referencia VARCHAR(255) NULL,
    observacion VARCHAR(255) NULL,
    estado ENUM('solicitado', 'enviado', 'facturado', 'entregado', 'rechazado') NOT NULL DEFAULT 'solicitado',
    repartidor VARCHAR(100) NULL,
    motivo_rechazo VARCHAR(200) NULL,
    fecha_solicitado DATETIME DEFAULT CURRENT_TIMESTAMP,
    fecha_enviado DATETIME NULL,
    fecha_facturado DATETIME NULL,
    fecha_entregado DATETIME NULL,
    fecha_rechazado DATETIME NULL,
    usuario_id INT NULL,
    FOREIGN KEY (pedido_id) REFERENCES pedidos(id),
    FOREIGN KEY (sede_id) REFERENCES sedes(id),
    FOREIGN KEY (cliente_id) REFERENCES clientes(id),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
    INDEX idx_pedidos_delivery_sede (sede_id, estado, fecha_solicitado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pedidos_delivery_historial (
    id INT AUTO_INCREMENT PRIMARY KEY,
    pedido_id INT NOT NULL,
    estado VARCHAR(20) NOT NULL,
    nota VARCHAR(255) NULL,
    usuario_id INT NULL,
    fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (pedido_id) REFERENCES pedidos_delivery(pedido_id),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
    INDEX idx_pedidos_delivery_historial (pedido_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- categorias_insumo y insumos.categoria_id (categorias de insumos)
CREATE TABLE IF NOT EXISTS categorias_insumo (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(80) NOT NULL,
    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_categorias_insumo_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE insumos ADD COLUMN categoria_id INT NULL', 'SELECT 1')
            FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'insumos' AND COLUMN_NAME = 'categoria_id');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE insumos ADD CONSTRAINT fk_insumos_categoria FOREIGN KEY (categoria_id) REFERENCES categorias_insumo(id)', 'SELECT 1')
            FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'insumos' AND COLUMN_NAME = 'categoria_id' AND REFERENCED_TABLE_NAME = 'categorias_insumo');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- inventario_movimientos: referencia y costos del kardex
SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE inventario_movimientos ADD COLUMN referencia VARCHAR(100) NULL', 'SELECT 1')
            FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventario_movimientos' AND COLUMN_NAME = 'referencia');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE inventario_movimientos ADD COLUMN costo_unitario DECIMAL(12,4) NULL', 'SELECT 1')
            FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventario_movimientos' AND COLUMN_NAME = 'costo_unitario');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE inventario_movimientos ADD COLUMN costo_total DECIMAL(12,2) NULL', 'SELECT 1')
            FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventario_movimientos' AND COLUMN_NAME = 'costo_total');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- caja_sesiones.turno (el cuadre de caja se hace por turno)
SET @sql = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE caja_sesiones ADD COLUMN turno VARCHAR(30) NULL AFTER caja_id', 'SELECT 1')
            FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'caja_sesiones' AND COLUMN_NAME = 'turno');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
