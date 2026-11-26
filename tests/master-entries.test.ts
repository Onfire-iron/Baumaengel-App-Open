// Stammdaten-Einträge: Gleichheit von Namen, Schlüssel und das Prüfen von Einträgen aus Dateien
import { describe, expect, it } from 'vitest';
import { defaultEntries, defaultUid, entryKey, nameKey, readEntry } from '../src/master-entries.ts';

describe('nameKey', () => {
  it('ignoriert Groß/klein, Umlaute und doppelte Leerzeichen', () => {
    expect(nameKey('  Müller   GmbH ')).toBe(nameKey('muller gmbh'));
    expect(nameKey('Außenanlagen')).toBe(nameKey('AUSSENANLAGEN'));
  });
});

describe('entryKey', () => {
  it('trennt gleichnamige Personen verschiedener Firmen', () => {
    const a = entryKey({ kind: 'person', name: 'Thomas Müller', companyUid: 'f1' });
    const b = entryKey({ kind: 'person', name: 'thomas müller', companyUid: 'f2' });
    expect(a).not.toBe(b);
    expect(a).toBe(entryKey({ kind: 'person', name: 'thomas muller', companyUid: 'f1' }));
  });

  it('trennt Textbausteine nach Kategorie und Art', () => {
    const title = entryKey({ kind: 'textblock', name: 'Mangel Tür', category: 'Tür', blockType: 'title' });
    expect(title).not.toBe(entryKey({ kind: 'textblock', name: 'Mangel Tür', category: 'Fenster', blockType: 'title' }));
    expect(title).not.toBe(entryKey({ kind: 'textblock', name: 'Mangel Tür', category: 'Tür', blockType: 'note' }));
    // ohne Art gilt Notiz
    expect(entryKey({ kind: 'textblock', name: 'X', category: 'Tür' })).toBe(
      entryKey({ kind: 'textblock', name: 'x', category: 'tür', blockType: 'note' })
    );
  });

  it('Firmen hängen nicht an einer Firma', () => {
    expect(entryKey({ kind: 'company', name: 'A', companyUid: 'x' })).toBe(entryKey({ kind: 'company', name: 'a' }));
  });
});

describe('defaultEntries', () => {
  it('enthält Gewerke und die Veranlassung mit festen Kennungen und updatedAt 0', () => {
    const entries = defaultEntries();
    expect(entries.filter((e) => e.kind === 'trade')).toHaveLength(16);
    expect(entries.filter((e) => e.kind === 'occasion')).toHaveLength(1);
    for (const entry of entries) {
      expect(entry.uid).toBe(defaultUid(entry.kind, entry.name));
      expect(entry.updatedAt).toBe(0);
      expect(entry.deleted).toBe(false);
    }
  });
});

describe('readEntry', () => {
  it('lehnt Unbrauchbares ab', () => {
    expect(readEntry(null)).toBeNull();
    expect(readEntry({ uid: 'a', kind: 'unbekannt', name: 'X' })).toBeNull();
    expect(readEntry({ uid: '', kind: 'trade', name: 'X' })).toBeNull();
    expect(readEntry({ uid: 'a', kind: 'trade', name: '   ' })).toBeNull();
    expect(readEntry({ uid: 'a'.repeat(201), kind: 'trade', name: 'X' })).toBeNull();
  });

  it('übernimmt nur die Felder, die zur Art passen', () => {
    expect(readEntry({ uid: 'a', kind: 'trade', name: ' Dach ', role: 'x', category: 'y', updatedAt: -5 })).toEqual({
      uid: 'a',
      kind: 'trade',
      name: 'Dach',
      updatedAt: 0,
      deleted: false,
    });
    expect(readEntry({ uid: 'p', kind: 'person', name: 'Max', companyUid: 'f', role: 'Bauleitung', updatedAt: 7, deleted: true })).toEqual({
      uid: 'p',
      kind: 'person',
      name: 'Max',
      companyUid: 'f',
      role: 'Bauleitung',
      updatedAt: 7,
      deleted: true,
    });
  });

  it('kürzt Namen, Textbausteine dürfen länger sein', () => {
    expect(readEntry({ uid: 'a', kind: 'company', name: 'x'.repeat(500) })!.name).toHaveLength(200);
    const block = readEntry({ uid: 'b', kind: 'textblock', name: 'x'.repeat(500), category: 'Tür', blockType: 'quatsch' })!;
    expect(block.name).toHaveLength(500);
    expect(block.category).toBe('Tür');
    expect(block.blockType).toBe('note');
  });
});
