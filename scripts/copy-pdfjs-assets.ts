// Kopiert Hilfsdateien von PDF.js nach public/pdfjs, damit sie auch offline da sind.
// Läuft automatisch vor "npm run dev" und "npm run build".
// Ohne sie bleiben manche Scans weiß und manche Schriften werden falsch angezeigt.

import { cpSync } from 'node:fs';

for (const folder of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  cpSync(`node_modules/pdfjs-dist/${folder}`, `public/pdfjs/${folder}`, { recursive: true });
}
