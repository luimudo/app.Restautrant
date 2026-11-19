# Plan de implementación — Sistema Restaurante (Propuesta COT-2026-0010 v2)

Fuente: `Version2/Propuesta_Implementacion_IADIGITALCONNECT_v2.docx`, secciones 3 (Sistema Restaurante) y 5 (Recordatorios, los 3 sistemas).

## Alcance para el Restaurante

| Código | Requerimiento | Horas |
|---|---|---|
| R-01 | Módulo Personal completo (6 secciones, Excel, adjuntos de hasta 15 MB) | 8 |
| R-02 | Módulo Caja: varias cajas por sede, cada una asociada a un almacén | 5 |
| R-03 | Cerveza de barril: descuento por litros según la presentación | 4 |
| T-01 | Recordatorios con importe: generar el pago en Gastos al marcarlos como atendidos | parte de 4 |
| T-03 | Pruebas integrales, migraciones y despliegue | parte de 2 |

C-06 (estado Vencido/Pendiente) ya funciona en el Restaurante: es el modelo que se replica en Concesionario.

## Criterios generales

- Las tablas y columnas nuevas se crean solas al iniciar la API (idempotente, igual que `clientes.activo`). También se entrega el script `publicacion/migrations/2026-11-18-version2-restaurante.sql` para quien prefiera aplicarlo a mano.
- Compatible con MySQL 5.7 del hosting (`max_allowed_packet` = 4 MB): los adjuntos de 15 MB se guardan en partes de 1 MB.
- Permisos por perfil: módulo nuevo `personnel` (Personal) en la pantalla de Perfiles y permisos; se otorga una sola vez al perfil Administrador.
- Exportación a Excel con `write-excel-file`, como en el resto del sistema.

## T-01 — Recordatorios con importe → Pagos y Gastos

1. Tabla `recordatorio_pagos` (recordatorio, periodo, gasto, usuario, fecha): vincula cada periodo atendido con su gasto; clave única (recordatorio, periodo) para no duplicar.
   - Periodo: `AAAA-MM` en los recordatorios periódicos (un pago por mes) y la fecha de vencimiento en los de fecha fija.
2. `POST /api/recordatorios/:id/atender` acepta `{ generar_pago, fecha_pago, metodo_pago, referencia, categoria_gasto_id, tipo_documento }`. Si el recordatorio es de tipo pago con monto y `generar_pago` está activo, en la misma transacción crea el gasto **al contado** (con su pago) mediante `insertarGasto`, con beneficiario = nombre del recordatorio.
3. Revertir: si el periodo tiene un gasto vigente, se pide anularlo primero en Gastos; si ya está anulado, se libera el vínculo.
4. Pantalla: al pulsar «Atendido» en un recordatorio con monto se abre un diálogo para confirmar la fecha, el medio de pago, la categoría del gasto y la referencia. El listado muestra el gasto vinculado (G-000123). Los recordatorios sin monto se siguen marcando directamente.

## R-03 — Cerveza de barril por litros

1. Columna `productos.producto_base_id`: una presentación (Vaso 0.3 L, Jarra 1.5 L…) es un producto de la carta con su precio que descuenta del stock del producto base (barril, stock en litros). `factor_venta` = litros por presentación.
2. Venta (`descontarStockVenta`): agrupa por producto de stock (`COALESCE(producto_base_id, id)`) y descuenta `SUM(cantidad × factor)` del almacén de la caja.
3. Anulación / nota de crédito (`restituirStockVenta`): devuelve los litros al mismo almacén; en notas por ítem convierte las unidades de cada presentación a litros del producto base.
4. Las presentaciones no tienen stock propio: no aparecen en inventario, transferencias ni ajustes; muestran el stock del barril.
5. Validaciones: el producto base debe tener stock, no puede ser otra presentación ni el mismo producto.
6. Reporte `GET /api/reportes/consumo-litros?desde&hasta`: unidades, litros e importe por producto base y presentación (comprobantes vigentes), con Excel.
7. Gaseosas y bebidas envasadas siguen descontando por unidades (sin producto base).

## R-02 — Varias cajas por sede, cada una con su almacén

1. Columnas `cajas.almacen_id` (almacén del que descuenta) y `cajas.activo`.
2. Mantenimiento de cajas (administrador): crear, editar descripción y almacén, activar/desactivar. El almacén debe ser de la misma sede. No se desactiva una caja con sesión abierta.
3. Venta: el stock sale del almacén de la caja donde se registra la venta; si la caja no tiene almacén, del almacén de ventas por defecto de la sede (comportamiento actual).
4. Apertura, arqueo y cierre siguen siendo independientes por caja; no se abre una caja inactiva.
5. Historial de arqueos filtrable por caja (y por sede para perfiles multisede, con el selector de sede).

## R-01 — Módulo Personal

Basado en el módulo Personal del Sistema de Distribución de Bebidas, adaptado a MySQL y al restaurante.

| Sección | Contenido |
|---|---|
| Trabajadores | Ficha: DNI, código, nombres, apellidos, nacimiento, ingreso, cese, sede, cargo, área, turno, vínculo (planilla, honorarios, locación, practicante), RUC, sistema de pensión, CUSPP, remuneración (solo administrador), teléfono, correo, dirección, funciones (mozo, cocina, bar, caja, delivery, limpieza), estado, observación. Adjuntos PDF/JPG/PNG de hasta 15 MB. |
| Uniforme y EPP | Entregas por trabajador (elemento, cantidad, talla, estado, motivo, costo, próximo cambio según frecuencia) y devoluciones parciales. |
| Control diario C/NC | Control por fecha, turno y área: lista los trabajadores activos × elementos de control diario; se marca C o NC (NC exige observación) y se cierra con el % de cumplimiento. |
| Elementos de EPP | Catálogo: nombre, tipo (EPP/uniforme), unidad, frecuencia de cambio en meses, costo, área, incluido en el control diario. |
| Costos por trabajador y área | Remuneración + costo de EPP/uniformes entregados en el periodo, por trabajador y por área. |
| Cargos, áreas y turnos | Mantenimiento de las tablas de configuración. |

- Tablas: `personal`, `personal_cargos`, `personal_areas`, `personal_turnos`, `personal_adjuntos`, `personal_adjunto_partes`, `epp_elementos`, `epp_entregas`, `epp_devoluciones`, `epp_controles`, `epp_control_detalle`.
- Rutas en `server/personal.js` (`/api/personal/...`), protegidas por el módulo `personnel`.
- Pantalla `/personal` con pestañas y botón Excel en cada sección.

## Pruebas

- Tests automatizados (`node --test`) contra la base de prueba: recordatorio con monto genera gasto y no duplica el periodo; venta de presentaciones descuenta litros del barril en el almacén de la caja y la anulación los devuelve; mantenimiento de cajas; CRUD de personal, adjunto de más de 4 MB, entrega de EPP, control C/NC y costos.
- Compilación del cliente (`vite build`) y lint.
- Prueba manual en el navegador de las pantallas nuevas.

## Despliegue

1. Commit en la rama `feature/facturacion-propia` y push a GitHub para las pruebas integrales.
2. En el hosting, la API crea sola las tablas y columnas al iniciar; el script SQL de `publicacion/migrations` queda como alternativa manual.
