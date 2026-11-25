// =============================================================
// Datumskachel: Datum als Text, darüber unsichtbar das Datumsfeld
// =============================================================
//
// Aufbau im HTML: <div class="tile date-tile"> Symbol, .tile-label, .tile-value, <input type="date">.
// Das Feld liegt über der ganzen Kachel (style.css) und öffnet am Finger die Datumsauswahl des Geräts.
// Genutzt im Bearbeitungsfenster (Festgestellt, Frist, Erledigt am) und im Berichtsfenster.

import { formatDate } from './defects.ts';

// Zeigt das Datum des Felds in seiner Kachel an. Nach jeder Änderung des Werts aufrufen.
export function showDate(input: HTMLInputElement): void {
  const tile = input.closest('.date-tile')!;
  tile.querySelector('.tile-value')!.textContent = input.value ? formatDate(input.value) : 'Kein Datum';
  tile.classList.toggle('empty', !input.value);
}

// clearable: "×" oben rechts leert das Datum, nicht jede Datumsauswahl hat dafür einen Knopf
export function initDateTile(input: HTMLInputElement, { clearable = true } = {}): void {
  // Am Rechner öffnet ein Klick auf das Feld die Auswahl nicht von selbst, nur sein Kalender-Symbol.
  // Mit dem Finger (iPad, Android) macht das Gerät das selbst.
  input.addEventListener('click', (e) => {
    if ((e as PointerEvent).pointerType === 'touch' || (e as PointerEvent).pointerType === 'pen') return;
    try {
      input.showPicker();
    } catch {
      // ältere Browser: dann bleibt es beim Feld selbst
    }
  });

  if (!clearable) return;
  const clear = document.createElement('button');
  clear.className = 'date-clear';
  clear.textContent = '×';
  clear.setAttribute('aria-label', `${input.getAttribute('aria-label')}: Datum entfernen`);
  clear.addEventListener('click', () => {
    input.value = '';
    input.dispatchEvent(new Event('input'));
  });
  input.closest('.date-tile')!.append(clear);
}
