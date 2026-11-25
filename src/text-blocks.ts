// =============================================================
// Fenster "Textbausteine"
// =============================================================
//
// Vorerst ein Platzhalter. Geplant: Bausteine nach Kategorien (Kachel-Menü), erst die Überschrift
// "Mangel <Kategorie>", danach gleich die Notiz-Bausteine dieser Kategorie. Die bisherigen
// Bausteine bleiben in der Datenbank und im Backup (db.ts, backup.ts).

const dialog = document.getElementById('text-blocks-dialog') as HTMLElement;

export function openTextBlocks(): void {
  dialog.hidden = false;
}

document.getElementById('text-blocks-close')!.addEventListener('click', () => {
  dialog.hidden = true;
});
