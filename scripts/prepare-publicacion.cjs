const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'publicacion');
const stage = fs.mkdtempSync(path.join(root, '.publicacion-stage-'));
const clientBuild = path.join(root, 'client', 'dist');
const serverRoot = path.join(root, 'server');
const dbPassword = process.env.PUBLICATION_DB_PASSWORD;

function run(command, args, cwd) {
    const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`);
}

function writeReadme(directory) {
    const content = [
        '# Publicación para hosting Windows compartido',
        '',
        'Esta carpeta está lista para subir a un hosting que ejecute aplicaciones Node.js en Windows y no permita ejecutar `npm install`. Incluye `node_modules` con las dependencias de producción ya instaladas.',
        '',
        '## Despliegue',
        '',
        '1. Sube el contenido de esta carpeta a la raíz de la aplicación Node.js del hosting.',
        '2. Configura `index.js` como archivo de inicio y selecciona modo `production`.',
        '3. Selecciona Node.js 18 o posterior. La aplicación usa dependencias JavaScript sin módulos nativos compilados.',
        '4. Reinicia la aplicación desde el panel del hosting. No ejecutes `npm install` ni `initDb.js` en el hosting.',
        '',
        'El archivo `.env` contiene la conexión a la base MySQL ya migrada. Si el panel define variables de entorno, esas variables prevalecen sobre `.env`. El proveedor debe asignar el puerto mediante `PORT`; la aplicación lo toma automáticamente.',
        '',
        'El servidor Express sirve el frontend desde `public/` y las rutas de API desde el mismo proceso. La raíz de la aplicación debe ser esta carpeta, donde están juntos `index.js`, `node_modules/` y `public/`.',
        '',
        '## Actualizar la base de datos',
        '',
        'Si esta versión trae cambios de tablas, ejecuta una sola vez los archivos de `migrations/` (en orden de fecha) desde el administrador MySQL del hosting. Cada archivo se puede repetir sin riesgo: aplica solo lo que falta y no borra datos. No ejecutes `database.sql`: ese archivo recrea la base demo.',
        '',
        '## Archivos incluidos',
        '',
        '- `index.js` y módulos del servidor',
        '- `public/` con el frontend compilado',
        '- `node_modules/` con dependencias de producción',
        '- `migrations/` con los scripts SQL de actualización de la base',
        '- `package.json` y `package-lock.json`',
        '- `.env` con conexión MySQL y clave de sesión',
        '',
        'Conserva una copia privada de `.env`: contiene credenciales. Si cambias la contraseña MySQL en el panel, actualiza `DB_PASSWORD` aquí o en las variables de entorno del hosting.',
        ''
    ].join('\n');
    fs.writeFileSync(path.join(directory, 'README.md'), content);
}

async function main() {
    const previousEnv = path.join(output, '.env');
    const reuseEnv = fs.existsSync(previousEnv);
    if (!dbPassword && !reuseEnv) throw new Error('Define PUBLICATION_DB_PASSWORD para configurar la conexión de producción.');
    if (!fs.existsSync(path.join(clientBuild, 'index.html'))) throw new Error('Compila el frontend primero: npm --prefix client run build');

    const sourcePackage = JSON.parse(fs.readFileSync(path.join(serverRoot, 'package.json'), 'utf8'));
    const dependencies = Object.fromEntries(Object.entries(sourcePackage.dependencies || {})
        .filter(([name]) => !['nodemon', 'better-sqlite3'].includes(name)));
    const packageJson = {
        name: 'restaurant-tinpu-publicacion',
        version: sourcePackage.version || '1.0.0',
        private: true,
        main: 'index.js',
        scripts: { start: 'node index.js' },
        engines: { node: '>=18' },
        dependencies
    };
    fs.writeFileSync(path.join(stage, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`);

    for (const file of ['index.js', 'db.js', 'auth.js', 'facturacion.js', 'formatosComprobante.js', 'numeroALetras.js', 'permisos.js']) {
        fs.copyFileSync(path.join(serverRoot, file), path.join(stage, file));
    }
    fs.cpSync(clientBuild, path.join(stage, 'public'), { recursive: true });
    const authSecret = crypto.randomBytes(48).toString('hex');
    const env = [
        'NODE_ENV=production',
        'PORT=3000',
        'APP_TIMEZONE=America/Lima',
        'DB_TIME_ZONE=-05:00',
        'DB_HOST=MYSQL5042.site4now.net',
        'DB_PORT=3306',
        'DB_USER=ac7c08_restcea',
        `DB_PASSWORD=${dbPassword}`,
        'DB_NAME=db_ac7c08_restcea',
        `AUTH_SECRET=${authSecret}`,
        'AUTH_TOKEN_TTL_HOURS=12',
        ''
    ].join('\n');
    // Un .env ya publicado se conserva tal cual: mantiene las credenciales y la clave de sesión (las sesiones abiertas siguen válidas).
    if (reuseEnv && !dbPassword) fs.copyFileSync(previousEnv, path.join(stage, '.env'));
    else fs.writeFileSync(path.join(stage, '.env'), env, { mode: 0o600 });
    const previousMigrations = path.join(output, 'migrations');
    if (fs.existsSync(previousMigrations)) fs.cpSync(previousMigrations, path.join(stage, 'migrations'), { recursive: true });
    writeReadme(stage);

    run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], stage);

    const stageNodeModules = path.join(stage, 'node_modules');
    const sourceNodeModules = path.resolve(stageNodeModules);
    if (!sourceNodeModules.startsWith(`${stage}${path.sep}`) || !fs.existsSync(path.join(stageNodeModules, 'mysql2', 'promise.js'))) {
        throw new Error('No se generó node_modules con mysql2.');
    }
    if (!fs.existsSync(path.join(stage, 'package-lock.json'))) throw new Error('No se generó package-lock.json.');

    const legacyRoot = path.join(root, 'respaldos');
    fs.mkdirSync(legacyRoot, { recursive: true });
    if (fs.existsSync(output)) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const legacy = path.join(legacyRoot, `publicacion-anterior-${stamp}`);
        if (path.dirname(legacy) !== legacyRoot || path.dirname(output) !== root) throw new Error('Destino de respaldo inválido.');
        try {
            fs.renameSync(output, legacy);
            console.log(`Publicación anterior respaldada en ${path.relative(root, legacy)}.`);
        } catch (error) {
            // Windows no deja renombrar una carpeta que otro programa tiene abierta (editor, Explorador, antivirus):
            // se respalda copiando y la carpeta nueva se copia por encima, sin renombrar.
            if (!['EPERM', 'EBUSY'].includes(error.code)) throw error;
            fs.cpSync(output, legacy, { recursive: true });
            fs.cpSync(stage, output, { recursive: true, force: true });
            console.log(`Publicación anterior respaldada (copia) en ${path.relative(root, legacy)}.`);
            console.log('Carpeta publicacion actualizada por copia (estaba en uso). Los archivos que ya no existen en el paquete nuevo no se borran.');
            return;
        }
    }
    fs.renameSync(stage, output);
    console.log('Carpeta publicacion preparada con MySQL, frontend y dependencias incluidas.');
}

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
}).finally(() => {
    if (fs.existsSync(stage) && path.dirname(stage) === root && path.basename(stage).startsWith('.publicacion-stage-')) {
        fs.rmSync(stage, { recursive: true, force: true });
    }
});
