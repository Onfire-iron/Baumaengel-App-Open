// =============================================================
// Fenster "Begehungen": Liste der Begehungen, eine Begehung mit ihren Teilnehmern bearbeiten
// =============================================================
//
// Erreichbar über das "…"-Menü im Projekt und über "Bericht erstellen". Nichts davon ist Pflicht,
// eine Begehung entsteht nur über "Neue Begehung". Alles wird sofort gespeichert.
// Damit es auf der Baustelle schnell geht, übernimmt eine neue Begehung das heutige Datum und die
// Teilnehmer der letzten Begehung. Beim Tippen schlägt die App Namen und Firmen aus allen
// bisherigen Begehungen vor, und zu einem bekannten Namen wird die Firma ergänzt.

import { openChoiceDialog } from './choice-dialog.ts';
import * as store from './db.ts';
import { formatDate, todayIso } from './defects.ts';
import { cleanParticipants, sortInspections } from './inspections.ts';
import { nameKey } from './master-entries.ts';
import { activeProfileName } from './profiles.ts';
import { setStatus } from './status.ts';
import type { Inspection, Participant, Project } from './types.ts';
import { closeOnOutsideTap } from './outside-tap.ts';

const dialog = document.getElementById('inspections-dialog') as HTMLElement;
const listView = document.getElementById('inspections-list-view') as HTMLElement;
const editView = document.getElementById('inspection-edit-view') as HTMLElement;
const box = dialog.querySelector('.dialog-box') as HTMLElement;
const list = document.getElementById('inspection-list') as HTMLElement;
const message = document.getElementById('inspections-message') as HTMLElement;
const dateInput = document.getElementById('inspection-date') as HTMLInputElement;
const participantList = document.getElementById('participant-list') as HTMLElement;
const nameSuggestions = document.getElementById('participant-names') as HTMLDataListElement;
const orgSuggestions = document.getElementById('participant-orgs') as HTMLDataListElement;

let current: {
  project: Project;
  inspections: Inspection[];
  editing: Inspection | null;
  onClose: (inspections: Inspection[]) => void;
} | null = null;

// Name -> Amt/Büro/Firma, aus allen Projekten. Gilt der Name mehrfach, zählt die jüngste Begehung.
let knownOrgs = new Map<string, string>();

export async function openInspectionsDialog(
  project: Project,
  onClose: (inspections: Inspection[]) => void = () => {}
): Promise<void> {
  const settings = await store.getReportSettings(project.id);
  current = { project, inspections: sortInspections([...(settings?.inspections ?? [])]), editing: null, onClose };
  await loadSuggestions();
  message.textContent = '';
  showList();
  dialog.hidden = false;
}

// Vorschläge beim Tippen: Personen und Firmen aus den Listen (Stammdaten) und aus allen Begehungen
async function loadSuggestions() {
  const all = [...(await store.getAllReportSettings()).values()].flatMap((s) => s.inspections ?? []);
  const [persons, companies] = await Promise.all([store.listMaster('person'), store.companyNames()]);
  knownOrgs = new Map();
  for (const person of persons) {
    const org = person.companyUid ? companies.get(person.companyUid) : '';
    if (org) knownOrgs.set(person.name, org);
  }
  for (const inspection of sortInspections(all)) {
    for (const { name, org } of inspection.participants) if (name && org) knownOrgs.set(name, org);
  }
  for (const person of persons) if (!knownOrgs.has(person.name)) knownOrgs.set(person.name, '');
  const orgs = new Set([
    ...companies.values(),
    ...all.flatMap((inspection) => inspection.participants.map((p) => p.org)).filter(Boolean),
  ]);
  nameSuggestions.replaceChildren(...[...knownOrgs.keys()].sort(byName).map((name) => option(name)));
  orgSuggestions.replaceChildren(...[...orgs].sort(byName).map((org) => option(org)));
}

function option(value: string) {
  const element = document.createElement('option');
  element.value = value;
  return element;
}

function byName(a: string, b: string) {
  return a.localeCompare(b, 'de');
}

function save() {
  const { project, inspections } = current!;
  store.saveInspections(project.id, inspections).catch((err) => {
    console.error(err);
    message.textContent = 'Die Begehungen konnten nicht gespeichert werden. Ist der Speicher voll?';
  });
}

// ---------- Liste ----------

function showList() {
  const { inspections } = current!;
  // Neueste oben, im Bericht ist es umgekehrt
  list.replaceChildren(
    ...[...inspections].reverse().map((inspection) => {
      const item = document.createElement('button');
      item.className = 'inspection-item';
      const date = document.createElement('strong');
      date.textContent = `${formatDate(inspection.date)} · ${inspection.participants.length} Teilnehmer`;
      const names = document.createElement('span');
      names.textContent = inspection.participants.map((p) => p.name || p.org).join(', ') || 'noch niemand eingetragen';
      item.append(date, names);
      item.addEventListener('click', () => showInspection(inspection));
      return item;
    })
  );
  editView.hidden = true;
  listView.hidden = false;
  box.scrollTop = 0;
}

// Gibt es für heute schon eine Begehung, geht es mit der weiter statt eine zweite anzulegen
function newInspection() {
  const { inspections } = current!;
  const today = todayIso();
  const existing = inspections.find((inspection) => inspection.date === today);
  if (existing) {
    showInspection(existing);
    return;
  }
  const last = inspections.at(-1);
  const profile = activeProfileName();
  const participants: Participant[] = last
    ? last.participants.map((p) => ({ ...p }))
    : profile
      ? [{ name: profile, org: knownOrgs.get(profile) ?? '' }]
      : [];
  if (!participants.length) participants.push({ name: '', org: '' });
  const inspection: Inspection = { date: today, participants };
  inspections.push(inspection);
  sortInspections(inspections);
  save();
  showInspection(inspection);
}

function closeDialog() {
  const { inspections, onClose } = current!;
  dialog.hidden = true;
  current = null;
  onClose(inspections);
}

// ---------- Eine Begehung ----------

function showInspection(inspection: Inspection) {
  current!.editing = inspection;
  dateInput.value = inspection.date;
  participantList.replaceChildren(...inspection.participants.map((p) => participantRow(inspection, p)));
  listView.hidden = true;
  editView.hidden = false;
  box.scrollTop = 0;
}

function participantRow(inspection: Inspection, participant: Participant) {
  const row = document.createElement('div');
  row.className = 'participant-row';
  const name = field(participant.name, 'participant-names', 'Name');
  const org = field(participant.org, 'participant-orgs', 'Amt / Büro / Firma');
  name.addEventListener('input', () => {
    participant.name = name.value;
    save();
  });
  // Bekannter Name (ausgewählt oder fertig getippt): Firma ergänzen, wenn sie noch fehlt
  name.addEventListener('change', () => {
    const known = knownOrgs.get(name.value.trim());
    if (known && !org.value.trim()) {
      org.value = participant.org = known;
      save();
    }
  });
  org.addEventListener('input', () => {
    participant.org = org.value;
    save();
  });
  // Aus der Personenliste wählen: Name und Firma auf einmal (choice-dialog.ts)
  const pick = document.createElement('button');
  pick.className = 'btn icon soft';
  pick.title = 'Aus der Liste wählen';
  pick.setAttribute('aria-label', 'Person aus der Liste wählen');
  pick.innerHTML =
    '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM3 20a6 6 0 0 1 12 0M17 8h4M17 12h4M17 16h3" /></svg>';
  pick.addEventListener('click', () => {
    openChoiceDialog('person', name.value.trim(), (picked) => {
      name.value = participant.name = picked.name;
      if (picked.company || !picked.name) org.value = participant.org = picked.company;
      save();
    }).catch((err) => {
      console.error(err);
      message.textContent = 'Die Personenliste konnte nicht geladen werden.';
    });
  });
  const remove = document.createElement('button');
  remove.className = 'btn icon soft';
  remove.textContent = '✕';
  remove.title = 'Teilnehmer entfernen';
  remove.setAttribute('aria-label', 'Teilnehmer entfernen');
  remove.addEventListener('click', () => {
    inspection.participants.splice(inspection.participants.indexOf(participant), 1);
    row.remove();
    save();
  });
  row.append(name, org, pick, remove);
  return row;
}

function field(value: string, suggestions: string, label: string) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'in';
  input.value = value;
  input.maxLength = 80;
  input.autocomplete = 'off';
  input.setAttribute('list', suggestions);
  input.setAttribute('aria-label', label);
  input.placeholder = label;
  return input;
}

// Neue Teilnehmer kommen in die Personenliste, damit sie beim nächsten Mal zur Auswahl stehen.
// Gibt es den Namen schon ohne Firma, bekommt er die Firma dazu, statt doppelt angelegt zu werden.
async function rememberPeople(participants: Participant[]) {
  const [persons, companies] = await Promise.all([store.listMaster('person'), store.companyNames()]);
  let added = 0;
  for (const { name, org } of participants) {
    if (!name.trim()) continue;
    const sameName = persons.filter((p) => nameKey(p.name) === nameKey(name));
    const companyOf = (uid?: string) => nameKey(uid ? (companies.get(uid) ?? '') : '');
    if (sameName.some((p) => companyOf(p.companyUid) === nameKey(org))) continue;
    const withoutCompany = sameName.find((p) => !p.companyUid);
    if (withoutCompany && org.trim()) {
      const company = await store.addMaster('company', org.trim());
      await store.updateMaster(withoutCompany.uid, { companyUid: company.uid });
      continue;
    }
    persons.push(await store.addPerson(name.trim(), org));
    added++;
  }
  if (added) setStatus(`${added === 1 ? 'Eine neue Person' : `${added} neue Personen`} in die Liste übernommen.`);
}

// Zurück zur Liste: leere Zeilen fallen weg, die Reihenfolge folgt dem Datum
function finishInspection() {
  const { editing, inspections } = current!;
  editing!.participants = cleanParticipants(editing!.participants);
  sortInspections(inspections);
  current!.editing = null;
  save();
  rememberPeople(editing!.participants)
    .then(() => loadSuggestions())
    .catch(console.error);
  showList();
}

dateInput.addEventListener('change', () => {
  const editing = current!.editing!;
  // Ohne Datum geht es nicht, dann bleibt das bisherige
  if (!dateInput.value) {
    dateInput.value = editing.date;
    return;
  }
  editing.date = dateInput.value;
  save();
});

document.getElementById('participant-add')!.addEventListener('click', () => {
  const editing = current!.editing!;
  const participant = { name: '', org: '' };
  editing.participants.push(participant);
  const row = participantRow(editing, participant);
  participantList.append(row);
  (row.firstElementChild as HTMLInputElement).focus();
});

document.getElementById('inspection-delete')!.addEventListener('click', () => {
  const { editing, inspections } = current!;
  if (!confirm(`Begehung vom ${formatDate(editing!.date)} löschen?`)) return;
  inspections.splice(inspections.indexOf(editing!), 1);
  current!.editing = null;
  save();
  showList();
});

document.getElementById('inspection-done')!.addEventListener('click', finishInspection);
document.getElementById('inspection-new')!.addEventListener('click', newInspection);
document.getElementById('inspections-close')!.addEventListener('click', closeDialog);
// Daneben tippen schließt das ganze Fenster, eine offene Begehung wird vorher wie mit "Fertig" abgeschlossen
closeOnOutsideTap(dialog, () => {
  if (current?.editing) finishInspection();
  closeDialog();
});
