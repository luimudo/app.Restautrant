-- Observaciones del cliente (nov. 2026): Personal, cajas por usuario, costeo promedio y perfiles y permisos.
-- OPCIONAL: la aplicacion aplica estos cambios sola al iniciar (asegurarObservacionesNov2026 en index.js y
-- actualizarEsquema en personal.js). Ejecutar solo si prefiere hacerlo a mano, una sola vez y en este orden.

-- Inventario: costo promedio ponderado con 4 decimales (un insumo comprado por kg y llevado en gramos cuesta
-- fracciones de centimo; con 2 decimales el promedio se distorsionaba en cada compra).
ALTER TABLE insumos MODIFY costo_unitario DECIMAL(12,4) DEFAULT 0;

-- Cajas: usuarios asignados a cada caja (varios, por turno). Solo ellos ven y operan la caja;
-- el administrador, el contador (con Facturacion) y el super admin operan todas.
CREATE TABLE IF NOT EXISTS caja_usuarios (
    caja_id INT NOT NULL,
    usuario_id INT NOT NULL,
    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (caja_id, usuario_id),
    KEY idx_caja_usuarios_usuario (usuario_id),
    CONSTRAINT fk_cajausr_caja FOREIGN KEY (caja_id) REFERENCES cajas(id) ON DELETE CASCADE,
    CONSTRAINT fk_cajausr_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Personal: funciones como texto libre (los codigos antiguos "mozo,caja" los convierte la aplicacion a "Mozo, Caja").
ALTER TABLE personal MODIFY funciones TEXT NULL;

-- Personal: devolucion o baja de uniforme / EPP, cada una con su fecha. Saldo vigente = cantidad - devuelta - baja.
ALTER TABLE epp_devoluciones ADD COLUMN tipo VARCHAR(12) NOT NULL DEFAULT 'devolucion' AFTER entrega_id;
ALTER TABLE epp_entregas ADD COLUMN baja DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER devuelta;

-- Perfiles y permisos: la pantalla pasa al modulo "permisos", que por defecto solo tiene el super admin.
-- No requiere cambios de tablas: ningun perfil tiene ese modulo hasta que el super admin lo otorgue.
