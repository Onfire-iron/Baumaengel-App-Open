// Lädt den fertigen Ordner dist/ per SFTP auf den Webspace (npm run deploy).
//
// Die Zugangsdaten stehen in .deploy.local (nicht in Git), zum Beispiel:
//   SFTP_HOST=ssh.xyz.project.host
//   SFTP_USER=sftp-benutzer
//   SFTP_DIR=/html/maengel
//   SFTP_PORT=22            (optional)
// Ein Passwort steht dort nie: sftp fragt es beim Hochladen im Terminal ab. Ist beim SFTP-Benutzer
// ein SSH-Schlüssel hinterlegt, entfällt die Frage.
//
// Reihenfolge: erst alle übrigen Dateien, zum Schluss index.html und der Service Worker.
// So verweist die neue Version nie auf Dateien, die noch nicht oben sind.
// Alte Dateien in assets/ bleiben liegen (wenige 100 KB pro Version), sie stören nicht.

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DIST = 'dist';
const LAST = ['manifest.webmanifest', 'registerSW.js', 'sw.js', 'index.html'];

function readConfig(): Record<string, string> {
  if (!existsSync('.deploy.local')) {
    console.error('Es fehlt .deploy.local mit SFTP_HOST, SFTP_USER und SFTP_DIR, siehe UEBERGABE.md.');
    process.exit(1);
  }
  const config: Record<string, string> = {};
  for (const line of readFileSync('.deploy.local', 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) config[match[1]] = match[2];
  }
  for (const key of ['SFTP_HOST', 'SFTP_USER', 'SFTP_DIR']) {
    if (!config[key]) {
      console.error(`In .deploy.local fehlt ${key}.`);
      process.exit(1);
    }
  }
  return config;
}

// Alle Dateien und Ordner unter dist/, als Pfade relativ zu dist/
function walk(dir: string, prefix = ''): { dirs: string[]; files: string[] } {
  const result = { dirs: [] as string[], files: [] as string[] };
  for (const name of readdirSync(dir).sort()) {
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(join(dir, name)).isDirectory()) {
      result.dirs.push(rel);
      const inner = walk(join(dir, name), rel);
      result.dirs.push(...inner.dirs);
      result.files.push(...inner.files);
    } else {
      result.files.push(rel);
    }
  }
  return result;
}

const quote = (path: string) => `"${path.replace(/"/g, '\\"')}"`;

const config = readConfig();
if (!existsSync(join(DIST, 'index.html'))) {
  console.error('dist/ fehlt. Erst "npm run build" ausführen.');
  process.exit(1);
}

const { dirs, files } = walk(DIST);
const remote = config.SFTP_DIR.replace(/\/+$/, '');
const ordered = [...files.filter((f) => !LAST.includes(f)), ...LAST.filter((f) => files.includes(f))];

// "-" vor mkdir: Fehler ignorieren, wenn es den Ordner schon gibt
const batch = [
  ...dirs.map((d) => `-mkdir ${quote(`${remote}/${d}`)}`),
  ...ordered.map((f) => `put ${quote(join(DIST, f))} ${quote(`${remote}/${f}`)}`),
].join('\n');
const batchFile = join(tmpdir(), `baumaengel-deploy-${process.pid}.txt`);
writeFileSync(batchFile, `${batch}\n`);

console.log(`Lade ${files.length} Dateien nach ${config.SFTP_USER}@${config.SFTP_HOST}:${remote || '/'} …`);
// -b schaltet eigentlich jede Rückfrage ab, auch die nach dem Passwort. "BatchMode=no" davor hebt das
// auf (ssh nimmt die erste Angabe), die Befehle laufen trotzdem als Stapel und brechen bei Fehlern ab.
const args = [
  '-o', 'BatchMode=no',
  '-b', batchFile,
  '-P', config.SFTP_PORT || '22',
  `${config.SFTP_USER}@${config.SFTP_HOST}`,
];
// Passwort- und Server-Rückfrage laufen direkt übers Terminal, nicht über stdout/stderr.
// stdout: sftp wiederholt jeden Befehl ("sftp> put …"), daraus wird die Fortschrittsanzeige.
// stderr: "remote mkdir …: Failure" heißt nur "Ordner gibt es schon" und wird ausgeblendet.
const child = spawn('sftp', args, { stdio: ['inherit', 'pipe', 'pipe'] });
let uploaded = 0;
const showProgress = () => {
  const text = `  ${uploaded} von ${files.length} Dateien hochgeladen`;
  if (process.stdout.isTTY) process.stdout.write(`\r${text}`);
  else if (uploaded % 25 === 0 || uploaded === files.length) console.log(text);
};
createInterface({ input: child.stdout }).on('line', (line) => {
  if (line.startsWith('sftp> put ')) {
    uploaded++;
    showProgress();
  }
});
createInterface({ input: child.stderr }).on('line', (line) => {
  if (/^remote mkdir ".*": Failure$/.test(line)) return;
  if (process.stdout.isTTY && uploaded > 0) process.stdout.write('\n');
  console.error(line);
});

const status: number = await new Promise((resolve) => child.on('close', (code) => resolve(code ?? 1)));
rmSync(batchFile, { force: true });
if (process.stdout.isTTY && uploaded > 0) process.stdout.write('\n');
if (status !== 0) {
  console.error('Hochladen fehlgeschlagen. Die Meldung von sftp steht oben.');
  process.exit(status);
}
console.log('Fertig. Die Geräte übernehmen die neue Version beim nächsten Öffnen.');
