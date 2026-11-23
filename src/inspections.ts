// =============================================================
// Begehungen: wer an welchem Tag dabei war
// =============================================================
//
// Ein Projekt hat beliebig viele Begehungen, keine ist Pflicht. Sie liegen als Liste bei den
// Angaben für den Bericht (ReportSettings.inspections), nach Datum sortiert, älteste zuerst.
// Bearbeitet werden sie im Fenster "Begehungen" (inspections-dialog.ts). Im Bericht steht jede
// als eigene Tabelle (drawInspections in report.ts).
// Diese Datei enthält nur die Regeln für die Daten, keine Oberfläche.

import type { Inspection, Participant } from './types.ts';

export function sortInspections(list: Inspection[]): Inspection[] {
  return list.sort((a, b) => a.date.localeCompare(b.date));
}

// Teilnehmer ohne Name und Firma zählen nicht
export function cleanParticipants(participants: Participant[]): Participant[] {
  return participants
    .map(({ name, org }) => ({ name: name.trim(), org: org.trim() }))
    .filter(({ name, org }) => name || org);
}

// "unknown": Die Liste kommt aus einem Backup und kann alles Mögliche enthalten
export function readInspections(value: unknown): Inspection[] {
  if (!Array.isArray(value)) return [];
  const list: Inspection[] = [];
  for (const entry of value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry?.date)) continue;
    const participants = Array.isArray(entry.participants) ? entry.participants : [];
    list.push({
      date: entry.date,
      participants: cleanParticipants(
        participants.map((p: { name?: unknown; org?: unknown } | null) => ({
          name: String(p?.name ?? ''),
          org: String(p?.org ?? ''),
        }))
      ),
    });
  }
  return sortInspections(list);
}
