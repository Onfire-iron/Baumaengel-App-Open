// =============================================================
// Baumängel-App – Etappe 4: PDF-Bericht
// =============================================================

import '@fontsource-variable/inter/wght.css';
import './style.css';
import './theme.ts';
import * as store from './db.ts';
import { backupReminder } from './backup.ts';
import {
  DEFAULT_IMPORTANCE,
  IMPORTANCE,
  IMPORTANCE_PLURAL,
  IMPORTANCE_TEXT,
  formatDate,
  isOverdue,
  sortPins,
  todayIso,
} from './defects.ts';
import { renderHome } from './home.ts';
import { bindMenu } from './menu.ts';
import { openPdf } from './pdf.ts';
import { googleMapsUrl } from './maps.ts';
import { isNativeApp, onRestoredPhoto, openLinksWithAndroid, takeNativePhoto } from './native.ts';
import type { PhotoTarget } from './native.ts';
import { openInspectionsDialog } from './inspections-dialog.ts';
import { openPhotoEditor } from './photo-editor.ts';
import { openCamera, useOwnCamera } from './camera.ts';
import { shrinkPhoto } from './photos.ts';
import { activeProfileName, loadActiveProfile, openProfiles } from './profiles.ts';
import { openProjectDialog } from './project-dialog.ts';
import { openReportDialog } from './report-dialog.ts';
import { normalize, searchWords } from './search.ts';
import { setStatus } from './status.ts';
import { openTextBlocks } from './text-blocks.ts';
import { openChoiceDialog } from './choice-dialog.ts';
import { initDateTile, showDate } from './date-tile.ts';
import {
  clearHistory,
  endMerge,
  nextRedo,
  nextUndo,
  onHistoryChange,
  record,
  redo,
  snapshot,
  undo,
} from './history.ts';
import type { PinState, Step } from './history.ts';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { Defect, Importance, Photo, Plan, Project } from './types.ts';

interface Point {
  x: number;
  y: number;
}

// Was der Finger gerade tut. Am Feld "type" erkennt TypeScript, welche Angaben es dazu gibt.
interface DragPinGesture {
  type: 'drag-pin';
  id: number;
  startX: number;
  startY: number;
  grabX: number;
  grabY: number;
  moved: boolean;
}

type Gesture =
  | DragPinGesture
  | {
      type: 'pan';
      pinId: number | null; // gesperrter Punkt, auf dem der Finger aufgesetzt hat
      startX: number;
      startY: number;
      startOffsetX: number;
      startOffsetY: number;
      moved: boolean;
    }
  | { type: 'pinch'; lastDist: number; lastMid: Point }
  | { type: 'idle' };

// Abschnitte der Mängelliste: je Wichtigkeit, dazu die erledigten Mängel
type ListGroup = Importance | 'done';

// ---------- Elemente aus der Seite holen ----------
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const openBtn = document.getElementById('open-btn') as HTMLButtonElement;
const modeBtn = document.getElementById('mode-btn') as HTMLButtonElement;
const deleteBtn = document.getElementById('delete-btn') as HTMLButtonElement;
const zoomInBtn = document.getElementById('zoom-in') as HTMLButtonElement;
const zoomOutBtn = document.getElementById('zoom-out') as HTMLButtonElement;
const fitBtn = document.getElementById('fit-btn') as HTMLButtonElement;
const viewport = document.getElementById('viewport') as HTMLElement;
const stage = document.getElementById('stage') as HTMLElement;
const canvas = document.getElementById('pdf-canvas') as HTMLCanvasElement;
const pinLayer = document.getElementById('pin-layer') as HTMLElement;
const emptyHint = document.getElementById('empty-hint') as HTMLElement;
const listBtn = document.getElementById('list-btn') as HTMLButtonElement;
const listCount = document.getElementById('list-count') as HTMLElement;
const defectList = document.getElementById('defect-list') as HTMLElement;
const defectListBody = document.getElementById('defect-list-body') as HTMLElement;
const listSearch = document.getElementById('list-search') as HTMLElement;
const listSearchInput = document.getElementById('list-search-input') as HTMLInputElement;
const listSearchClear = document.getElementById('list-search-clear') as HTMLButtonElement;
const panel = document.getElementById('panel') as HTMLElement;
const panelBody = document.getElementById('panel-body') as HTMLElement;
const panelBadge = document.getElementById('panel-badge') as HTMLElement;
const panelLate = document.getElementById('panel-late') as HTMLElement;
const panelHeading = document.getElementById('panel-heading') as HTMLElement;
const panelClose = document.getElementById('panel-close') as HTMLButtonElement;
const titleInput = document.getElementById('pin-title') as HTMLInputElement;
const notesInput = document.getElementById('pin-notes') as HTMLTextAreaElement;
const textBlocksBtn = document.getElementById('text-blocks-btn') as HTMLButtonElement;
const tradeBtn = document.getElementById('pin-trade-btn') as HTMLButtonElement;
const tradeText = document.getElementById('pin-trade') as HTMLElement;
const companyBtn = document.getElementById('pin-company-btn') as HTMLButtonElement;
const companyText = document.getElementById('pin-company') as HTMLElement;
const foundInput = document.getElementById('pin-found') as HTMLInputElement;
const dueInput = document.getElementById('pin-due') as HTMLInputElement;
const createdByRow = document.getElementById('created-by-row') as HTMLElement;
const dueTile = dueInput.closest('.date-tile') as HTMLElement;
const createdByText = document.getElementById('pin-created-by') as HTMLElement;
const doneDateField = document.getElementById('done-date-field') as HTMLElement;
const doneAtInput = document.getElementById('pin-done-at') as HTMLInputElement;
const importanceBtns = document.querySelectorAll<HTMLButtonElement>('.importance-buttons .seg-btn');
const doneBtn = document.getElementById('done-btn') as HTMLButtonElement;
const moveBtn = document.getElementById('move-btn') as HTMLButtonElement;
const moveHint = document.getElementById('move-hint') as HTMLElement;
const photoCameraBtn = document.getElementById('photo-camera-btn') as HTMLButtonElement;
const photoGalleryBtn = document.getElementById('photo-gallery-btn') as HTMLButtonElement;
const photoCamera = document.getElementById('photo-camera') as HTMLInputElement;
const photoGallery = document.getElementById('photo-gallery') as HTMLInputElement;
const photoGrid = document.getElementById('photo-grid') as HTMLElement;
const homeView = document.getElementById('home-view') as HTMLElement;
const projectView = document.getElementById('project-view') as HTMLElement;
const homeBtn = document.getElementById('home-btn') as HTMLButtonElement;
const projectName = document.getElementById('project-name') as HTMLElement;
const planBtn = document.getElementById('plan-btn') as HTMLButtonElement;
const planNameEl = document.getElementById('plan-name') as HTMLElement;
const planMenu = document.getElementById('plan-menu') as HTMLElement;
const planMenuLabel = document.getElementById('plan-menu-label') as HTMLElement;
const planMenuList = document.getElementById('plan-menu-list') as HTMLElement;
const planMenuAdd = document.getElementById('plan-menu-add') as HTMLButtonElement;
const planOrderBtn = document.getElementById('plan-order-btn') as HTMLButtonElement;
const planReplaceBtn = document.getElementById('plan-replace-btn') as HTMLButtonElement;
const planReplaceInput = document.getElementById('plan-replace-input') as HTMLInputElement;
const planDeleteBtn = document.getElementById('plan-delete-btn') as HTMLButtonElement;
const backupReminderBar = document.getElementById('backup-reminder') as HTMLElement;
const backupReminderText = document.getElementById('backup-reminder-text') as HTMLElement;
const pageControls = document.getElementById('page-controls') as HTMLElement;
const pagePrev = document.getElementById('page-prev') as HTMLButtonElement;
const pageNext = document.getElementById('page-next') as HTMLButtonElement;
const pageSelect = document.getElementById('page-select') as HTMLSelectElement;
const reportBtn = document.getElementById('report-btn') as HTMLButtonElement;
const homeDot = document.getElementById('home-dot') as HTMLElement;
const modeLabel = document.getElementById('mode-label') as HTMLElement;
const placeHint = document.getElementById('place-hint') as HTMLElement;
const filterBtns = document.querySelectorAll<HTMLElement>('#plan-filter [data-level]');
const filterHideDoneBtn = document.getElementById('filter-hide-done') as HTMLButtonElement;
const capture = document.getElementById('capture') as HTMLElement;
const captureBadge = document.getElementById('capture-badge') as HTMLElement;
const captureTitle = document.getElementById('capture-title') as HTMLInputElement;
const capturePhotos = document.getElementById('capture-photos') as HTMLElement;
const undoBtn = document.getElementById('undo-btn') as HTMLButtonElement;
const redoBtn = document.getElementById('redo-btn') as HTMLButtonElement;
const duplicateBtn = document.getElementById('duplicate-btn') as HTMLButtonElement;
const PLACE_HINT = placeHint.textContent;

// ---------- Zustand der App ----------
let currentProject: Project | null = null;
let plans: Plan[] = []; // alle Pläne des Projekts (ohne die PDF-Daten)
let currentPlan: Plan | null = null; // der angezeigte Plan
let currentPage = 1; // die angezeigte Seite, beginnt bei 1
let currentPdf: PDFDocumentProxy | null = null; // das aktuell geöffnete PDF
let loadedPlanId: number | null = null; // zu welchem Plan currentPdf gehört
let viewQueue: Promise<void> = Promise.resolve(); // Plan-Wechsel laufen nacheinander, siehe showPlanPage
let viewRequest = 0;
let pageWidth = 0; // Breite des Plans (in PDF-Einheiten)
let pageHeight = 0;
let scale = 1; // aktueller Zoom
let offsetX = 0; // Verschiebung des Plans
let offsetY = 0;
let placing = false; // Ist der Modus "Punkt setzen" aktiv?
// Alle Punkte des Projekts, siehe Defect in types.ts.
// Die Nummer gilt im ganzen Projekt, über alle Pläne hinweg.
let pins: Defect[] = [];
let selectedId: number | null = null;
// Sperre: Punkte lassen sich nur ziehen, wenn sie im Bearbeitungsfenster freigegeben wurden.
// Die Freigabe gilt für einen einzigen Punkt und endet, sobald er nicht mehr ausgewählt ist.
// Sie wird nicht gespeichert, nach dem Neuladen ist also wieder alles gesperrt.
let movableId: number | null = null;
let duplicateSource: Defect | null = null; // "Duplizieren": Vorlage für den nächsten gesetzten Punkt
let dragBefore: PinState | null = null; // Stand vor dem Ziehen, für Rückgängig
let lockHintShown = false; // Hinweis auf die Sperre nur einmal pro Sitzung zeigen
let thumbUrls: string[] = []; // Adressen der gerade angezeigten Foto-Miniaturen
let listLevel: Importance | null = null; // Filter für Liste und Plan: nur diese Wichtigkeit, null = alle
let listHideDone = false; // Filter für Liste und Plan: Erledigte ausblenden
let reminderClosed = false; // Backup-Erinnerung für dieses Öffnen des Projekts weggetippt

const MIN_SCALE = 0.1;
const MAX_SCALE = 10;

// So viel Platz nehmen die schwebenden Leisten auf dem Plan ein
const BAR_TOP = 78;
const BAR_BOTTOM = 88;
const PLAN_MARGIN = 16;

const narrow = window.matchMedia('(max-width: 699px)'); // Blätter unten statt seitlich

// =============================================================
// Ansichten: Startseite oder Projekt, je nach Adresse (#/projekt/3)
// =============================================================

async function route() {
  try {
    const match = location.hash.match(/^#\/projekt\/(\d+)$/);
    if (match) await openProject(Number(match[1]));
    else await showHome();
  } catch (err) {
    console.error(err);
    setStatus('Die gespeicherten Daten konnten nicht geladen werden. Es wurde nichts gelöscht.');
  }
}

window.addEventListener('hashchange', route);
homeBtn.addEventListener('click', () => (location.hash = '#/'));

async function showHome() {
  leaveProject();
  projectView.hidden = true;
  homeView.hidden = false;
  setStatus('');
  await renderHome();
}

async function openProject(id: number) {
  const project = await store.getProject(id);
  if (!project || project.importing) {
    location.hash = '#/';
    return;
  }

  leaveProject();
  homeView.hidden = true;
  projectView.hidden = false;
  currentProject = project;
  projectName.textContent = project.name;
  plans = await store.listPlans(id);
  pins = await store.listPins(id);
  listSearchInput.value = ''; // eine Suche aus dem vorigen Projekt passt hier nicht
  listSearchClear.hidden = true;
  renderList();
  showBackupReminder(project);
  showMapsLink(null); // bis die Adresse geladen ist, kein Link aus dem vorigen Projekt
  refreshMapsLink();

  const plan = plans.find((p) => p.id === project.lastPlanId) ?? plans[0];
  if (plan) await showPlanPage(plan, project.lastPage ?? 1);
  else showNoPlan();

  // Nach einem Neustart durch Android: den Mangel mit dem nachgereichten Foto öffnen
  const restoredPin = openPinAfterLoad;
  openPinAfterLoad = null;
  if (restoredPin !== null && pins.some((pin) => pin.id === restoredPin)) {
    await jumpToPin(restoredPin);
    setStatus('Foto gespeichert. Android hatte die App während der Aufnahme kurz beendet.');
  }
}

function leaveProject() {
  selectPin(null);
  closeList();
  setPlacing(false);
  clearHistory(); // der Verlauf gilt nur für das geöffnete Projekt
  currentProject = null;
  currentPlan = null;
  plans = [];
  pins = [];
  listLevel = null;
  listHideDone = false;
  reminderClosed = false;
  backupReminderBar.hidden = true;
  homeDot.hidden = true;
  queueClosePdf();
}

// ---------- Erinnerung an das Backup ----------

function showBackupReminder(project: Project) {
  const reminder = backupReminder(project);
  backupReminderBar.hidden = reminderClosed || !reminder;
  homeDot.hidden = !reminder; // bleibt als Hinweis, auch wenn die Meldung weggetippt ist
  if (reminder) backupReminderText.textContent = `Backup empfohlen: ${reminder}. Gesichert wird in der Projektliste.`;
}

document.getElementById('backup-reminder-go')!.addEventListener('click', () => (location.hash = '#/'));
document.getElementById('backup-reminder-close')!.addEventListener('click', () => {
  reminderClosed = true;
  backupReminderBar.hidden = true;
});

// =============================================================
// Pläne: PDF laden und zeichnen
// =============================================================

// Prüft, ob die Datei ein gültiges PDF ist, und liest die Größe der gewünschten Seite.
// Die Kopie ist nötig, denn PDF.js verbraucht die übergebenen Daten.
async function readPlanFile(file: File, pageNumber: number = 1) {
  const data = await file.arrayBuffer();
  const pdf = await openPdf(data.slice(0));
  try {
    const page = await pdf.getPage(Math.min(pageNumber, pdf.numPages));
    const { width, height } = page.getViewport({ scale: 1 });
    return { data, name: file.name.replace(/\.pdf$/i, ''), pageCount: pdf.numPages, width, height };
  } finally {
    pdf.loadingTask.destroy();
  }
}

// "Kein gültiges PDF" nur, wenn PDF.js das wirklich festgestellt hat. Alles andere ist ein Problem
// des Geräts oder der App, die Fehlermeldung hilft dann bei der Suche nach der Ursache.
function planFileError(err: unknown) {
  const error = err as Error | null | undefined;
  if (error?.name === 'InvalidPDFException') return 'Die Datei ist kein gültiges PDF.';
  if (error?.name === 'PasswordException') return 'Das PDF ist mit einem Passwort geschützt.';
  return `Das PDF konnte auf diesem Gerät nicht geöffnet werden (${error?.message ?? error}).`;
}

document.getElementById('project-edit-btn')!.addEventListener('click', () => {
  const project = currentProject!;
  openProjectDialog(project, ({ name, address }) => {
    project.name = name;
    if (currentProject !== project) return;
    projectName.textContent = name;
    showMapsLink(address);
  }).catch((err) => {
    console.error(err);
    setStatus('Die Angaben zum Projekt konnten nicht geladen werden.');
  });
});

document.getElementById('inspections-btn')!.addEventListener('click', () => {
  openInspectionsDialog(currentProject!).catch((err) => {
    console.error(err);
    setStatus('Die Begehungen konnten nicht geladen werden.');
  });
});

// "In Google Maps" im "…"-Menü, nur wenn das Projekt eine Adresse hat. Die Adresse lässt sich
// auch unter "Bericht erstellen" ändern, darum beim Öffnen des Menüs noch einmal nachsehen.
const mapsLink = document.getElementById('project-maps-link') as HTMLAnchorElement;

function showMapsLink(address: string | null | undefined) {
  const url = googleMapsUrl(address);
  mapsLink.hidden = !url;
  if (url) mapsLink.href = url;
}

async function refreshMapsLink() {
  const project = currentProject;
  if (!project) return;
  const settings = await store.getReportSettings(project.id).catch(() => undefined);
  if (currentProject === project) showMapsLink(settings?.address);
}

document.getElementById('more-btn')!.addEventListener('click', refreshMapsLink);

openBtn.addEventListener('click', () => fileInput.click());
document.getElementById('empty-add-btn')!.addEventListener('click', () => fileInput.click());
bindMenu(document.getElementById('more-btn')!, document.getElementById('more-menu')!);
bindMenu(document.getElementById('theme-btn')!, document.getElementById('theme-menu')!);

// Mehrere PDFs auf einmal sind möglich, oft gibt es pro Geschoss eine eigene Datei.
// Sie werden nacheinander gelesen, damit das iPad immer nur ein PDF im Speicher hat.
fileInput.addEventListener('change', async () => {
  const files = [...fileInput.files!];
  fileInput.value = ''; // erlaubt, dieselbe Datei nochmal zu wählen
  if (files.length === 0) return;
  const projectId = currentProject!.id;
  const added: Plan[] = [];
  const problems: string[] = [];

  for (const [index, file] of files.entries()) {
    setStatus(files.length > 1 ? `Plan ${index + 1} von ${files.length} wird geladen …` : 'Plan wird geladen …');
    let planFile;
    try {
      planFile = await readPlanFile(file);
    } catch (err) {
      console.error(err);
      problems.push(files.length > 1 ? `„${file.name}“: ${planFileError(err)}` : planFileError(err));
      continue;
    }

    try {
      const { name, data, pageCount } = planFile;
      const id = await store.addPlan(projectId, name, data, pageCount);
      // Wer währenddessen das Projekt verlassen hat, bekommt die Pläne beim nächsten Öffnen
      if (currentProject?.id !== projectId) continue;
      const position = plans.reduce((max, plan) => Math.max(max, plan.position + 1), 0);
      const plan: Plan = { id, projectId, name, pageCount, createdAt: Date.now(), position };
      plans.push(plan);
      added.push(plan);
    } catch (err) {
      // Meist ist der Speicher voll, dann klappt es mit den weiteren Dateien auch nicht
      console.error(err);
      problems.push('Der Plan konnte nicht gespeichert werden. Ist der Speicher voll?');
      break;
    }
  }

  if (currentProject?.id !== projectId) return;
  if (added.length > 0) {
    renderList();
    await showPlanPage(added[0], 1); // löscht die Meldung, darum kommt die Zusammenfassung danach
  }
  const summary = files.length > 1 ? [`${added.length} von ${files.length} Plänen hinzugefügt.`] : [];
  setStatus([...summary, ...problems].join(' '));
});

planReplaceBtn.addEventListener('click', () => planReplaceInput.click());

// Neue Planversion: Die Punkte behalten ihre Lage relativ zur Seite (x/y von 0 bis 1).
// Ob sie auch auf dem neuen Plan noch richtig liegen, kann nur der Mensch beurteilen.
planReplaceInput.addEventListener('change', async () => {
  const file = planReplaceInput.files![0];
  planReplaceInput.value = '';
  if (!file) return;
  const plan = currentPlan!;
  const pageNumber = currentPage;
  setStatus('Plan wird geladen …');

  let next;
  try {
    next = await readPlanFile(file, pageNumber);
  } catch (err) {
    console.error(err);
    setStatus(planFileError(err));
    return;
  }

  const planPins = pins.filter((p) => p.planId === plan.id);
  const beyond = planPins.filter((p) => p.page > next.pageCount).length;
  const formatChanged = Math.abs(next.width / next.height / (pageWidth / pageHeight) - 1) > 0.02;
  const lines = [
    `Plan „${plan.name}“ durch „${next.name}“ ersetzen?`,
    `Die ${planPins.length} Mängel und ihre Fotos bleiben erhalten. Das bisherige PDF wird gelöscht.`,
  ];
  if (beyond > 0) {
    lines.push(`Der neue Plan hat nur ${next.pageCount} Seite(n): ${beyond} Mängel wandern auf die letzte Seite.`);
  }
  if (formatChanged) lines.push('Das Seitenformat weicht ab, die Punkte können dadurch verrutschen.');
  if (!confirm(lines.join('\n\n'))) {
    setStatus('');
    return;
  }

  try {
    await store.replacePlan(plan, next.name, next.data, next.pageCount);
  } catch (err) {
    console.error(err);
    setStatus('Der Plan konnte nicht gespeichert werden. Ist der Speicher voll?');
    return;
  }

  plan.name = next.name;
  plan.pageCount = next.pageCount;
  for (const pin of planPins) pin.page = Math.min(pin.page, next.pageCount);
  selectPin(null);
  renderList();
  queueClosePdf(); // sonst bliebe das alte PDF geöffnet
  await showPlanPage(plan, pageNumber);
  if (loadedPlanId === plan.id) {
    setStatus(
      `Plan ersetzt. Bitte die Lage der ${planPins.length} Mängel prüfen. Zum Verschieben einen Punkt antippen und „Verschieben“ einschalten.`
    );
  }
});

planDeleteBtn.addEventListener('click', async () => {
  const plan = currentPlan!;
  const count = pins.filter((p) => p.planId === plan.id).length;
  if (!confirm(`Plan „${plan.name}“ mit ${count} Mängeln und deren Fotos endgültig löschen?`)) return;

  await store.deletePlan(plan);
  plans = plans.filter((p) => p !== plan);
  pins = pins.filter((p) => p.planId !== plan.id);
  selectPin(null);
  renderList();
  if (plans.length > 0) await showPlanPage(plans[0], 1);
  else showNoPlan();
  setStatus('Plan gelöscht.');
});

// ---------- Plan wechseln über das Menü am Plannamen ----------

// Vor bindMenu, damit das Menü beim Aufgehen schon die aktuellen Zahlen zeigt
planBtn.addEventListener('click', () => {
  planOrdering = false;
  renderPlanMenu();
});
bindMenu(planBtn, planMenu);
planBtn.addEventListener('click', () => {
  if (!planMenu.hidden) planMenuList.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
});
planMenuAdd.addEventListener('click', () => fileInput.click());

// "Reihenfolge": Statt zu wechseln, bekommt jeder Plan zwei Pfeile. Das Menü bleibt dabei offen,
// denn Pfeile und "Fertig" sind keine .menu-item, siehe bindMenu.
let planOrdering = false;
planOrderBtn.addEventListener('click', () => {
  planOrdering = !planOrdering;
  renderPlanMenu();
});

function renderPlanMenu() {
  planMenuLabel.textContent = planOrdering ? 'Reihenfolge ändern' : `Pläne (${plans.length})`;
  planOrderBtn.textContent = planOrdering ? 'Fertig' : 'Reihenfolge';
  planOrderBtn.hidden = plans.length < 2 && !planOrdering;
  planMenuAdd.hidden = planOrdering;
  planMenuList.replaceChildren(
    ...plans.map((plan, index) => (planOrdering ? planOrderItem(plan, index) : planPickItem(plan)))
  );
}

// Umbrechen lieber nach "_" oder "-" als mitten im Wort, sonst stünde "O" und "G1" getrennt
function planItemName(plan: Plan) {
  const name = document.createElement('span');
  name.className = 'plan-item-name';
  name.append(...plan.name.split(/(?<=[_-])/).flatMap((part) => [part, document.createElement('wbr')]));
  return name;
}

// Ein Plan zum Wechseln, mit der Zahl seiner offenen Mängel. Der angezeigte ist markiert.
function planPickItem(plan: Plan) {
  const item = document.createElement('button');
  item.className = 'menu-item plan-item';
  item.setAttribute('aria-current', String(plan.id === currentPlan?.id));
  item.innerHTML = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.500l4.500 4.500L19 7" /></svg>';
  const name = planItemName(plan);

  const meta = document.createElement('span');
  meta.className = 'plan-item-meta';
  const open = pins.filter((pin) => pin.planId === plan.id && !pin.done).length;
  const pages = plan.pageCount && plan.pageCount > 1 ? `${plan.pageCount} Seiten` : '';
  meta.textContent = [pages, open ? `${open} offen` : ''].filter(Boolean).join(' · ');

  item.append(name, meta);
  item.addEventListener('click', () => {
    if (plan.id !== currentPlan?.id) showPlanPage(plan, 1);
  });
  return item;
}

// Ein Plan beim Ändern der Reihenfolge: Name und Pfeile nach oben und unten
function planOrderItem(plan: Plan, index: number) {
  const item = document.createElement('div');
  item.className = 'plan-order-item';
  item.append(
    planItemName(plan),
    planMoveButton(plan, index, -1, 'nach oben', 'M12 19V5M6 11l6-6 6 6'),
    planMoveButton(plan, index, 1, 'nach unten', 'M12 5v14M6 13l6 6 6-6')
  );
  return item;
}

function planMoveButton(plan: Plan, index: number, step: number, label: string, path: string) {
  const btn = document.createElement('button');
  btn.className = 'btn icon';
  btn.dataset.step = String(step);
  btn.setAttribute('aria-label', `${plan.name} ${label}`);
  btn.innerHTML = `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="${path}" /></svg>`;
  btn.disabled = !plans[index + step];
  btn.addEventListener('click', () => movePlan(index, index + step));
  return btn;
}

function movePlan(from: number, to: number) {
  const [plan] = plans.splice(from, 1);
  plans.splice(to, 0, plan);
  plans.forEach((p, position) => (p.position = position));
  renderPlanMenu();
  // Der verschobene Plan bleibt im Blick, und derselbe Pfeil kann gleich nochmal getippt werden
  const item = planMenuList.children[to];
  item?.scrollIntoView({ block: 'nearest' });
  item?.querySelector<HTMLButtonElement>(`[data-step="${to - from}"]:not(:disabled)`)?.focus();
  store.setPlanOrder(plans.map((p) => p.id)).catch((err) => {
    console.error(err);
    setStatus('Die Reihenfolge konnte nicht gespeichert werden.');
  });
}

// Lange Namen werden in der Mitte gekürzt, damit das Ende mit dem Geschoss sichtbar bleibt.
// Dafür steht der Name in zwei Teilen da: Nur der vordere darf "…" bekommen. Das Ende ist das
// letzte Stück nach "_", "-" oder Leerzeichen ("…_Grundriss" + "_OG1"), notfalls die letzten Zeichen.
const PLAN_NAME_END = 10;
function setPlanName(name: string) {
  planBtn.setAttribute('aria-label', name ? `Plan wählen, angezeigt: ${name}` : 'Plan wählen');
  planBtn.title = name;
  if (name.length <= PLAN_NAME_END * 2) {
    planNameEl.textContent = name;
    return;
  }
  const cut = Math.max(name.lastIndexOf('_'), name.lastIndexOf('-'), name.lastIndexOf(' '));
  const endLength = cut > 0 && name.length - cut <= PLAN_NAME_END + 2 ? name.length - cut : PLAN_NAME_END;
  const start = document.createElement('span');
  start.className = 'start';
  start.textContent = name.slice(0, -endLength);
  const end = document.createElement('span');
  end.className = 'end';
  end.textContent = name.slice(-endLength);
  planNameEl.replaceChildren(start, end);
}

pageSelect.addEventListener('change', () => showPlanPage(currentPlan!, Number(pageSelect.value)));
pagePrev.addEventListener('click', () => showPlanPage(currentPlan!, currentPage - 1));
pageNext.addEventListener('click', () => showPlanPage(currentPlan!, currentPage + 1));

reportBtn.addEventListener('click', () => {
  selectPin(null);
  closeList();
  setPlacing(false);
  openReportDialog(currentProject!, plans, pins);
});

// Zeigt eine Seite eines Plans. Auf eine Zeichenfläche darf immer nur ein Zeichenvorgang
// laufen. Darum stehen Wechsel in einer Warteschlange, und überholte Wünsche
// (mehrmals schnell auf "nächste Seite") werden übersprungen.
function showPlanPage(plan: Plan, pageNumber: number) {
  const request = ++viewRequest;
  viewQueue = viewQueue.then(async () => {
    if (request !== viewRequest) return;
    setStatus('Plan wird geladen …');
    try {
      if (loadedPlanId !== plan.id) {
        const pdf = await openPdf(await store.getPlanData(plan.id));
        closePdf();
        currentPdf = pdf;
        loadedPlanId = plan.id;
        if (plan.pageCount !== pdf.numPages) {
          plan.pageCount = pdf.numPages;
          store.setPlanPageCount(plan.id, pdf.numPages);
        }
      }
      const page = await currentPdf!.getPage(clamp(pageNumber, 1, currentPdf!.numPages));
      await renderPage(page);
      if (request !== viewRequest) return;

      currentPlan = plan;
      currentPage = page.pageNumber;
      afterPlanShown();
    } catch (err) {
      console.error(err);
      setStatus('Der Plan konnte nicht geöffnet werden.');
    }
  });
  return viewQueue;
}

function afterPlanShown() {
  emptyHint.hidden = true;
  stage.hidden = false;
  [modeBtn, listBtn, reportBtn, zoomInBtn, zoomOutBtn, fitBtn, planBtn, planReplaceBtn, planDeleteBtn].forEach(
    (el) => (el.disabled = false)
  );

  const selected = getSelectedPin();
  if (selected && !isOnCurrentPage(selected)) selectPin(null);
  else renderPins();
  renderPlanControls();
  fitToScreen();

  store.updateProject(currentProject!.id, { lastPlanId: currentPlan!.id, lastPage: currentPage });
  setStatus(''); // Plan und Seite stehen schon in der Leiste
}

// Zustand eines Projekts ohne Pläne
function showNoPlan() {
  queueClosePdf();
  currentPlan = null;
  stage.hidden = true;
  emptyHint.hidden = false;
  setPlacing(false);
  [modeBtn, reportBtn, zoomInBtn, zoomOutBtn, fitBtn, planBtn, planReplaceBtn, planDeleteBtn].forEach(
    (el) => (el.disabled = true)
  );
  listBtn.disabled = false;
  renderPlanControls();
  renderPins();
}

function renderPlanControls() {
  setPlanName(currentPlan?.name ?? (plans.length ? '' : 'Kein Plan'));
  planBtn.disabled = plans.length === 0;

  const pageCount = currentPlan?.pageCount ?? 1;
  pageControls.hidden = pageCount <= 1;
  pageSelect.replaceChildren(
    ...Array.from({ length: pageCount }, (_, index) => {
      const option = document.createElement('option');
      option.value = String(index + 1);
      option.textContent = `Seite ${index + 1} von ${pageCount}`;
      return option;
    })
  );
  pageSelect.value = String(currentPage);
  pagePrev.disabled = currentPage <= 1;
  pageNext.disabled = currentPage >= pageCount;
}

// Gibt den Speicher des PDFs frei (wichtig auf dem iPad)
function closePdf() {
  currentPdf?.loadingTask.destroy();
  currentPdf = null;
  loadedPlanId = null;
}

// Wie closePdf, aber erst nachdem ein laufender Zeichenvorgang fertig ist
function queueClosePdf() {
  viewRequest++;
  viewQueue = viewQueue.then(() => {
    closePdf();
    canvas.width = 0;
    canvas.height = 0;
  });
}

// Speichert im Hintergrund und meldet Fehler in der Statuszeile
function savePin(pin: Defect) {
  store.savePin(pin).catch((err) => {
    console.error(err);
    setStatus('Speichern fehlgeschlagen. Ist der Speicher voll?');
  });
}

async function renderPage(page: PDFPageProxy) {
  const base = page.getViewport({ scale: 1 });
  pageWidth = base.width;
  pageHeight = base.height;

  // Plan scharf genug zeichnen, aber nicht zu groß:
  // Das iPad erlaubt nur ca. 16 Mio. Pixel pro Zeichenfläche.
  const maxPixels = 16_000_000;
  const renderScale = Math.min(6, Math.sqrt(maxPixels / (base.width * base.height)));
  const vp = page.getViewport({ scale: renderScale });

  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  stage.style.width = `${pageWidth}px`;
  stage.style.height = `${pageHeight}px`;

  await page.render({ canvas, viewport: vp }).promise;
}

// =============================================================
// Zoomen und Verschieben
// =============================================================

function applyTransform() {
  stage.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
  // Punkte sollen auf dem Bildschirm immer gleich groß bleiben
  stage.style.setProperty('--inv', String(1 / scale));
  positionCapture();
}

// Eingepasst liegt der Plan zwischen den Leisten, erst beim Zoomen läuft er unter das Glas
function getFitScale() {
  const rect = viewport.getBoundingClientRect();
  return Math.min(
    (rect.width - PLAN_MARGIN * 2) / pageWidth,
    (rect.height - BAR_TOP - BAR_BOTTOM) / pageHeight
  );
}

function fitToScreen() {
  const rect = viewport.getBoundingClientRect();
  scale = getFitScale();
  offsetX = (rect.width - pageWidth * scale) / 2;
  offsetY = BAR_TOP + (rect.height - BAR_TOP - BAR_BOTTOM - pageHeight * scale) / 2;
  applyTransform();
}

// Zoomt so, dass der Punkt (cx, cy) auf dem Bildschirm an derselben Stelle bleibt
function zoomAt(factor: number, cx: number, cy: number) {
  const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor));
  const real = newScale / scale;
  offsetX = cx - (cx - offsetX) * real;
  offsetY = cy - (cy - offsetY) * real;
  scale = newScale;
  applyTransform();
}

function zoomCenter(factor: number) {
  const rect = viewport.getBoundingClientRect();
  zoomAt(factor, rect.width / 2, rect.height / 2);
}

zoomInBtn.addEventListener('click', () => zoomCenter(1.4));
zoomOutBtn.addEventListener('click', () => zoomCenter(1 / 1.4));
fitBtn.addEventListener('click', fitToScreen);

// Nur bei geänderter Breite (z. B. iPad drehen) neu einpassen. Die Bildschirmtastatur
// ändert nur die Höhe und soll den gewählten Zoom nicht zurücksetzen.
let lastWindowWidth = window.innerWidth;
window.addEventListener('resize', () => {
  if (window.innerWidth === lastWindowWidth) return;
  lastWindowWidth = window.innerWidth;
  if (!stage.hidden) fitToScreen();
});

// Der Teil des Plans, den keine Leiste und kein Blatt verdeckt
function visibleArea() {
  const rect = viewport.getBoundingClientRect();
  const area = { left: 0, top: BAR_TOP, right: rect.width, bottom: rect.height - BAR_BOTTOM };
  if (narrow.matches) {
    const sheet = !panel.hidden ? panel : !capture.hidden ? capture : null;
    if (sheet) area.bottom = sheet.getBoundingClientRect().top - rect.top;
    return area;
  }
  if (!panel.hidden) area.right = panel.getBoundingClientRect().left - rect.left;
  if (!defectList.hidden) area.left = defectList.getBoundingClientRect().right - rect.left;
  return area;
}

// Schiebt den Plan sanft, damit man sieht, wohin er wandert
let glideTimer: number | undefined;
function glide() {
  stage.classList.add('gliding');
  clearTimeout(glideTimer);
  glideTimer = setTimeout(() => stage.classList.remove('gliding'), 400);
}

// Schiebt den Plan so, dass der Punkt in der Mitte der freien Fläche liegt
function centerOnPin(pin: Defect) {
  const area = visibleArea();
  glide();
  offsetX = (area.left + area.right) / 2 - pin.x * pageWidth * scale;
  offsetY = (area.top + area.bottom) / 2 - pin.y * pageHeight * scale;
  applyTransform();
}

// Holt einen Punkt nur dann in die Mitte, wenn er gerade verdeckt oder nicht zu sehen ist
function ensurePinVisible(pin: Defect) {
  const area = visibleArea();
  const margin = 44;
  const x = offsetX + pin.x * pageWidth * scale;
  const y = offsetY + pin.y * pageHeight * scale;
  if (x < area.left + margin || x > area.right - margin || y < area.top + margin || y > area.bottom - margin) {
    centerOnPin(pin);
  }
}

// Mausrad am PC zum Zoomen
viewport.addEventListener(
  'wheel',
  (e) => {
    if (stage.hidden) return;
    e.preventDefault();
    const rect = viewport.getBoundingClientRect();
    zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - rect.left, e.clientY - rect.top);
  },
  { passive: false }
);

// =============================================================
// Finger, Stift und Maus (Pointer Events funktionieren für alle drei)
// =============================================================

const pointers = new Map<number, Point>(); // aktive Finger/Stifte auf dem Plan
let gesture: Gesture | null = null; // was gerade passiert: Verschieben, Zoomen, Punkt ziehen
const TAP_TOLERANCE = 8; // so viele Pixel darf sich ein "Tippen" bewegen

viewport.addEventListener('pointerdown', (e) => {
  if (stage.hidden) return;
  if (e.button !== 0) return; // nur linke Maustaste, Finger oder Stiftspitze
  if (narrow.matches) closeList(); // sonst bleibt die Liste offen, der Plan ist daneben ja zu sehen
  stage.classList.remove('gliding');
  viewport.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  // Wurde ein freigegebener Punkt angetippt? Dann diesen verschieben.
  // Ein gesperrter Punkt verhält sich wie der Plan: Ziehen verschiebt die Ansicht, Tippen öffnet ihn.
  const pinEl = (e.target as Element).closest<HTMLElement>('.pin');
  if (pinEl && pointers.size === 1 && Number(pinEl.dataset.id) === movableId) {
    const id = Number(pinEl.dataset.id);
    const pin = pins.find((p) => p.id === id)!;
    const pos = screenToPage(e.clientX, e.clientY);
    dragBefore = snapshot(pin);
    gesture = {
      type: 'drag-pin',
      id,
      startX: e.clientX,
      startY: e.clientY,
      // Abstand zur Punktmitte merken, damit der Punkt beim Ziehen nicht springt
      grabX: pin.x - pos.x,
      grabY: pin.y - pos.y,
      moved: false,
    };
    return;
  }

  if (pointers.size === 1) {
    gesture = {
      type: 'pan',
      pinId: pinEl ? Number(pinEl.dataset.id) : null,
      startX: e.clientX,
      startY: e.clientY,
      startOffsetX: offsetX,
      startOffsetY: offsetY,
      moved: false,
    };
  } else if (pointers.size === 2) {
    // Zweiter Finger: Pinch-Zoom beginnt
    savePinIfDragged();
    const [a, b] = [...pointers.values()];
    gesture = {
      type: 'pinch',
      lastDist: distance(a, b),
      lastMid: midpoint(a, b),
    };
  }
});

viewport.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId) || !gesture) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (gesture.type === 'drag-pin') {
    const dx = e.clientX - gesture.startX;
    const dy = e.clientY - gesture.startY;
    // Leichtes Wackeln beim Antippen soll den Punkt nicht versetzen
    if (Math.hypot(dx, dy) > TAP_TOLERANCE) gesture.moved = true;
    const pin = pins.find((p) => p.id === (gesture as DragPinGesture).id);
    if (pin && gesture.moved) {
      const pos = screenToPage(e.clientX, e.clientY);
      pin.x = clamp(pos.x + gesture.grabX, 0, 1);
      pin.y = clamp(pos.y + gesture.grabY, 0, 1);
      renderPins();
    }
  } else if (gesture.type === 'pan') {
    const dx = e.clientX - gesture.startX;
    const dy = e.clientY - gesture.startY;
    if (Math.hypot(dx, dy) > TAP_TOLERANCE && !gesture.moved) {
      gesture.moved = true;
      if (gesture.pinId !== null) showLockHint();
    }
    if (gesture.moved) {
      offsetX = gesture.startOffsetX + dx;
      offsetY = gesture.startOffsetY + dy;
      applyTransform();
    }
  } else if (gesture.type === 'pinch' && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const dist = distance(a, b);
    const mid = midpoint(a, b);
    const rect = viewport.getBoundingClientRect();
    // gleichzeitig verschieben (zwei Finger bewegen) und zoomen
    offsetX += mid.x - gesture.lastMid.x;
    offsetY += mid.y - gesture.lastMid.y;
    zoomAt(dist / gesture.lastDist, mid.x - rect.left, mid.y - rect.top);
    gesture.lastDist = dist;
    gesture.lastMid = mid;
  }
});

function endPointer(e: PointerEvent) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);

  if (gesture?.type === 'drag-pin') {
    savePinIfDragged();
    // Kurzes Tippen auf einen Punkt öffnet das Bearbeitungsfenster
    if (!gesture.moved && e.type === 'pointerup') openPanel();
  }

  if (gesture?.type === 'pan' && !gesture.moved && e.type === 'pointerup') {
    // Kurzes Tippen ohne Bewegung
    if (gesture.pinId !== null) {
      // Tippen auf einen gesperrten Punkt öffnet das Bearbeitungsfenster
      selectPin(gesture.pinId);
      openPanel();
    } else if (placing) {
      addPin(e.clientX, e.clientY);
    } else {
      // Tippen auf eine freie Stelle schließt die offenen Seitenfenster (siehe outside-tap.ts)
      selectPin(null);
      closeList();
    }
  }

  // Nach dem Pinch nicht versehentlich verschieben/tippen
  gesture = pointers.size === 0 ? null : { type: 'idle' };
}

// Wer einen gesperrten Punkt ziehen will, verschiebt stattdessen den Plan. Einmal erklären, warum.
function showLockHint() {
  if (lockHintShown) return;
  lockHintShown = true;
  setStatus('Punkte sind gesperrt. Zum Verschieben den Punkt antippen und „Verschieben“ einschalten.');
}

// Die neue Position wird erst am Ende des Ziehens gespeichert, nicht bei jeder Bewegung
function savePinIfDragged() {
  if (gesture?.type !== 'drag-pin' || !gesture.moved) return;
  const pin = pins.find((p) => p.id === (gesture as DragPinGesture).id);
  if (!pin) return;
  savePin(pin);
  if (dragBefore?.pin.id === pin.id) {
    record({ label: `Punkt ${pin.number} verschoben`, pinId: pin.id, before: dragBefore, after: snapshot(pin) });
  }
  dragBefore = snapshot(pin); // Ein weiteres Ziehen ist ein neuer Schritt
}

viewport.addEventListener('pointerup', endPointer);
viewport.addEventListener('pointercancel', endPointer);
// Kein Browser-Menü bei Rechtsklick oder langem Drücken auf dem Plan
viewport.addEventListener('contextmenu', (e) => e.preventDefault());

// =============================================================
// Mängelpunkte
// =============================================================

modeBtn.addEventListener('click', () => {
  if (!placing) selectPin(null);
  setPlacing(!placing);
});

function setPlacing(value: boolean) {
  placing = value;
  if (!placing) duplicateSource = null;
  modeBtn.classList.toggle('active', placing);
  modeLabel.textContent = placing ? 'Fertig' : 'Punkt setzen';
  placeHint.textContent = duplicateSource
    ? `Tippe auf den Plan, wo die Kopie von Punkt ${duplicateSource.number} hin soll`
    : PLACE_HINT;
  placeHint.hidden = !placing;
  viewport.classList.toggle('placing', placing);
}

deleteBtn.addEventListener('click', deleteSelected);

window.addEventListener('keydown', (e) => {
  if ((e.target as Element).closest('input, textarea, select')) return; // beim Tippen in Feldern nichts löschen
  // Hinter einem offenen Fenster bleibt der Punkt ausgewählt, darf aber nicht gelöscht werden
  const openDialog =
    '#photo-editor:not([hidden]), #text-blocks-dialog:not([hidden]), #choice-dialog:not([hidden]), ' +
    '#profile-dialog:not([hidden]), ' +
    '#project-dialog:not([hidden]), #camera-dialog:not([hidden])';
  if (document.querySelector(openDialog)) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId !== null) deleteSelected();
});

async function addPin(clientX: number, clientY: number) {
  const pos = screenToPage(clientX, clientY);
  if (pos.x < 0 || pos.x > 1 || pos.y < 0 || pos.y > 1) {
    setStatus('Bitte innerhalb des Plans tippen.');
    return;
  }
  // Beim Duplizieren kommen Überschrift, Notizen, Art, Gewerk und Firma von der Vorlage. Fotos, Frist und
  // "Erledigt" nicht: Die gehören zum einzelnen Mangel und sollen bewusst neu gesetzt werden.
  const source = duplicateSource;
  // id und Nummer kommen erst beim Speichern dazu
  const pin = {
    projectId: currentProject!.id,
    planId: currentPlan!.id,
    page: currentPage,
    x: pos.x,
    y: pos.y,
    title: source?.title ?? '',
    notes: source?.notes ?? '',
    importance: source?.importance ?? DEFAULT_IMPORTANCE,
    done: false,
    trade: source?.trade ?? '',
    company: source?.company ?? '',
    foundAt: todayIso(),
    dueDate: null,
    doneAt: null,
    createdBy: activeProfileName(),
  } as Defect;
  try {
    pin.id = await store.addPin(pin); // die Datenbank vergibt id und Nummer
  } catch (err) {
    console.error(err);
    setStatus('Speichern fehlgeschlagen. Ist der Speicher voll?');
    return;
  }
  pins.push(pin);
  record({
    label: source ? `Punkt ${pin.number} (Kopie von ${source.number}) gesetzt` : `Punkt ${pin.number} gesetzt`,
    pinId: pin.id,
    before: null,
    after: snapshot(pin, []),
  });
  if (listLevel && listLevel !== pin.importance) listLevel = null; // sonst wäre der neue Punkt gleich weg
  setPlacing(false);
  selectPin(pin.id);
  // Ein frisch gesetzter Punkt darf noch zurechtgerückt werden, bis er abgewählt wird
  setMovable(pin.id);
  openCapture();

  const project = await store.getProject(pin.projectId);
  if (project && currentProject?.id === project.id) showBackupReminder(project);
}

async function deleteSelected() {
  const pin = getSelectedPin();
  if (!pin) return;

  // Nur nachfragen, wenn beim Löschen auch Eingaben verloren gehen. Die Fotos kommen mit in den
  // Verlauf, damit "Rückgängig" den Mangel vollständig zurückbringt.
  let photos: Photo[];
  try {
    photos = await store.getPhotos(pin.id);
  } catch (err) {
    console.error(err);
    setStatus('Löschen fehlgeschlagen.');
    return;
  }
  if (
    (pin.title || pin.notes || photos.length > 0) &&
    !confirm(`Mangel ${getPinNumber(pin)} mit Text und ${photos.length} Foto(s) wirklich löschen?`)
  ) {
    return;
  }

  const before = snapshot(pin, photos);
  pins = pins.filter((p) => p.id !== pin.id);
  selectPin(null);
  renderList();
  try {
    await store.deletePin(pin);
  } catch (err) {
    console.error(err);
    setStatus('Löschen fehlgeschlagen.');
    return;
  }
  record({ label: `Punkt ${pin.number} gelöscht`, pinId: pin.id, before, after: null });
  setStatus('Punkt gelöscht. Rückgängig mit dem Pfeil unten.');
}

function selectPin(id: number | null) {
  const changed = id !== selectedId;
  selectedId = id;
  if (changed) movableId = null; // die Freigabe endet mit der Auswahl
  deleteBtn.disabled = id === null;
  if (changed) closeCapture();
  renderPins();
  renderList();
  if (id === null) closePanel();
  else if (changed && !panel.hidden) fillPanel();
}

function getSelectedPin() {
  return pins.find((p) => p.id === selectedId);
}

function getPinNumber(pin: Defect) {
  return pin.number;
}

function isOnCurrentPage(pin: Defect) {
  return pin.planId === currentPlan?.id && pin.page === currentPage;
}

// Zeichnet die Punkte der angezeigten Seite neu. Die Nummer ist fest: Wird ein Punkt
// gelöscht, entsteht eine Lücke, damit verschickte Berichte weiter stimmen.
function renderPins() {
  pinLayer.innerHTML = '';
  pins.forEach((pin) => {
    if (!isOnCurrentPage(pin) || !isShownOnPlan(pin)) return;
    const el = document.createElement('div');
    el.className =
      `pin ${pin.importance}` +
      (pin.done ? ' done' : '') +
      (pin.id === selectedId ? ' selected' : '') +
      (pin.id === movableId ? ' movable' : ' locked');
    el.dataset.id = String(pin.id);
    // Erledigte Punkte zeigen statt der Nummer einen Haken (kommt aus dem CSS)
    if (pin.done) el.setAttribute('aria-label', `Mangel ${pin.number}, erledigt`);
    else el.textContent = String(pin.number);
    el.style.left = `${pin.x * 100}%`;
    el.style.top = `${pin.y * 100}%`;
    pinLayer.appendChild(el);
  });
  renderPlanFilter();
  positionCapture();
}

function passesFilter(pin: Defect) {
  return (!listLevel || pin.importance === listLevel) && !(listHideDone && pin.done);
}

// Der ausgewählte Punkt bleibt immer sichtbar, auch wenn der Filter ihn gerade ausschließt
function isShownOnPlan(pin: Defect) {
  return pin.id === selectedId || passesFilter(pin);
}

// ---------- Filter auf dem Plan, gilt auch für die Liste ----------

filterBtns.forEach((btn) => {
  btn.addEventListener('click', () => setListLevel((btn.dataset.level || null) as Importance | null));
});
filterHideDoneBtn.addEventListener('click', toggleListHideDone);

function setListLevel(level: Importance | null) {
  listLevel = level;
  renderPins();
  renderList();
}

function toggleListHideDone() {
  listHideDone = !listHideDone;
  renderPins();
  renderList();
}

// Die Zahlen zeigen die offenen Mängel der angezeigten Seite
function renderPlanFilter() {
  filterBtns.forEach((btn) => {
    const level = (btn.dataset.level || null) as Importance | null;
    setPressed(btn, listLevel === level);
    if (level) {
      btn.querySelector('.count')!.textContent = String(
        pins.filter((pin) => isOnCurrentPage(pin) && !pin.done && pin.importance === level).length
      );
    }
  });
  setPressed(filterHideDoneBtn, listHideDone);
}

// =============================================================
// Bearbeitungsfenster
// =============================================================

function openPanel() {
  const pin = getSelectedPin();
  if (!pin) return;
  closeCapture();
  panel.hidden = false;
  showSheetState();
  fillPanel();
  // Das Fenster liegt über dem Plan, der Punkt soll sichtbar bleiben
  ensurePinVisible(pin);
}

function closePanel() {
  panel.hidden = true;
  showSheetState();
  clearThumbs();
}

// Die Leisten weichen den offenen Blättern aus, siehe style.css
function showSheetState() {
  projectView.classList.toggle('panel-open', !panel.hidden);
  projectView.classList.toggle('capture-open', !capture.hidden);
  projectView.classList.toggle('list-open', !defectList.hidden);
}

// ---------- Schnellerfassung: das Nötigste direkt am neuen Punkt ----------

function openCapture() {
  const pin = getSelectedPin()!;
  captureTitle.value = pin.title;
  showMarking(pin);
  capture.hidden = false;
  showSheetState();
  positionCapture();
  ensurePinVisible(pin);
  clearThumbs();
  renderPhotos();
}

function closeCapture() {
  if (capture.hidden) return;
  capture.hidden = true;
  showSheetState();
  clearThumbs();
}

// Neben dem Punkt, dort wo Platz ist. Auf schmalen Bildschirmen liegt das Blatt fest unten.
function positionCapture() {
  if (capture.hidden) return;
  if (narrow.matches) {
    capture.style.left = '';
    capture.style.top = '';
    return;
  }
  const pin = getSelectedPin()!;
  const rect = viewport.getBoundingClientRect();
  const margin = 14;
  const beside = 34;
  const x = offsetX + pin.x * pageWidth * scale;
  const y = offsetY + pin.y * pageHeight * scale;
  const fitsRight = x + beside + capture.offsetWidth <= rect.width - margin;
  const left = fitsRight ? x + beside : x - beside - capture.offsetWidth;
  capture.style.left = `${clamp(left, margin, rect.width - capture.offsetWidth - margin)}px`;
  capture.style.top = `${clamp(y - 120, BAR_TOP, rect.height - capture.offsetHeight - margin)}px`;
}

document.getElementById('capture-camera-btn')!.addEventListener('click', takePhoto);
document.getElementById('capture-gallery-btn')!.addEventListener('click', () => photoGallery.click());
document.getElementById('capture-blocks-btn')!.addEventListener('click', openTextBlocks);
document.getElementById('capture-close')!.addEventListener('click', () => selectPin(null));
document.getElementById('capture-details')!.addEventListener('click', openPanel);
document.getElementById('capture-next')!.addEventListener('click', () => {
  selectPin(null);
  setPlacing(true);
});
// "Nochmal setzen": denselben Mangel gleich noch einmal, z. B. bei mehreren gleichen Türen
document.getElementById('capture-duplicate')!.addEventListener('click', () => {
  const pin = getSelectedPin();
  if (pin) startDuplicate(pin);
});
capture.addEventListener('focusout', () => window.scrollTo(0, 0));

function fillPanel() {
  const pin = getSelectedPin()!;
  panelHeading.textContent = `Mangel ${getPinNumber(pin)}`;
  titleInput.value = pin.title;
  notesInput.value = pin.notes;
  showListFields(pin);
  foundInput.value = pin.foundAt ?? '';
  dueInput.value = pin.dueDate ?? '';
  showDate(foundInput);
  showDate(dueInput);
  createdByRow.hidden = !pin.createdBy; // bei älteren Mängeln unbekannt
  createdByText.textContent = pin.createdBy ?? '';
  showMarking(pin);
  panelBody.scrollTop = 0;
  clearThumbs();
  renderPhotos();
}

function showMarking(pin: Defect) {
  importanceBtns.forEach((btn) => setPressed(btn, btn.dataset.importance === pin.importance));
  setPressed(doneBtn, pin.done);
  showMovable();
  doneDateField.hidden = !pin.done;
  doneAtInput.value = pin.doneAt ?? '';
  showDate(doneAtInput);
  dueTile.classList.toggle('overdue', isOverdue(pin));
  panelLate.hidden = !isOverdue(pin);
  for (const badge of [panelBadge, captureBadge]) {
    badge.className = `badge ${pin.importance}`;
    badge.textContent = String(getPinNumber(pin));
  }
}

function setPressed(btn: HTMLElement, pressed: boolean) {
  btn.classList.toggle('active', pressed);
  btn.setAttribute('aria-pressed', String(pressed));
}

panelClose.addEventListener('click', () => selectPin(null));

// Jede Änderung an einem Mangel läuft hierüber: speichern und als Schritt für Rückgängig merken.
// mergeKey fasst Tippen im selben Feld zu einem Schritt zusammen (history.ts).
function changePin(pin: Defect, what: string, change: () => void, mergeKey?: string) {
  const before = snapshot(pin);
  change();
  savePin(pin);
  record({ label: `${what} von Punkt ${pin.number}`, pinId: pin.id, before, after: snapshot(pin), mergeKey });
}

// Jede Eingabe wird sofort gespeichert, es gibt keinen "Speichern"-Knopf
for (const input of [titleInput, captureTitle]) {
  input.addEventListener('input', () => {
    const pin = getSelectedPin()!;
    changePin(pin, 'Überschrift', () => (pin.title = input.value), `title:${pin.id}`);
    renderList();
  });
}

notesInput.addEventListener('input', () => {
  const pin = getSelectedPin()!;
  changePin(pin, 'Notizen', () => (pin.notes = notesInput.value), `notes:${pin.id}`);
});

// Verlässt man ein Feld, ist das Tippen dort ein abgeschlossener Schritt
for (const input of [titleInput, captureTitle, notesInput]) input.addEventListener('blur', endMerge);

textBlocksBtn.addEventListener('click', openTextBlocks);

// Gewerk und Firma: Auswahl aus den Listen im eigenen Fenster, siehe choice-dialog.ts
function showListFields(pin: Defect) {
  tradeText.textContent = pin.trade || 'Wählen';
  companyText.textContent = pin.company || 'Wählen';
}

for (const [btn, kind, what, key] of [
  [tradeBtn, 'trade', 'Gewerk', 'trade'],
  [companyBtn, 'company', 'Firma', 'company'],
] as const) {
  btn.addEventListener('click', () => {
    const pin = getSelectedPin();
    if (!pin) return;
    openChoiceDialog(kind, pin[key], ({ name }) => {
      if (!pins.includes(pin)) return; // inzwischen gelöscht
      changePin(pin, what, () => (pin[key] = name));
      if (selectedId === pin.id) showListFields(pin);
      renderList();
    }).catch((err) => {
      console.error(err);
      setStatus('Die Liste konnte nicht geladen werden.');
    });
  });
}

// Termine. Ein geleertes Datumsfeld heißt: kein Datum.
const detailFields: [HTMLInputElement, 'foundAt' | 'dueDate' | 'doneAt', (value: string) => string | null][] = [
  [foundInput, 'foundAt', (value) => value || null],
  [dueInput, 'dueDate', (value) => value || null],
  [doneAtInput, 'doneAt', (value) => value || null],
];

for (const [input, key, read] of detailFields) {
  input.addEventListener('input', () => {
    const pin = getSelectedPin()!;
    const what = { foundAt: 'Festgestellt', dueDate: 'Frist', doneAt: 'Erledigt am' }[key];
    changePin(pin, what, () => (pin[key] = read(input.value)));
    if (input.type === 'date') showDate(input);
    showMarking(pin);
    renderList();
  });
}

// Datumskacheln, siehe date-tile.ts
for (const input of [foundInput, dueInput, doneAtInput]) initDateTile(input);

function changeMarking(changes: Partial<Defect>, what: string) {
  const pin = getSelectedPin()!;
  changePin(pin, what, () => Object.assign(pin, changes));
  showMarking(pin);
  renderPins();
  renderList();
}

importanceBtns.forEach((btn) => {
  btn.addEventListener('click', () => changeMarking({ importance: btn.dataset.importance as Importance }, 'Art'));
});
// ---------- Sperre gegen versehentliches Verschieben ----------

moveBtn.addEventListener('click', () => {
  if (selectedId === null) return;
  setMovable(movableId === selectedId ? null : selectedId);
  if (movableId !== null) setStatus('Punkt auf dem Plan an die neue Stelle ziehen.');
});

function setMovable(id: number | null) {
  movableId = id;
  showMovable();
  renderPins();
}

function showMovable() {
  const movable = selectedId !== null && movableId === selectedId;
  setPressed(moveBtn, movable);
  moveHint.textContent = movable ? 'Punkt auf dem Plan ziehen' : 'Gesperrt';
}

doneBtn.addEventListener('click', () => {
  const done = !getSelectedPin()!.done;
  changeMarking({ done, doneAt: done ? todayIso() : null }, 'Erledigt');
});

// iPad: Die Tastatur schiebt die Seite manchmal nach oben. Danach wieder zurückholen.
panel.addEventListener('focusout', () => window.scrollTo(0, 0));

// ---------- Duplizieren ----------

// Die Vorlage merken und auf den Plan tippen lassen. Das geht mit jedem Punkt, jederzeit, auch auf
// einem anderen Plan (vor dem Tippen den Plan wechseln). Abbrechen mit "Fertig".
function startDuplicate(source: Defect) {
  selectPin(null);
  duplicateSource = { ...source };
  setPlacing(true);
}

duplicateBtn.addEventListener('click', () => {
  const pin = getSelectedPin();
  if (pin) startDuplicate(pin);
});

// ---------- Rückgängig und Wiederholen, siehe history.ts ----------

let historyBusy = false;

// Bringt einen Mangel auf den Stand target (null = gibt es nicht) und zeigt das Ergebnis
async function applyHistory(target: PinState | null, step: Step) {
  const current = pins.find((p) => p.id === step.pinId);
  if (target) {
    const pin = { ...target.pin };
    await store.restorePin(pin, target.photos?.map((photo) => ({ ...photo })));
    if (current) Object.assign(current, pin);
    else pins.push(pin);
  } else if (current) {
    // Wird ein gerade gesetzter Punkt zurückgenommen, wird seine Nummer wieder frei
    await store.removePin(current, step.before === null);
    pins = pins.filter((p) => p !== current);
  }
}

async function runHistory(direction: 'undo' | 'redo') {
  if (historyBusy || !currentProject) return;
  historyBusy = true;
  endMerge();
  try {
    const step = direction === 'undo' ? await undo(applyHistory) : await redo(applyHistory);
    if (step) showHistoryResult(step, direction === 'undo' ? 'Rückgängig' : 'Wiederholt');
  } catch (err) {
    console.error(err);
    setStatus('Das ließ sich nicht rückgängig machen. Ist der Speicher voll?');
  } finally {
    historyBusy = false;
    showHistoryButtons();
  }
}

function showHistoryResult(step: Step, verb: string) {
  const pin = pins.find((p) => p.id === step.pinId);
  if (!pin) {
    if (selectedId === step.pinId) selectPin(null);
  } else if (selectedId === pin.id) {
    if (!panel.hidden) fillPanel();
    if (!capture.hidden) {
      captureTitle.value = pin.title;
      showMarking(pin);
      renderPhotos();
    }
  }
  renderPins();
  renderList();
  // Liegt der Punkt auf einem anderen Plan oder einer anderen Seite, sagen wir wo
  const plan = pin && !isOnCurrentPage(pin) ? plans.find((p) => p.id === pin.planId) : null;
  const where = plan ? ` (auf ${plan.name}${(plan.pageCount ?? 1) > 1 ? `, Seite ${pin!.page}` : ''})` : '';
  setStatus(`${verb}: ${step.label}${where}`);
}

function showHistoryButtons() {
  const back = nextUndo();
  const forward = nextRedo();
  undoBtn.disabled = !back || historyBusy;
  redoBtn.disabled = !forward || historyBusy;
  undoBtn.title = back ? `Rückgängig: ${back.label}` : 'Rückgängig';
  redoBtn.title = forward ? `Wiederholen: ${forward.label}` : 'Wiederholen';
  undoBtn.setAttribute('aria-label', undoBtn.title);
  redoBtn.setAttribute('aria-label', redoBtn.title);
}

onHistoryChange(showHistoryButtons);
undoBtn.addEventListener('click', () => runHistory('undo'));
redoBtn.addEventListener('click', () => runHistory('redo'));

// Am Rechner: Strg+Z / Strg+Y (bzw. Strg+Umschalt+Z, am Mac mit Cmd). In Textfeldern bleibt es beim
// Rückgängig des Browsers für den Text selbst.
window.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || projectView.hidden) return;
  if ((e.target as Element).closest('input, textarea, select')) return;
  if (document.querySelector('#photo-editor:not([hidden]), [id$="-dialog"]:not([hidden])')) return; // Fenster offen
  const key = e.key.toLowerCase();
  if (key === 'z' && !e.shiftKey) {
    e.preventDefault();
    runHistory('undo');
  } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
    e.preventDefault();
    runHistory('redo');
  }
});

// ---------- Fotos ----------

photoCameraBtn.addEventListener('click', takePhoto);

// iPad und Handy: Kamera-App des Geräts. Laptop und PC: eigenes Kamerafenster, siehe camera.ts
// Android hat die App während der Aufnahme beendet (wenig Arbeitsspeicher). Beim Neustart kommt das
// Foto nach: beim richtigen Mangel speichern und diesen öffnen, siehe openProject.
let openPinAfterLoad: number | null = null;

async function saveRestoredPhoto({ projectId, pinId }: PhotoTarget, photo: Blob) {
  try {
    const exists = (await store.listPins(projectId)).some((pin) => pin.id === pinId);
    if (!exists) return; // Mangel inzwischen gelöscht
    await store.addPhoto({ id: pinId, projectId }, await shrinkPhoto(photo));
  } catch (err) {
    console.error(err);
    setStatus('Das Foto konnte nach dem Neustart nicht gespeichert werden. Es liegt aber in der Galerie.');
    return;
  }
  openPinAfterLoad = pinId;
  const hash = `#/projekt/${projectId}`;
  if (location.hash === hash) await route();
  else location.hash = hash;
}

// Android-App: Kamera des Geräts, das Foto kommt zusätzlich in die Galerie (siehe native.ts)
function takePhoto() {
  if (isNativeApp) {
    const pin = getSelectedPin()!;
    takeNativePhoto({ projectId: pin.projectId, pinId: pin.id })
      .then((photo) => photo && addPhotos([photo]))
      .catch((err) => {
        console.error(err);
        setStatus('Die Kamera konnte nicht geöffnet werden.');
      });
  } else if (useOwnCamera()) openCamera((photo) => addPhotos([photo]), () => photoGallery.click());
  else photoCamera.click();
}
photoGalleryBtn.addEventListener('click', () => photoGallery.click());

[photoCamera, photoGallery].forEach((input) => {
  input.addEventListener('change', () => {
    const files = [...input.files!];
    input.value = ''; // erlaubt, dasselbe Foto nochmal zu wählen
    addPhotos(files);
  });
});

// Verarbeitet ein Foto nach dem anderen, damit dem iPad nicht der Arbeitsspeicher ausgeht
async function addPhotos(files: Blob[]) {
  const pin = getSelectedPin()!;
  let failed = 0;
  // Für Rückgängig: die Fotos vorher und nachher, alle in einem Schritt
  const before = snapshot(pin, await store.getPhotos(pin.id).catch(() => []));

  for (const [index, file] of files.entries()) {
    setStatus(`Foto ${index + 1} von ${files.length} wird verkleinert …`);
    try {
      const data = await shrinkPhoto(file);
      if (!pins.includes(pin)) return; // Punkt wurde inzwischen gelöscht
      await store.addPhoto(pin, data);
      if (selectedId === pin.id) await renderPhotos();
    } catch (err) {
      console.error(err);
      failed++;
    }
  }

  if (failed < files.length && pins.includes(pin)) {
    const after = snapshot(pin, await store.getPhotos(pin.id).catch(() => []));
    const count = files.length - failed;
    record({
      label: `${count === 1 ? 'Foto' : `${count} Fotos`} bei Punkt ${pin.number} hinzugefügt`,
      pinId: pin.id,
      before,
      after,
    });
  }

  setStatus(
    failed > 0
      ? `${failed} von ${files.length} Fotos konnten nicht gespeichert werden.`
      : `${files.length} Foto(s) gespeichert.`
  );
}

async function renderPhotos() {
  const pinId = selectedId!;
  const photos = await store.getPhotos(pinId);
  const images: ArrayBuffer[] = [];
  for (const photo of photos) images.push(await getThumbData(photo));
  if (pinId !== selectedId) return; // inzwischen wurde ein anderer Punkt gewählt

  clearThumbs();
  // Die Schnellerfassung zeigt die Fotos selbst, sonst liegen sie im Bearbeitungsfenster
  const grid = capture.hidden ? photoGrid : capturePhotos;
  photos.forEach((photo, index) => {
    const url = URL.createObjectURL(new Blob([images[index]], { type: 'image/jpeg' }));
    thumbUrls.push(url);

    const thumb = document.createElement('div');
    thumb.className = 'thumb';

    const img = document.createElement('img');
    img.src = url;
    img.alt = '';

    const open = document.createElement('button');
    open.className = 'thumb-open';
    open.setAttribute('aria-label', 'Foto ansehen und markieren');
    open.append(img);
    open.addEventListener('click', () => {
      openPhotoEditor(photo, currentProject!.id, renderPhotos).catch((err) => {
        console.error(err);
        setStatus('Das Foto konnte nicht geöffnet werden.');
      });
    });

    const del = document.createElement('button');
    del.className = 'thumb-delete';
    del.setAttribute('aria-label', 'Foto löschen');
    del.addEventListener('click', async () => {
      if (!confirm('Dieses Foto wirklich löschen?')) return;
      const pin = pins.find((p) => p.id === photo.pinId);
      const before = pin && snapshot(pin, await store.getPhotos(pin.id));
      await store.deletePhoto(photo.id, currentProject!.id);
      if (pin && before) {
        record({
          label: `Foto bei Punkt ${pin.number} gelöscht`,
          pinId: pin.id,
          before,
          after: snapshot(pin, await store.getPhotos(pin.id)),
        });
      }
      await renderPhotos();
      setStatus('Foto gelöscht.');
    });

    thumb.append(open, del);
    if (photo.caption) {
      const caption = document.createElement('span');
      caption.className = 'thumb-caption';
      caption.textContent = photo.caption;
      thumb.appendChild(caption);
    }
    grid.appendChild(thumb);
  });
  positionCapture();
}

// Miniaturen zeigen die Markierungen mit. Klappt das nicht, reicht das Foto selbst.
async function getThumbData(photo: Photo) {
  if (!photo.marks?.length) return photo.data;
  try {
    return await shrinkPhoto(new Blob([photo.data], { type: 'image/jpeg' }), 400, 0.8, photo.marks);
  } catch (err) {
    console.error(err);
    return photo.data;
  }
}

function clearThumbs() {
  thumbUrls.forEach((url) => URL.revokeObjectURL(url));
  thumbUrls = [];
  photoGrid.replaceChildren();
  capturePhotos.replaceChildren();
}

// =============================================================
// Mängelliste
// =============================================================

listBtn.addEventListener('click', () => {
  if (defectList.hidden) openList();
  else closeList();
});

document.getElementById('list-close')!.addEventListener('click', closeList);

function openList() {
  defectList.hidden = false;
  listBtn.classList.add('active');
  listBtn.setAttribute('aria-expanded', 'true');
  showSheetState();
}

function closeList() {
  defectList.hidden = true;
  listBtn.classList.remove('active');
  listBtn.setAttribute('aria-expanded', 'false');
  showSheetState();
}

function renderList() {
  listCount.textContent = `Mängel ${pins.length}`;
  defectListBody.replaceChildren();
  listSearch.hidden = pins.length === 0;

  if (pins.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'list-empty';
    empty.textContent = 'Noch keine Mängel.';
    defectListBody.appendChild(empty);
    return;
  }

  defectListBody.appendChild(createListFilter());

  // Die Suche gilt nur für die Liste, der Filter für Liste und Plan
  const found = sortPins(pins).filter(matchesListSearch);
  const visible = found.filter(passesFilter);
  const hidden = found.length - visible.length;
  if (visible.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'list-empty';
    empty.textContent = listSearchInput.value.trim() ? 'Kein Mangel gefunden.' : 'Keine Mängel für diesen Filter.';
    defectListBody.appendChild(empty);
  }
  // Sonst sucht man nach "12" und wundert sich, warum der erledigte Mangel 12 fehlt
  if (hidden > 0 && listSearchInput.value.trim()) {
    const hint = document.createElement('p');
    hint.className = 'list-hidden-hint';
    hint.textContent =
      hidden === 1
        ? 'Ein weiterer Treffer ist durch den Filter ausgeblendet.'
        : `${hidden} weitere Treffer sind durch den Filter ausgeblendet.`;
    defectListBody.appendChild(hint);
  }
  if (visible.length === 0) return;

  // Die Liste ist sortiert, darum beginnt ein Abschnitt, sobald sich die Gruppe ändert
  const groupOf = (pin: Defect): ListGroup => (pin.done ? 'done' : pin.importance);
  let group: ListGroup | null = null;
  for (const pin of visible) {
    if (groupOf(pin) !== group) {
      group = groupOf(pin);
      const count = visible.filter((p) => groupOf(p) === group).length;
      defectListBody.appendChild(createListSection(group, count));
    }
    defectListBody.appendChild(createListItem(pin));
  }
}

// ---------- Suche in der Mängelliste: nach Nummer und Überschrift ----------

// Eine reine Zahl ("12", "#12", "Nr. 12") findet den Mangel mit genau dieser Nummer und dazu
// Überschriften, in denen die Zahl vorkommt. Sonst muss jedes Wort in der Überschrift stehen.
function matchesListSearch(pin: Defect) {
  const query = listSearchInput.value.trim();
  if (!query) return true;
  const number = /^(?:nr\.?|#)?\s*(\d+)$/i.exec(query)?.[1];
  if (number && pin.number === Number(number)) return true;
  const title = normalize(pin.title);
  return searchWords(number ?? query).every((word) => title.includes(word));
}

listSearchInput.addEventListener('input', () => {
  listSearchClear.hidden = !listSearchInput.value;
  renderList();
});

listSearchClear.addEventListener('click', () => {
  clearListSearch();
  listSearchInput.focus();
});

// Enter schließt die Tastatur. Bei genau einem Treffer geht es gleich zu diesem Mangel.
listSearchInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  listSearchInput.blur();
  const results = pins.filter((pin) => matchesListSearch(pin) && passesFilter(pin));
  if (results.length === 1) jumpToPin(results[0].id);
});

function clearListSearch() {
  listSearchInput.value = '';
  listSearchClear.hidden = true;
  renderList();
}

function createListFilter() {
  const filter = document.createElement('div');
  filter.className = 'list-filter';

  const levels = document.createElement('div');
  levels.className = 'segmented';
  for (const level of [null, ...IMPORTANCE]) {
    const btn = document.createElement('button');
    btn.className = `seg-btn ${level ?? 'plain'}`;
    btn.textContent = level ? IMPORTANCE_TEXT[level] : 'Alle';
    setPressed(btn, listLevel === level);
    btn.addEventListener('click', () => setListLevel(level));
    levels.appendChild(btn);
  }

  const hideDone = document.createElement('button');
  hideDone.className = 'btn soft';
  hideDone.textContent = 'Erledigte ausblenden';
  setPressed(hideDone, listHideDone);
  hideDone.addEventListener('click', toggleListHideDone);

  filter.append(levels, hideDone);
  return filter;
}

function createListSection(group: ListGroup, count: number) {
  const section = document.createElement('div');
  section.className = `list-section ${group}`;
  if (group !== 'done') {
    const symbol = document.createElement('span');
    symbol.className = 'sw';
    section.appendChild(symbol);
  }
  section.append(`${group === 'done' ? 'Erledigt' : IMPORTANCE_PLURAL[group]} (${count})`);
  return section;
}

function createListItem(pin: Defect) {
  const item = document.createElement('button');
  item.className =
    'list-item' +
    (pin.done ? ' done' : '') +
    (pin.title ? '' : ' untitled') +
    (pin.id === selectedId ? ' selected' : '');

  // Auch erledigte Mängel behalten hier ihre Nummer und die Form ihrer Wichtigkeit
  const number = document.createElement('span');
  number.className = `badge ${pin.importance}`;
  number.textContent = String(getPinNumber(pin));

  const text = document.createElement('span');
  text.className = 'list-text';

  const title = document.createElement('span');
  title.className = 'list-title';
  title.textContent = pin.title || 'Ohne Überschrift';
  text.appendChild(title);

  // Bei mehreren Plänen oder Seiten zeigen, wo der Mangel liegt
  const details = pin.done ? [IMPORTANCE_TEXT[pin.importance]] : [];
  if (pin.trade) details.push(pin.trade);
  if (pin.company) details.push(pin.company);
  const plan = plans.find((p) => p.id === pin.planId);
  if (plans.length > 1 || (plan?.pageCount ?? 0) > 1) {
    details.push((plan?.pageCount ?? 0) > 1 ? `${plan!.name}, S. ${pin.page}` : plan?.name ?? '');
  }
  if (details.length > 0) {
    const where = document.createElement('span');
    where.className = 'list-where';
    where.textContent = details.join(' · ');
    text.appendChild(where);
  }
  if (pin.dueDate && !pin.done) {
    const overdue = isOverdue(pin);
    const due = document.createElement('span');
    due.className = overdue ? 'list-overdue' : 'list-where';
    due.textContent = `${overdue ? 'Überfällig seit' : 'Frist'} ${formatDate(pin.dueDate)}`;
    text.appendChild(due);
  }

  item.append(number, text);
  item.addEventListener('click', () => jumpToPin(pin.id));
  return item;
}

// Springt zum Punkt, auch auf einen anderen Plan oder eine andere Seite:
// wählt ihn aus, zoomt bei Bedarf heran und öffnet das Fenster
async function jumpToPin(id: number) {
  if (narrow.matches) closeList();
  const pin = pins.find((p) => p.id === id)!;
  if (!isOnCurrentPage(pin)) {
    await showPlanPage(plans.find((p) => p.id === pin.planId)!, pin.page);
    if (!isOnCurrentPage(pin)) return; // inzwischen wurde etwas anderes gewählt
  }
  selectPin(id);
  openPanel();
  scale = Math.max(scale, Math.min(MAX_SCALE, getFitScale() * 2.5));
  centerOnPin(getSelectedPin()!);
}

// =============================================================
// Hilfsfunktionen
// =============================================================

// Rechnet eine Bildschirmposition in eine Position auf dem Plan um (0 bis 1)
function screenToPage(clientX: number, clientY: number): Point {
  const rect = viewport.getBoundingClientRect();
  return {
    x: (clientX - rect.left - offsetX) / scale / pageWidth,
    y: (clientY - rect.top - offsetY) / scale / pageHeight,
  };
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: Point, b: Point) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

// =============================================================
// Start
// =============================================================

// Neue App-Version angekommen: neu laden, denn die alten Dateien (z. B. der PDF.js-Worker)
// sind dann nicht mehr da. Es geht nichts verloren, jede Eingabe ist schon gespeichert.
const hadServiceWorker = Boolean(navigator.serviceWorker?.controller);
navigator.serviceWorker?.addEventListener('controllerchange', () => {
  if (hadServiceWorker) location.reload();
});

async function start() {
  openLinksWithAndroid();
  onRestoredPhoto(saveRestoredPhoto);
  // Bittet den Browser, die Daten nicht von selbst zu löschen (geht nur über https/localhost)
  navigator.storage?.persist?.().catch(() => {});

  await store.removeUnfinishedImports().catch((err) => console.error(err));
  const hasProfile = await loadActiveProfile().catch((err) => {
    console.error(err);
    return true; // nicht fragen, wenn schon das Lesen scheitert
  });
  await route();

  // Ohne Profil einmal pro Start fragen. Wer das Fenster schließt, erfasst ohne Namen.
  if (!hasProfile) openProfiles(true).catch((err) => console.error(err));
}

start();
