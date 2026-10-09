# Publicación — App.Restaurant (Plesk Node.js Selector)

Esta carpeta contiene el paquete **listo para subir tal cual** a un hosting
compartido Windows con Plesk (Node.js Selector). Incluye `node_modules` ya
instalado porque ese hosting no permite ejecutar `npm install`.

## Contenido

```
publicacion/                (todo esto va DIRECTO en la raíz del sitio)
├── index.js           # API + sirve el frontend ya compilado (carpeta public/)
├── db.js
├── initDb.js          # Reset completo de la BD (borra y recrea desde database.sql)
├── migrate.js         # Migraciones incrementales + seed data
├── package.json
├── .env                # PORT=3000 (Plesk normalmente inyecta su propio PORT)
├── restaurant.db       # Base de datos SQLite con los datos actuales
├── node_modules/       # Dependencias ya instaladas (Windows x64, Node v25.2.1)
├── public/             # Build de producción del cliente (React/Vite)
├── database.sql        # Esquema completo (solo referencia, no lo usa el server)
└── README.md           # Este archivo (solo referencia)
```

**No hay subcarpeta `server/`.** Todo el contenido de `publicacion/` se sube
tal cual, sin entrar a ninguna carpeta primero: `index.js` debe quedar
directo en la raíz del Application Root de Plesk
(`.../www/restaurantia/index.js`). Si subes la carpeta `publicacion`
completa como una unidad (quedando `.../restaurantia/publicacion/index.js`)
tampoco va a funcionar — sube el *contenido*, no la carpeta contenedora.

El frontend YA está compilado (`client/dist` → `public/`) y el backend
sirve esos archivos estáticos desde el mismo proceso Node, en el mismo
puerto/dominio. Ya no hay URLs `http://localhost:3000` hardcodeadas en el
cliente: todas las llamadas usan rutas relativas `/api/...`, así que
funcionan sin importar el dominio real del hosting.

## Pasos en Plesk

1. **Subir los archivos.** En el File Manager de Plesk, entra a la carpeta
   raíz del dominio/subdominio (`www/restaurantia/` o la que corresponda) y
   sube ahí **el contenido** de esta carpeta `publicacion/` (selecciona
   todos los archivos y carpetas de adentro, no la carpeta `publicacion`
   en sí). Al terminar debe quedar `www/restaurantia/index.js`,
   `www/restaurantia/node_modules/`, etc. — directo, sin nivel intermedio.
2. **Activar Node.js en el dominio** (Plesk > tu dominio > Node.js):
   - **Application Root**: esa misma carpeta raíz donde subiste los archivos.
   - **Application Startup File**: `index.js`
   - **Application Mode**: production
   - **NO uses el botón "NPM install"** — ya está incluido `node_modules`.
     Si Plesk lo pide igual, puedes omitirlo; la app arranca sin él.
3. **Versión de Node**: este paquete está probado y funcionando con **Node
   v25.2.1** (la versión fija de este hosting). Se usa `better-sqlite3@13`,
   que trae binarios N-API (ABI estable) embebidos en el propio paquete —
   no requiere compilar nada en el servidor. Si en algún momento el hosting
   cambia de versión de Node, avísame y confirmo compatibilidad (o
   regenero el paquete) antes de subir.
4. Dale **Reiniciar app** (Restart App) en el panel de Plesk.
5. Abre el dominio en el navegador: debe cargar la aplicación React
   directamente (no una página de "API Running"), y el login debe
   consultar `/api/usuarios` sin errores de CORS ni "localhost".

## Si sigue dando 502 / "Cannot find module .../index.js"

Ese error específico significa que `index.js` no está exactamente en el
Application Root. Verifica en el File Manager, abriendo la carpeta que
Plesk tiene configurada como Application Root, que **veas `index.js`
listado ahí mismo** (no un nivel más abajo). Si ves una carpeta de más
(`server`, `publicacion`, etc.) antes de llegar a `index.js`, mueve todo un
nivel hacia arriba.

## Base de datos

- Se incluye `restaurant.db` con los datos que tenías en desarrollo. Si
  prefieres arrancar en blanco (solo el seed de `database.sql`, sin tus
  pruebas), sube en su lugar una copia recién generada con
  `npm run db:init` desde tu máquina antes de empaquetar, o pide que se
  regenere el paquete con la base "limpia".
- SQLite escribe a archivos `restaurant.db-wal` / `restaurant.db-shm`
  junto al `.db` en cuanto arranca la app — asegúrate de que la cuenta del
  hosting tenga permiso de escritura en esa carpeta (normalmente sí, al ser
  tu propio Application Root).
- **Backups**: como es un archivo único, respaldarlo es copiar
  `restaurant.db` (con la app detenida, o usando el comando `.backup` de
  SQLite si necesitas hacerlo en caliente).

## Actualizar la publicación más adelante

Cuando vuelvas a compilar (cambios en `client/` o `server/`), no hace falta
rehacer todo el paquete a mano — dime "regenera la carpeta publicacion" y
la reconstruyo (build del cliente + copia de server + node_modules) antes
de que la vuelvas a subir. Si solo cambió el backend, basta con resubir los
`.js` modificados (no hace falta tocar `node_modules` ni `public/`).
