// =============================================================
// Excel-Dateien (.xlsx) lesen, nur den Text der Zellen
// =============================================================
//
// Eine .xlsx ist ein ZIP mit XML-Dateien. Gebraucht wird hier nur, was in den Zellen steht, darum
// reicht die ZIP-Bibliothek, die es für die Backups schon gibt, und der XML-Leser des Browsers.
// Formeln liefern ihr zuletzt berechnetes Ergebnis, Formatierung wird nicht gelesen.
//   xl/workbook.xml              Namen und Reihenfolge der Reiter
//   xl/_rels/workbook.xml.rels   welcher Reiter in welcher Datei steht
//   xl/sharedStrings.xml         Texte, die Excel einmal zentral ablegt (Zellen verweisen darauf)
//   xl/worksheets/sheetN.xml     die Zellen eines Reiters
// Benutzt von list-import.ts.

import { BlobReader, TextWriter, ZipReader } from '@zip.js/zip.js';
import type { Entry, FileEntry } from '@zip.js/zip.js';

export interface SheetRow {
  row: number; // Zeilennummer wie in Excel (ab 1)
  cells: string[]; // Spalte A = 0. Leere Zellen sind ''.
}

export interface Sheet {
  name: string;
  rows: SheetRow[]; // nur Zeilen mit Inhalt
}

const MAX_ROWS = 5000; // je Reiter, mehr braucht keine Liste
const MAX_COLUMNS = 26; // A bis Z
const MAX_PART_SIZE = 30 * 1024 * 1024; // ausgepackt, Schutz vor aufgeblähten Dateien

const NOT_EXCEL = 'Die Datei lässt sich nicht als Excel-Datei (.xlsx) lesen.';

export async function readXlsx(file: Blob): Promise<Sheet[]> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  // Altes Excel-Format (.xls) beginnt mit D0 CF 11 E0
  if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) {
    throw new Error('Das ist das alte Excel-Format (.xls). Bitte in Excel als „Excel-Arbeitsmappe (.xlsx)“ speichern.');
  }
  const zip = new ZipReader(new BlobReader(file));
  try {
    let entries: Map<string, Entry>;
    try {
      entries = new Map((await zip.getEntries()).map((entry) => [entry.filename, entry]));
    } catch {
      throw new Error(NOT_EXCEL);
    }
    const read = async (path: string): Promise<Document | null> => {
      const entry = entries.get(path);
      if (!entry || entry.directory) return null;
      if (entry.uncompressedSize > MAX_PART_SIZE) throw new Error('Die Excel-Datei ist zu groß.');
      const text = await (entry as FileEntry).getData(new TextWriter());
      const doc = new DOMParser().parseFromString(text, 'application/xml');
      if (doc.getElementsByTagName('parsererror').length) throw new Error(NOT_EXCEL);
      return doc;
    };

    // Wo das Arbeitsblatt-Verzeichnis liegt, steht in _rels/.rels (fast immer xl/workbook.xml)
    const rootRels = await read('_rels/.rels');
    const workbookPath =
      relationships(rootRels, '')
        .find((rel) => rel.type.endsWith('/officeDocument'))?.target ?? 'xl/workbook.xml';
    const workbook = await read(workbookPath);
    if (!workbook) throw new Error(NOT_EXCEL);
    const baseDir = workbookPath.replace(/[^/]*$/, '');
    const rels = relationships(await read(`${baseDir}_rels/${workbookPath.slice(baseDir.length)}.rels`), baseDir);
    const relById = new Map(rels.map((rel) => [rel.id, rel]));

    const sharedPath = rels.find((rel) => rel.type.endsWith('/sharedStrings'))?.target ?? `${baseDir}sharedStrings.xml`;
    const shared = readSharedStrings(await read(sharedPath));

    const sheets: Sheet[] = [];
    for (const el of byName(workbook, 'sheet')) {
      const name = el.getAttribute('name') ?? '';
      const target = relById.get(relationId(el))?.target;
      const doc = target ? await read(target) : null;
      if (doc) sheets.push({ name, rows: readRows(doc, shared) });
    }
    return sheets;
  } finally {
    await zip.close();
  }
}

// Alle Elemente mit diesem Namen, egal unter welchem Namensraum (Excel und "Strict"-Dateien unterscheiden sich)
function byName(parent: Document | Element, localName: string): Element[] {
  return [...parent.getElementsByTagNameNS('*', localName)];
}

function childrenByName(parent: Element, localName: string): Element[] {
  return [...parent.children].filter((child) => child.localName === localName);
}

// r:id eines Reiters, der Namensraum-Präfix kann anders heißen
function relationId(el: Element): string {
  return [...el.attributes].find((attr) => attr.localName === 'id' && attr.namespaceURI)?.value ?? '';
}

interface Relationship {
  id: string;
  type: string;
  target: string; // Pfad im ZIP, ohne führenden Schrägstrich
}

function relationships(doc: Document | null, baseDir: string): Relationship[] {
  if (!doc) return [];
  return byName(doc, 'Relationship').map((el) => ({
    id: el.getAttribute('Id') ?? '',
    type: el.getAttribute('Type') ?? '',
    target: resolvePath(baseDir, el.getAttribute('Target') ?? ''),
  }));
}

// "worksheets/sheet1.xml" relativ zu "xl/", "/xl/worksheets/sheet1.xml" absolut, auch mit "../"
function resolvePath(baseDir: string, target: string): string {
  const parts = (target.startsWith('/') ? target.slice(1) : baseDir + target).split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (part === '..') out.pop();
    else if (part && part !== '.') out.push(part);
  }
  return out.join('/');
}

// Ein Text kann aus mehreren Stücken mit eigener Formatierung bestehen (<r><t>…</t></r>).
// Lautschrift-Hilfen (<rPh>, bei japanischen Texten) gehören nicht dazu.
function textOf(el: Element): string {
  return byName(el, 't')
    .filter((t) => t.parentElement?.localName !== 'rPh')
    .map((t) => t.textContent ?? '')
    .join('');
}

function readSharedStrings(doc: Document | null): string[] {
  if (!doc) return [];
  const root = doc.documentElement;
  return childrenByName(root, 'si').map(textOf);
}

// "C12" -> Spalte 2
function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? '';
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

function readRows(doc: Document, shared: string[]): SheetRow[] {
  const rows: SheetRow[] = [];
  let lastRow = 0;
  for (const rowEl of byName(doc, 'row')) {
    const row = Number(rowEl.getAttribute('r')) || lastRow + 1;
    lastRow = row;
    const cells: string[] = [];
    let lastColumn = -1;
    for (const cell of childrenByName(rowEl, 'c')) {
      const ref = cell.getAttribute('r');
      const column = ref ? columnIndex(ref) : lastColumn + 1;
      lastColumn = column;
      if (column < 0 || column >= MAX_COLUMNS) continue;
      const value = cellText(cell, shared);
      if (!value) continue;
      while (cells.length < column) cells.push('');
      cells[column] = value;
    }
    if (cells.some((value) => value.trim())) rows.push({ row, cells });
    if (rows.length >= MAX_ROWS) break;
  }
  return rows;
}

function cellText(cell: Element, shared: string[]): string {
  const type = cell.getAttribute('t');
  const v = childrenByName(cell, 'v')[0]?.textContent ?? '';
  switch (type) {
    case 's':
      return shared[Number(v)] ?? '';
    case 'inlineStr': {
      const is = childrenByName(cell, 'is')[0];
      return is ? textOf(is) : '';
    }
    case 'b':
      return v === '1' ? 'WAHR' : 'FALSCH';
    case 'e':
      return ''; // Fehlerwert wie #NV
    default:
      return v; // Zahl oder Formel-Ergebnis als Text
  }
}
