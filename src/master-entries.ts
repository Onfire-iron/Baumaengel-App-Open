// =============================================================
// Stammdaten: Listen für alle Projekte (Gewerke, später Kontakte, Textbausteine …)
// =============================================================
//
// Jeder Eintrag ist so gebaut, dass er sich zwischen Geräten und später mit SharePoint abgleichen lässt:
// - uid: feste, eindeutige Kennung. Dieselbe auf allen Geräten, daran erkennt der Abgleich einen Eintrag.
// - updatedAt: Zeitpunkt der letzten Änderung. Bei zwei Fassungen gilt die neuere.
// - deleted: Gelöschte Einträge bleiben als Vermerk stehen, damit andere Geräte davon erfahren.
// Die Vorgaben (z. B. TRADES) haben feste uids aus ihrem Namen. So entsteht dieselbe Vorgabe auf zwei
// Geräten nicht doppelt.
// Gespeichert in der Tabelle masterData (db.ts), als Datei weitergegeben über master-data.ts.

import { TRADES } from './defects.ts';
import { normalize } from './search.ts';
import type { MasterEntry, MasterKind } from './types.ts';

export const MASTER_KINDS: readonly MasterKind[] = ['trade', 'company', 'person'];

// Vorgaben je Liste, solange auf dem Gerät noch nichts anderes steht
const DEFAULTS: Record<MasterKind, readonly string[]> = {
  trade: TRADES,
  company: [],
  person: [],
};

// Gleicher Name heißt gleicher Eintrag: Groß/klein, Umlaute und Leerzeichen egal
export function nameKey(name: string): string {
  return normalize(name).replace(/\s+/g, ' ').trim();
}

// Woran zwei Einträge als derselbe erkannt werden: Art und Name, bei Personen zusätzlich die Firma
// (zwei "Thomas Müller" in verschiedenen Firmen sind zwei Personen)
export function entryKey(entry: Pick<MasterEntry, 'kind' | 'name' | 'companyUid'>): string {
  return `${entry.kind}|${nameKey(entry.name)}|${entry.kind === 'person' ? (entry.companyUid ?? '') : ''}`;
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
  const name = typeof entry.name === 'string' ? entry.name.trim().slice(0, 200) : '';
  if (!name) return null;
  const updatedAt = Number(entry.updatedAt);
  const text = (value: unknown) => (typeof value === 'string' ? value.trim().slice(0, 200) : '');
  return {
    uid: entry.uid,
    kind: entry.kind as MasterKind,
    name,
    updatedAt: Number.isFinite(updatedAt) && updatedAt >= 0 ? updatedAt : 0,
    deleted: entry.deleted === true,
    ...(entry.kind === 'person' && text(entry.companyUid) ? { companyUid: text(entry.companyUid) } : {}),
    ...(entry.kind === 'person' && text(entry.role) ? { role: text(entry.role) } : {}),
  };
}
