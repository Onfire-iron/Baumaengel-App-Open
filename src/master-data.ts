// =============================================================
// Stammdaten als Datei weitergeben: "Listen sichern" und "Listen einlesen" (Menü der Startseite)
// =============================================================
//
// Bis zum Abgleich über SharePoint wandern die Listen so zwischen PC und Tablet. Die Datei enthält alle
// Einträge mit Kennung, Änderungszeit und Lösch-Vermerken. Beim Einlesen wird zusammengeführt
// (mergeMaster in db.ts): Neues kommt dazu, die neuere Fassung gilt, nichts entsteht doppelt.

import * as store from './db.ts';
import { todayIso } from './defects.ts';
import { readEntry } from './master-entries.ts';
import type { MasterEntry } from './types.ts';

const FORMAT = 'baumaengel-listen';
const VERSION = 1;

export async function exportMasterData(): Promise<{ blob: Blob; fileName: string; count: number }> {
  const entries = await store.allMasterEntries();
  const file = { format: FORMAT, version: VERSION, exportedAt: Date.now(), entries };
  return {
    blob: new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }),
    fileName: `Baumaengel-Listen ${todayIso()}.json`,
    count: entries.filter((entry) => !entry.deleted).length,
  };
}

export async function importMasterData(file: Blob): Promise<{ added: number; changed: number }> {
  let data: { format?: unknown; version?: unknown; entries?: unknown };
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error('Das ist keine Listen-Datei der Baumängel-App.');
  }
  if (data?.format !== FORMAT || !Array.isArray(data.entries)) {
    throw new Error('Das ist keine Listen-Datei der Baumängel-App.');
  }
  if (Number(data.version) > VERSION) {
    throw new Error('Die Datei stammt von einer neueren App-Version. Bitte erst die App aktualisieren.');
  }
  const entries = data.entries.map(readEntry).filter((entry): entry is MasterEntry => entry !== null);
  return store.mergeMaster(entries);
}
