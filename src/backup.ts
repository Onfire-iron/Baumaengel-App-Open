// =============================================================
// Backup: Projekte als ZIP-Datei sichern und wieder einlesen
// =============================================================
//
// Im ZIP liegen projekt.json (Texte, Punkte) sowie die PDFs und Fotos als normale
// Dateien. So kommst du notfalls auch ohne die App an deine Daten.
// Die Dateien werden nacheinander verarbeitet, damit große Projekte auf dem iPad
// nicht den Arbeitsspeicher sprengen.
//
// Sammelbackup: alle Projekte in einem ZIP. Jedes Projekt hat einen eigenen Ordner
// ("projekte/01 Name/") mit genau dem Inhalt eines einzelnen Backups, dazu kommt
// sammlung.json mit der Liste der Ordner. Die Projekte stecken bewusst nicht als
// ZIP im ZIP, sonst lägen auf dem iPad alle Daten zweimal im Speicher.

import {
  BlobReader,
  BlobWriter,
  TextReader,
  TextWriter,
  ZipReader,
  ZipWriter,
  configure,
} from '@zip.js/zip.js';
import type { Entry, FileEntry } from '@zip.js/zip.js';
import { readDetails, readMarking } from './defects.ts';
import { readDivision } from './divisions.ts';
import { PARTIES } from './parties.ts';
import { readInspections } from './inspections.ts';
import * as store from './db.ts';
import { readMarks } from './photos.ts';
import { safeFileName } from './share.ts';
import type {
  BackupCollectionFile,
  BackupFile,
  BackupPhoto,
  BackupReport,
  ExportedBackup,
  IncomingBackupFile,
  IncomingBackupPhoto,
  Project,
} from './types.ts';

type ProgressCallback = (text: string) => void;

const FORMAT = 'baumaengel-backup';
// 2: Wichtigkeit und "Erledigt" statt Status
// 3: feste Nummern, Gewerk, Firma, Termine, Bildunterschrift, Markierungen, Textbausteine
// 4: wer den Mangel erfasst hat (die Profile selbst gehören zum Gerät und kommen nicht mit)
// 5: Bereich (Büro) des Projekts, siehe divisions.ts
// 6: Beteiligte und Projektnummer im Teil "report", siehe parties.ts
// 7: Begehungen im Teil "report", siehe inspections.ts
// 8: Stufen Mangel, Hinweis, Intern statt Wichtig, Relevant, Hinweis (ältere werden umgesetzt,
//    siehe readMarking) und die Gewerke-Liste
const VERSION = 8;

const COLLECTION_FORMAT = 'baumaengel-sammelbackup';
const COLLECTION_VERSION = 1;

const REMIND_DEFECTS = 10; // so viele neue Mängel, oder ...
const REMIND_DAYS = 7; // ... so viele Tage seit dem letzten Backup, dann erinnert die App
const DAY = 24 * 60 * 60 * 1000;

configure({ useWebWorkers: false });

// Liefert den Grund für eine Backup-Erinnerung, oder null, wenn alles gesichert ist.
// Nach einem Import zählt das eingelesene Backup als letzte Sicherung.
export function backupReminder(project: Project, now: number = Date.now()): string | null {
  const last = project.lastBackupAt ?? project.createdAt;
  if (project.updatedAt <= last) return null;

  const newDefects = (project.nextDefectNumber ?? 1) - (project.lastBackupNumber ?? 1);
  const days = Math.floor((now - last) / DAY);
  if (newDefects >= REMIND_DEFECTS) {
    return `${newDefects} neue Mängel ${project.lastBackupAt ? 'seit dem letzten Backup' : 'und noch kein Backup'}`;
  }
  if (days < REMIND_DAYS) return null;
  return project.lastBackupAt ? `letztes Backup vor ${days} Tagen` : `seit ${days} Tagen kein Backup`;
}

// level 0 = nicht komprimieren: PDFs und JPEGs werden dadurch kaum kleiner, aber es dauert
function createZip() {
  return new ZipWriter(new BlobWriter('application/zip'), { level: 0 });
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export async function exportProject(projectId: number, onProgress?: ProgressCallback): Promise<ExportedBackup> {
  const zip = createZip();
  const { project, mark } = await writeProject(zip, projectId, '', onProgress);
  const blob = await zip.close();
  const safeName = safeFileName(project.name, 'Projekt');
  return {
    blob,
    fileName: `Baumaengel-Backup ${safeName} ${today()}.zip`,
    // Wird erst gespeichert, wenn die Datei wirklich gesichert wurde
    marks: [{ projectId, mark }],
  };
}

// Alle Projekte in einer Datei, für die regelmäßige Sicherung oder den Umzug auf ein anderes Gerät
export async function exportAllProjects(onProgress?: ProgressCallback): Promise<ExportedBackup> {
  const projects = await store.listProjects();
  const zip = createZip();
  const collection: BackupCollectionFile = {
    format: COLLECTION_FORMAT,
    version: COLLECTION_VERSION,
    exportedAt: Date.now(),
    projects: [],
  };
  const marks: ExportedBackup['marks'] = [];

  for (const [index, project] of projects.entries()) {
    const folder = `projekte/${String(index + 1).padStart(2, '0')} ${safeFileName(project.name, 'Projekt')}/`;
    const progress = (text: string) => onProgress?.(`Projekt ${index + 1} von ${projects.length}: ${text}`);
    const { mark } = await writeProject(zip, project.id, folder, progress);
    collection.projects.push({ name: project.name, folder });
    marks.push({ projectId: project.id, mark });
  }

  await zip.add('sammlung.json', new TextReader(JSON.stringify(collection, null, 2)));
  const blob = await zip.close();
  return {
    blob,
    fileName: `Baumaengel-Sammelbackup ${today()} (${projects.length} Projekte).zip`,
    marks,
  };
}

// Schreibt ein Projekt ins ZIP. folder ist beim einzelnen Backup leer, im Sammelbackup der
// Ordner des Projekts. Die Dateinamen in projekt.json gelten immer relativ zu diesem Ordner.
async function writeProject(
  zip: ZipWriter<Blob>,
  projectId: number,
  folder: string,
  onProgress?: ProgressCallback
) {
  const project = (await store.getProject(projectId))!;
  const startedAt = Date.now();
  const plans = await store.listPlans(projectId);
  const pins = await store.listPins(projectId);
  const addBytes = (name: string, data: ArrayBuffer) =>
    zip.add(folder + name, new BlobReader(new Blob([data])));

  const backup: BackupFile = {
    format: FORMAT,
    version: VERSION,
    exportedAt: startedAt,
    project: {
      name: project.name,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      nextDefectNumber: project.nextDefectNumber,
      division: project.division ?? null,
    },
    plans: [],
    defects: [],
    textBlocks: (await store.listTextBlocks()).map((block) => block.text),
    trades: (await store.listTrades()).map((trade) => trade.name),
  };

  for (const [index, plan] of plans.entries()) {
    onProgress?.(`Plan ${index + 1} von ${plans.length} wird gesichert …`);
    const file = `plaene/plan-${index + 1}.pdf`;
    await addBytes(file, await store.getPlanData(plan.id));
    backup.plans.push({ id: plan.id, name: plan.name, pageCount: plan.pageCount, file });
  }

  for (const [index, pin] of pins.entries()) {
    onProgress?.(`Mangel ${index + 1} von ${pins.length} wird gesichert …`);
    const photos = await store.getPhotos(pin.id);
    const files: BackupPhoto[] = [];
    for (const [photoIndex, photo] of photos.entries()) {
      const file = `fotos/mangel-${index + 1}-foto-${photoIndex + 1}.jpg`;
      await addBytes(file, photo.data);
      files.push({ file, caption: photo.caption ?? '', marks: photo.marks ?? [] });
    }
    backup.defects.push({
      number: pin.number,
      trade: pin.trade,
      company: pin.company,
      foundAt: pin.foundAt,
      dueDate: pin.dueDate,
      doneAt: pin.doneAt,
      createdBy: pin.createdBy,
      planId: pin.planId,
      page: pin.page,
      x: pin.x,
      y: pin.y,
      title: pin.title,
      notes: pin.notes,
      importance: pin.importance,
      done: pin.done,
      photos: files,
    });
  }

  // Angaben für den Bericht (Backups von Etappe 3 haben diesen Teil noch nicht)
  const settings = await store.getReportSettings(projectId);
  if (settings) {
    backup.report = { name: settings.name, address: settings.address, creator: settings.creator } as BackupReport;
    for (const { key } of PARTIES) if (settings[key]) backup.report[key] = settings[key];
    if (settings.inspections?.length) backup.report.inspections = settings.inspections;
    if (settings.coverPhoto) {
      backup.report.coverPhoto = 'bericht/titelbild.jpg';
      await addBytes(backup.report.coverPhoto as string, settings.coverPhoto);
    }
    if (settings.logo) {
      backup.report.logo = 'bericht/logo.jpg';
      await addBytes(backup.report.logo as string, settings.logo);
    } else if (settings.logo === null) {
      backup.report.logo = null; // bewusst kein Logo; fehlt die Angabe, gilt das Standardlogo
    }
  }

  await zip.add(folder + 'projekt.json', new TextReader(JSON.stringify(backup, null, 2)));
  return { project, mark: { lastBackupAt: startedAt, lastBackupNumber: project.nextDefectNumber } };
}

// ---------- Einlesen ----------

type Entries = Map<string, Entry>;

// Was in der Datei steckt, bevor etwas eingelesen wird. Ein einzelnes Backup ist eine
// Sammlung mit nur einem Projekt im Ordner "".
export interface BackupContents {
  collection: boolean;
  projects: { name: string; folder: string }[];
}

export interface ImportResult {
  imported: number;
  failed: { name: string; message: string }[];
}

// Liest ein einzelnes Backup oder ein Sammelbackup ein. Vor dem Einlesen fragt confirm nach,
// ob es losgehen soll (false = abbrechen, dann kommt null zurück).
// Jedes Projekt wird neu angelegt, ein vorhandenes wird nie überschrieben. Scheitert ein Projekt
// im Sammelbackup, geht es mit den übrigen weiter.
export async function importBackup(
  file: Blob,
  onProgress?: ProgressCallback,
  confirm?: (contents: BackupContents) => boolean
): Promise<ImportResult | null> {
  const zip = new ZipReader(new BlobReader(file));
  try {
    const entries: Entries = new Map((await zip.getEntries()).map((entry) => [entry.filename, entry]));
    const contents = await readContents(entries);
    if (confirm && !confirm(contents)) return null;

    // Ein einzelnes Backup meldet Fehler direkt, wie bisher
    if (!contents.collection) {
      await importProjectFrom(entries, '', onProgress);
      return { imported: 1, failed: [] };
    }

    const result: ImportResult = { imported: 0, failed: [] };
    const total = contents.projects.length;
    for (const [index, { name, folder }] of contents.projects.entries()) {
      const progress = (text: string) => onProgress?.(`Projekt ${index + 1} von ${total}: ${text}`);
      try {
        await importProjectFrom(entries, folder, progress);
        result.imported++;
      } catch (err) {
        console.error(err);
        result.failed.push({ name, message: (err as Error).message });
      }
    }
    return result;
  } finally {
    await zip.close().catch(() => {});
  }
}

async function readJson(entries: Entries, name: string): Promise<unknown> {
  const entry = entries.get(name);
  if (!entry || entry.directory) return undefined;
  return JSON.parse(await (entry as FileEntry).getData(new TextWriter()));
}

async function readContents(entries: Entries): Promise<BackupContents> {
  const collection = (await readJson(entries, 'sammlung.json')) as Partial<BackupCollectionFile> | undefined;
  if (!collection) {
    const backup = (await readJson(entries, 'projekt.json')) as IncomingBackupFile | undefined;
    checkFormat(backup);
    return { collection: false, projects: [{ name: String(backup.project?.name ?? ''), folder: '' }] };
  }

  if (collection.format !== COLLECTION_FORMAT || !Array.isArray(collection.projects)) {
    throw new Error('Das ist kein Baumängel-Backup.');
  }
  if (Number(collection.version) > COLLECTION_VERSION) {
    throw new Error('Das Backup stammt von einer neueren App-Version. Bitte erst die App aktualisieren.');
  }
  const projects = collection.projects
    .filter((p) => p && typeof p.folder === 'string' && entries.has(`${p.folder}projekt.json`))
    .map((p) => ({ name: String(p.name ?? ''), folder: p.folder }));
  if (projects.length !== collection.projects.length) throw new Error('Das Backup ist beschädigt.');
  return { collection: true, projects };
}

function checkFormat(backup: IncomingBackupFile | undefined): asserts backup is IncomingBackupFile {
  if (!backup || backup.format !== FORMAT) throw new Error('Das ist kein Baumängel-Backup.');
  if (backup.version > VERSION) {
    throw new Error('Das Backup stammt von einer neueren App-Version. Bitte erst die App aktualisieren.');
  }
}

// Legt ein Projekt aus dem Ordner folder neu an.
// Das Projekt bleibt versteckt ("importing"), bis wirklich alles eingelesen ist.
async function importProjectFrom(entries: Entries, folder: string, onProgress?: ProgressCallback): Promise<number> {
  let projectId: number | null = null;

  try {
    const readBytes = async (name: string) => {
      const entry = entries.get(folder + name);
      if (!entry || entry.directory) throw new Error(`Datei fehlt im Backup: ${folder + name}`);
      const blob = await (entry as FileEntry).getData(new BlobWriter(), { checkSignature: true });
      return blob.arrayBuffer();
    };

    const backup = (await readJson(entries, `${folder}projekt.json`)) as IncomingBackupFile | undefined;
    checkFormat(backup);

    const names = (await store.listProjects()).map((p) => p.name);
    const name = names.includes(backup.project.name as string)
      ? `${backup.project.name} (Import ${new Date().toLocaleDateString('de-DE')})`
      : String(backup.project.name);
    // Ältere Backups und unbekannte Bereiche: ohne Bereich
    projectId = await store.addProject(name, { importing: true, division: readDivision(backup.project.division) });

    const planIds = new Map<number, number>(); // alte id aus dem Backup -> neue id
    for (const [index, plan] of backup.plans.entries()) {
      onProgress?.(`Plan ${index + 1} von ${backup.plans.length} wird eingelesen …`);
      const data = await readBytes(plan.file);
      planIds.set(plan.id, await store.addPlan(projectId, String(plan.name), data, plan.pageCount ?? null));
    }

    for (const [index, defect] of backup.defects.entries()) {
      onProgress?.(`Mangel ${index + 1} von ${backup.defects.length} wird eingelesen …`);
      if (!planIds.has(defect.planId)) throw new Error('Das Backup ist beschädigt.');
      // Alte Backups haben keine Nummern. Sie sind in Erfassungs-Reihenfolge gespeichert,
      // darum vergibt addPin dieselben Nummern, die dort angezeigt wurden.
      const number = Number.isInteger(defect.number) && defect.number! > 0 ? defect.number : undefined;
      const pinId = await store.addPin({
        projectId,
        number,
        ...readDetails(defect),
        planId: planIds.get(defect.planId)!,
        page: Number(defect.page) || 1,
        x: Math.min(1, Math.max(0, Number(defect.x) || 0)),
        y: Math.min(1, Math.max(0, Number(defect.y) || 0)),
        title: String(defect.title ?? ''),
        notes: String(defect.notes ?? ''),
        ...readMarking(defect), // versteht auch alte Backups mit "status"
      });
      for (const entry of defect.photos ?? []) {
        // Alte Backups führen hier nur den Dateinamen
        const photo: IncomingBackupPhoto = typeof entry === 'string' ? { file: entry } : entry;
        await store.addPhoto({ id: pinId, projectId: projectId! }, await readBytes(photo.file), {
          caption: String(photo.caption ?? ''),
          marks: readMarks(photo.marks),
        });
      }
    }

    if (Array.isArray(backup.textBlocks)) {
      await store.addMissingTextBlocks(backup.textBlocks.filter((text) => typeof text === 'string' && text) as string[]);
    }

    if (Array.isArray(backup.trades)) {
      await store.addMissingTrades(backup.trades.filter((name) => typeof name === 'string' && name.trim()) as string[]);
    }

    if (backup.report) {
      const report = backup.report;
      await store.saveReportSettings(projectId, {
        name: String(report.name ?? ''),
        address: String(report.address ?? ''),
        // Beteiligte gibt es erst seit Version 6, ältere Backups haben sie nicht
        ...Object.fromEntries(PARTIES.map(({ key }) => [key, String(report[key] ?? '')])),
        creator: String(backup.report.creator ?? ''),
        inspections: readInspections(report.inspections),
        coverPhoto: backup.report.coverPhoto ? await readBytes(backup.report.coverPhoto) : null,
        logo: backup.report.logo ? await readBytes(backup.report.logo) : (backup.report.logo as null | undefined),
      });
    }

    // Auch die Nummern gelöschter Mängel bleiben gesperrt, siehe addPin
    const imported = await store.getProject(projectId);
    const nextDefectNumber = Math.max(
      imported!.nextDefectNumber,
      Number(backup.project.nextDefectNumber) || 0
    );

    // Zeitstempel erst hier setzen, die Einlese-Schritte haben "updatedAt" verändert
    await store.updateProject(projectId, {
      importing: false,
      createdAt: backup.project.createdAt ?? Date.now(),
      updatedAt: backup.project.updatedAt ?? Date.now(),
      nextDefectNumber,
      lastBackupAt: backup.exportedAt ?? Date.now(),
      lastBackupNumber: nextDefectNumber,
    });
    return projectId;
  } catch (err) {
    if (projectId !== null) await store.deleteProject(projectId).catch(() => {});
    throw err;
  }
}

