-- Actualizacion del 2026-10-30: el stock de productos admite decimales (p. ej. cerveza por litros)
-- OPCIONAL: la aplicacion hace este cambio sola al iniciar. Ejecutar solo si el usuario de MySQL de la aplicacion no puede hacer ALTER.
-- Es seguro repetirlo: convertir a DECIMAL un stock que ya es DECIMAL no cambia nada. No borra datos.
ALTER TABLE stock_productos MODIFY stock DECIMAL(12,3) NOT NULL DEFAULT 0;
