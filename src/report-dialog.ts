// =============================================================
// Fenster "Bericht erstellen": Formular, Fortschritt, fertige Datei
// =============================================================

import * as store from './db.ts';
import { formatDate, todayIso } from './defects.ts';
import { reportLogoUrl } from './divisions.ts';
import { openInspectionsDialog } from './inspections-dialog.ts';
import { INFO_PAGE_PARTIES, PARTIES, createPartyFields } from './parties.ts';
import { shrinkPhoto } from './photos.ts';
import { activeProfileName } from './profiles.ts';
import { saveFile, safeFileName } from './share.ts';
import type { Defect, Plan, Project, ReportSettings } from './types.ts';

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
const infoPage = coverMeta.closest('.info-page') as HTMLElement;
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
  formMessage.textContent = '';
  for (const key of Object.keys(images) as ImageKey[]) showImage(key);
  showInspectionCount();
  renderCover();

  showSection(formSection);
  dialog.hidden = false;
}

// Vorschau von Deckblatt und Projektangaben: zeigt die Angaben so, wie drawCover und
// drawProjectInfo in report.ts sie setzen
function renderCover() {
  coverName.textContent = nameInput.value.trim() || current!.project.name;
  coverAddress.textContent = addressInput.value;
  coverNumberValue.textContent = partyInputs.projectNumber.value.trim();
  coverNumber.hidden = !coverNumberValue.textContent;
  coverDate.textContent = formatDate(dateInput.value);
  coverCreator.textContent = creatorInput.value;
  coverDate.hidden = coverDateLabel.hidden = !dateInput.value;
  coverCreator.hidden = coverCreatorLabel.hidden = !creatorInput.value;

  // Beteiligte vor Datum und Ersteller, nur die ausgefüllten
  for (const old of coverMeta.querySelectorAll('.cover-party')) old.remove();
  const parties = INFO_PAGE_PARTIES.filter(({ key }) => partyInputs[key].value.trim()).flatMap(({ key, label }) => {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = partyInputs[key].value.trim();
    for (const el of [dt, dd]) el.className = 'cover-party';
    return [dt, dd];
  });
  coverDateLabel.before(...parties);
  // Danach etwas Abstand, wie im Bericht
  const firstAfter = dateInput.value ? [coverDateLabel, coverDate] : [coverCreatorLabel, coverCreator];
  for (const el of [coverDateLabel, coverDate, coverCreatorLabel, coverCreator]) {
    el.classList.toggle('cover-gap', parties.length > 0 && firstAfter.includes(el));
  }
  // Ohne jede Angabe entfällt die Seite auch im Bericht
  infoPage.hidden = !parties.length && !dateInput.value && !creatorInput.value.trim();
}

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
    if (current === opened) showInspectionCount();
  }).catch((err) => {
    console.error(err);
    formMessage.textContent = 'Die Begehungen konnten nicht geladen werden.';
  });
});

function showSection(section: HTMLElement) {
  for (const s of [formSection, progressSection, doneSection]) s.hidden = s !== section;
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
});
addressInput.addEventListener('input', () => {
  remember({ address: addressInput.value });
  renderCover();
});
for (const { key } of PARTIES) {
  partyInputs[key].addEventListener('input', () => {
    remember({ [key]: partyInputs[key].value });
    renderCover();
  });
}
creatorInput.addEventListener('input', () => {
  remember({ creator: creatorInput.value });
  renderCover();
});
dateInput.addEventListener('input', renderCover);

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
  removeBtn.hidden = !src;
  if (resetBtn) resetBtn.hidden = isDefault;
  if (src) {
    preview.src = src;
    cover.src = src;
  }
}

// ---------- Erstellen ----------

document.getElementById('report-close')!.addEventListener('click', closeDialog);
document.getElementById('report-done-close')!.addEventListener('click', closeDialog);
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
    result = { blob, fileName: `Maengelbericht ${name} ${dateInput.value || todayIso()}.pdf` };
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
