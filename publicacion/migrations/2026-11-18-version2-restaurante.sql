-- Version 2 (propuesta COT-2026-0010): R-02 cajas con almacen, R-03 presentaciones por litros, T-01 pagos de recordatorios.
-- OPCIONAL: la aplicacion crea estas columnas y tablas sola al iniciar (asegurarVersion2 en index.js).
-- Las tablas del modulo Personal (R-01: personal, personal_*, epp_*) tambien se crean solas al iniciar (personal.js).
-- Ejecutar solo si prefiere hacerlo a mano, una sola vez.

-- R-03: una presentacion (vaso, jarra) descuenta factor_venta litros del stock de su producto base (barril).
ALTER TABLE productos ADD COLUMN producto_base_id INT NULL;
ALTER TABLE productos ADD CONSTRAINT fk_productos_base FOREIGN KEY (producto_base_id) REFERENCES productos(id);

-- R-02: cada caja vende desde su almacen y se puede desactivar.
ALTER TABLE cajas ADD COLUMN almacen_id INT NULL;
ALTER TABLE cajas ADD CONSTRAINT fk_cajas_almacen FOREIGN KEY (almacen_id) REFERENCES almacenes(id);
ALTER TABLE cajas ADD COLUMN activo TINYINT(1) NOT NULL DEFAULT 1;

-- T-01: gasto generado por cada periodo atendido de un recordatorio con monto.
CREATE TABLE IF NOT EXISTS recordatorio_pagos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    recordatorio_id INT NOT NULL,
    sede_id INT NOT NULL,
    periodo VARCHAR(10) NOT NULL,
    gasto_id INT NOT NULL,
    usuario_id INT NULL,
    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_recordatorio_periodo (recordatorio_id, periodo),
    KEY idx_recordatorio_pagos_gasto (gasto_id),
    CONSTRAINT fk_recpagos_recordatorio FOREIGN KEY (recordatorio_id) REFERENCES recordatorios(id),
    CONSTRAINT fk_recpagos_gasto FOREIGN KEY (gasto_id) REFERENCES gastos(id),
    CONSTRAINT fk_recpagos_sede FOREIGN KEY (sede_id) REFERENCES sedes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
