# Facturacion electronica con la API propia (sin Nubefact)

El sistema emite boletas, facturas, notas de credito/debito y guias de remision remitente a traves de la API propia
de facturacion (FacturacionSaaS). Nubefact ya no se usa; el conector anterior quedo en `server/legado_nubefact/` solo como referencia.

## Como funciona
- `server/facturacion.js` traduce el documento electronico que el sistema ya arma (se sigue guardando en `facturas.nubefact_payload`,
  nombre de columna heredado) a la solicitud de la API y devuelve los mismos campos de respuesta (hash, QR, enlaces XML/CDR, estado).
- Respeta la tasa de IGV del sistema (p. ej. 10.5 %) y los importes ya calculados: el ticket impreso y el XML enviado coinciden.
- Estados: aceptado, rechazado (SUNAT rechazo), incierto (SUNAT/API sin respuesta: se consulta o se reenvia), pendiente.
- Antes de enviar comprueba que la API key corresponde a la cuenta correcta: en PRODUCCION exige el mismo RUC de la empresa,
  cuenta en produccion y certificado cargado; en PRUEBAS exige una cuenta en SUNAT beta.
- La representacion impresa (ticket / A4) la sigue generando el sistema con el hash y el QR que devuelve la API.

## Configuracion
1. En el panel de facturacion: empresa (RUC), local, series y certificado; genere una API key para el sistema del restaurante.
2. Ejecutar `npm run db:migrate` (agrega `configuracion_empresa.facturacion_url` y `facturacion_token`).
3. En el sistema: Configuracion > Facturacion electronica -> URL de la API, API key y ambiente.
   - PRUEBAS = SUNAT beta (cuenta demo, sin valor tributario).  PRODUCCION = SUNAT real (RUC, certificado y series de la empresa).
4. "Probar conexion" muestra la cuenta a la que apunta la API key.

## Pruebas
`cd server && npm test` (16 pruebas del conector). Probado de extremo a extremo contra SUNAT beta: boleta anonima y con DNI (IGV 10.5 %),
factura contado y credito, nota de credito, nota de debito, consulta, idempotencia y error por serie inexistente.

## Pendiente / limites
- Guias de remision: se envian por la API pero no estan validadas con SUNAT (requieren credenciales de la API GRE de la empresa).
- Pagador del flete / subcontratador (guia transportista): no soportados; el sistema los detiene con un mensaje.
- El RUC de pruebas (`nubefact_ruc_pruebas`) se sigue usando para las guias entre establecimientos en PRUEBAS (20000000001 en SUNAT beta).
