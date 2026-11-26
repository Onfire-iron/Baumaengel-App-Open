// =============================================================
// Auswahlfenster für die Listen: Gewerk, Firma, Person (Stammdaten, master-entries.ts)
// =============================================================
//
// Kacheln zum Antippen, darüber die Suche. Gibt es den gesuchten Namen noch nicht, lässt er sich
// gleich hinzufügen. "Bearbeiten": Antippen öffnet den Eintrag zum Ändern oder Löschen.
// Personen haben zusätzlich Firma und Funktion: Dafür öffnet sich beim Hinzufügen und Ändern ein
// kleines Formular. Die Firma einer Person kommt bei Bedarf neu in die Firmenliste.
// Gelöschte Einträge bekommen nur einen Lösch-Vermerk (für den Abgleich mit anderen Geräten);
// Mängel und Begehungen behalten ihre Namen als Text.

import * as store from './db.ts';
import { closeOnOutsideTap } from './outside-tap.ts';
import { normalize, searchWords } from './search.ts';
import type { MasterEntry, MasterKind } from './types.ts';

// Die Listen, aus denen das Fenster wählen lässt (Veranlassung und Textbausteine haben eigene Stellen)
export type ChoiceKind = Extract<MasterKind, 'trade' | 'company' | 'person'>;

export interface Picked {
  kind: ChoiceKind; // aus welcher Liste (wichtig, wenn zwischen Firmen und Personen umgeschaltet wurde)
  name: string;
  company: string; // nur bei Personen: Name ihrer Firma
  role: string; // nur bei Personen
}

interface KindText {
  title: string; // Überschrift des Fensters
  one: string; // "das Gewerk" usw. für Meldungen
  none: string; // Knopf zum Leeren
  empty: string;
  keep: string; // was beim Löschen erhalten bleibt
}

const TEXT: Record<ChoiceKind, KindText> = {
  trade: {
    title: 'Gewerk wählen',
    one: 'das Gewerk',
    none: 'Kein Gewerk',
    empty: 'Kein passendes Gewerk.',
    keep: 'Mängel mit diesem Gewerk behalten es.',
  },
  company: {
    title: 'Firma wählen',
    one: 'die Firma',
    none: 'Keine Firma',
    empty: 'Keine passende Firma.',
    keep: 'Mängel und Begehungen behalten den Namen.',
  },
  person: {
    title: 'Person wählen',
    one: 'die Person',
    none: 'Leeren',
    empty: 'Keine passende Person.',
    keep: 'Begehungen behalten den Namen.',
  },
};

const dialog = document.getElementById('choice-dialog') as HTMLElement;
const title = document.getElementById('choice-title') as HTMLElement;
const listView = document.getElementById('choice-list-view') as HTMLElement;
const search = document.getElementById('choice-search') as HTMLInputElement;
const grid = document.getElementById('choice-grid') as HTMLElement;
const message = document.getElementById('choice-message') as HTMLElement;
const editBtn = document.getElementById('choice-edit') as HTMLButtonElement;
const hint = document.getElementById('choice-hint') as HTMLElement;
const clearBtn = document.getElementById('choice-clear') as HTMLButtonElement;
const form = document.getElementById('choice-form') as HTMLElement;
const formName = document.getElementById('choice-form-name') as HTMLInputElement;
const formCompany = document.getElementById('choice-form-company') as HTMLInputElement;
const formRole = document.getElementById('choice-form-role') as HTMLInputElement;
const formCompanies = document.getElementById('choice-form-companies') as HTMLDataListElement;
const personFields = document.getElementById('choice-person-fields') as HTMLElement;
const formDelete = document.getElementById('choice-form-delete') as HTMLButtonElement;
const formSave = document.getElementById('choice-form-save') as HTMLButtonElement;
const listButtons = dialog.querySelector('.choice-buttons') as HTMLElement;
const kindSwitch = document.getElementById('choice-kinds') as HTMLElement;
const kindButtons = kindSwitch.querySelectorAll<HTMLButtonElement>('[data-kind]');

let kind: ChoiceKind = 'trade';
let entries: MasterEntry[] = [];
let companies = new Map<string, string>(); // uid -> Name, für die Personen
let current = '';
let editing = false;
let formEntry: MasterEntry | null = null; // im Formular: null = neuer Eintrag
let onPick: ((picked: Picked) => void) | null = null;

// Jedes eingegebene Wort muss vorkommen, Groß/klein und Umlaute egal (search.ts).
// Personen werden auch über Firma und Funktion gefunden.
function searchText(entry: MasterEntry) {
  return normalize([entry.name, companyOf(entry), entry.role].filter(Boolean).join(' '));
}

function matches(text: string, query: string) {
  return searchWords(query).every((word) => text.includes(word));
}

function companyOf(entry: MasterEntry) {
  return entry.companyUid ? (companies.get(entry.companyUid) ?? '') : '';
}

// Das Suchfeld bekommt bewusst keinen Fokus: Die iPad-Tastatur würde die Kacheln verdecken.
// Mehrere Listen (z. B. Firmen und Personen für die Beteiligten): oben ein Umschalter, die erste gilt zuerst.
export async function openChoiceDialog(
  listKind: ChoiceKind | ChoiceKind[],
  value: string,
  pick: (picked: Picked) => void
): Promise<void> {
  const kinds = Array.isArray(listKind) ? listKind : [listKind];
  kindSwitch.hidden = kinds.length < 2;
  kindButtons.forEach((btn) => (btn.hidden = !kinds.includes(btn.dataset.kind as ChoiceKind)));
  current = value;
  onPick = pick;
  clearBtn.disabled = !value;
  dialog.hidden = false;
  await switchKind(kinds[0]);
}

async function switchKind(next: ChoiceKind) {
  kind = next;
  [entries, companies] = await Promise.all([store.listMaster(kind), store.companyNames()]);
  title.textContent = TEXT[kind].title;
  clearBtn.textContent = TEXT[kind].none;
  kindButtons.forEach((btn) => {
    const active = btn.dataset.kind === kind;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
  search.value = '';
  message.textContent = '';
  dialog.dataset.kind = kind;
  showForm(null, false);
  setEditing(false);
  grid.scrollTop = 0;
}

kindButtons.forEach((btn) => btn.addEventListener('click', () => switchKind(btn.dataset.kind as ChoiceKind)));

function close() {
  dialog.hidden = true;
  onPick = null;
}

function choose(entry: MasterEntry | null, name: string) {
  onPick?.({ kind, name, company: entry ? companyOf(entry) : '', role: entry?.role ?? '' });
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
  const visible = entries.filter((entry) => matches(searchText(entry), text));
  const items: HTMLElement[] = [];

  // Der Wert des Mangels fehlt in der Liste (z. B. gelöscht oder aus einem Backup): trotzdem zeigen
  const known = entries.some((entry) => entry.name === current);
  if (current && !known && !editing && matches(normalize(current), text)) items.push(createChoice(current, null));

  // Neuer Eintrag: nur, wenn es den Namen so noch nicht gibt (Groß/klein egal). Personen dürfen
  // gleich heißen, wenn sie in verschiedenen Firmen sind: Das klärt das Formular.
  const exists = entries.some((entry) => normalize(entry.name) === normalize(text));
  if (text && (!exists || kind === 'person') && !editing) items.push(createAddChoice(text));

  items.push(...visible.map((entry) => createChoice(entry.name, entry)));

  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'list-empty';
    empty.textContent = text ? TEXT[kind].empty : 'Die Liste ist leer. Oben eintippen, um etwas hinzuzufügen.';
    items.push(empty);
  }
  grid.replaceChildren(...items);
}

function createChoice(name: string, entry: MasterEntry | null) {
  const btn = document.createElement('button');
  btn.className = 'choice';
  const label = document.createElement('span');
  label.className = 'choice-name';
  label.textContent = name;
  btn.append(label);
  // Personen: Firma und Funktion klein darunter
  const sub = entry ? [companyOf(entry), entry.role].filter(Boolean).join(' · ') : '';
  if (sub) {
    const small = document.createElement('span');
    small.className = 'choice-sub';
    small.textContent = sub;
    btn.append(small);
  }
  const selected = name === current;
  btn.classList.toggle('selected', selected && !editing);
  btn.setAttribute('aria-pressed', String(selected));
  if (editing && entry) {
    btn.classList.add('editable');
    btn.setAttribute('aria-label', `${name} ändern oder löschen`);
    btn.addEventListener('click', () => showForm(entry, true));
  } else {
    btn.addEventListener('click', () => choose(entry, name));
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
    // Personen brauchen noch Firma und Funktion, alles andere wird gleich angelegt und gewählt
    if (kind === 'person') {
      showForm(null, true, text);
      return;
    }
    try {
      const entry = await store.addMaster(kind, text);
      choose(entry, entry.name);
    } catch (err) {
      console.error(err);
      message.textContent = 'Das ließ sich nicht speichern. Ist der Speicher voll?';
    }
  });
  return btn;
}

// ---------- Formular: neu anlegen (Personen) oder ändern/löschen (alle) ----------

function showForm(entry: MasterEntry | null, visible: boolean, name = '') {
  formEntry = entry;
  form.hidden = !visible;
  listView.hidden = visible;
  // Solange das Formular offen ist, gelten nur seine Knöpfe
  listButtons.hidden = visible;
  editBtn.hidden = visible;
  kindSwitch.classList.toggle('locked', visible);
  if (!visible) return;
  personFields.hidden = kind !== 'person';
  formName.value = entry?.name ?? name;
  formCompany.value = entry ? companyOf(entry) : '';
  formRole.value = entry?.role ?? '';
  formCompanies.replaceChildren(
    ...[...companies.values()].sort((a, b) => a.localeCompare(b, 'de')).map((company) => {
      const option = document.createElement('option');
      option.value = company;
      return option;
    })
  );
  formDelete.hidden = !entry;
  formSave.textContent = entry ? 'Speichern' : 'Hinzufügen und wählen';
  message.textContent = '';
}

async function saveForm() {
  const name = formName.value.trim();
  if (!name) {
    message.textContent = 'Bitte einen Namen eintragen.';
    return;
  }
  try {
    if (kind === 'person') {
      const company = formCompany.value.trim() ? await store.addMaster('company', formCompany.value.trim()) : null;
      const extra = { companyUid: company?.uid, role: formRole.value.trim() || undefined };
      if (formEntry) {
        await store.updateMaster(formEntry.uid, { name, ...extra });
      } else {
        const entry = await store.addMaster('person', name, extra);
        companies = await store.companyNames();
        choose(entry, entry.name);
        return;
      }
    } else if (formEntry) {
      await store.updateMaster(formEntry.uid, { name });
    }
    [entries, companies] = await Promise.all([store.listMaster(kind), store.companyNames()]);
    showForm(null, false);
    render();
  } catch (err) {
    console.error(err);
    message.textContent = 'Das ließ sich nicht speichern. Ist der Speicher voll?';
  }
}

async function deleteFormEntry() {
  const entry = formEntry!;
  if (!confirm(`„${entry.name}“ aus der Liste löschen? ${TEXT[kind].keep}`)) return;
  try {
    await store.deleteMaster(entry.uid);
    entries = entries.filter((e) => e !== entry);
    showForm(null, false);
    render();
  } catch (err) {
    console.error(err);
    message.textContent = 'Das ließ sich nicht löschen.';
  }
}

search.addEventListener('input', render);

// Enter übernimmt den einzigen Treffer oder legt den neuen Eintrag an
search.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || editing) return;
  const choices = [...grid.querySelectorAll<HTMLButtonElement>('.choice')];
  if (choices.length === 1) choices[0].click();
  else search.blur();
});

editBtn.addEventListener('click', () => setEditing(!editing));
clearBtn.addEventListener('click', () => choose(null, ''));
formSave.addEventListener('click', saveForm);
formDelete.addEventListener('click', deleteFormEntry);
document.getElementById('choice-form-cancel')!.addEventListener('click', () => showForm(null, false));
document.getElementById('choice-close')!.addEventListener('click', close);

// Tippen neben das Fenster schließt es, Escape auch
closeOnOutsideTap(dialog, close);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !dialog.hidden) close();
});
