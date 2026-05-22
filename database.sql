-- SQLite Schema for Restaurant App (single-client)
PRAGMA foreign_keys = OFF;

-- Drop existing tables (in dependency order)
DROP TABLE IF EXISTS facturas;
DROP TABLE IF EXISTS detalles_pedido;
DROP TABLE IF EXISTS pedidos;
DROP TABLE IF EXISTS recetas;
DROP TABLE IF EXISTS insumos;
DROP TABLE IF EXISTS productos;
DROP TABLE IF EXISTS tipos_producto;
DROP TABLE IF EXISTS movimientos_caja;
DROP TABLE IF EXISTS caja_sesiones;
DROP TABLE IF EXISTS cajas;
DROP TABLE IF EXISTS clientes;
DROP TABLE IF EXISTS mesas;
DROP TABLE IF EXISTS zonas;
DROP TABLE IF EXISTS usuarios;
DROP TABLE IF EXISTS proveedores;
DROP TABLE IF EXISTS compras;
DROP TABLE IF EXISTS detalles_compra;
DROP TABLE IF EXISTS cuentas_por_pagar;
DROP TABLE IF EXISTS correlativos;

PRAGMA foreign_keys = ON;

-- 1. Usuarios
CREATE TABLE usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    rol TEXT NOT NULL DEFAULT 'mozo' CHECK(rol IN ('administrador', 'mozo', 'caja', 'cocina')),
    creado_en TEXT DEFAULT (datetime('now'))
);

-- 2. Zonas
CREATE TABLE zonas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    estado INTEGER DEFAULT 1
);

-- 3. Mesas
CREATE TABLE mesas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero TEXT UNIQUE NOT NULL,
    capacidad INTEGER NOT NULL,
    estado TEXT NOT NULL DEFAULT 'libre' CHECK(estado IN ('libre', 'ocupada', 'reservada')),
    zona_id INTEGER,
    FOREIGN KEY (zona_id) REFERENCES zonas(id)
);

-- 4. Clientes
CREATE TABLE clientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    telefono TEXT,
    email TEXT,
    documento TEXT
);

-- 5. Cajas
CREATE TABLE cajas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    descripcion TEXT NOT NULL,
    saldo REAL DEFAULT 0.00,
    estado TEXT NOT NULL DEFAULT 'cerrada' CHECK(estado IN ('abierta', 'cerrada')),
    creado_en TEXT DEFAULT (datetime('now'))
);

-- 6. Sesiones de Caja
CREATE TABLE caja_sesiones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    caja_id INTEGER NOT NULL,
    usuario_apertura_id INTEGER,
    usuario_cierre_id INTEGER,
    fecha_apertura TEXT DEFAULT (datetime('now')),
    fecha_cierre TEXT,
    monto_inicial REAL DEFAULT 0.00,
    monto_teorico_cierre REAL,
    monto_contado_cierre REAL,
    diferencia REAL,
    estado TEXT NOT NULL DEFAULT 'abierta' CHECK(estado IN ('abierta', 'cerrada')),
    observaciones_apertura TEXT,
    observaciones_cierre TEXT,
    FOREIGN KEY (caja_id) REFERENCES cajas(id),
    FOREIGN KEY (usuario_apertura_id) REFERENCES usuarios(id),
    FOREIGN KEY (usuario_cierre_id) REFERENCES usuarios(id)
);

-- 7. Movimientos Caja
CREATE TABLE movimientos_caja (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    caja_id INTEGER NOT NULL,
    sesion_id INTEGER,
    tipo TEXT NOT NULL CHECK(tipo IN ('ingreso', 'egreso')),
    monto REAL NOT NULL,
    descripcion TEXT,
    fecha TEXT DEFAULT (datetime('now')),
    usuario_id INTEGER,
    FOREIGN KEY (caja_id) REFERENCES cajas(id),
    FOREIGN KEY (sesion_id) REFERENCES caja_sesiones(id),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);

-- 8. Tipos de Producto
CREATE TABLE tipos_producto (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    descripcion TEXT,
    es_barra INTEGER DEFAULT 0
);

-- 9. Productos
CREATE TABLE productos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    descripcion TEXT,
    precio REAL NOT NULL,
    tipo_id INTEGER,
    es_receta INTEGER DEFAULT 1,
    disponible INTEGER DEFAULT 1,
    stock INTEGER DEFAULT 0,
    FOREIGN KEY (tipo_id) REFERENCES tipos_producto(id)
);

-- 10. Insumos
CREATE TABLE insumos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    unidad_medida TEXT NOT NULL,
    costo_unitario REAL DEFAULT 0.00,
    stock_actual REAL DEFAULT 0.00
);

-- 11. Recetas
CREATE TABLE recetas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    producto_id INTEGER NOT NULL,
    insumo_id INTEGER NOT NULL,
    cantidad_requerida REAL NOT NULL,
    FOREIGN KEY (producto_id) REFERENCES productos(id),
    FOREIGN KEY (insumo_id) REFERENCES insumos(id)
);

-- 12. Pedidos
CREATE TABLE pedidos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mesa_id INTEGER,
    cliente_id INTEGER,
    usuario_id INTEGER,
    estado TEXT NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente', 'en_proceso', 'listo', 'entregado', 'pagado', 'cancelado')),
    total REAL DEFAULT 0.00,
    fecha_creacion TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (mesa_id) REFERENCES mesas(id),
    FOREIGN KEY (cliente_id) REFERENCES clientes(id),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);

-- 13. Detalles Pedido
CREATE TABLE detalles_pedido (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pedido_id INTEGER NOT NULL,
    producto_id INTEGER NOT NULL,
    cantidad INTEGER NOT NULL,
    precio_unitario REAL NOT NULL,
    subtotal REAL NOT NULL,
    notas TEXT,
    estado_comanda TEXT NOT NULL DEFAULT 'pendiente' CHECK(estado_comanda IN ('pendiente', 'en_cocina', 'listo')),
    FOREIGN KEY (pedido_id) REFERENCES pedidos(id),
    FOREIGN KEY (producto_id) REFERENCES productos(id)
);

-- 14. Facturas
CREATE TABLE facturas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pedido_id INTEGER UNIQUE NOT NULL,
    cliente_id INTEGER,
    tipo_comprobante TEXT NOT NULL CHECK(tipo_comprobante IN ('boleta', 'factura')),
    numero_comprobante TEXT UNIQUE NOT NULL,
    fecha_emision TEXT DEFAULT (datetime('now')),
    total_venta REAL NOT NULL,
    impuesto REAL DEFAULT 0.00,
    sesion_caja_id INTEGER,
    FOREIGN KEY (pedido_id) REFERENCES pedidos(id),
    FOREIGN KEY (cliente_id) REFERENCES clientes(id),
    FOREIGN KEY (sesion_caja_id) REFERENCES caja_sesiones(id)
);

-- 15. Proveedores
CREATE TABLE proveedores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    razon_social TEXT NOT NULL,
    ruc TEXT UNIQUE NOT NULL,
    contacto TEXT,
    telefono TEXT,
    direccion TEXT
);

-- 16. Compras
CREATE TABLE compras (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    proveedor_id INTEGER NOT NULL,
    fecha_compra TEXT DEFAULT (datetime('now')),
    numero_factura_proveedor TEXT,
    total REAL NOT NULL,
    estado TEXT NOT NULL DEFAULT 'recibido' CHECK(estado IN ('pendiente', 'recibido')),
    FOREIGN KEY (proveedor_id) REFERENCES proveedores(id)
);

-- 17. Detalles Compra
CREATE TABLE detalles_compra (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    compra_id INTEGER NOT NULL,
    insumo_id INTEGER,
    producto_id INTEGER,
    cantidad REAL NOT NULL,
    precio_unitario REAL NOT NULL,
    subtotal REAL NOT NULL,
    FOREIGN KEY (compra_id) REFERENCES compras(id),
    FOREIGN KEY (insumo_id) REFERENCES insumos(id)
);

-- 18. Cuentas por Pagar
CREATE TABLE cuentas_por_pagar (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    compra_id INTEGER NOT NULL,
    proveedor_id INTEGER NOT NULL,
    monto_total REAL NOT NULL,
    monto_pagado REAL DEFAULT 0.00,
    fecha_vencimiento TEXT,
    estado TEXT NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente', 'parcial', 'pagado')),
    FOREIGN KEY (compra_id) REFERENCES compras(id),
    FOREIGN KEY (proveedor_id) REFERENCES proveedores(id)
);

-- 19. Correlativos (secuencias de numeracion de comprobantes)
CREATE TABLE correlativos (
    tipo TEXT PRIMARY KEY,
    serie TEXT NOT NULL DEFAULT 'B001',
    siguiente_numero INTEGER NOT NULL DEFAULT 1
);

-- Seed Data
INSERT INTO zonas (nombre) VALUES ('Salón Principal'), ('Terraza');

INSERT INTO tipos_producto (nombre, descripcion, es_barra) VALUES
('Entradas', 'Platos de entrada', 0),
('Platos de Fondo', 'Platos principales', 0),
('Bebidas', 'Bebidas frías y calientes', 1),
('Postres', 'Dulces y postres', 0);

INSERT INTO mesas (numero, capacidad, zona_id) VALUES
('M1', 4, 1),
('M2', 2, 1),
('M3', 6, 2);

INSERT INTO cajas (descripcion, saldo, estado) VALUES ('Caja Principal', 0, 'cerrada');

INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES
('Mozo Demo',    'mozo@restaurant.com',    'mozo123',    'mozo'),
('Caja Demo',    'caja@restaurant.com',    'caja123',    'caja'),
('Cocina Demo',  'cocina@restaurant.com',  'cocina123',  'cocina'),
('Administrador','admin@restaurant.com',   'admin123',   'administrador');

INSERT INTO productos (nombre, descripcion, precio, tipo_id, es_receta, disponible) VALUES
('Ceviche de Pescado',  'Clásico ceviche peruano con pescado fresco, limón y ají.', 35.00, 1, 1, 1),
('Lomo Saltado',        'Trozos de carne salteados con cebolla, tomate y papas fritas.', 42.00, 2, 1, 1),
('Inca Kola 500ml',     'Gaseosa nacional de sabor original.', 5.00, 3, 0, 1),
('Suspiro a la Limeña', 'Postre tradicional dulce con merengue.', 15.00, 4, 1, 1);

INSERT INTO correlativos (tipo, serie, siguiente_numero) VALUES
('boleta',  'B001', 1),
('factura', 'F001', 1);
