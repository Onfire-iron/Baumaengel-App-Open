// =============================================================
// Beteiligte am Bauvorhaben (Bauherrschaft, Entwurfsverfassende usw.) und Projektnummer
// =============================================================
//
// Freie Textfelder, keines ist Pflicht. Sie stehen in "Neues Projekt" / "Projekt bearbeiten" und
// in "Bericht erstellen" und sind dort dieselben Angaben: Sie liegen wie die Adresse bei den
// Angaben für den Bericht (ReportSettings), was man an einer Stelle einträgt, steht auch an der
// anderen. Im Bericht erscheinen sie auf Seite 2 "Projektangaben" (drawProjectInfo in report.ts),
// leere Felder nicht. Die Projektnummer steht stattdessen auf dem Deckblatt und in der Kopfzeile.
// multiline: mehrzeiliges Feld (z. B. Name und Anschrift), sonst eine Zeile.

export const PARTIES = [
  { key: 'owner', label: 'Bauherrschaft', multiline: true },
  { key: 'designer', label: 'Entwurfsverfassende', multiline: true },
  { key: 'buildingAuthority', label: 'Bauaufsichtsbehörde', multiline: true },
  { key: 'fireAuthority', label: 'Brandschutzdienststelle', multiline: true },
  { key: 'siteManager', label: 'Bauleitung', multiline: true },
  { key: 'projectNumber', label: 'Projektnummer', multiline: false },
] as const;

export type PartyKey = (typeof PARTIES)[number]['key'];

// Die Projektnummer steht im Bericht auf dem Deckblatt unter der Adresse, die übrigen Angaben auf
// der Seite "Projektangaben"
export const INFO_PAGE_PARTIES = PARTIES.filter(({ key }) => key !== 'projectNumber');

export type PartyFields = Record<PartyKey, HTMLTextAreaElement | HTMLInputElement>;

// Baut die Textfelder in container ein. idPrefix unterscheidet die beiden Fenster.
export function createPartyFields(container: HTMLElement, idPrefix: string): PartyFields {
  const fields = {} as PartyFields;
  container.replaceChildren(
    ...PARTIES.map(({ key, label, multiline }) => {
      const field = document.createElement('label');
      field.className = 'field';
      let input: HTMLTextAreaElement | HTMLInputElement;
      if (multiline) {
        input = document.createElement('textarea');
        input.rows = 2;
      } else {
        input = document.createElement('input');
        input.type = 'text';
        input.maxLength = 60;
      }
      input.id = `${idPrefix}-${key}`;
      input.autocomplete = 'off';
      field.append(label, input);
      fields[key] = input;
      return field;
    })
  );
  return fields;
}
