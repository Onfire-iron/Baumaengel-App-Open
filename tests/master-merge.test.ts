// Stammdaten anlegen und zusammenführen (addMaster, mergeMaster in db.ts): Grundlage für
// "Listen einlesen" und den späteren Abgleich über SharePoint
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MasterEntry } from '../src/types.ts';
import { freshStore } from './helpers/database.ts';

let store: Awaited<ReturnType<typeof freshStore>>;

beforeEach(async () => {
  store = await freshStore();
});

afterEach(() => store.db.close());

const entry = (fields: Partial<MasterEntry> & Pick<MasterEntry, 'uid' | 'kind' | 'name'>): MasterEntry => ({
  updatedAt: 1000,
  deleted: false,
  ...fields,
});

describe('addMaster', () => {
  it('legt einen Namen nur einmal an, egal wie geschrieben', async () => {
    const a = await store.addMaster('company', 'Musterbau GmbH');
    const b = await store.addMaster('company', 'musterbau  gmbh');
    expect(b.uid).toBe(a.uid);
    expect(await store.listMaster('company')).toHaveLength(1);
  });

  it('holt einen gelöschten Eintrag zurück statt einen neuen anzulegen', async () => {
    const a = await store.addMaster('trade', 'Gerüstbau');
    await store.deleteMaster(a.uid);
    expect((await store.listMaster('trade')).some((e) => e.uid === a.uid)).toBe(false);
    const b = await store.addMaster('trade', 'Gerüstbau');
    expect(b.uid).toBe(a.uid);
    expect(b.deleted).toBe(false);
  });

  it('legt eine Person mit ihrer Firma an', async () => {
    const person = await store.addPerson('Max Muster', 'Musterbau GmbH', 'Bauleitung');
    const names = await store.companyNames();
    expect(names.get(person.companyUid!)).toBe('Musterbau GmbH');
    expect(person.role).toBe('Bauleitung');
    // gleicher Name, andere Firma: eine zweite Person
    await store.addPerson('Max Muster', 'Andere AG');
    expect(await store.listMaster('person')).toHaveLength(2);
  });
});

describe('mergeMaster', () => {
  it('übernimmt Unbekanntes und zählt es', async () => {
    const result = await store.mergeMaster([entry({ uid: 'x1', kind: 'company', name: 'Neu GmbH' })]);
    expect(result).toEqual({ added: 1, changed: 0 });
    expect((await store.listMaster('company')).map((e) => e.name)).toEqual(['Neu GmbH']);
  });

  it('legt nichts doppelt an, wenn derselbe Name hier schon eine andere Kennung hat', async () => {
    await store.addMaster('company', 'Musterbau GmbH');
    const result = await store.mergeMaster([entry({ uid: 'fremd', kind: 'company', name: 'MUSTERBAU GMBH' })]);
    expect(result).toEqual({ added: 0, changed: 0 });
    expect(await store.listMaster('company')).toHaveLength(1);
  });

  it('die neuere Fassung gilt, die ältere wird übergangen', async () => {
    await store.mergeMaster([entry({ uid: 'a', kind: 'trade', name: 'Alt', updatedAt: 1000 })]);
    expect(await store.mergeMaster([entry({ uid: 'a', kind: 'trade', name: 'Älter', updatedAt: 500 })])).toEqual({ added: 0, changed: 0 });
    expect(await store.mergeMaster([entry({ uid: 'a', kind: 'trade', name: 'Neu', updatedAt: 2000 })])).toEqual({ added: 0, changed: 1 });
    expect((await store.allMasterEntries()).find((e) => e.uid === 'a')?.name).toBe('Neu');
  });

  it('übernimmt Löschungen von anderen Geräten, auch für Vorgaben', async () => {
    const result = await store.mergeMaster([entry({ uid: 'vorgabe:trade:dach', kind: 'trade', name: 'Dach', deleted: true, updatedAt: 5 })]);
    expect(result.changed).toBe(1);
    expect((await store.listMaster('trade')).some((e) => e.name === 'Dach')).toBe(false);
  });

  it('eine Vorgabe ohne Änderung überschreibt keine eigene Änderung', async () => {
    await store.deleteMaster('vorgabe:trade:dach');
    await store.mergeMaster([entry({ uid: 'vorgabe:trade:dach', kind: 'trade', name: 'Dach', updatedAt: 0 })]);
    expect((await store.listMaster('trade')).some((e) => e.name === 'Dach')).toBe(false);
  });

  it('gleichnamige Personen verschiedener Firmen bleiben getrennt', async () => {
    const a = await store.addPerson('Thomas Müller', 'Firma A');
    await store.mergeMaster([entry({ uid: 'p2', kind: 'person', name: 'Thomas Müller', companyUid: 'andere' })]);
    const persons = await store.listMaster('person');
    expect(persons.map((p) => p.uid).sort()).toEqual([a.uid, 'p2'].sort());
  });
});
