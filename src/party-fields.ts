// =============================================================
// Eingabefelder für die Beteiligten und die Projektnummer (siehe parties.ts)
// =============================================================
//
// Genutzt in "Neues Projekt" / "Projekt bearbeiten" und "Bericht erstellen". Mehrzeilige Felder haben
// "Aus der Liste": Firma bzw. Amt oder Person (mit Firma in der zweiten Zeile) aus den Stammdaten
// übernehmen, siehe choice-dialog.ts.

import { openChoiceDialog } from './choice-dialog.ts';
import { PARTIES } from './parties.ts';
import type { PartyKey } from './parties.ts';

export type PartyFields = Record<PartyKey, HTMLTextAreaElement | HTMLInputElement>;

// Baut die Textfelder in container ein. idPrefix unterscheidet die beiden Fenster.
export function createPartyFields(container: HTMLElement, idPrefix: string): PartyFields {
  const fields = {} as PartyFields;
  container.replaceChildren(
    ...PARTIES.map(({ key, label, multiline }) => {
      const field = document.createElement('div');
      field.className = 'field';
      const head = document.createElement('div');
      head.className = 'field-head';
      const caption = document.createElement('label');
      caption.textContent = label;
      head.append(caption);
      let input: HTMLTextAreaElement | HTMLInputElement;
      if (multiline) {
        input = document.createElement('textarea');
        input.rows = 2;
        head.append(createPickButton(label, () => input));
      } else {
        input = document.createElement('input');
        input.type = 'text';
        input.maxLength = 60;
      }
      input.id = `${idPrefix}-${key}`;
      caption.htmlFor = input.id;
      input.autocomplete = 'off';
      field.append(head, input);
      fields[key] = input;
      return field;
    })
  );
  return fields;
}

// Übernimmt einen Eintrag aus der Firmen- oder Personenliste in das Feld. Das "input"-Ereignis sorgt dafür,
// dass die Fenster die Angabe wie beim Tippen speichern.
function createPickButton(label: string, getInput: () => HTMLTextAreaElement | HTMLInputElement) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn link pick-btn';
  btn.textContent = 'Aus der Liste';
  btn.setAttribute('aria-label', `${label} aus der Liste wählen`);
  btn.addEventListener('click', () => {
    const input = getInput();
    openChoiceDialog(['company', 'person'], input.value.split('\n')[0].trim(), (picked) => {
      input.value = picked.kind === 'person' ? [picked.name, picked.company].filter(Boolean).join('\n') : picked.name;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }).catch(console.error);
  });
  return btn;
}
