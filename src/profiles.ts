// =============================================================
// Profile: Wer gerade mit dem Gerät arbeitet. Gilt nur auf diesem Gerät.
// =============================================================
//
// Neue Mängel bekommen den Namen des gewählten Profils (createdBy). Ein Passwort gibt es
// bewusst nicht: Ohne Server könnte es nichts schützen. Welches Profil gewählt ist, merkt
// sich das Gerät wie die Darstellung im Browser-Speicher, die Profile selbst liegen in der Datenbank.

import * as store from './db.ts';
import { setStatus } from './status.ts';
import type { Profile } from './types.ts';

const KEY = 'baumaengel-profile';

const dialog = document.getElementById('profile-dialog') as HTMLElement;
const hint = document.getElementById('profile-hint') as HTMLElement;
const list = document.getElementById('profile-list') as HTMLElement;
const input = document.getElementById('profile-input') as HTMLInputElement;
const addBtn = document.getElementById('profile-add') as HTMLButtonElement;
const message = document.getElementById('profile-message') as HTMLElement;
const homeBtn = document.getElementById('profile-btn') as HTMLButtonElement;
const homeLabel = document.getElementById('profile-label') as HTMLElement;
const projectBtn = document.getElementById('profile-switch-btn') as HTMLButtonElement;

let profiles: Profile[] = [];
let active: Profile | null = null;

// Name für neue Mängel, null = kein Profil gewählt
export function activeProfileName(): string | null {
  return active?.name ?? null;
}

// Liest beim Start das zuletzt gewählte Profil. Liefert false, wenn keins gewählt ist.
export async function loadActiveProfile(): Promise<boolean> {
  const id = Number(readSaved());
  active = (id && (await store.getProfile(id))) || null;
  showActive();
  return active !== null;
}

// Mit firstStart erklärt das Fenster, wozu die Profile da sind
export async function openProfiles(firstStart: boolean = false): Promise<void> {
  hint.textContent = firstStart
    ? 'Neue Mängel bekommen den Namen des gewählten Profils. So sieht man später, wer sie erfasst hat. Die Profile gelten nur auf diesem Gerät.'
    : 'Neue Mängel bekommen den Namen des gewählten Profils. Wird das Gerät weitergegeben, hier wechseln.';
  input.value = '';
  message.textContent = '';
  profiles = await store.listProfiles();
  render();
  dialog.hidden = false;
}

function closeDialog() {
  dialog.hidden = true;
}

function render() {
  addBtn.disabled = !input.value.trim();
  if (profiles.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'list-empty';
    empty.textContent = 'Noch keine Profile. Leg unten dein eigenes an.';
    list.replaceChildren(empty);
    return;
  }
  list.replaceChildren(...profiles.map(createItem));
}

function createItem(profile: Profile) {
  const item = document.createElement('div');
  item.className = 'text-block';

  const isActive = profile.id === active?.id;
  const pick = document.createElement('button');
  pick.className = 'text-block-pick profile-pick' + (isActive ? ' active' : '');
  pick.textContent = profile.name;
  pick.setAttribute('aria-pressed', String(isActive));
  pick.addEventListener('click', () => {
    choose(profile);
    closeDialog();
    setStatus(`Profil „${profile.name}“ gewählt.`);
  });

  const del = document.createElement('button');
  del.className = 'btn icon danger';
  del.textContent = '×';
  del.setAttribute('aria-label', `Profil „${profile.name}“ löschen`);
  del.addEventListener('click', () => removeProfile(profile));

  item.append(pick, del);
  return item;
}

function choose(profile: Profile | null) {
  active = profile;
  try {
    if (profile) localStorage.setItem(KEY, String(profile.id));
    else localStorage.removeItem(KEY);
  } catch {
    // Ohne Speicher (privater Modus) gilt die Wahl eben nur bis zum Schließen
  }
  showActive();
}

function readSaved() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

// Auf dem Telefon ist der Name ausgeblendet, darum steht er auch in aria-label
function showActive() {
  const text = active ? `Profil: ${active.name}` : 'Profil wählen';
  homeLabel.textContent = active?.name ?? 'Profil wählen';
  homeBtn.setAttribute('aria-label', text);
  projectBtn.textContent = text;
}

async function removeProfile(profile: Profile) {
  const question = `Profil „${profile.name}“ löschen? Mängel, die damit erfasst wurden, behalten den Namen.`;
  if (!confirm(question)) return;
  try {
    await store.deleteProfile(profile.id);
    profiles = profiles.filter((p) => p !== profile);
    if (profile.id === active?.id) choose(null);
    render();
  } catch (err) {
    console.error(err);
    message.textContent = 'Das Profil konnte nicht gelöscht werden.';
  }
}

async function addProfile() {
  const name = input.value.trim();
  if (!name) return;
  // Gleiche Namen wären in den Mängeln nicht zu unterscheiden
  const existing = profiles.find((p) => p.name.toLowerCase() === name.toLowerCase());
  try {
    const profile = existing ?? { id: await store.addProfile(name), name };
    choose(profile);
    closeDialog();
    setStatus(existing ? `Profil „${existing.name}“ gibt es schon und ist jetzt gewählt.` : `Profil „${name}“ angelegt und gewählt.`);
  } catch (err) {
    console.error(err);
    message.textContent = 'Das Profil konnte nicht gespeichert werden. Ist der Speicher voll?';
  }
}

input.addEventListener('input', render);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addProfile();
});
addBtn.addEventListener('click', addProfile);
document.getElementById('profile-close')!.addEventListener('click', closeDialog);

function showProfiles() {
  openProfiles().catch((err) => {
    console.error(err);
    setStatus('Die Profile konnten nicht geladen werden.');
  });
}

homeBtn.addEventListener('click', showProfiles);
projectBtn.addEventListener('click', showProfiles);
