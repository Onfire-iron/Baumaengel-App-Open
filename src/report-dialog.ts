// =============================================================
// Fenster "Bericht erstellen": Formular, Fortschritt, fertige Datei
// =============================================================

import { initBulletField } from './bullet-field.ts';
import {
  EXPERTS_TEXT,
  FINDINGS_TEXT,
  OCCASIONS,
  occasionOf,
  parseBullets,
  requiredProofsIntro,
} from './control-fields.ts';
import type { TextLine } from './control-fields.ts';
import { initDateTile, showDate } from './date-tile.ts';
import * as store from './db.ts';
import { DEFAULT_REPORT_LEVELS, IMPORTANCE, IMPORTANCE_PLURAL, IMPORTANCE_TEXT, formatDate, todayIso } from './defects.ts';
import { reportAddress, reportLogoUrl, reportRecipient } from './divisions.ts';
import { openInspectionsDialog } from './inspections-dialog.ts';
import { createPartyFields } from './party-fields.ts';
import { INFO_PAGE_PARTIES, PARTIES } from './parties.ts';
import { shrinkPhoto } from './photos.ts';
import { activeProfileName } from './profiles.ts';
import { saveFile, safeFileName } from './share.ts';
import type { Defect, Importance, Plan, Project, ReportSettings } from './types.ts';
import { clickVisible, closeOnOutsideTap } from './outside-tap.ts';

const dialog = document.getElementById('report-dialog') as HTMLElement;
const formSection = document.getElementById('report-form') as HTMLElement;
const progressSection = document.getElementById('report-progress') as HTMLElement;
const doneSection = document.getElementById('report-done') as HTMLElement;
const nameInput = document.getElementById('report-name') as HTMLInputElement;
const addressInput = document.getElementById('report-address') as HTMLTextAreaElement;
const partyInputs = createPartyFields(document.getElementById('report-parties')!, 'report');
const dateInput = document.getElementById('report-date') as HTMLInputElement;
const inspectionsText = document.getElementById('report-inspections-text') as HTMLElement;
const creatorInput = document.getElementById('report-creator') as HTMLInputElement;
const formMessage = document.getElementById('report-message') as HTMLElement;
const progressBar = document.getElementById('report-progress-bar') as HTMLProgressElement;
const progressText = document.getElementById('report-progress-text') as HTMLElement;
const doneText = document.getElementById('report-done-text') as HTMLElement;
const coverName = document.getElementById('cover-name') as HTMLElement;
const coverAddress = document.getElementById('cover-address') as HTMLElement;
const coverNumber = document.getElementById('cover-number') as HTMLElement;
const coverNumberValue = document.getElementById('cover-number-value') as HTMLElement;
const coverMeta = document.getElementById('cover-meta') as HTMLElement;
const coverInfo = document.getElementById('cover-info') as HTMLElement;
const coverOffice = document.getElementById('cover-office') as HTMLElement;
const coverInspection = document.getElementById('cover-inspection') as HTMLElement;
const coverInspectionLabel = document.getElementById('cover-inspection-label') as HTMLElement;
const photoPage = document.getElementById('cover-photo-page') as HTMLElement;
const levelBtns = document.querySelectorAll<HTMLButtonElement>('#report-levels .seg-btn');
const createBtn = document.getElementById('report-create') as HTMLButtonElement;
const reportX = document.getElementById('report-x') as HTMLButtonElement;
const occasionInput = document.getElementById('report-occasion') as HTMLInputElement;
const occasionChips = document.getElementById('report-occasion-chips') as HTMLElement;
const documentsInput = document.getElementById('report-documents') as HTMLTextAreaElement;
const executionInput = document.getElementById('report-execution') as HTMLTextAreaElement;
const proofsInput = document.getElementById('report-proofs') as HTMLTextAreaElement;
const plansGrid = document.getElementById('report-plans') as HTMLElement;
const controlSummary = document.getElementById('report-control-summary') as HTMLElement;
const projectSummary = document.getElementById('report-project-summary') as HTMLElement;
const imagesSummary = document.getElementById('report-images-summary') as HTMLElement;
const coverControl = document.getElementById('cover-control') as HTMLElement;
const coverDate = document.getElementById('cover-date') as HTMLElement;
const coverDateLabel = document.getElementById('cover-date-label') as HTMLElement;
const coverCreator = document.getElementById('cover-creator') as HTMLElement;
const coverCreatorLabel = document.getElementById('cover-creator-label') as HTMLElement;

let current: {
  project: Project;
  plans: Plan[];
  pins: Defect[];
  settings: Partial<ReportSettings>;
} | null = null;
let abortController: AbortController | null = null;
let result: { blob: Blob; fileName: string } | null = null; // fertiger Bericht, wartet auf den Fingertipp zum Sichern

type ImageKey = 'coverPhoto' | 'logo';

interface ImageSlot {
  prefix: string;
  coverId: string;
  maxSide: number;
  quality: number;
  defaultSrc?: string;
}

// Zwei Bilder im selben Aufbau: Titelbild und Logo.
// Das Logo hat ein Standardbild, das gilt, solange im Projekt nichts anderes gespeichert ist.
const images: Record<ImageKey, ImageSlot> = {
  coverPhoto: { prefix: 'report-cover', coverId: 'cover-photo', maxSide: 1600, quality: 0.8 },
  logo: {
    prefix: 'report-logo',
    coverId: 'cover-logo',
    maxSide: 800,
    quality: 0.9,
    defaultSrc: reportLogoUrl(null), // wird beim Öffnen auf den Bereich des Projekts gesetzt
  },
};

export async function openReportDialog(project: Project, plans: Plan[], pins: Defect[]): Promise<void> {
  const settings: Partial<ReportSettings> = (await store.getReportSettings(project.id)) ?? {};
  current = { project, plans, pins, settings };
  images.logo.defaultSrc = reportLogoUrl(project.division); // Standardlogo des Bereichs

  // Wurde noch nie ein Ersteller eingetragen, gilt das gewählte Profil.
  // Gemerkt wird es erst, wenn jemand das Feld ändert.
  settings.creator ??= activeProfileName() ?? '';
  nameInput.value = settings.name || project.name;
  addressInput.value = settings.address ?? '';
  for (const { key } of PARTIES) partyInputs[key].value = settings[key] ?? '';
  creatorInput.value = settings.creator;
  dateInput.value = todayIso(); // Das Datum gilt für diesen Bericht und wird nicht gemerkt
  showDate(dateInput);
  occasionInput.value = occasionOf(settings);
  renderOccasionChips();
  loadOccasions().catch(console.error);
  documentsInput.value = settings.documents ?? '';
  executionInput.value = settings.executionState ?? '';
  proofsInput.value = settings.requiredProofs ?? '';
  renderPlans();
  formMessage.textContent = '';
  coverOffice.textContent = reportAddress(project.division);
  for (const key of Object.keys(images) as ImageKey[]) showImage(key);
  showInspectionCount();
  showLevels();
  renderCover();
  showSummaries();

  showSection(formSection);
  dialog.hidden = false;
  growing.forEach(grow);
  formSection.scrollIntoView({ block: 'start' });
}

// Vorschau des Deckblatts: zeigt die Angaben so, wie drawCover und drawProjectInfo in report.ts sie setzen
function renderCover() {
  coverName.textContent = nameInput.value.trim() || current!.project.name;
  coverAddress.textContent = addressInput.value;
  coverNumberValue.textContent = partyInputs.projectNumber.value.trim();
  coverNumber.hidden = !coverNumberValue.textContent;
  coverDate.textContent = formatDate(dateInput.value);
  coverCreator.textContent = creatorInput.value;
  coverDate.hidden = coverDateLabel.hidden = !dateInput.value;
  coverCreator.hidden = coverCreatorLabel.hidden = !creatorInput.value;
  const lastInspection = lastInspectionDate();
  coverInspection.textContent = lastInspection ? formatDate(lastInspection) : '';
  coverInspection.hidden = coverInspectionLabel.hidden = !lastInspection;

  // Beteiligte vor den Daten, nur die ausgefüllten
  for (const old of coverMeta.querySelectorAll('.cover-party')) old.remove();
  const parties = INFO_PAGE_PARTIES.filter(({ key }) => partyInputs[key].value.trim()).flatMap(({ key, label }) => {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = partyInputs[key].value.trim();
    for (const el of [dt, dd]) el.className = 'cover-party';
    return [dt, dd];
  });
  coverInspectionLabel.before(...parties);
  // Danach etwas Abstand, wie im Bericht
  const dates = [
    [coverInspectionLabel, coverInspection],
    [coverDateLabel, coverDate],
    [coverCreatorLabel, coverCreator],
  ];
  const firstAfter = dates.find(([label]) => !label.hidden) ?? [];
  for (const el of dates.flat()) el.classList.toggle('cover-gap', parties.length > 0 && firstAfter.includes(el));
  // Ohne jede Angabe entfallen die Projektangaben auch im Bericht
  coverInfo.hidden = !parties.length && dates.every(([label]) => label.hidden);
}

function lastInspectionDate() {
  return (current!.settings.inspections ?? []).map((inspection) => inspection.date).sort().at(-1);
}

// ---------- Zusammenfassungen in den Kopfzeilen der Abschnitte ----------

function showSummaries() {
  const { settings, plans } = current!;
  const planCount = plans.filter((plan) => settings.inspectedPlanIds?.includes(plan.id)).length;
  const control = [
    occasionInput.value.trim() && 'Veranlassung',
    documentsInput.value.trim() && 'Unterlagen',
    planCount && (planCount === 1 ? '1 Gebäudeteil' : `${planCount} Gebäudeteile`),
    executionInput.value.trim() && 'Ausführungsstand',
  ].filter(Boolean);
  controlSummary.textContent = control.length ? control.join(' · ') : 'Noch nichts eingetragen';

  const number = partyInputs.projectNumber.value.trim();
  const parties = PARTIES.filter(({ key }) => key !== 'projectNumber' && partyInputs[key].value.trim()).length;
  projectSummary.textContent = [
    nameInput.value.trim() || current!.project.name,
    number,
    parties ? `${parties} ${parties === 1 ? 'Beteiligter' : 'Beteiligte'}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const logo = settings.logo === undefined ? 'Standardlogo' : settings.logo ? 'eigenes Logo' : 'ohne Logo';
  imagesSummary.textContent = `${settings.coverPhoto ? 'Mit Titelbild' : 'Ohne Titelbild'} · ${logo}`;
  renderControlPreview();
}

// Vorschau der Tabelle "Angaben zur Baukontrolle", Zeilen wie in drawControlTable (report.ts)
function renderControlPreview() {
  const { settings, plans, project } = current!;
  const planNames = plans
    .filter((plan) => settings.inspectedPlanIds?.includes(plan.id))
    .map((plan) => ({ bullet: false, text: plan.name }));
  const rows: [string, TextLine[][]][] = [
    ['Veranlassung', [parseBullets(occasionInput.value)]],
    ['Unterlagen', [parseBullets(documentsInput.value)]],
    ['Begangene Gebäudeteile', [planNames]],
    ['Ausführungsstand', [parseBullets(executionInput.value)]],
    [
      'Vorzulegende Unterlagen zur Durchführung der Baukontrollen',
      [[{ bullet: false, text: requiredProofsIntro(reportRecipient(project.division)) }], parseBullets(proofsInput.value)],
    ],
    ['Vorzulegende Bescheinigungen von Sachverständigen nach PrüfVO NRW', [[{ bullet: false, text: EXPERTS_TEXT }]]],
    ['Abnahmebefund', [[{ bullet: false, text: FINDINGS_TEXT }]]],
  ];
  coverControl.replaceChildren(
    ...rows
      .filter(([, blocks]) => blocks.some((block) => block.length))
      .flatMap(([label, blocks]) => {
        const dt = document.createElement('div');
        dt.className = 'control-label';
        dt.textContent = label;
        const dd = document.createElement('div');
        dd.className = 'control-value';
        for (const block of blocks.filter((b) => b.length)) {
          let list: HTMLUListElement | null = null;
          for (const line of block) {
            if (line.bullet) {
              if (!list) dd.append((list = document.createElement('ul')));
              const li = document.createElement('li');
              li.textContent = line.text;
              list.append(li);
            } else {
              list = null;
              const p = document.createElement('p');
              p.textContent = line.text;
              dd.append(p);
            }
          }
        }
        return [dt, dd];
      })
  );
}

// ---------- Angaben zur Baukontrolle ----------

// Begangene Gebäudeteile: die Pläne des Projekts als Kacheln, mehrere wählbar
function renderPlans() {
  const { plans, settings } = current!;
  if (!plans.length) {
    const empty = document.createElement('div');
    empty.className = 'list-empty';
    empty.textContent = 'Das Projekt hat noch keine Pläne.';
    plansGrid.replaceChildren(empty);
    return;
  }
  plansGrid.replaceChildren(
    ...plans.map((plan) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'choice';
      btn.textContent = plan.name;
      const selected = settings.inspectedPlanIds?.includes(plan.id) ?? false;
      btn.classList.toggle('selected', selected);
      btn.setAttribute('aria-pressed', String(selected));
      btn.addEventListener('click', () => {
        const ids = settings.inspectedPlanIds ?? [];
        remember({ inspectedPlanIds: ids.includes(plan.id) ? ids.filter((id) => id !== plan.id) : [...ids, plan.id] });
        renderPlans();
        showSummaries();
      });
      return btn;
    })
  );
}

// Vorschläge für die Veranlassung aus der Liste (Stammdaten, auch per Excel einlesbar), ohne den,
// der schon im Feld steht. Die Liste wird beim Öffnen des Fensters geladen.
let occasions: string[] = [...OCCASIONS];

async function loadOccasions() {
  occasions = (await store.listMaster('occasion')).map((entry) => entry.name);
  renderOccasionChips();
}

function renderOccasionChips() {
  occasionChips.replaceChildren(
    ...occasions.filter((text) => text !== occasionInput.value.trim()).map(createOccasionChip)
  );
}

function createOccasionChip(text: string) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'btn soft suggestion';
  chip.textContent = text;
  chip.addEventListener('click', () => {
    occasionInput.value = text;
    occasionInput.dispatchEvent(new Event('input'));
  });
  return chip;
}
occasionInput.addEventListener('input', renderOccasionChips);

const controlFields: [HTMLInputElement | HTMLTextAreaElement, 'occasion' | 'documents' | 'executionState' | 'requiredProofs'][] = [
  [occasionInput, 'occasion'],
  [documentsInput, 'documents'],
  [executionInput, 'executionState'],
  [proofsInput, 'requiredProofs'],
];
for (const [input, key] of controlFields) {
  input.addEventListener('input', () => {
    remember({ [key]: input.value });
    showSummaries();
  });
}

// Die Textfelder wachsen mit ihrem Inhalt, statt selbst zu rollen. Im zugeklappten Abschnitt haben sie
// keine Höhe, darum auch beim Aufklappen.
const growing = [documentsInput, executionInput, proofsInput];
function grow(textarea: HTMLTextAreaElement) {
  textarea.style.height = 'auto';
  if (textarea.scrollHeight) textarea.style.height = `${textarea.scrollHeight + 2}px`;
}
for (const textarea of growing) textarea.addEventListener('input', () => grow(textarea));
document.getElementById('report-control')!.addEventListener('toggle', () => growing.forEach(grow));

initBulletField(documentsInput, document.getElementById('report-documents-bullet') as HTMLButtonElement);
initBulletField(proofsInput, document.getElementById('report-proofs-bullet') as HTMLButtonElement);

// ---------- Welche Punkttypen in den Bericht kommen ----------

function selectedLevels(): Importance[] {
  return current!.settings.reportLevels ?? DEFAULT_REPORT_LEVELS;
}

function showLevels() {
  const levels = selectedLevels();
  levelBtns.forEach((btn) => {
    const level = btn.dataset.level as Importance;
    const count = current!.pins.filter((pin) => pin.importance === level).length;
    btn.querySelector('.level-text')!.textContent = `${(count === 1 ? IMPORTANCE_TEXT : IMPORTANCE_PLURAL)[level]} (${count})`;
    const on = levels.includes(level);
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  });
  createBtn.disabled = levels.length === 0;
  formMessage.textContent = levels.length === 0 ? 'Mindestens einen Punkttyp für den Bericht wählen.' : '';
}

levelBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    const level = btn.dataset.level as Importance;
    const levels = selectedLevels();
    const next = levels.includes(level) ? levels.filter((l) => l !== level) : [...levels, level];
    remember({ reportLevels: IMPORTANCE.filter((l) => next.includes(l)) });
    showLevels();
  });
});

function showInspectionCount() {
  const inspections = current!.settings.inspections ?? [];
  inspectionsText.textContent = inspections.length
    ? `${inspections.length} ${inspections.length === 1 ? 'Begehung' : 'Begehungen'}, zuletzt am ${formatDate(inspections.at(-1)!.date)}`
    : 'Noch keine Begehung eingetragen.';
}

// Öffnet sich über dem Berichtsfenster. Danach gelten die geänderten Begehungen auch für den Bericht.
document.getElementById('report-inspections-btn')!.addEventListener('click', () => {
  const opened = current!;
  openInspectionsDialog(opened.project, (inspections) => {
    opened.settings.inspections = inspections;
    if (current === opened) {
      showInspectionCount();
      renderCover();
    }
  }).catch((err) => {
    console.error(err);
    formMessage.textContent = 'Die Begehungen konnten nicht geladen werden.';
  });
});

function showSection(section: HTMLElement) {
  for (const s of [formSection, progressSection, doneSection]) s.hidden = s !== section;
  reportX.hidden = section === progressSection; // während der Bericht entsteht, nur "Abbrechen"
}

function closeDialog() {
  dialog.hidden = true;
  result = null;
  for (const key of Object.keys(images) as ImageKey[]) showImage(key, true);
  current = null;
}

// ---------- Eingaben werden sofort gemerkt ----------

function remember(changes: Partial<ReportSettings>) {
  Object.assign(current!.settings, changes);
  store.saveReportSettings(current!.project.id, changes).catch((err) => {
    console.error(err);
    formMessage.textContent = 'Die Angaben konnten nicht gespeichert werden. Ist der Speicher voll?';
  });
}

nameInput.addEventListener('input', () => {
  // Nur abweichende Namen merken, sonst gilt der aktuelle Projektname
  const name = nameInput.value.trim();
  remember({ name: name === current!.project.name ? '' : name });
  renderCover();
  showSummaries();
});
addressInput.addEventListener('input', () => {
  remember({ address: addressInput.value });
  renderCover();
});
for (const { key } of PARTIES) {
  partyInputs[key].addEventListener('input', () => {
    remember({ [key]: partyInputs[key].value });
    renderCover();
    showSummaries();
  });
}
creatorInput.addEventListener('input', () => {
  remember({ creator: creatorInput.value });
  renderCover();
});
initDateTile(dateInput, { clearable: false });
dateInput.addEventListener('input', () => {
  // Ein Datum muss sein: Wird es geleert, gilt wieder heute
  if (!dateInput.value) dateInput.value = todayIso();
  showDate(dateInput);
  renderCover();
});

for (const [key, { prefix, maxSide, quality }] of Object.entries(images) as [ImageKey, ImageSlot][]) {
  const input = document.getElementById(`${prefix}-input`) as HTMLInputElement;

  document.getElementById(`${prefix}-btn`)!.addEventListener('click', () => input.click());

  input.addEventListener('change', async () => {
    const file = input.files![0];
    input.value = '';
    if (!file) return;
    try {
      remember({ [key]: await shrinkPhoto(file, maxSide, quality) });
      formMessage.textContent = '';
      showImage(key);
    } catch (err) {
      console.error(err);
      formMessage.textContent = 'Das Bild konnte nicht gelesen werden.';
    }
  });

  document.getElementById(`${prefix}-remove`)!.addEventListener('click', () => {
    remember({ [key]: null });
    showImage(key);
  });

  document.getElementById(`${prefix}-reset`)?.addEventListener('click', () => {
    remember({ [key]: undefined });
    showImage(key);
  });
}

function showImage(key: ImageKey, clearOnly: boolean = false) {
  const { prefix, coverId, defaultSrc } = images[key];
  const preview = document.getElementById(`${prefix}-preview`) as HTMLImageElement;
  const cover = document.getElementById(coverId) as HTMLImageElement;
  const removeBtn = document.getElementById(`${prefix}-remove`) as HTMLElement;
  const resetBtn = document.getElementById(`${prefix}-reset`);

  if (preview.src.startsWith('blob:')) URL.revokeObjectURL(preview.src);
  preview.removeAttribute('src');
  cover.removeAttribute('src');
  if (clearOnly) return;

  const data = current!.settings[key];
  const isDefault = data === undefined;
  const src = data
    ? URL.createObjectURL(new Blob([data], { type: 'image/jpeg' }))
    : isDefault && defaultSrc;
  preview.hidden = !src;
  cover.hidden = !src;
  if (key === 'coverPhoto') photoPage.hidden = !src; // das Titelbild hat eine eigene Seite
  removeBtn.hidden = !src;
  if (resetBtn) resetBtn.hidden = isDefault;
  if (src) {
    preview.src = src;
    cover.src = src;
  }
  showSummaries();
}

// ---------- Erstellen ----------

document.getElementById('report-close')!.addEventListener('click', closeDialog);
reportX.addEventListener('click', closeDialog);
document.getElementById('report-done-close')!.addEventListener('click', closeDialog);
// Während der Bericht entsteht, bleibt das Fenster offen (dort gibt es nur "Abbrechen")
closeOnOutsideTap(dialog, () => clickVisible('report-close', 'report-done-close'));
document.getElementById('report-cancel')!.addEventListener('click', () => abortController?.abort());

document.getElementById('report-create')!.addEventListener('click', async () => {
  const { project, plans, pins, settings } = current!;
  abortController = new AbortController();
  progressBar.value = 0;
  progressText.textContent = 'Bericht wird vorbereitet …';
  showSection(progressSection);

  try {
    // Erst hier laden: So startet die App schneller, offline ist die Datei trotzdem da
    const { buildReport } = await import('./report.ts');
    const dateText = dateInput.value
      ? new Date(`${dateInput.value}T12:00:00`).toLocaleDateString('de-DE')
      : '';
    const blob = await buildReport({
      project,
      plans,
      pins,
      settings,
      levels: selectedLevels(),
      dateText,
      reportDate: dateInput.value || todayIso(), // Stichtag für überfällige Mängel
      signal: abortController.signal,
      onProgress: (done, total, text) => {
        progressBar.max = total;
        progressBar.value = done;
        progressText.textContent = text;
      },
    });

    const name = safeFileName(settings.name || project.name, 'Projekt');
    result = { blob, fileName: `Bauueberwachungsbericht ${name} ${dateInput.value || todayIso()}.pdf` };
    doneText.textContent = `Der Bericht ist fertig (${formatSize(blob.size)}).`;
    showSection(doneSection);
  } catch (err) {
    showSection(formSection);
    if ((err as Error).name === 'AbortError') {
      formMessage.textContent = 'Der Bericht wurde abgebrochen.';
    } else {
      console.error(err);
      formMessage.textContent = 'Der Bericht konnte nicht erstellt werden. Ist der Speicher voll?';
    }
  }
});

document.getElementById('report-save')!.addEventListener('click', async () => {
  try {
    const savedAt = await saveFile(result!);
    doneText.textContent = savedAt ? `Der Bericht wurde gespeichert unter ${savedAt}.` : 'Der Bericht wurde übergeben.';
  } catch (err) {
    if ((err as Error).name === 'AbortError') return; // Teilen-Fenster wurde einfach geschlossen
    console.error(err);
    doneText.textContent = 'Der Bericht konnte nicht gesichert werden.';
  }
});

function formatSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}
