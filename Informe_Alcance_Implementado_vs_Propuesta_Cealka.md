# INFORME DE ALCANCE
## Contraste entre la Propuesta «Cealka Digital Intelligence Restaurant» y lo efectivamente implementado

**Documento de referencia:** `Cealka_Digital_Intelligence_Restaurant.pdf` — Propuesta Técnica y Económica CONECTA-IA (11 slides).
**Base comparada:** Código fuente del sistema implementado (frontend `client/` en React y backend `server/` en Node.js/Express con MySQL).
**Fecha del informe:** 2026
**Tarifa de desarrollo considerada:** **S/ 30.00 por hora** (supuesto base de valorización).

---

## 1. Objetivo

Identificar y valorizar las **funcionalidades que se han implementado y que NO estaban contempladas en la propuesta original** de CONECTA-IA, presentando además el contraste del alcance propuesto vs. el alcance real, y una estimación de **tiempo (horas) y costo (Soles peruanos)** de todo lo adicional entregado.

---

## 2. Resumen de lo ofertado en la propuesta (valor referencial S/ 2,000 – pago único)

La propuesta plantea tres flujos y una arquitectura:

| Eje de la propuesta | Contenido ofertado |
|---|---|
| **Flujo de Servicio** | Toma de pedidos visual, enrutamiento inteligente Cocina/Bar (KDS) y facturación rápida (Billing). |
| **Flujo de Logística** | Multialmacén, Kardex Valorizado y gestión de recetas (Escandallo). |
| **Flujo Financiero** | Sesiones blindadas de caja, cuadre digital/efectivo y prevención de pérdidas. |
| **Control de Merma** | Sellado de fugas: platos equivocados, porciones mal servidas y robo/faltantes. |
| **Facturación Electrónica** | Generación automática de boletas y facturas con IGV y correlativos. |
| **Dashboard Gerencial** | Métricas de rentabilidad por plato y analítica. |
| **Arquitectura** | React + Node.js, operación en red local y nube (redundancia híbrida). |
| **Comercial** | S/ 2,000 pago único, soporte 6 meses, garantía 3 meses, 15 días calendario de implementación. |

---

## 3. Cobertura de lo propuesto (lo que SÍ se implementó)

| Propuesta | Estado en el sistema implementado | Evidencia |
|---|---|---|
| Toma de pedidos visual (POS) | **Implementado** | `client/src/pages/POS.jsx` (531 líneas) |
| Enrutamiento inteligente Cocina (KDS) | **Implementado** | `client/src/pages/Kitchen.jsx` (Kanban drag & drop) |
| Enrutamiento inteligente Bar | **Implementado** (supera lo propuesto: módulo Bar propio) | `client/src/pages/Bar.jsx` |
| Facturación rápida (Billing) | **Implementado** | `client/src/pages/Billing.jsx` (1,001 líneas) |
| Multialmacén y Kardex Valorizado | **Implementado** | `Almacenes.jsx`, `Inventory.jsx`, tablas `almacenes`, `inventario_movimientos` |
| Gestión de recetas (Escandallo) | **Parcial** | Existe la marca `es_receta` en productos y la tabla `recetas`, pero **no hay composición producto→insumos ni descuento de gramos al vender** (ver §5) |
| Sesiones blindadas de caja y arqueo | **Implementado** | `caja_sesiones`, `movimientos_caja`, `/api/caja/*` |
| Cuadre digital/efectivo | **Implementado** | `/api/caja/resumen/:sesionId`, informes de arqueo |
| Facturación electrónica (boletas/facturas, IGV, correlativos) | **Implementado y superado** | `server/facturacion.js`, `configuracion_empresa`, `facturas`, correlativos por sede |
| Dashboard gerencial | **Implementado** | `Dashboard.jsx`, `/api/stats/*` |
| React + Node.js + operación local/nube | **Implementado** | `client/` + `server/`, despliegue en hosting (sitio publicado) |

> **Conclusión de cobertura:** el núcleo prometido (POS, KDS, Billing, almacenes, caja, facturación y dashboard) está presente. Sin embargo, la **gestión de recetas/escandallo (deducción por gramo) quedó sin implementar en su parte central**, que era justamente uno de los pilares de ahorro prometidos.

---

## 4. Funcionalidades implementadas **NO contempladas** en la propuesta (alcance adicional)

Estos módulos y capacidades **no figuran** en la propuesta y representan desarrollo adicional entregado:

| # | Funcionalidad adicional | Descripción | Evidencia (muestra) |
|---|---|---|---|
| 1 | **Arquitectura multi-sede (sucursales)** | Aislamiento total de datos por sede; rol superadmin con selector de sede; tablas `sede_id` en toda la operación. La propuesta asume un solo local. | `Sedes.jsx`, `sedes`, `migrate.js` |
| 2 | **Control de acceso por roles y permisos** | 5 perfiles (superadmin, administrador, mozo, caja, cocina) con módulos y rutas por rol. | `security/accessControl.js`, `ProtectedRoute.jsx` |
| 3 | **Delivery** | Gestión de pedidos delivery con etapas (solicitado, enviado, facturado, entregado, rechazado) e historial. | `Delivery.jsx`, `pedidos_delivery*` |
| 4 | **Reservas** | Reservas por consumo/evento, confirmación, cancelación y validación. | `Reservas.jsx`, `reservas` |
| 5 | **Gestión de clientes (CRM) + consulta DNI/RUC** | Registro de clientes y consulta a RENIEC/SUNAT (Decolecta/API) para autocompletar. | `Clients.jsx`, `/api/clientes/buscar` |
| 6 | **Proveedores + Compras + Cuentas por pagar** | Cadena de abastecimiento completa con detalle de compra, unidades y kardex. | `Suppliers.jsx`, `Purchases.jsx`, `compras`, `detalles_compra`, `cuentas_por_pagar` |
| 7 | **Gastos y pagos** | Registro de gastos, categorías, tipos de documento, condición gravado/inafecto/exonerado, pagos y reporte de por pagar. | `Gastos.jsx`, `gastos`, `pagos_gasto`, `categorias_gasto` |
| 8 | **Cuentas por cobrar y cobros** | Ventas al crédito, estados (pendiente/parcial/vencido/cobrado) y registro de cobros. | `CuentasPorCobrar.jsx`, `cobros_venta` |
| 9 | **Equipos y mantenimiento** | Inventario de equipos con planes de mantenimiento, ejecución, historial, reporte de falla y baja. | `Equipos.jsx`, `equipos`, `mantenimientos`, `mantenimiento_planes` |
| 10 | **Recordatorios y vencimientos** | Alertas de pagos de servicios, documentos y licencias, con campana de notificaciones en el encabezado. | `Recordatorios.jsx`, `RecordatoriosBell.jsx`, `recordatorios` |
| 11 | **Multi-almacén avanzado: transferencias y guías** | Transferencias entre almacenes con despacho/recepción/anulación, guías internas y **guía de remisión remitente electrónica**, con catálogo **ubigeos INEI/SUNAT**. | `Almacenes.jsx`, `transferencias`, `guias`, `ubigeos` |
| 12 | **Unidades de medida con código SUNAT y conversiones** | Catálogo de unidades (con código SUNAT) y conversión entre unidades de compra y de stock. | `unidades_medida`, `unidad_conversiones`, `UnidadesModal.jsx` |
| 13 | **Categorías de insumo** | Catálogo maestro de categorías de insumos. | `categorias_insumo` |
| 14 | **Facturación electrónica avanzada con conector propio** | Reemplazo de Nubefact por **API de facturación propia**: notas de crédito/débito, facturas a crédito con cuotas, guías remitente (conductor/placa/ubigeo), estados (aceptado/rechazado/incierto), idempotencia, verificación de ambiente, QR, XML/CDR e IGV configurable (10.5%). | `server/facturacion.js`, `facturacion.test.js` |
| 15 | **Exportables a Excel e impresión de documentos** | Exportación a Excel en 10 módulos (arqueo, carta, compras, contactos, cuentas, delivery, gastos, inventario, reservas, ventas) y representación impresa (tickets, precuenta, A4, QR). | `utils/export*.js`, `utils/printDocs.js` |
| 16 | **Dashboard analítico ampliado** | Serie temporal de ventas (7/30 días/mes), KPIs de ventas del día, pedidos activos y clientes. | `Dashboard.jsx`, `/api/stats/ventas-tiempo` |
| 17 | **Imágenes de productos** | Carga, optimización y servicio de imágenes por producto. | `MenuManagement.jsx`, `producto_imagenes` |
| 18 | **Operación de salón extendida** | Juntar mesas, despacho de bar, estados por ítem de comanda, precuenta/ticket. | `/api/pedidos/juntar-mesas`, `/api/pedidos/:id/despachar-bar`, `/api/precuenta/ticket` |

**Resumen cuantitativo del sistema implementado:**
- **~127 endpoints** REST en el backend.
- **~40 tablas** en la base de datos.
- **20 páginas** funcionales en el frontend (7,000+ líneas solo en `pages/`).

---

## 5. Observaciones y brechas detectadas

1. **Escandallo / motor de recetas no implementado en su núcleo.** El sistema descuenta stock de **productos terminados** (bebidas/directos) al vender, pero **no explota la receta** para descontar insumos por gramo. Existe la bandera `es_receta` y la tabla `recetas`, sin editor de composición ni deducción. Impacto: la promesa de “cada gramo rastreado” y el control de merma por porción no se cumple aún.
2. **Control de merma.** Hay motivos de merma/consumo interno/vencimiento en el kardex, pero no un módulo específico de control de merma por receta (dependiente del punto 1).
3. **Facturación en modo pruebas.** El conector propio está probado contra SUNAT beta; el pase a producción (certificado, usuario SOL, tenant productivo) figura como pendiente.
4. **Soporte/garantía.** La propuesta ofrecía 6 meses de soporte y 3 de garantía; debe validarse su cumplimiento en el contrato.

---

## 6. Estimación de tiempo y costo de lo adicional

**Supuestos:**
- Tarifa de desarrollo: **S/ 30.00 por hora**.
- Estimación basada en el tamaño y complejidad del código implementado (no incluye pruebas de usuario, despliegue ni soporte posterior).
- Jornada de referencia: 8 horas/día.

| # | Funcionalidad adicional (no propuesta) | Horas estimadas | Costo (S/ 30/h) |
|---|---|---:|---:|
| 1 | Arquitectura multi-sede + superadmin/selector | 40 | 1,200.00 |
| 2 | Roles y permisos por módulo | 20 | 600.00 |
| 3 | Delivery | 16 | 480.00 |
| 4 | Reservas | 18 | 540.00 |
| 5 | Clientes + consulta DNI/RUC | 16 | 480.00 |
| 6 | Proveedores + Compras + Cuentas por pagar | 32 | 960.00 |
| 7 | Gastos, categorías y pagos | 26 | 780.00 |
| 8 | Cuentas por cobrar y cobros | 20 | 600.00 |
| 9 | Equipos y mantenimiento | 30 | 900.00 |
| 10 | Recordatorios y vencimientos | 14 | 420.00 |
| 11 | Multi-almacén: transferencias, guías y ubigeos | 40 | 1,200.00 |
| 12 | Unidades de medida (SUNAT) y conversiones | 18 | 540.00 |
| 13 | Categorías de insumo (catálogo) | 0 (incluido en #12) | 0.00 |
| 14 | Facturación electrónica avanzada (conector propio, NC/ND, crédito, guías) | 60 | 1,800.00 |
| 15 | Exportables Excel + impresión de documentos | 24 | 720.00 |
| 16 | Dashboard analítico ampliado | 12 | 360.00 |
| 17 | Imágenes de productos | 8 | 240.00 |
| 18 | Operación de salón extendida (KDS avanzado, juntar mesas) | 20 | 600.00 |
| | **TOTAL** | **414 h** | **S/ 12,420.00** |

> **Equivalencia:** 414 horas ≈ **51.8 días-hombre** ≈ **~10.4 semanas** con un desarrollador a tiempo completo.

---

## 7. Resumen económico comparativo

| Concepto | Horas | Costo (S/) |
|---|---:|---:|
| Alcance base de la propuesta (ofertado) | — | 2,000.00 |
| **Desarrollo adicional entregado (no propuesto)** | **414 h** | **12,420.00** |
| **Valor total de lo implementado (base + adicional)** | — | **S/ 14,420.00** |

**Interpretación:** el valor de desarrollo del sistema realmente entregado (S/ 14,420) equivale a **~7.2 veces el monto ofertado** (S/ 2,000). La diferencia se explica porque el sistema implementado es, en la práctica, un **ERP/POS completo multi-sucursal** y no el alcance acotado (mono-local) descrito en la propuesta.

> Nota: el monto de la propuesta (S/ 2,000) es un **precio comercial de cierre**, mientras que la cifra de S/ 12,420 es una **valorización de esfuerzo de desarrollo**; no son directamente comparables como “cobro”, sino como **magnitud de trabajo adicional entregado**.

---

## 8. Conclusiones

1. La totalidad del núcleo prometido está implementada y varias piezas fueron **superadas** (Bar como módulo propio, facturación electrónica avanzada, dashboard analítico).
2. Se entregaron **18 funcionalidades no contempladas** en la propuesta, que elevan notablemente el valor del sistema (delivery, reservas, CRM, compras/proveedores, gastos, cuentas por cobrar/pagar, equipos y mantenimiento, recordatorios, multi-sede, guías de remisión electrónicas, exportables, etc.).
3. El esfuerzo adicional se estima en **414 horas ≈ S/ 12,420** a razón de S/ 30/hora.
4. La principal brecha frente a lo prometido es el **motor de recetas/escandallo**, cuya parte central (explosión de insumos y descuento por gramo al vender) **aún no está implementada**; se recomienda priorizarla por su impacto directo en el control de merma y margen.

---

*Elaborado a partir del análisis del código fuente (`client/`, `server/`, `database.sql`, `migrate.js`) y del texto extraído de la propuesta PDF (OCR).*
