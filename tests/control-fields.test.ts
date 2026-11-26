// Angaben zur Baukontrolle: Aufzählungen erkennen und Vorgabe der Veranlassung
import { describe, expect, it } from 'vitest';
import { OCCASIONS, isBulletLine, occasionOf, parseBullets } from '../src/control-fields.ts';

describe('parseBullets', () => {
  it('erkennt Aufzählungszeichen und lässt leere Zeilen weg', () => {
    expect(parseBullets('Pläne vom 01.11.\n• Grundriss EG\n- Schnitt A\r\n– Ansicht Nord\n\n  \nSchluss')).toEqual([
      { bullet: false, text: 'Pläne vom 01.11.' },
      { bullet: true, text: 'Grundriss EG' },
      { bullet: true, text: 'Schnitt A' },
      { bullet: true, text: 'Ansicht Nord' },
      { bullet: false, text: 'Schluss' },
    ]);
  });

  it('ein Bindestrich im Wort ist keine Aufzählung', () => {
    expect(parseBullets('-Rohbau\nBrand-schutz')).toEqual([
      { bullet: false, text: '-Rohbau' },
      { bullet: false, text: 'Brand-schutz' },
    ]);
  });

  it('kommt mit leeren Werten zurecht', () => {
    expect(parseBullets(undefined)).toEqual([]);
    expect(parseBullets(null)).toEqual([]);
    expect(parseBullets('• ')).toEqual([]);
  });

  it('isBulletLine', () => {
    expect(isBulletLine('• Text')).toBe(true);
    expect(isBulletLine('  - Text')).toBe(true);
    expect(isBulletLine('Text')).toBe(false);
  });
});

describe('occasionOf', () => {
  it('nimmt die Vorgabe nur, solange nichts eingetragen wurde', () => {
    expect(occasionOf({})).toBe(OCCASIONS[0]);
    expect(occasionOf({ occasion: '' })).toBe(''); // bewusst geleert
    expect(occasionOf({ occasion: 'Eigene' })).toBe('Eigene');
  });
});
