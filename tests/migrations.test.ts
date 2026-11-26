// Datenbank-Umstellungen: Eine ältere Datenbank muss beim Öffnen durch die neue App vollständig
// und ohne Datenverlust umgestellt werden (db.ts, Versionen 9 bis 12)
import { describe, expect, it } from 'vitest';
import { TRADES } from '../src/defects.ts';
import { OCCASIONS } from '../src/control-fields.ts';
import { STORES_V8, STORES_V9, createOldDatabase, freshStore, loadStore } from './helpers/database.ts';

const oldPin = {
  projectId: 1,
  planId: 1,
  page: 1,
  x: 0.5,
  y: 0.5,
  notes: '',
  trade: '',
  foundAt: null,
  dueDate: null,
  doneAt: null,
  createdBy: null,
};

describe('Erster Start', () => {
  it('legt Gewerke und Veranlassung als Vorgaben an', async () => {
    const store = await freshStore();
    expect(store.db.verno).toBe(12);
    expect((await store.listMaster('trade')).map((e) => e.name).sort()).toEqual([...TRADES].sort());
    expect((await store.listMaster('occasion')).map((e) => e.name)).toEqual(OCCASIONS);
    expect(await store.listMaster('company')).toEqual([]);
    store.db.close();
  });
});

describe('Umstellung von Version 8 (vor Etappe 4.24)', () => {
  it('setzt die alten Stufen um und füllt Gewerke, Firmen, Personen und Veranlassung', async () => {
    await createOldDatabase(8, STORES_V8, async (db) => {
      await db.table('projects').add({ id: 1, name: 'Alt', createdAt: 1, updatedAt: 1, nextDefectNumber: 4, division: null });
      await db.table('defects').bulkAdd([
        { ...oldPin, id: 1, number: 1, title: 'A', importance: 'wichtig', done: false, company: 'Musterbau GmbH' },
        { ...oldPin, id: 2, number: 2, title: 'B', importance: 'relevant', done: true, company: ' musterbau  gmbh ' },
        { ...oldPin, id: 3, number: 3, title: 'C', importance: 'hinweis', done: false, company: '' },
      ]);
      await db.table('reportSettings').add({
        projectId: 1,
        inspections: [
          {
            date: '2026-11-01',
            participants: [
              { name: 'Max Muster', org: 'Musterbau GmbH' },
              { name: 'Erika Amt', org: 'Stadt Musterstadt' },
              { name: 'max muster', org: 'MUSTERBAU GMBH' }, // dieselbe Person
              { name: 'Ohne Firma', org: '' },
              { name: '  ', org: 'Nur Firma' }, // ohne Namen: weder Person noch Firma
            ],
          },
        ],
      });
    });
    const store = await loadStore();
    const pins = await store.listPins(1);
    expect(pins.map((p) => [p.number, p.importance, p.done])).toEqual([
      [1, 'mangel', false],
      [2, 'intern', true],
      [3, 'hinweis', false],
    ]);
    // Die Mängel behalten ihre Firma als Text
    expect(pins[1].company).toBe(' musterbau  gmbh ');

    const trades = await store.listMaster('trade');
    expect(trades).toHaveLength(TRADES.length);
    expect(trades.every((t) => t.uid.startsWith('vorgabe:trade:'))).toBe(true);

    const companies = await store.listMaster('company');
    expect(companies.map((c) => c.name)).toEqual(['Musterbau GmbH', 'Stadt Musterstadt']);

    const names = await store.companyNames();
    const persons = (await store.listMaster('person')).map((p) => `${p.name} (${p.companyUid ? names.get(p.companyUid) : '-'})`);
    expect(persons).toEqual(['Erika Amt (Stadt Musterstadt)', 'Max Muster (Musterbau GmbH)', 'Ohne Firma (-)']);

    expect((await store.listMaster('occasion')).map((e) => e.name)).toEqual(OCCASIONS);
    expect((await store.getProject(1))?.nextDefectNumber).toBe(4);
    store.db.close();
  });
});

describe('Umstellung von Version 9 (Gewerke-Tabelle, Etappe 4.24 bis 4.28)', () => {
  it('übernimmt eigene Gewerke und merkt gelöschte Vorgaben als gelöscht', async () => {
    await createOldDatabase(9, STORES_V9, async (db) => {
      const kept = TRADES.filter((name) => name !== 'Dach');
      await db.table('trades').bulkAdd([...kept, 'Brandschutz', 'brandschutz'].map((name) => ({ name })));
    });
    const store = await loadStore();
    const all = await store.allMasterEntries();

    const dach = all.find((e) => e.uid === 'vorgabe:trade:dach');
    expect(dach?.deleted).toBe(true);
    expect(dach?.updatedAt).toBeGreaterThan(0); // damit der Lösch-Vermerk beim Abgleich gewinnt

    const own = all.filter((e) => e.kind === 'trade' && e.name.toLowerCase() === 'brandschutz');
    expect(own).toHaveLength(1);
    expect(own[0].uid.startsWith('vorgabe:')).toBe(false);

    // Die Veranlassung (neu in Version 12) darf von der Umstellung der Gewerke nicht gelöscht werden
    const occasions = all.filter((e) => e.kind === 'occasion');
    expect(occasions.map((e) => [e.name, e.deleted])).toEqual(OCCASIONS.map((name) => [name, false]));
    store.db.close();
  });
});
