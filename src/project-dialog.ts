// =============================================================
// Fenster "Neues Projekt" und "Projekt bearbeiten": Name, Adresse, Beteiligte und Bereich
// =============================================================
//
// Adresse und Beteiligte sind dieselben wie im Fenster "Bericht erstellen" (siehe createProject
// in db.ts). Pflicht ist nur der Name, denn bei einem Neubau kennt man manches noch nicht.

import * as store from './db.ts';
import { DIVISIONS, NO_DIVISION, activeDivision } from './divisions.ts';
import { createPartyFields } from './party-fields.ts';
import { PARTIES } from './parties.ts';
import type { Project } from './types.ts';
import { closeOnOutsideTap } from './outside-tap.ts';

interface Saved {
  id: number;
  name: string;
  address: string;
  division: string | null;
}

const dialog = document.getElementById('project-dialog') as HTMLElement;
const heading = document.getElementById('project-dialog-title') as HTMLElement;
const nameInput = document.getElementById('project-form-name') as HTMLInputElement;
const addressInput = document.getElementById('project-form-address') as HTMLTextAreaElement;
const divisionInput = document.getElementById('project-form-division') as HTMLSelectElement;
const partyInputs = createPartyFields(document.getElementById('project-form-parties')!, 'project-form');

// "" steht für ohne Bereich
divisionInput.replaceChildren(
  ...[{ id: '', name: NO_DIVISION }, ...DIVISIONS].map(({ id, name }) => {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = name;
    return option;
  })
);
const message = document.getElementById('project-dialog-message') as HTMLElement;
const saveBtn = document.getElementById('project-dialog-save') as HTMLButtonElement;

let editing: { project: Project | null; details: Required<store.ProjectDetails>; onSaved: (saved: Saved) => void } | null =
  null;

// Adresse und Beteiligte, wie sie gerade in den Feldern stehen
function readDetails(): Required<store.ProjectDetails> {
  const details = { address: addressInput.value.trim() } as Required<store.ProjectDetails>;
  for (const { key } of PARTIES) details[key] = partyInputs[key].value.trim();
  return details;
}

// project = null legt ein neues Projekt an, sonst wird dieses bearbeitet
export async function openProjectDialog(project: Project | null, onSaved: (saved: Saved) => void): Promise<void> {
  const settings = project ? await store.getReportSettings(project.id) : undefined;
  heading.textContent = project ? 'Projekt bearbeiten' : 'Neues Projekt';
  saveBtn.textContent = project ? 'Speichern' : 'Anlegen';
  nameInput.value = project?.name ?? '';
  addressInput.value = settings?.address ?? '';
  for (const { key } of PARTIES) partyInputs[key].value = settings?.[key] ?? '';
  // Zum Vergleich beim Speichern so, wie es in den Feldern ankommt (getrimmt)
  editing = { project, details: readDetails(), onSaved };
  // Ein neues Projekt kommt in den Bereich, der auf der Startseite gerade gewählt ist
  divisionInput.value = (project ? project.division : activeDivision()) ?? '';
  message.textContent = '';
  updateButton();
  initialState = currentState();
  dialog.hidden = false;
  if (!project) nameInput.focus();
}

// Alles, was im Fenster steht, zum Erkennen von Änderungen (siehe Tippen neben das Fenster)
let initialState = '';
function currentState() {
  return JSON.stringify([nameInput.value.trim(), divisionInput.value, readDetails()]);
}

function closeDialog() {
  dialog.hidden = true;
  editing = null;
}

function updateButton() {
  saveBtn.disabled = !nameInput.value.trim();
}

async function save() {
  const { project, onSaved } = editing!;
  const name = nameInput.value.trim();
  const details = readDetails();
  const division = divisionInput.value || null;
  if (!name) return;

  // Nichts geändert: Das Projekt soll dann auch nicht als "zuletzt geändert" nach oben rutschen
  const detailsChanged = Object.entries(details).some(
    ([key, value]) => value !== editing!.details[key as keyof typeof details]
  );
  if (project && name === project.name && !detailsChanged && division === (project.division ?? null)) {
    closeDialog();
    return;
  }

  saveBtn.disabled = true;
  try {
    const id = project ? project.id : await store.createProject(name, details, division);
    if (project) await store.saveProjectDetails(id, name, details, division);
    if (project) project.division = division;
    closeDialog();
    onSaved({ id, name, address: details.address, division });
  } catch (err) {
    console.error(err);
    message.textContent = 'Das Projekt konnte nicht gespeichert werden. Ist der Speicher voll?';
    updateButton();
  }
}

nameInput.addEventListener('input', updateButton);
// Return im Namen springt weiter zur Adresse
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addressInput.focus();
});
saveBtn.addEventListener('click', save);
document.getElementById('project-dialog-cancel')!.addEventListener('click', closeDialog);
// Daneben tippen schließt wie "Abbrechen". Wurde etwas eingetragen, erst nachfragen, damit es nicht
// durch einen Fehltipper verloren geht.
closeOnOutsideTap(dialog, () => {
  if (currentState() !== initialState && !confirm('Fenster schließen? Die Eingaben werden nicht gespeichert.')) return;
  closeDialog();
});
