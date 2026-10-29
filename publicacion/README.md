# Publicación para hosting Windows compartido

Esta carpeta está lista para subir a un hosting que ejecute aplicaciones Node.js en Windows y no permita ejecutar `npm install`. Incluye `node_modules` con las dependencias de producción ya instaladas.

## Despliegue

1. Sube el contenido de esta carpeta a la raíz de la aplicación Node.js del hosting.
2. Configura `index.js` como archivo de inicio y selecciona modo `production`.
3. Selecciona Node.js 18 o posterior. La aplicación usa dependencias JavaScript sin módulos nativos compilados.
4. Reinicia la aplicación desde el panel del hosting. No ejecutes `npm install` ni `initDb.js` en el hosting.

El archivo `.env` contiene la conexión a la base MySQL ya migrada. Si el panel define variables de entorno, esas variables prevalecen sobre `.env`. El proveedor debe asignar el puerto mediante `PORT`; la aplicación lo toma automáticamente.

El servidor Express sirve el frontend desde `public/` y las rutas de API desde el mismo proceso. La raíz de la aplicación debe ser esta carpeta, donde están juntos `index.js`, `node_modules/` y `public/`.

## Actualizar la base de datos

Si esta versión trae cambios de tablas, ejecuta una sola vez los archivos de `migrations/` (en orden de fecha) desde el administrador MySQL del hosting. Cada archivo se puede repetir sin riesgo: aplica solo lo que falta y no borra datos. No ejecutes `database.sql`: ese archivo recrea la base demo.

## Archivos incluidos

- `index.js` y módulos del servidor
- `public/` con el frontend compilado
- `node_modules/` con dependencias de producción
- `migrations/` con los scripts SQL de actualización de la base
- `package.json` y `package-lock.json`
- `.env` con conexión MySQL y clave de sesión

Conserva una copia privada de `.env`: contiene credenciales. Si cambias la contraseña MySQL en el panel, actualiza `DB_PASSWORD` aquí o en las variables de entorno del hosting.
