# RestaurantTinpu — Integración con la API de Facturación Electrónica propia

Resumen de lo implementado para dejar de usar Nubefact y emitir a SUNAT a través de nuestra API (`site19`). Complementa a `FACTURACION_API_PROPIA.md`. Fecha de corte: 2026-10-26. Rama: `feature/facturacion-propia` (sin commit todavía).

## 1. Qué cambió

El restaurante ya **no usa Nubefact**. Todo comprobante pasa por un conector propio que traduce el payload que el sistema siempre armó (`buildComprobantePayload`) al formato de la API, y devuelve la respuesta con los mismos campos que el resto del sistema espera.

Por eso se **conservaron los nombres legados** de columnas y campos (`nubefact_payload`, `nubefact_respuesta`, `nubefact_ambiente`, `nubefact_ruc_pruebas`): evita migraciones destructivas y cambios en el resto del código.

## 2. Conector — `server/facturacion.js`

| Función | Para qué sirve |
|---|---|
| `validarCredenciales` | URL solo HTTPS (HTTP únicamente a localhost) y API key con formato `fe_...` |
| `request` | Envía comprobantes y guías; traduce la respuesta |
| `infoCuenta` / `verificarCuenta` | Consulta la cuenta de la API antes de emitir |
| `estadoDesdeRespuesta` | Devuelve `aceptado`, `rechazado`, `incierto` o `pendiente` |
| `consultarPayload` | Consulta si un documento ya existe |
| `_traduccion` | Traductores internos, usados por las pruebas |

Comportamiento:

- **Aceptado**: marca `aceptada_por_sunat`, hash, cadena QR y enlaces de XML/CDR.
- **Rechazo de SUNAT (422)**: estado `rechazado`, sin lanzar excepción.
- **SUNAT no disponible (502) o sin respuesta de red**: estado `incierto`; se consulta antes de reenviar para no duplicar.
- **Documento en Error con más de 30 s**: se reenvía automáticamente.
- **Solicitud inválida (400)** y **API key inválida (401)**: error claro y el documento no se marca.
- **Idempotencia**: cada envío usa `externalId` (`cpe-<tipo>-<serie>-<numero>`).
- **Seguridad de ambiente** (`verificarCuenta`):
  - En `PRUEBAS` bloquea si la cuenta de la API emite en producción.
  - En `PRODUCCION` exige que el RUC de la cuenta coincida con el de la empresa.

### Documentos traducidos
- Boleta (03) y factura (01), contado y crédito (cuotas y monto neto).
- Nota de crédito (07) con documento que modifica y motivo.
- Guía de remisión remitente (09) con conductor, placa, ubigeos y documento relacionado. El código de establecimiento anexo se envía solo si el sistema lo informa.
- IGV **10,5 %** (`tasaIgv`) con importes por ítem exactos para que el ticket impreso coincida con el XML.
- Un tipo de IGV no soportado **detiene el envío** en vez de mandar datos erróneos.

## 3. Configuración

- Nuevas columnas en `configuracion_empresa`: `facturacion_url` y `facturacion_token`.
- Migración: `publicacion/migrations/2026-10-26-facturacion-api-propia.sql` (ya ejecutada en producción por el usuario) y también aplicada en `server/migrate.js` y `database.sql`.
- Endpoints del servidor (`server/index.js`): obtener, guardar y **probar conexión** de la configuración de facturación.
- Pantalla `client/src/components/settings/FacturacionConfig.jsx`: URL, API key, ambiente, RUC, local y series, y botón «Probar conexión» (muestra empresa, ambiente y si hay certificado cargado).
- Se cambiaron los textos de la interfaz que mencionaban Nubefact.

## 4. Pruebas realizadas

- **Automáticas**: `npm test` en `server` → 16 de 16 (traducción de boleta, NC, crédito, guía, credenciales, aceptado, rechazo 422, 502, reenvío, 400, 401, red, consulta 404 y verificación de ambiente).
- **Extremo a extremo en SUNAT beta**: factura **F003-108 aceptada (código 0)**, con importes, hash y QR coincidentes con el ticket. Se usa el tenant demo (RUC 20000000001), porque el RUC real no puede autenticarse en beta.
- **Prueba de conexión** desde el panel del restaurante: correcta (EMPRESA DEMO BETA SAC, beta, certificado cargado).
- **Guías**: en modo no productivo la API las **simula** (código `SIM`, sin enviarlas a SUNAT); ejemplo T003-105.

## 5. Despliegue

Sitio `site14` (Windows, Node.js en hosting compartido).

```powershell
cd D:\Desarrollos\RestaurantTinpu
npm --prefix client run build
node scripts\prepare-publicacion.cjs
powershell -ExecutionPolicy Bypass -File scripts\publicar.ps1 -PublishSettings D:\Desarrollos\RestaurantTinpu\site14.PublishSettings
```

Después, **reiniciar la aplicación Node.js** desde el panel del hosting. `publicacion/` es el paquete que arma `prepare-publicacion.cjs`. El script pide la contraseña de Web Deploy por consola.

> Pendiente: volver a desplegar el restaurante porque el conector cambió (los códigos de establecimiento de las guías ya no se inventan como `0000`).

## 6. Estado: solo pruebas

Por ahora el restaurante emite **solo a SUNAT beta** contra el tenant demo. **No está en producción.**

Para pasar a producción con la empresa real (SONDER AXIS, RUC 20615200892):

1. Cargar en la API el certificado digital real y el usuario SOL secundario (y credenciales GRE si se emiten guías).
2. Marcar el tenant como *Producción* y activarlo.
3. Generar una API key nueva para el restaurante y guardarla en la configuración.
4. Cambiar el ambiente del restaurante a `PRODUCCION` (el conector verificará que el RUC coincida).
5. Probar con documentos reales de poco monto y revocar las API keys de prueba.

## 7. Archivos tocados

- `server/facturacion.js` (nuevo), `server/index.js`, `server/migrate.js`, `database.sql`
- `server/tests/facturacion.test.js` (nuevo) y `server/package.json` (`"test": "node --test tests/*.test.js"`)
- `server/legado_nubefact/nubefact.js` (copia del conector anterior, solo referencia)
- `client/src/components/settings/FacturacionConfig.jsx` y textos relacionados
- `publicacion/migrations/2026-10-26-facturacion-api-propia.sql`
- `scripts/publicar.ps1`, `scripts/prepare-publicacion.cjs`
- `FACTURACION_API_PROPIA.md` y este documento

## 8. Pendientes

- Redesplegar el restaurante (ver §5).
- Script de pruebas de todos los documentos (boleta, factura contado/crédito, NC por motivo, ND) contra beta.
- Definir si el restaurante emite facturas a crédito y notas de débito.
- Pasar a producción (ver §6).
- Hacer commit en la rama `feature/facturacion-propia` (el repositorio ya tenía cambios sin relación).
