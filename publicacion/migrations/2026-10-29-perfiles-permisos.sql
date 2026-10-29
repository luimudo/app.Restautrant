-- Actualizacion del 2026-10-29: perfiles y permisos por modulo (contador, supervisor, repartidor + pantalla de permisos)
-- OPCIONAL: la aplicacion crea estas tablas y los perfiles por defecto sola al iniciar. Ejecutar este archivo solo si el usuario
-- de MySQL de la aplicacion no tiene permiso de CREATE/ALTER. Es seguro repetirlo. No borra datos.

ALTER TABLE usuarios MODIFY rol VARCHAR(30) NOT NULL DEFAULT 'mozo';

CREATE TABLE IF NOT EXISTS perfiles (
    codigo VARCHAR(30) NOT NULL PRIMARY KEY,
    nombre VARCHAR(60) NOT NULL,
    descripcion VARCHAR(255) NULL,
    base VARCHAR(20) NOT NULL,
    alcance VARCHAR(10) NOT NULL DEFAULT 'sede',
    sistema TINYINT(1) NOT NULL DEFAULT 0,
    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS perfil_modulos (
    perfil VARCHAR(30) NOT NULL,
    modulo VARCHAR(30) NOT NULL,
    PRIMARY KEY (perfil, modulo),
    CONSTRAINT fk_perfil_modulos_perfil FOREIGN KEY (perfil) REFERENCES perfiles(codigo) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- Los perfiles y sus modulos iniciales los siembra la aplicacion al iniciar (server/permisos.js).
