CREATE TABLE IF NOT EXISTS producto_imagenes (
    producto_id INT NOT NULL PRIMARY KEY,
    mime_type VARCHAR(24) NOT NULL,
    contenido MEDIUMBLOB NOT NULL,
    actualizado_en DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_producto_imagenes_producto FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
