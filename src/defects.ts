// =============================================================
// Wichtigkeit und "Erledigt" eines Mangels
// =============================================================
//
// Beides ist unabhängig voneinander: Ein erledigter Mangel behält seine Wichtigkeit.
// Die Nummer wird beim Anlegen fest vergeben und danach nie mehr geändert oder neu verteilt.
// Sie stimmt so immer mit bereits verschickten Berichten überein.

import type { Defect, Importance, IsoDate } from './types.ts';

export const IMPORTANCE: Importance[] = ['mangel', 'hinweis', 'intern'];

export const IMPORTANCE_TEXT: Record<Importance, string> = {
  mangel: 'Mangel',
  hinweis: 'Hinweis',
  intern: 'Intern',
};

// Mehrzahl, z. B. "3 Mängel" auf der Startseite und als Abschnitt der Mängelliste
export const IMPORTANCE_PLURAL: Record<Importance, string> = {
  mangel: 'Mängel',
  hinweis: 'Hinweise',
  intern: 'Intern',
};

export const DEFAULT_IMPORTANCE: Importance = 'mangel';

// Bis Etappe 4.23 gab es Wichtig, Relevant und Hinweis. Wichtig wurde zu Mangel, Relevant zu Intern
// (gleiche Form: Quadrat), Hinweis blieb. Gilt für die Datenbank (db.ts) und alte Backups.
const OLD_IMPORTANCE = new Map<unknown, Importance>([
  ['wichtig', 'mangel'],
  ['relevant', 'intern'],
  ['hinweis', 'hinweis'],
]);

// Erste Einträge der Gewerke-Liste. Sie lassen sich in der App ergänzen und löschen.
export const TRADES = [
  'Rohbau',
  'Abdichtung',
  'Dach',
  'Fassade',
  'Fenster und Türen',
  'Trockenbau',
  'Estrich',
  'Putz und Maler',
  'Fliesen',
  'Bodenbelag',
  'Sanitär',
  'Heizung',
  'Lüftung',
  'Elektro',
  'Schlosser',
  'Außenanlagen',
];

// Erste Textbausteine. Sie lassen sich in der App löschen und ergänzen.
export const DEFAULT_TEXT_BLOCKS = [
  'Silikonfuge unsauber ausgeführt',
  'Riss im Putz',
  'Fliese beschädigt',
  'Anstrich unsauber, Nacharbeit erforderlich',
  'Kratzer am Fensterrahmen',
  'Tür schließt nicht richtig',
  'Türblatt beschädigt',
  'Feuchtigkeitsfleck sichtbar',
  'Abdichtung fehlt oder unvollständig',
  'Bodenbelag beschädigt',
  'Steckdose ohne Funktion',
  'Abdeckung fehlt',
  'Verschmutzung, Reinigung erforderlich',
  'Restarbeiten nicht ausgeführt',
];

// Daten stehen als Text im Format JJJJ-MM-TT in der Datenbank, wie im Datumsfeld.
// Sie lassen sich so direkt vergleichen, und Zeitzonen spielen keine Rolle.
export function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export function formatDate(iso: IsoDate): string {
  if (!iso) return '';
  const [year, month, day] = iso.split('-');
  return `${day}.${month}.${year}`;
}

export function isOverdue(pin: Pick<Defect, 'done' | 'dueDate'>, today: string = todayIso()): boolean {
  return !pin.done && Boolean(pin.dueDate) && pin.dueDate! < today;
}

// "unknown": Der Wert kommt von außen (Backup) und kann alles Mögliche sein
function readDate(value: unknown): IsoDate {
  return /^\d{4}-\d{2}-\d{2}$/.test(value as string) ? (value as string) : null;
}

// Liest Gewerk, Firma, Termine und wer den Mangel erfasst hat,
// auch aus alten Backups, die das noch nicht kennen
export function readDetails(defect: {
  trade?: unknown;
  company?: unknown;
  foundAt?: unknown;
  dueDate?: unknown;
  doneAt?: unknown;
  createdBy?: unknown;
}): Pick<Defect, 'trade' | 'company' | 'foundAt' | 'dueDate' | 'doneAt' | 'createdBy'> {
  const createdBy = typeof defect.createdBy === 'string' ? defect.createdBy.trim() : '';
  return {
    trade: String(defect.trade ?? ''),
    company: String(defect.company ?? ''),
    foundAt: readDate(defect.foundAt),
    dueDate: readDate(defect.dueDate),
    doneAt: readDate(defect.doneAt),
    createdBy: createdBy || null,
  };
}

// Liest die Angaben auch aus alten Daten mit "status" (offen/erledigt).
// Alte Daten kannten keine Wichtigkeit, darum gelten sie als "Mangel". Die alten Stufen
// (wichtig, relevant) werden umgesetzt, siehe OLD_IMPORTANCE.
export function readMarking(defect: {
  importance?: unknown;
  done?: unknown;
  status?: unknown;
}): Pick<Defect, 'importance' | 'done'> {
  return {
    importance: IMPORTANCE.includes(defect.importance as Importance)
      ? (defect.importance as Importance)
      : (OLD_IMPORTANCE.get(defect.importance) ?? DEFAULT_IMPORTANCE),
    done: defect.done === true || defect.status === 'erledigt',
  };
}

// Reihenfolge für Liste und Bericht: erst offene, dann erledigte Mängel,
// jeweils nach Wichtigkeit und innerhalb einer Stufe nach Nummer. Liefert eine Kopie.
export function sortPins(pins: Defect[]): Defect[] {
  const rank = (pin: Defect) => (pin.done ? IMPORTANCE.length : 0) + IMPORTANCE.indexOf(pin.importance);
  const position = new Map(pins.map((pin, index) => [pin, index]));
  return [...pins].sort((a, b) => rank(a) - rank(b) || position.get(a)! - position.get(b)!);
}
