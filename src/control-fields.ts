// =============================================================
// Angaben zur Baukontrolle: Tabelle nach dem Deckblatt (bzw. nach dem Titelbild)
// =============================================================
//
// Links die Bezeichnung, rechts der Wert. Ein Teil wird im
// Berichtsfenster eingetragen (gilt fürs ganze Projekt, liegt in ReportSettings und im Backup),
// ein Teil steht fest im Bericht. Leere Eingaben fallen im Bericht weg.
//
// Aufzählungen: Zeilen, die mit "• " (oder "- ") beginnen, werden im Bericht zu Aufzählungspunkten,
// siehe bullet-field.ts für die Eingabe und parseBullets unten.
//
// Alle festen Texte und Vorgaben hier sind Beispiele. Für den eigenen Einsatz durch die eigenen
// Formulierungen ersetzen.

import type { ReportSettings } from './types.ts';

// Vorschläge für "Veranlassung", der erste gilt, solange nichts eingetragen wurde.
// Später kommen sie aus den Textbausteinen.
export const OCCASIONS = ['Termin auf Wunsch der Bauleitung'];

// Fester Absatz vor der Liste. recipient ist der Empfänger im Dativ, z. B. "der Musterfirma GmbH"
// (je Bereich in divisions.ts).
export function requiredProofsIntro(recipient: string): string {
  return (
    'Für Bauprodukte und Bauarten mit Anforderungen an den Brandschutz sind die passenden Nachweise ' +
    '(zum Beispiel Zulassungen, Prüfzeugnisse, Leistungs- oder Übereinstimmungserklärungen) auf der ' +
    `Baustelle bereitzuhalten und ${recipient} vor der nächsten Baukontrolle in Kopie zu übermitteln. ` +
    'Das betrifft vor allem:'
  );
}

export const EXPERTS_TEXT =
  'Sachverständige für die Prüfung der technischen Anlagen sollten frühzeitig beauftragt werden.';

export const FINDINGS_TEXT = 'Die bei der Begehung festgestellten Punkte sind in der folgenden Übersicht zusammengestellt.';

// Veranlassung mit ihrer Vorgabe, wenn noch nichts eingetragen wurde (undefined = nie geändert)
export function occasionOf(settings: Partial<ReportSettings>): string {
  return settings.occasion ?? OCCASIONS[0];
}

export interface TextLine {
  bullet: boolean;
  text: string;
}

const BULLET = /^\s*[•\-–]\s+/;

// Zerlegt einen Text in Zeilen mit und ohne Aufzählungszeichen. Leere Zeilen fallen weg.
export function parseBullets(text: string | null | undefined): TextLine[] {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => (BULLET.test(line) ? { bullet: true, text: line.replace(BULLET, '').trim() } : { bullet: false, text: line.trim() }))
    .filter((line) => line.text);
}

export function isBulletLine(line: string): boolean {
  return BULLET.test(line);
}
