// =============================================================
// Startseite: Liste der Projekte, Backup, Speicher-Anzeige
// =============================================================

import * as store from './db.ts';
import { backupReminder, exportAllProjects, exportProject, importBackup } from './backup.ts';
import type { BackupContents, ImportResult } from './backup.ts';
import { IMPORTANCE, IMPORTANCE_TEXT } from './defects.ts';
import { DIVISIONS, NO_DIVISION, activeDivision, assetUrl, divisionName, findDivision, setActiveDivision } from './divisions.ts';
import { bindMenu } from './menu.ts';
import { getPlanThumb } from './plan-thumb.ts';
import { openProjectDialog } from './project-dialog.ts';
import { googleMapsUrl } from './maps.ts';
import { PARTIES } from './parties.ts';
import { isNativeApp } from './native.ts';
import { normalize, searchWords } from './search.ts';
import { saveFile } from './share.ts';
import { setStatus } from './status.ts';
import type { ExportedBackup, Plan, Project, ProjectStats, ReportSettings } from './types.ts';

const homeView = document.getElementById('home-view') as HTMLElement;
const projectList = document.getElementById('project-list') as HTMLElement;
const newProjectBtn = document.getElementById('new-project-btn') as HTMLButtonElement;
const importBtn = document.getElementById('import-btn') as HTMLButtonElement;
const importInput = document.getElementById('import-input') as HTMLInputElement;
const backupReady = document.getElementById('backup-ready') as HTMLElement;
const backupReadyText = document.getElementById('backup-ready-text') as HTMLElement;
const backupSaveBtn = document.getElementById('backup-save-btn') as HTMLButtonElement;
const backupCloseBtn = document.getElementById('backup-close-btn') as HTMLButtonElement;
const backupAllBtn = document.getElementById('backup-all-btn') as HTMLButtonElement;
const appInfo = document.getElementById('app-info') as HTMLElement;
const homeTools = document.getElementById('home-tools') as HTMLElement;
const searchInput = document.getElementById('project-search-input') as HTMLInputElement;
const searchClear = document.getElementById('project-search-clear') as HTMLButtonElement;
const divisionBtn = document.getElementById('division-btn') as HTMLButtonElement;
const divisionLogo = document.getElementById('division-logo') as HTMLImageElement;
const divisionNone = document.getElementById('division-none') as HTMLElement;
const divisionMenu = document.getElementById('division-menu') as HTMLElement;
const divisionList = document.getElementById('division-list') as HTMLElement;

let readyBackup: ExportedBackup | null = null; // fertig erstelltes Backup, wartet auf den Fingertipp zum Sichern
let thumbUrls: string[] = []; // Adressen der gerade angezeigten Plan-Vorschauen
let thumbRun = 0; // Eine neue Liste beendet das Nachladen für die alte
let shownCards: { element: HTMLElement; searchText: string }[] = []; // für die Suche
let projectCount = 0; // alle Projekte, auch die anderer Bereiche ("Alle sichern" sichert alle)
const noMatch = createNoMatch();

bindMenu(document.getElementById('home-menu-btn')!, document.getElementById('home-menu')!);

// ---------- Bereich (Büro) wählen: Logo oben links ----------

// Vor bindMenu, damit das Menü beim Aufgehen den aktuellen Bereich markiert
divisionBtn.addEventListener('click', renderDivisionMenu);
bindMenu(divisionBtn, divisionMenu);

// Die Bereiche nur als Logo, "Ohne Bereich" als Text
function renderDivisionMenu() {
  const active = activeDivision();
  divisionList.replaceChildren(
    ...[...DIVISIONS, null].map((division) => {
      const item = document.createElement('button');
      item.className = 'menu-item division-item';
      item.setAttribute('aria-current', String((division?.id ?? null) === active));
      if (division) {
        const logo = document.createElement('img');
        logo.src = assetUrl(division.headerLogo);
        logo.alt = division.name;
        item.appendChild(logo);
      } else {
        item.textContent = NO_DIVISION;
      }
      item.addEventListener('click', () => chooseDivision(division?.id ?? null));
      return item;
    })
  );
}

function chooseDivision(id: string | null) {
  if (id === activeDivision()) return;
  setActiveDivision(id);
  searchInput.value = ''; // die Suche galt dem vorigen Bereich
  renderHome();
}

function showDivision() {
  const division = findDivision(activeDivision());
  divisionLogo.hidden = !division;
  divisionNone.hidden = Boolean(division);
  if (division) {
    divisionLogo.src = assetUrl(division.headerLogo);
    divisionLogo.alt = division.name;
  }
  divisionBtn.setAttribute('aria-label', `Bereich wählen, gewählt: ${divisionName(division?.id)}`);
}

export async function renderHome(): Promise<void> {
  const [projects, allSettings] = await Promise.all([store.listProjects(), store.getAllReportSettings()]);
  // Nur die Projekte des gewählten Bereichs. Unbekannte Bereiche zählen wie "ohne Bereich".
  const active = activeDivision();
  const inDivision = projects.filter((project) => (findDivision(project.division)?.id ?? null) === active);
  // Erst alles laden, dann tauschen: So flackert die Liste nicht
  const cards = await Promise.all(inDivision.map((project) => createCard(project, allSettings.get(project.id))));

  thumbUrls.forEach((url) => URL.revokeObjectURL(url));
  thumbUrls = [];
  shownCards = cards;
  projectCount = projects.length;
  showDivision();
  homeTools.hidden = projects.length === 0; // "Alle sichern" auch, wenn dieser Bereich leer ist
  searchInput.disabled = cards.length === 0;

  if (cards.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const symbol = document.createElement('img');
    symbol.src = `${import.meta.env.BASE_URL}favicon.svg`;
    symbol.alt = '';
    const heading = document.createElement('strong');
    const hint = document.createElement('p');
    if (projects.length === 0) {
      heading.textContent = 'Noch keine Projekte';
      hint.textContent = 'Lege ein neues Projekt an oder importiere ein Backup.';
    } else {
      // Es gibt Projekte, nur nicht in diesem Bereich
      heading.textContent = `Keine Projekte in „${divisionName(active)}“`;
      hint.textContent = 'Oben links auf das Logo tippen, um einen anderen Bereich zu wählen, oder hier ein neues Projekt anlegen.';
    }
    empty.append(symbol, heading, hint);
    projectList.replaceChildren(empty);
  } else {
    projectList.replaceChildren(...cards.map((card) => card.element), noMatch);
    applySearch(); // Eine Suche bleibt stehen, auch wenn die Liste neu aufgebaut wird
    fillThumbs(cards);
  }
  renderAppInfo();
}

// ---------- Suche ----------

// Jedes eingegebene Wort muss irgendwo vorkommen, die Reihenfolge ist egal
function applySearch() {
  const words = searchWords(searchInput.value);
  let found = 0;
  for (const card of shownCards) {
    card.element.hidden = !words.every((word) => card.searchText.includes(word));
    if (!card.element.hidden) found++;
  }
  noMatch.hidden = found > 0;
  searchClear.hidden = !searchInput.value;
}

function createNoMatch() {
  const element = document.createElement('div');
  element.className = 'empty-state';
  element.hidden = true;
  const heading = document.createElement('strong');
  heading.textContent = 'Kein Projekt gefunden';
  const hint = document.createElement('p');
  hint.textContent =
    'Durchsucht werden Projektname, Adresse, Beteiligte (z. B. Bauherrschaft) und Projektnummer, auch ein abweichender Projektname aus „Bericht erstellen“.';
  element.append(heading, hint);
  return element;
}

searchInput.addEventListener('input', applySearch);
searchClear.addEventListener('click', () => {
  searchInput.value = '';
  applySearch();
});

// ---------- Projektkarten ----------

// settings: Angaben für den Bericht, darin stehen Projektname, Adresse und Beteiligte für die Suche
async function createCard(project: Project, settings?: ReportSettings) {
  const stats = await store.getProjectStats(project.id);
  const { planCount, defectCount } = stats;
  const plans = await store.listPlans(project.id);
  const plan = plans.find((p) => p.id === project.lastPlanId) ?? plans[0];

  const card = document.createElement('article');
  card.className = 'project-card';

  const open = document.createElement('a');
  open.className = 'project-open';
  open.href = `#/projekt/${project.id}`;

  const thumb = document.createElement('span');
  thumb.className = 'project-thumb';
  thumb.innerHTML =
    '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v16H4zM4 12h7M11 4v10M15 20v-8h5" /></svg>';

  const text = document.createElement('span');
  text.className = 'project-text';

  const name = document.createElement('span');
  name.className = 'project-name';
  name.textContent = project.name;

  const details = document.createElement('span');
  details.className = 'project-meta';
  details.textContent =
    `${new Date(project.updatedAt).toLocaleDateString('de-DE')} · ` +
    `${planCount} ${planCount === 1 ? 'Plan' : 'Pläne'} · ` +
    `${defectCount} ${defectCount === 1 ? 'Mangel' : 'Mängel'}`;
  text.append(name, details);
  if (defectCount > 0) text.append(createLevelBar(stats), createLevelCounts(stats));

  const reminder = backupReminder(project);
  if (reminder) {
    const hint = document.createElement('span');
    hint.className = 'project-reminder';
    hint.textContent = `Backup empfohlen: ${reminder}`;
    text.appendChild(hint);
  }

  open.append(thumb, text);

  const more = document.createElement('div');
  more.className = 'project-more glass';
  const moreBtn = document.createElement('button');
  moreBtn.className = 'btn icon';
  moreBtn.setAttribute('aria-label', `Aktionen für ${project.name}`);
  moreBtn.setAttribute('aria-haspopup', 'true');
  moreBtn.setAttribute('aria-expanded', 'false');
  moreBtn.innerHTML =
    '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h.01M12 12h.01M19 12h.01" /></svg>';
  more.appendChild(moreBtn);

  const menu = document.createElement('div');
  menu.className = 'menu glass-thick';
  menu.hidden = true;
  menu.append(menuItem('Bearbeiten', () => editProject(project)));
  const mapsUrl = googleMapsUrl(settings?.address);
  if (mapsUrl) menu.append(menuLink('In Google Maps', mapsUrl));
  menu.append(
    menuItem('Backup', () => backupProject(project)),
    menuItem('Löschen', () => deleteProject(project, planCount, defectCount), 'danger')
  );
  bindMenu(moreBtn, menu);

  card.append(open, more, menu);
  const parties = PARTIES.map(({ key }) => settings?.[key]);
  const searchText = normalize([project.name, settings?.name, settings?.address, ...parties].filter(Boolean).join(' '));
  return { element: card, plan, thumb, searchText };
}

function createLevelBar({ open, doneCount }: ProjectStats) {
  const bar = document.createElement('span');
  bar.className = 'level-bar';
  bar.setAttribute('aria-hidden', 'true');
  for (const level of IMPORTANCE) {
    if (open[level] > 0) bar.appendChild(barPart(level, open[level]));
  }
  if (doneCount > 0) bar.appendChild(barPart('done', doneCount));
  return bar;
}

function barPart(className: string, count: number) {
  const part = document.createElement('span');
  part.className = className;
  part.style.flex = String(count);
  return part;
}

function createLevelCounts({ open, doneCount }: ProjectStats) {
  const counts = document.createElement('span');
  counts.className = 'level-counts';
  for (const level of IMPORTANCE) {
    if (open[level] === 0) continue;
    const count = document.createElement('span');
    count.className = level;
    const symbol = document.createElement('span');
    symbol.className = 'sw';
    count.append(symbol, `${open[level]} ${IMPORTANCE_TEXT[level]}`);
    counts.appendChild(count);
  }
  if (doneCount > 0) {
    const done = document.createElement('span');
    done.textContent = `${doneCount} erledigt`;
    counts.appendChild(done);
  }
  return counts;
}

// Ein Link statt eines Knopfs: Den öffnet der Browser ohne Rückfrage, auch auf dem iPad
function menuLink(text: string, href: string) {
  const link = document.createElement('a');
  link.className = 'menu-item';
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = text;
  return link;
}

function menuItem(text: string, onClick: () => void, extraClass: string = '') {
  const button = document.createElement('button');
  button.className = `menu-item ${extraClass}`;
  button.textContent = text;
  button.addEventListener('click', onClick);
  return button;
}

// Lädt die Plan-Vorschauen nacheinander, damit dem iPad nicht der Arbeitsspeicher ausgeht.
// Fehlt eine, bleibt einfach das Symbol stehen.
async function fillThumbs(cards: { plan?: Plan; thumb: HTMLElement }[]) {
  const run = ++thumbRun;
  for (const { plan, thumb } of cards) {
    if (!plan) continue;
    if (run !== thumbRun || homeView.hidden) return;
    try {
      const data = await getPlanThumb(plan);
      if (run !== thumbRun) return;
      const url = URL.createObjectURL(new Blob([data], { type: 'image/jpeg' }));
      thumbUrls.push(url);
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      thumb.replaceChildren(img);
    } catch (err) {
      console.error(err);
    }
  }
}

newProjectBtn.addEventListener('click', () => {
  openProjectDialog(null, ({ id, division }) => {
    // In einem anderen Bereich angelegt: dorthin wechseln, sonst fehlte es beim Zurückkommen
    if (division !== activeDivision()) setActiveDivision(division);
    location.hash = `#/projekt/${id}`;
  }).catch((err) => {
    console.error(err);
    setStatus('Das Fenster „Neues Projekt“ konnte nicht geöffnet werden.');
  });
});

function editProject(project: Project) {
  openProjectDialog(project, async ({ name, division }) => {
    await renderHome();
    if (division !== activeDivision()) setStatus(`Projekt „${name}“ ist jetzt unter „${divisionName(division)}“.`);
  }).catch((err) => {
    console.error(err);
    setStatus('Die Angaben zum Projekt konnten nicht geladen werden.');
  });
}

async function deleteProject(project: Project, planCount: number, defectCount: number) {
  const question =
    `Projekt „${project.name}“ mit ${planCount} Plänen und ${defectCount} Mängeln ` +
    'inklusive aller Fotos endgültig löschen? Das lässt sich nicht rückgängig machen.';
  if (!confirm(question)) return;
  await store.deleteProject(project.id);
  await renderHome();
  setStatus('Projekt gelöscht.');
}

// ---------- Backup ----------

// Zwei Schritte: Das Erstellen kann dauern, und das iPad erlaubt "Teilen" nur
// direkt nach einem Fingertipp. Deshalb erst erstellen, dann "Datei sichern" antippen.
function backupProject(project: Project) {
  return prepareBackup(() => exportProject(project.id, setStatus), `Backup von „${project.name}“`);
}

// Alle Projekte in einer Datei. Lässt sich auf einem anderen Gerät über "Backup importieren" einlesen.
backupAllBtn.addEventListener('click', () => {
  const count = projectCount; // alle Bereiche, nicht nur die angezeigten
  const label = `Sammelbackup mit ${count === 1 ? 'einem Projekt' : `${count} Projekten`}`;
  prepareBackup(() => exportAllProjects(setStatus), label);
});

let preparing = false; // zwei Backups gleichzeitig würden den Speicher des iPads doppelt belasten

async function prepareBackup(create: () => Promise<ExportedBackup>, label: string) {
  if (preparing) return;
  preparing = true;
  backupAllBtn.disabled = true;
  readyBackup = null;
  backupReady.hidden = true;
  try {
    setStatus('Backup wird erstellt …');
    readyBackup = await create();
    const megabytes = (readyBackup.blob.size / 1024 / 1024).toFixed(1).replace('.', ',');
    backupReadyText.textContent = `${label} ist fertig (${megabytes} MB).`;
    backupReady.hidden = false;
    setStatus('Backup fertig. Jetzt „Datei sichern“ antippen.');
  } catch (err) {
    console.error(err);
    setStatus('Das Backup konnte nicht erstellt werden.');
  } finally {
    preparing = false;
    backupAllBtn.disabled = false;
  }
}

backupSaveBtn.addEventListener('click', async () => {
  try {
    const savedAt = await saveFile(readyBackup!);
    for (const { projectId, mark } of readyBackup!.marks) await store.updateProject(projectId, mark);
    await renderHome();
    setStatus(savedAt ? `Backup gespeichert unter ${savedAt}` : 'Backup wurde übergeben.');
  } catch (err) {
    if ((err as Error).name === 'AbortError') return; // Teilen-Fenster wurde einfach geschlossen
    console.error(err);
    setStatus('Das Backup konnte nicht gesichert werden.');
  }
});

backupCloseBtn.addEventListener('click', () => {
  readyBackup = null;
  backupReady.hidden = true;
});

importBtn.addEventListener('click', () => importInput.click());

importInput.addEventListener('change', async () => {
  const file = importInput.files![0];
  importInput.value = '';
  if (!file) return;

  try {
    setStatus('Backup wird eingelesen …');
    const existing = (await store.listProjects()).map((project) => project.name);
    const result = await importBackup(file, setStatus, (contents) => confirmImport(contents, existing));
    if (!result) {
      setStatus('');
      return;
    }
    await renderHome();
    setStatus(importMessage(result));
  } catch (err) {
    console.error(err);
    await renderHome(); // im Sammelbackup sind vor dem Fehler vielleicht schon Projekte angekommen
    setStatus(`Import fehlgeschlagen: ${(err as Error).message}`);
  }
});

// Ein einzelnes Backup wird wie bisher ohne Rückfrage eingelesen. Beim Sammelbackup kommen
// viele Projekte auf einmal, darum vorher sagen, was passiert.
function confirmImport(contents: BackupContents, existing: string[]) {
  if (!contents.collection) return true;
  const count = contents.projects.length;
  const twice = contents.projects.filter((project) => existing.includes(project.name)).length;
  const lines = [
    `Sammelbackup mit ${count === 1 ? 'einem Projekt' : `${count} Projekten`} einlesen?`,
    'Jedes Projekt wird neu angelegt. Vorhandene Projekte bleiben unverändert.',
  ];
  if (twice > 0) {
    lines.push(
      `${twice === 1 ? 'Ein Projekt gibt' : `${twice} Projekte gibt`} es hier schon. ` +
        `Sie kommen als Kopie mit dem Zusatz „(Import ${new Date().toLocaleDateString('de-DE')})“ dazu.`
    );
  }
  return confirm(lines.join('\n\n'));
}

function importMessage(result: ImportResult) {
  const total = result.imported + result.failed.length;
  if (total === 1 && result.imported === 1) return 'Backup wurde als neues Projekt importiert.';
  const parts = [`${result.imported} von ${total} Projekten importiert.`];
  for (const { name, message } of result.failed) parts.push(`„${name}“: ${message}`);
  return parts.join(' ');
}

// ---------- Anzeige: Speicher und Offline-Bereitschaft ----------

// Sobald der Service Worker fertig ist, die Anzeige von selbst auf "Offline bereit" umstellen.
// Gibt es nach 20 Sekunden noch nicht einmal eine Registrierung, stimmt etwas nicht (WLAN-Test:
// Zertifikat nicht vertraut).
let offlineWaiting = false;
let offlineCheckTimedOut = false;

function waitForOffline() {
  if (offlineWaiting) return;
  offlineWaiting = true;
  navigator.serviceWorker.ready.then(() => renderAppInfo());
  setTimeout(() => {
    offlineCheckTimedOut = true;
    renderAppInfo();
  }, 20_000);
}

async function renderAppInfo() {
  const parts = [];
  let warn = false;

  if (isNativeApp) {
    // Android-App: Alle Dateien stecken in der App selbst, ein Service Worker ist nicht nötig
    parts.push('Android-App, offline bereit');
  } else if (!('serviceWorker' in navigator)) {
    parts.push('Offline nicht möglich, die App läuft nicht über HTTPS');
    warn = true;
  } else {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration?.active) parts.push('Offline bereit');
    else if (import.meta.env.DEV) parts.push('Offline im Entwicklungsmodus abgeschaltet');
    else if (registration || !offlineCheckTimedOut) {
      // Beim ersten Öffnen lädt der Service Worker alle Dateien nacheinander, das dauert etwa eine Minute
      parts.push('Offline wird eingerichtet (beim ersten Öffnen etwa 1 Minute) …');
      waitForOffline();
    } else {
      // Nach einer Weile immer noch keine Registrierung: Der Service Worker wurde abgelehnt
      parts.push('Offline noch nicht bereit, stimmt das Zertifikat?');
      warn = true;
    }
  }

  if (navigator.storage?.estimate) {
    const { usage = 0 } = await navigator.storage.estimate();
    const persisted = await navigator.storage.persisted?.();
    parts.push(`${Math.round(usage / 1024 / 1024)} MB belegt`);
    // In der Android-App liegen die Daten im eigenen Bereich der App, Android räumt dort nicht auf
    if (persisted || isNativeApp) parts.push(isNativeApp ? 'im Speicher der App' : 'vor Löschen geschützt');
    else {
      parts.push('nicht vor Löschen geschützt, mach regelmäßig Backups');
      warn = true;
    }
  }

  appInfo.textContent = parts.join(' · ');
  appInfo.classList.toggle('warn', warn);
}

// Aktualisiert die Anzeige, sobald der Service Worker fertig ist
navigator.serviceWorker?.ready.then(renderAppInfo);
