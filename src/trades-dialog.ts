// =============================================================
// Fenster "Gewerk wählen": Kacheln aus der Gewerke-Liste, suchen, ergänzen, löschen
// =============================================================
//
// Die Liste gilt für alle Projekte und liegt bei den Stammdaten (Art "trade", master-entries.ts),
// am Anfang gefüllt mit TRADES aus defects.ts. Gelöschte Gewerke bekommen nur einen Lösch-Vermerk,
// damit der Abgleich mit anderen Geräten davon erfährt. Erster Test für die geplanten Auswahlfenster
// für Firmen und Namen.

import * as store from './db.ts';
import { normalize, searchWords } from './search.ts';
import type { MasterEntry } from './types.ts';
import { closeOnOutsideTap } from './outside-tap.ts';

const dialog = document.getElementById('trades-dialog') as HTMLElement;
const search = document.getElementById('trades-search') as HTMLInputElement;
const grid = document.getElementById('trades-grid') as HTMLElement;
const message = document.getElementById('trades-message') as HTMLElement;
const editBtn = document.getElementById('trades-edit') as HTMLButtonElement;
const hint = document.getElementById('trades-hint') as HTMLElement;
const clearBtn = document.getElementById('trades-clear') as HTMLButtonElement;

let trades: MasterEntry[] = [];
let current = '';
let editing = false;
let onPick: ((name: string) => void) | null = null;

// Jedes eingegebene Wort muss im Namen vorkommen, Groß/klein und Umlaute egal (search.ts)
function matches(name: string, query: string) {
  const text = normalize(name);
  return searchWords(query).every((word) => text.includes(word));
}

// Das Suchfeld bekommt bewusst keinen Fokus: Die iPad-Tastatur würde die Kacheln verdecken
export async function openTradesDialog(value: string, pick: (name: string) => void): Promise<void> {
  trades = await store.listMaster('trade');
  current = value;
  onPick = pick;
  search.value = '';
  message.textContent = '';
  setEditing(false);
  clearBtn.disabled = !value;
  dialog.hidden = false;
  grid.scrollTop = 0;
}

function close() {
  dialog.hidden = true;
  onPick = null;
}

function choose(name: string) {
  onPick?.(name);
  close();
}

function setEditing(value: boolean) {
  editing = value;
  editBtn.textContent = value ? 'Fertig' : 'Bearbeiten';
  editBtn.setAttribute('aria-pressed', String(value));
  hint.hidden = !value;
  dialog.classList.toggle('editing', value);
  render();
}

function render() {
  const text = search.value.trim();
  const visible = trades.filter((trade) => matches(trade.name, text));
  const items: HTMLElement[] = [];

  // Das Gewerk des Mangels fehlt in der Liste (z. B. gelöscht oder aus einem Backup): trotzdem zeigen
  const known = trades.some((trade) => trade.name === current);
  if (current && !known && !editing && matches(current, text)) items.push(createChoice(current, null));

  // Neues Gewerk: nur, wenn es das so noch nicht gibt (Groß/klein egal)
  const exists = trades.some((trade) => normalize(trade.name) === normalize(text));
  if (text && !exists && !editing) items.push(createAddChoice(text));

  items.push(...visible.map((trade) => createChoice(trade.name, trade)));

  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'list-empty';
    empty.textContent = text ? 'Kein passendes Gewerk.' : 'Die Liste ist leer.';
    items.push(empty);
  }
  grid.replaceChildren(...items);
}

function createChoice(name: string, trade: MasterEntry | null) {
  const btn = document.createElement('button');
  btn.className = 'choice';
  btn.textContent = name;
  const selected = name === current;
  btn.classList.toggle('selected', selected && !editing);
  btn.setAttribute('aria-pressed', String(selected));
  if (editing && trade) {
    btn.classList.add('removable');
    btn.setAttribute('aria-label', `${name} löschen`);
    btn.addEventListener('click', () => removeTrade(trade));
  } else {
    btn.addEventListener('click', () => choose(name));
  }
  return btn;
}

// Neue Einträge beginnen groß, wie die übrigen: "brandschutz" wird zu "Brandschutz"
function createAddChoice(input: string) {
  const text = input.charAt(0).toLocaleUpperCase('de-DE') + input.slice(1);
  const btn = document.createElement('button');
  btn.className = 'choice add';
  btn.textContent = `„${text}“ hinzufügen`;
  btn.addEventListener('click', async () => {
    try {
      const entry = await store.addMaster('trade', text);
      choose(entry.name);
    } catch (err) {
      console.error(err);
      message.textContent = 'Das Gewerk konnte nicht gespeichert werden. Ist der Speicher voll?';
    }
  });
  return btn;
}

async function removeTrade(trade: MasterEntry) {
  if (!confirm(`„${trade.name}“ aus der Liste löschen? Mängel mit diesem Gewerk behalten es.`)) return;
  try {
    await store.deleteMaster(trade.uid);
    trades = trades.filter((t) => t !== trade);
    render();
  } catch (err) {
    console.error(err);
    message.textContent = 'Das Gewerk konnte nicht gelöscht werden.';
  }
}

search.addEventListener('input', render);

// Enter übernimmt den einzigen Treffer oder legt das neue Gewerk an
search.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || editing) return;
  const choices = [...grid.querySelectorAll<HTMLButtonElement>('.choice')];
  if (choices.length === 1) choices[0].click();
  else search.blur();
});

editBtn.addEventListener('click', () => setEditing(!editing));
clearBtn.addEventListener('click', () => choose(''));
document.getElementById('trades-close')!.addEventListener('click', close);

// Tippen neben das Fenster schließt es, Escape auch
closeOnOutsideTap(dialog, close);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !dialog.hidden) close();
});
