// =============================================================
// Stammdaten: Listen für alle Projekte (Gewerke, Firmen, Personen, Veranlassung, Textbausteine)
// =============================================================
//
// Jeder Eintrag ist so gebaut, dass er sich zwischen Geräten und später mit SharePoint abgleichen lässt:
// - uid: feste, eindeutige Kennung. Dieselbe auf allen Geräten, daran erkennt der Abgleich einen Eintrag.
// - updatedAt: Zeitpunkt der letzten Änderung. Bei zwei Fassungen gilt die neuere.
// - deleted: Gelöschte Einträge bleiben als Vermerk stehen, damit andere Geräte davon erfahren.
// Die Vorgaben (z. B. TRADES) haben feste uids aus ihrem Namen. So entsteht dieselbe Vorgabe auf zwei
// Geräten nicht doppelt.
// Gespeichert in der Tabelle masterData (db.ts), als Datei weitergegeben über master-data.ts.

import { OCCASIONS } from './control-fields.ts';
import { TRADES } from './defects.ts';
import { normalize } from './search.ts';
import type { MasterEntry, MasterKind, TextBlockType } from './types.ts';

export const MASTER_KINDS: readonly MasterKind[] = ['trade', 'company', 'person', 'occasion', 'textblock'];
const BLOCK_TYPES: readonly TextBlockType[] = ['title', 'note'];

// Höchstlänge des Namens. Textbausteine dürfen länger sein, sie können ganze Sätze enthalten.
export function maxNameLength(kind: MasterKind): number {
  return kind === 'textblock' ? 2000 : 200;
}

// Vorgaben je Liste, solange auf dem Gerät noch nichts anderes steht
const DEFAULTS: Record<MasterKind, readonly string[]> = {
  trade: TRADES,
  company: [],
  person: [],
  occasion: OCCASIONS,
  textblock: [],
};

// Gleicher Name heißt gleicher Eintrag: Groß/klein, Umlaute und Leerzeichen egal
export function nameKey(name: string): string {
  return normalize(name).replace(/\s+/g, ' ').trim();
}

// Woran zwei Einträge als derselbe erkannt werden: Art und Name, bei Personen zusätzlich die Firma
// (zwei "Thomas Müller" in verschiedenen Firmen sind zwei Personen), bei Textbausteinen Kategorie
// und Art (derselbe Text unter "Tür" und "Fenster" sind zwei Bausteine)
export function entryKey(entry: Pick<MasterEntry, 'kind' | 'name' | 'companyUid' | 'category' | 'blockType'>): string {
  let extra = '';
  if (entry.kind === 'person') extra = entry.companyUid ?? '';
  if (entry.kind === 'textblock') extra = `${nameKey(entry.category ?? '')}:${entry.blockType ?? 'note'}`;
  return `${entry.kind}|${nameKey(entry.name)}|${extra}`;
}

export function defaultUid(kind: MasterKind, name: string): string {
  return `vorgabe:${kind}:${nameKey(name)}`;
}

export function newUid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // ältere Browser: 16 zufällige Bytes als Hex
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Die Vorgaben haben updatedAt 0: Jede echte Änderung auf irgendeinem Gerät ist neuer
export function defaultEntries(): MasterEntry[] {
  return MASTER_KINDS.flatMap((kind) =>
    DEFAULTS[kind].map((name) => ({ uid: defaultUid(kind, name), kind, name, updatedAt: 0, deleted: false }))
  );
}

// Ein Eintrag aus einer Datei: Wert für Wert prüfen, unbrauchbare fallen weg
export function readEntry(value: unknown): MasterEntry | null {
  const entry = value as Partial<MasterEntry> | null;
  if (!entry || typeof entry !== 'object') return null;
  if (typeof entry.uid !== 'string' || !entry.uid || entry.uid.length > 200) return null;
  if (!MASTER_KINDS.includes(entry.kind as MasterKind)) return null;
  const kind = entry.kind as MasterKind;
  const name = typeof entry.name === 'string' ? entry.name.trim().slice(0, maxNameLength(kind)) : '';
  if (!name) return null;
  const updatedAt = Number(entry.updatedAt);
  const text = (value: unknown) => (typeof value === 'string' ? value.trim().slice(0, 200) : '');
  return {
    uid: entry.uid,
    kind,
    name,
    updatedAt: Number.isFinite(updatedAt) && updatedAt >= 0 ? updatedAt : 0,
    deleted: entry.deleted === true,
    ...(entry.kind === 'person' && text(entry.companyUid) ? { companyUid: text(entry.companyUid) } : {}),
    ...(entry.kind === 'person' && text(entry.role) ? { role: text(entry.role) } : {}),
    ...(entry.kind === 'textblock' && text(entry.category) ? { category: text(entry.category) } : {}),
    ...(entry.kind === 'textblock'
      ? { blockType: BLOCK_TYPES.includes(entry.blockType as TextBlockType) ? (entry.blockType as TextBlockType) : 'note' }
      : {}),
  };
}
