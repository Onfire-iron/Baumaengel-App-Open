// Excel-Vorlage einlesen: Zellen lesen (xlsx-read.ts) und den Import planen und ausführen
// (list-import-plan.ts)
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OCCASIONS } from '../src/control-fields.ts';
import { readXlsx } from '../src/xlsx-read.ts';
import { buildXlsx } from './helpers/xlsx.ts';
import type { SheetData } from './helpers/xlsx.ts';
import { freshStore } from './helpers/database.ts';

describe('readXlsx', () => {
  for (const style of ['excel', 'inline'] as const) {
    it(`liest Reiter und Zellen (${style})`, async () => {
      const file = await buildXlsx(
        [
          ['Erster', [['A1', null, 'C1'], null, ['A3 & <Text>', 42], ['Zeile\nzwei']]],
          ['Zweiter', [['nur', 'eine Zeile']]],
        ],
        style
      );
      const sheets = await readXlsx(file);
      expect(sheets.map((s) => s.name)).toEqual(['Erster', 'Zweiter']);
      expect(sheets[0].rows).toEqual([
        { row: 1, cells: ['A1', '', 'C1'] },
        { row: 3, cells: ['A3 & <Text>', '42'] },
        { row: 4, cells: ['Zeile\nzwei'] },
      ]);
    });
  }

  it('setzt Text aus mehreren formatierten Stücken zusammen', async () => {
    const sheets = await readXlsx(await buildXlsx([['Gewerke', [['Brand|schutz']]]]));
    expect(sheets[0].rows[0].cells).toEqual(['Brandschutz']);
  });

  it('erkennt das alte .xls-Format und andere Dateien', async () => {
    const xls = new Blob([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0])]);
    await expect(readXlsx(xls)).rejects.toThrow(/\.xls/);
    await expect(readXlsx(new Blob(['%PDF-1.7 kein Excel']))).rejects.toThrow(/nicht als Excel-Datei/);
  });
});

describe('Import planen und übernehmen', () => {
  let store: Awaited<ReturnType<typeof freshStore>>;
  let plan: typeof import('../src/list-import-plan.ts');

  beforeEach(async () => {
    store = await freshStore();
    plan = await import('../src/list-import-plan.ts');
  });
  afterEach(() => store.db.close());

  const template = (sheets: SheetData[]) => buildXlsx([['Anleitung', [['Bitte ausfüllen']]], ...sheets]);
  const states = (rows: { row: number; state: string; note?: string }[]) => rows.map((r) => `${r.row} ${r.state}${r.note ? ` (${r.note})` : ''}`);

  it('zeigt je Zeile neu, vorhanden, ergänzt und fehlerhaft und übernimmt nur Neues', async () => {
    // Was schon in der App steht
    await store.addMaster('person', 'Erika Beispiel'); // ohne Firma
    await store.addPerson('Paul Vorhanden', 'Altfirma KG'); // ohne Funktion
    await store.addPerson('Hans Gleich', 'Altfirma KG', 'Statiker');
    await store.deleteMaster('vorgabe:trade:dach');

    const file = await template([
      [
        'Kontakte',
        [
          ['Name', 'Firma / Amt', 'Funktion'],
          ['Max Mustermann', 'Musterbau GmbH', 'Bauleitung'],
          ['max  mustermann', 'MUSTERBAU GMBH', ''],
          ['Erika Beispiel', 'Stadt Musterstadt', 'Prüferin'],
          [null, 'Nur Firma AG', null],
          [null, null, 'Prüfer'],
          ['Lisa Lang', 'Musterbau GmbH', 'Elektro'],
          ['Paul Vorhanden', 'Altfirma KG', 'Statik'],
          ['Hans Gleich', 'Altfirma KG', 'Bauherr'],
        ],
      ],
      ['Gewerke', [['Gewerk'], ['Rohbau'], ['Brandschutz'], ['brandschutz'], ['Dach'], ['x'.repeat(201)]]],
      [
        'Textbausteine',
        [
          ['Text', 'Kategorie', 'Art'], // andere Reihenfolge als in der Vorlage
          ['Mangel Tür', 'Tür', 'Überschrift'],
          ['Obentürschließer fehlt', 'Tür', 'Notiz'],
          ['Rauchmelder fehlt', 'Decke', null],
          ['ohne Kategorie', null, 'Notiz'],
          ['falsche Art', 'Tür', 'Bild'],
          ['Mangel Tür', 'Fenster', 'Überschrift'],
        ],
      ],
      ['Veranlassung', [['Text'], [OCCASIONS[0]], ['Anfrage der Bauherrschaft']]], // die Vorgabe ist schon da
      ['Notizen', [['wird nicht gelesen']]],
    ]);

    const result = await plan.planListImport(file);
    expect(result.ignored).toEqual(['Notizen']);
    const sheet = (title: string) => result.sheets.find((s) => s.title === title)!;

    expect(states(sheet('Kontakte').rows)).toEqual([
      '2 new (neue Firma)',
      '3 known (steht schon in Zeile 2)',
      '4 update (Firma wird ergänzt (neu in der Firmenliste))',
      '5 new (nur Firma)',
      '6 error (Name fehlt)',
      '7 new',
      '8 update (Funktion wird ergänzt)',
      '9 known (in der App mit Funktion „Statiker“)',
    ]);
    expect(states(sheet('Gewerke').rows)).toEqual([
      '2 known',
      '3 new',
      '4 known (steht schon in Zeile 3)',
      '5 new (war gelöscht, kommt zurück)',
      '6 error (zu lang (201 Zeichen, höchstens 200))',
    ]);
    expect(states(sheet('Textbausteine').rows)).toEqual([
      '2 new',
      '3 new',
      '4 new (Art leer, gilt als Notiz)',
      '5 error (Kategorie fehlt)',
      '6 error (Art „Bild“ unbekannt, erlaubt sind „Überschrift“ und „Notiz“)',
      '7 new',
    ]);
    expect(states(sheet('Veranlassung').rows)).toEqual(['2 known', '3 new']);

    // Noch nichts übernommen
    expect((await store.listMaster('person')).map((p) => p.name)).not.toContain('Max Mustermann');

    for (const row of plan.toApply(result)) await row.apply!();

    const companies = await store.companyNames();
    const persons = (await store.listMaster('person')).map((p) => `${p.name} | ${p.companyUid ? companies.get(p.companyUid) : '-'} | ${p.role ?? '-'}`);
    expect(persons).toEqual([
      'Erika Beispiel | Stadt Musterstadt | Prüferin',
      'Hans Gleich | Altfirma KG | Statiker',
      'Lisa Lang | Musterbau GmbH | Elektro',
      'Max Mustermann | Musterbau GmbH | Bauleitung',
      'Paul Vorhanden | Altfirma KG | Statik',
    ]);
    expect([...companies.values()].sort()).toEqual(['Altfirma KG', 'Musterbau GmbH', 'Nur Firma AG', 'Stadt Musterstadt']);
    const trades = (await store.listMaster('trade')).map((t) => t.name);
    expect(trades).toContain('Brandschutz');
    expect(trades).toContain('Dach');
    expect(trades.filter((t) => t.toLowerCase() === 'brandschutz')).toHaveLength(1);
    const blocks = (await store.listMaster('textblock')).map((b) => `${b.category}/${b.blockType}: ${b.name}`).sort();
    expect(blocks).toEqual([
      'Decke/note: Rauchmelder fehlt',
      'Fenster/title: Mangel Tür',
      'Tür/note: Obentürschließer fehlt',
      'Tür/title: Mangel Tür',
    ]);
    expect((await store.listMaster('occasion')).map((o) => o.name).sort()).toEqual(['Anfrage der Bauherrschaft', OCCASIONS[0]].sort());

    // Dieselbe Datei noch einmal: nichts Neues
    const again = await plan.planListImport(file);
    expect(plan.toApply(again)).toEqual([]);
  });

  it('meldet falsche Spaltennamen je Reiter und überspringt leere Reiter', async () => {
    const result = await plan.planListImport(
      await buildXlsx([
        ['Kontakte', [['Nachname', 'Ort'], ['Muster', 'Köln']]],
        ['Gewerke', []],
        ['Textbausteine', [['Kategorie', 'Art'], ['Tür', 'Notiz']]],
      ])
    );
    expect(result.sheets.map((s) => [s.title, s.problem ?? '', s.rows.length])).toEqual([
      ['Kontakte', 'In Zeile 1 steht keine der Spalten „Name“, „Firma / Amt“, „Funktion“. Die Spaltennamen der Vorlage bitte nicht ändern.', 0],
      ['Gewerke', '', 0],
      ['Textbausteine', 'In Zeile 1 fehlt die Spalte „Text“. Die Spaltennamen der Vorlage bitte nicht ändern.', 0],
    ]);
  });

  it('lehnt Dateien ohne bekannte Reiter ab', async () => {
    await expect(plan.planListImport(await buildXlsx([['Tabelle1', [['a']]]]))).rejects.toThrow(/fehlen die Reiter/);
  });
});
