// =============================================================
// Fenster "Textbausteine"
// =============================================================
//
// Vorerst ein Platzhalter. Geplant: Bausteine nach Kategorien (Kachel-Menü), erst die Überschrift
// "Mangel <Kategorie>", danach gleich die Notiz-Bausteine dieser Kategorie. Die bisherigen
// Bausteine bleiben in der Datenbank und im Backup (db.ts, backup.ts).

import { closeOnOutsideTap } from './outside-tap.ts';

const dialog = document.getElementById('text-blocks-dialog') as HTMLElement;

export function openTextBlocks(): void {
  dialog.hidden = false;
}

function close() {
  dialog.hidden = true;
}

document.getElementById('text-blocks-close')!.addEventListener('click', close);
closeOnOutsideTap(dialog, close);
