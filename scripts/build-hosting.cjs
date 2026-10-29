// Compilacion para el despliegue con GitHub: construye el cliente y lo deja en server/public, donde el servidor lo sirve.
// El panel ya ejecuta `npm install` en la raiz (dependencias del servidor) antes de llamar a este script.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const client = path.join(root, 'client');
const dist = path.join(client, 'dist');
const target = path.join(root, 'server', 'public');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(args) {
    // Se ejecuta dentro de client/ (sin --prefix): asi npm no mezcla el package.json de la raiz con el del cliente.
    const result = spawnSync(npm, args, { cwd: client, stdio: 'inherit', shell: process.platform === 'win32' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`npm ${args.join(' ')} termino con codigo ${result.status}`);
}

// Vite es una dependencia de desarrollo: se incluye aunque el entorno tenga NODE_ENV=production.
run(['install', '--include=dev', '--no-audit', '--no-fund']);
run(['run', 'build']);

if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error('No se genero client/dist/index.html');
fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(dist, target, { recursive: true });
console.log(`Cliente copiado a ${path.relative(root, target)}`);
