// =============================================================
// Listen aus Excel einlesen, mit Vorschau ("Listen einlesen" im Menü der Startseite)
// =============================================================
//
// Für die Excel-Vorlage mit den Reitern Kontakte, Gewerke, Textbausteine und Veranlassung. Erst zeigt
// ein Fenster je Reiter, was neu ist, was schon da ist und welche Zeilen nicht passen (mit Grund und
// Zeilennummer). Übernommen wird erst nach dem Antippen von "Übernehmen".
// - Es wird nur ergänzt: Nichts in der App wird gelöscht oder umbenannt.
// - Gleich ist, was entryKey (master-entries.ts) für gleich hält, also z. B. "müller" = "Müller".
// - Ein in der App gelöschter Eintrag, der wieder in der Liste steht, kommt zurück (als "neu" gezeigt).
// - Personen mit derselben Firma: Fehlt in der App die Funktion, wird sie ergänzt.
// - Erkannt werden Reiter und Spalten an ihren Namen in Zeile 1, die Reihenfolge ist egal.
// Excel lesen: xlsx-read.ts. Die Listen-Datei der App (.json) geht weiter über master-data.ts.

import * as store from './db.ts';
import { closeOnOutsideTap } from './outside-tap.ts';
import { entryKey, maxNameLength, nameKey } from './master-entries.ts';
import { readXlsx } from './xlsx-read.ts';
import type { Sheet, SheetRow } from './xlsx-read.ts';
import type { MasterEntry, MasterKind, TextBlockType } from './types.ts';

type RowState = 'new' | 'update' | 'known' | 'error';

interface PlanRow {
  row: number;
  text: string; // so wird die Zeile in der Vorschau gezeigt
  state: RowState;
  note?: string; // Grund bei Fehlern, sonst ein Hinweis (z. B. "Firma neu")
  apply?: () => Promise<unknown>;
}

export interface PlanSheet {
  title: string; // Name des Reiters in der Vorlage
  rows: PlanRow[];
  problem?: string; // der ganze Reiter ließ sich nicht lesen
  hint?: string;
}

export interface ImportPlan {
  sheets: PlanSheet[];
  ignored: string[]; // Reiter, die die App nicht kennt
}

interface Column {
  key: string;
  names: string[]; // erlaubte Überschriften, verglichen über nameKey
  required?: boolean;
}

interface SheetSpec {
  title: string;
  columns: Column[];
  hint?: string;
  plan: (rows: ParsedRow[], known: Known) => PlanRow[];
}

interface ParsedRow {
  row: number;
  value: Record<string, string>;
}

// Was schon in der App steht, auch Gelöschtes (das käme durch addMaster zurück)
interface Known {
  all: MasterEntry[];
  byKey: Map<string, MasterEntry>; // aktive Einträge
  deletedKeys: Set<string>;
}

const SPECS: SheetSpec[] = [
  {
    title: 'Kontakte',
    columns: [
      { key: 'name', names: ['Name'] },
      { key: 'company', names: ['Firma / Amt', 'Firma/Amt', 'Firma', 'Amt'] },
      { key: 'role', names: ['Funktion', 'Rolle'] },
    ],
    plan: planContacts,
  },
  {
    title: 'Gewerke',
    columns: [{ key: 'name', names: ['Gewerk', 'Gewerke', 'Name'], required: true }],
    plan: (rows, known) => planSimple('trade', rows, known),
  },
  {
    title: 'Textbausteine',
    columns: [
      { key: 'category', names: ['Kategorie'], required: true },
      { key: 'type', names: ['Art', 'Typ'] },
      { key: 'text', names: ['Text', 'Baustein'], required: true },
    ],
    hint: 'Die Textbausteine werden gespeichert. Im Punkt-Menü erscheinen sie mit dem neuen Textbaustein-Fenster.',
    plan: planTextBlocks,
  },
  {
    title: 'Veranlassung',
    columns: [{ key: 'name', names: ['Text', 'Veranlassung'], required: true }],
    hint: 'Erscheinen im Berichtsfenster als Vorschläge für das Feld „Veranlassung“.',
    plan: (rows, known) => planSimple('occasion', rows, known),
  },
];

const IGNORED_SHEETS = new Set(['anleitung', 'hinweise', 'beispiele'].map(nameKey));

export async function planListImport(file: Blob): Promise<ImportPlan> {
  const sheets = await readXlsx(file);
  const all = await store.allMasterEntries();
  const known: Known = { all, byKey: new Map(), deletedKeys: new Set() };
  for (const entry of all) {
    if (entry.deleted) known.deletedKeys.add(entryKey(entry));
    else known.byKey.set(entryKey(entry), entry);
  }
  const plan: ImportPlan = { sheets: [], ignored: [] };
  const used = new Set<Sheet>();
  for (const spec of SPECS) {
    const sheet = sheets.find((s) => nameKey(s.name) === nameKey(spec.title));
    if (!sheet) continue;
    used.add(sheet);
    plan.sheets.push(planSheet(spec, sheet, known));
  }
  plan.ignored = sheets.filter((s) => !used.has(s) && !IGNORED_SHEETS.has(nameKey(s.name))).map((s) => s.name);
  if (!plan.sheets.length) {
    throw new Error(`In der Datei fehlen die Reiter ${SPECS.map((s) => `„${s.title}“`).join(', ')}. Bitte die Excel-Vorlage benutzen.`);
  }
  return plan;
}

function planSheet(spec: SheetSpec, sheet: Sheet, known: Known): PlanSheet {
  const result: PlanSheet = { title: spec.title, rows: [], hint: spec.hint };
  const [header, ...rows] = sheet.rows;
  if (!header) return result; // leerer Reiter
  const columns = new Map<string, number>();
  header.cells.forEach((cell, index) => {
    const column = spec.columns.find((c) => c.names.some((name) => nameKey(name) === nameKey(cell)));
    if (column && !columns.has(column.key)) columns.set(column.key, index);
  });
  // Spalten, die fehlen: Pflichtspalten verhindern das Einlesen, bei Kontakten reicht Name oder Firma
  const missing = spec.columns.filter((c) => c.required && !columns.has(c.key));
  const names = (list: Column[]) => list.map((c) => `„${c.names[0]}“`).join(', ');
  if (missing.length) {
    const what = missing.length === 1 ? `fehlt die Spalte ${names(missing)}` : `fehlen die Spalten ${names(missing)}`;
    result.problem = `In Zeile ${header.row} ${what}. Die Spaltennamen der Vorlage bitte nicht ändern.`;
    return result;
  }
  if (!columns.size) {
    result.problem = `In Zeile ${header.row} steht keine der Spalten ${names(spec.columns)}. Die Spaltennamen der Vorlage bitte nicht ändern.`;
    return result;
  }
  const parsed = rows.map((row) => parseRow(row, columns)).filter((row) => Object.values(row.value).some(Boolean));
  result.rows = spec.plan(parsed, known);
  return result;
}

function parseRow(row: SheetRow, columns: Map<string, number>): ParsedRow {
  const value: Record<string, string> = {};
  for (const [key, index] of columns) value[key] = (row.cells[index] ?? '').trim();
  return { row: row.row, value };
}

// Namen auf eine Zeile bringen (Zeilenumbrüche in Excel-Zellen, doppelte Leerzeichen)
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

// Mehrzeiliger Text: Zeilen behalten, aber ohne Leerzeichen an den Rändern und ohne leere Zeilen am Ende
function lines(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function tooLong(kind: MasterKind, text: string): string | null {
  const max = maxNameLength(kind);
  return text.length > max ? `zu lang (${text.length} Zeichen, höchstens ${max})` : null;
}

// Prüft, ob es den Eintrag schon gibt, auch weiter oben in derselben Datei
function stateOf(key: string, known: Known, seen: Map<string, number>, row: number): Pick<PlanRow, 'state' | 'note'> | null {
  const earlier = seen.get(key);
  if (earlier !== undefined) return { state: 'known', note: `steht schon in Zeile ${earlier}` };
  seen.set(key, row);
  if (known.byKey.has(key)) return { state: 'known' };
  return null;
}

// Gewerke und Veranlassung: ein Text pro Zeile
function planSimple(kind: MasterKind, rows: ParsedRow[], known: Known): PlanRow[] {
  const seen = new Map<string, number>();
  return rows.map(({ row, value }) => {
    const name = oneLine(value.name ?? '');
    if (!name) return { row, text: '–', state: 'error', note: 'leer' };
    const long = tooLong(kind, name);
    if (long) return { row, text: name, state: 'error', note: long };
    const key = entryKey({ kind, name });
    const state = stateOf(key, known, seen, row);
    if (state) return { row, text: name, ...state };
    return newRow(row, name, key, known, () => store.addMaster(kind, name));
  });
}

function newRow(row: number, text: string, key: string, known: Known, apply: () => Promise<unknown>, note?: string): PlanRow {
  const revived = known.deletedKeys.has(key) ? 'war gelöscht, kommt zurück' : '';
  return { row, text, state: 'new', note: [note, revived].filter(Boolean).join(', ') || undefined, apply };
}

// Kontakte: Name, Firma / Amt, Funktion. Nur Firma (ohne Name) ergibt einen Eintrag in der Firmenliste.
function planContacts(rows: ParsedRow[], known: Known): PlanRow[] {
  const seen = new Map<string, number>();
  // Firmen, die durch diese Datei neu dazukommen, mit der Zeile, in der sie zuerst stehen
  const newCompanies = new Map<string, number>();
  const companyUid = (name: string) => known.byKey.get(entryKey({ kind: 'company', name }))?.uid;
  // Personen der App ohne Firma: Bekommen sie hier eine, wird sie ergänzt statt die Person doppelt anzulegen
  const withoutCompany = new Map<string, MasterEntry>();
  for (const entry of known.byKey.values()) {
    if (entry.kind === 'person' && !entry.companyUid && !withoutCompany.has(nameKey(entry.name))) {
      withoutCompany.set(nameKey(entry.name), entry);
    }
  }

  return rows.map(({ row, value }) => {
    const name = oneLine(value.name ?? '');
    const company = oneLine(value.company ?? '');
    const role = oneLine(value.role ?? '');
    const text = [name, company, role].filter(Boolean).join(' · ');
    if (!name && !company) return { row, text: role || '–', state: 'error', note: 'Name fehlt' };
    const long = tooLong('person', name) ?? tooLong('company', company) ?? tooLong('person', role);
    if (long) return { row, text, state: 'error', note: long };

    const companyKey = company ? entryKey({ kind: 'company', name: company }) : '';
    const companyIsNew = Boolean(company) && !known.byKey.has(companyKey);
    const companyNote = companyIsNew && !newCompanies.has(companyKey) ? 'neue Firma' : undefined; // nur beim ersten Mal

    if (!name) {
      const twice = seen.get(companyKey) ?? newCompanies.get(companyKey);
      if (twice !== undefined) return { row, text, state: 'known', note: `steht schon in Zeile ${twice}` };
      seen.set(companyKey, row);
      if (!companyIsNew) return { row, text, state: 'known' };
      newCompanies.set(companyKey, row);
      return newRow(row, text, companyKey, known, () => store.addMaster('company', company), 'nur Firma');
    }

    // Personen einer neuen Firma sind immer neu. Ihre Firma bekommt erst beim Übernehmen eine Kennung.
    const uid = company ? (companyUid(company) ?? `neu:${nameKey(company)}`) : undefined;
    const key = entryKey({ kind: 'person', name, companyUid: uid });
    const twice = seen.get(key);
    if (twice !== undefined) return { row, text, state: 'known', note: `steht schon in Zeile ${twice}` };
    seen.set(key, row);
    if (companyIsNew && !newCompanies.has(companyKey)) newCompanies.set(companyKey, row);

    const lonely = company ? withoutCompany.get(nameKey(name)) : undefined;
    if (!known.byKey.has(key) && lonely) {
      withoutCompany.delete(nameKey(name)); // nur einmal ergänzen
      const note = companyNote ? 'Firma wird ergänzt (neu in der Firmenliste)' : 'Firma wird ergänzt';
      return {
        row,
        text,
        state: 'update',
        note,
        apply: async () => {
          const entry = await store.addMaster('company', company);
          await store.updateMaster(lonely.uid, { companyUid: entry.uid, role: lonely.role || role || undefined });
        },
      };
    }

    const existing = known.byKey.get(key);
    if (existing) {
      if (role && !existing.role) {
        return { row, text, state: 'update', note: 'Funktion wird ergänzt', apply: () => store.updateMaster(existing.uid, { role }) };
      }
      const other = role && existing.role && nameKey(role) !== nameKey(existing.role);
      return { row, text, state: 'known', note: other ? `in der App mit Funktion „${existing.role}“` : undefined };
    }
    return newRow(row, text, key, known, () => store.addPerson(name, company, role), companyNote);
  });
}

// Textbausteine: Kategorie, Art (Überschrift oder Notiz), Text
const BLOCK_TYPE_NAMES: Record<string, TextBlockType> = {
  [nameKey('Überschrift')]: 'title',
  [nameKey('Titel')]: 'title',
  [nameKey('Notiz')]: 'note',
  [nameKey('Notizen')]: 'note',
  [nameKey('Text')]: 'note',
};

const BLOCK_TYPE_TEXT: Record<TextBlockType, string> = { title: 'Überschrift', note: 'Notiz' };

function planTextBlocks(rows: ParsedRow[], known: Known): PlanRow[] {
  const seen = new Map<string, number>();
  return rows.map(({ row, value }) => {
    const category = oneLine(value.category ?? '');
    const typeText = oneLine(value.type ?? '');
    const text = lines(value.text ?? '');
    // Leere Art gilt als Notiz, das ist der häufigere Fall
    const blockType = typeText ? BLOCK_TYPE_NAMES[nameKey(typeText)] : 'note';
    const typeShown = blockType ? BLOCK_TYPE_TEXT[blockType] : typeText;
    const shown = [category, typeShown, oneLine(text)].filter(Boolean).join(' · ');
    if (!text) return { row, text: shown || '–', state: 'error', note: 'Text fehlt' };
    if (!category) return { row, text: shown, state: 'error', note: 'Kategorie fehlt' };
    if (!blockType) return { row, text: shown, state: 'error', note: `Art „${typeText}“ unbekannt, erlaubt sind „Überschrift“ und „Notiz“` };
    const long = tooLong('textblock', text) ?? tooLong('company', category);
    if (long) return { row, text: shown, state: 'error', note: long };
    const key = entryKey({ kind: 'textblock', name: text, category, blockType });
    const state = stateOf(key, known, seen, row);
    if (state) return { row, text: shown, ...state };
    return newRow(row, shown, key, known, () => store.addMaster('textblock', text, { category, blockType }), typeText ? undefined : 'Art leer, gilt als Notiz');
  });
}

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

function toApply(plan: ImportPlan): PlanRow[] {
  return plan.sheets.flatMap((sheet) => sheet.rows.filter((row) => row.apply));
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
