// =============================================================
// Listen aus Excel einlesen: Vorschau-Fenster ("Listen einlesen" im Menü der Startseite)
// =============================================================
//
// Zeigt den Plan aus list-import-plan.ts je Reiter: fehlerhafte Zeilen gleich sichtbar, die neuen zum
// Aufklappen, die vorhandenen nur gezählt. Übernommen wird erst nach dem Antippen von "Übernehmen".
// Die Listen-Datei der App (.json) geht weiter über master-data.ts.

import { closeOnOutsideTap } from './outside-tap.ts';
import { planListImport, toApply } from './list-import-plan.ts';
import type { ImportPlan, PlanRow, PlanSheet, RowState } from './list-import-plan.ts';

// ---------- Vorschau-Fenster ----------

const dialog = document.getElementById('list-import-dialog') as HTMLElement;
const fileLabel = document.getElementById('list-import-file') as HTMLElement;
const sheetList = document.getElementById('list-import-sheets') as HTMLElement;
const applyBtn = document.getElementById('list-import-apply') as HTMLButtonElement;
const cancelBtn = document.getElementById('list-import-cancel') as HTMLButtonElement;

const STATE_TEXT: Record<RowState, string> = { new: 'neu', update: 'ergänzt', known: 'vorhanden', error: 'fehlerhaft' };

let pending: { plan: ImportPlan; done: (message: string) => void } | null = null;

// Liest die Datei und zeigt die Vorschau. Fehler beim Lesen kommen als Error zurück.
export async function openListImport(file: File, done: (message: string) => void): Promise<void> {
  const plan = await planListImport(file);
  pending = { plan, done };
  fileLabel.textContent = file.name;
  sheetList.replaceChildren(...plan.sheets.map(renderSheet));
  if (plan.ignored.length) {
    const p = document.createElement('p');
    p.className = 'dialog-hint';
    p.textContent = `Nicht gelesen: Reiter ${plan.ignored.map((name) => `„${name}“`).join(', ')}.`;
    sheetList.append(p);
  }
  const count = toApply(plan).length;
  applyBtn.disabled = count === 0;
  applyBtn.textContent = count ? `${count} übernehmen` : 'Nichts Neues';
  dialog.hidden = false;
  sheetList.scrollTop = 0;
}

function count(rows: PlanRow[], state: RowState) {
  return rows.filter((row) => row.state === state).length;
}

function renderSheet(sheet: PlanSheet): HTMLElement {
  const section = document.createElement('section');
  section.className = 'import-sheet';
  const head = document.createElement('div');
  head.className = 'import-sheet-head';
  const h3 = document.createElement('h3');
  h3.textContent = sheet.title;
  const counts = document.createElement('div');
  counts.className = 'import-counts';
  if (sheet.problem) {
    counts.append(stateChip('error', 'nicht lesbar'));
  } else if (!sheet.rows.length) {
    counts.append(stateChip('known', 'leer'));
  } else {
    for (const state of ['new', 'update', 'known', 'error'] as RowState[]) {
      const n = count(sheet.rows, state);
      if (n) counts.append(stateChip(state, `${n} ${STATE_TEXT[state]}`));
    }
  }
  head.append(h3, counts);
  section.append(head);

  if (sheet.problem) {
    section.append(paragraph('import-problem', sheet.problem));
    return section;
  }
  if (sheet.hint && sheet.rows.some((row) => row.apply)) section.append(paragraph('import-hint', sheet.hint));

  // Fehlerhafte Zeilen gleich sichtbar, die neuen zum Aufklappen, die vorhandenen nur gezählt
  // (außer sie haben einen Hinweis, z. B. doppelt in der Datei)
  const errors = sheet.rows.filter((row) => row.state === 'error');
  if (errors.length) section.append(rowList(errors, 'Nicht übernommen'));
  const changes = sheet.rows.filter((row) => row.state === 'new' || row.state === 'update');
  if (changes.length) {
    const label = changes.length === 1 ? 'Ansehen, was dazukommt' : `Ansehen, was dazukommt (${changes.length})`;
    section.append(foldable(label, rowList(changes)));
  }
  const noted = sheet.rows.filter((row) => row.state === 'known' && row.note);
  if (noted.length) section.append(foldable(`Hinweise zu ${noted.length} vorhandenen`, rowList(noted)));
  return section;
}

function stateChip(state: RowState, text: string) {
  const chip = document.createElement('span');
  chip.className = `import-chip is-${state}`;
  chip.textContent = text;
  return chip;
}

function paragraph(className: string, text: string) {
  const p = document.createElement('p');
  p.className = className;
  p.textContent = text;
  return p;
}

function foldable(summaryText: string, content: HTMLElement) {
  const details = document.createElement('details');
  details.className = 'import-fold';
  const summary = document.createElement('summary');
  summary.textContent = summaryText;
  details.append(summary, content);
  return details;
}

function rowList(rows: PlanRow[], heading?: string) {
  const wrap = document.createElement('div');
  if (heading) wrap.append(paragraph('import-list-head', heading));
  const ul = document.createElement('ul');
  ul.className = 'import-rows';
  for (const row of rows) {
    const li = document.createElement('li');
    li.className = `is-${row.state}`;
    const line = document.createElement('span');
    line.className = 'import-row-no';
    line.textContent = `Z. ${row.row}`;
    const text = document.createElement('span');
    text.className = 'import-row-text';
    text.textContent = row.text;
    if (row.note) {
      const note = document.createElement('small');
      note.textContent = row.note;
      text.append(note);
    }
    li.append(line, text);
    ul.append(li);
  }
  wrap.append(ul);
  return wrap;
}

function close() {
  dialog.hidden = true;
  pending = null;
  sheetList.replaceChildren();
}

applyBtn.addEventListener('click', async () => {
  if (!pending) return;
  const { plan, done } = pending;
  applyBtn.disabled = true;
  const rows = toApply(plan);
  let added = 0;
  let updated = 0;
  try {
    // Nacheinander: Personen einer neuen Firma brauchen die Firma, die eine Zeile vorher entsteht
    for (const row of rows) {
      await row.apply!();
      if (row.state === 'update') updated++;
      else added++;
    }
    close();
    done(`Aus Excel übernommen: ${added} neu${updated ? `, ${updated} ergänzt` : ''}.`);
  } catch (err) {
    console.error(err);
    close();
    done(`Beim Übernehmen ist ein Fehler aufgetreten (${added + updated} von ${rows.length} übernommen).`);
  }
});

cancelBtn.addEventListener('click', close);
closeOnOutsideTap(dialog, close);
