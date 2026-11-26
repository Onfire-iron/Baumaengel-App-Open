// Datenbank im Test: alten Stand anlegen und die App-Datenbank frisch laden
//
// Die Umstellungen in db.ts laufen, wenn die App eine ältere Datenbank öffnet. Für einen Test wird
// darum erst eine Datenbank mit dem Aufbau einer alten Version angelegt (createOldDatabase), dann
// db.ts neu geladen (loadStore). Dexie zählt intern in Zehnern: Version 8 ist in IndexedDB 80.

import Dexie from 'dexie';
import { vi } from 'vitest';

export const DB_NAME = 'baumaengel';

// Aufbau der Tabellen bis Version 8 (Stand vor Etappe 4.24), zusammengefasst aus db.ts
export const STORES_V8: Record<string, string> = {
  projects: '++id',
  planMeta: '++id, projectId',
  planData: 'planId',
  defects: '++id, projectId, planId',
  photos: '++id, pinId',
  reportSettings: 'projectId',
  textBlocks: '++id',
  profiles: '++id',
};

export const STORES_V9 = { ...STORES_V8, trades: '++id' };

export async function createOldDatabase(
  version: number,
  stores: Record<string, string>,
  fill: (db: Dexie) => Promise<unknown>
): Promise<void> {
  await Dexie.delete(DB_NAME);
  const old = new Dexie(DB_NAME);
  old.version(version).stores(stores);
  await old.open();
  await fill(old);
  old.close();
}

// db.ts neu laden: eine neue Dexie-Verbindung, die beim ersten Zugriff die Umstellungen ausführt
export async function loadStore() {
  vi.resetModules();
  return import('../../src/db.ts');
}

// Leere Datenbank wie beim allerersten Start
export async function freshStore() {
  await Dexie.delete(DB_NAME);
  return loadStore();
}
