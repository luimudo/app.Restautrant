const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'publicacion');
const archive = path.join(root, 'publicacion.zip');
if (!fs.existsSync(path.join(source, 'index.js')) || !fs.existsSync(path.join(source, 'node_modules', 'mysql2'))) {
    throw new Error('Primero prepara y verifica la carpeta publicacion.');
}

const ps = [
    '$ErrorActionPreference = "Stop"',
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    `$src = '${source.replace(/'/g, "''")}'`,
    `$dest = '${archive.replace(/'/g, "''")}'`,
    'if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Force }',
    '[System.IO.Compression.ZipFile]::CreateFromDirectory($src, $dest, [System.IO.Compression.CompressionLevel]::Optimal, $false)'
].join('; ');
const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
if (result.error || result.status !== 0) throw result.error || new Error(result.stderr || `PowerShell exit ${result.status}`);
console.log(`Paquete listo: ${archive} (${fs.statSync(archive).size} bytes).`);
