// =============================================================
// Speicher: alles liegt mit Dexie in der IndexedDB des Browsers
// =============================================================

import Dexie from 'dexie';
import type { EntityTable } from 'dexie';
import { DEFAULT_TEXT_BLOCKS, IMPORTANCE, TRADES, readMarking } from './defects.ts';
import { defaultEntries, defaultUid, nameKey, newUid } from './master-entries.ts';
import type { PartyKey } from './parties.ts';
import type {
  Defect,
  Importance,
  Inspection,
  NewDefect,
  Photo,
  Plan,
  PlanData,
  Profile,
  Project,
  ProjectStats,
  ReportSettings,
  MasterEntry,
  MasterKind,
  TextBlock,
} from './types.ts';

// Die Tabellen entstehen erst durch die Versionen unten, darum hier die Angabe, was drinliegt.
// Das zweite Argument nennt das Feld mit dem Schlüssel.
export const db = new Dexie('baumaengel') as Dexie & {
  projects: EntityTable<Project, 'id'>;
  planMeta: EntityTable<Plan, 'id'>;
  planData: EntityTable<PlanData, 'planId'>;
  defects: EntityTable<Defect, 'id'>;
  photos: EntityTable<Photo, 'id'>;
  reportSettings: EntityTable<ReportSettings, 'projectId'>;
  textBlocks: EntityTable<TextBlock, 'id'>;
  profiles: EntityTable<Profile, 'id'>;
  masterData: EntityTable<MasterEntry, 'uid'>;
};

// Hinter dem Namen stehen nur die Felder, nach denen gesucht wird.
// PDF und Fotos liegen als ArrayBuffer (rohe Bytes) in der Datenbank,
// weil Safari mit Blobs in IndexedDB immer wieder Probleme hatte.

// Etappe 2: genau ein Plan, ohne Projekte
db.version(1).stores({
  plans: 'id', // { id: 'current', name, data }
  pins: 'id', // { id, x, y, title, notes, status }
  photos: '++id, pinId', // { id, pinId, data }
});

// Etappe 3: Projekte mit mehreren Plänen
db.version(2)
  .stores({
    projects: '++id', // { id, name, createdAt, updatedAt, lastPlanId, lastPage, importing }
    planMeta: '++id, projectId', // { id, projectId, name, pageCount, createdAt, thumb }
    planData: 'planId', // { planId, data } – getrennt, damit Listen nicht alle PDFs laden
    defects: '++id, projectId, planId', // { id, projectId, planId, page, x, y, title, notes, status }
    photos: '++id, pinId', // { id, pinId, data } – pinId ist die id aus "defects"
    plans: null,
    pins: null,
  })
  .upgrade(async (tx) => {
    // Daten aus Etappe 2 in ein erstes Projekt übernehmen. Die Punkte behalten ihre
    // id, damit die Fotos weiter passen. Läuft alles in einer Transaktion:
    // Geht etwas schief, bleiben die alten Daten unverändert.
    const oldPlan = await tx.table('plans').get('current');
    if (!oldPlan) return;

    const now = Date.now();
    const projectId = await tx.table('projects').add({
      name: oldPlan.name.replace(/\.pdf$/i, ''),
      createdAt: now,
      updatedAt: now,
    });
    const planId = await tx.table('planMeta').add({
      projectId,
      name: oldPlan.name.replace(/\.pdf$/i, ''),
      pageCount: null, // wird beim ersten Öffnen ergänzt
      createdAt: now,
    });
    await tx.table('planData').add({ planId, data: oldPlan.data });

    const oldPins = await tx.table('pins').toArray();
    await tx.table('defects').bulkAdd(oldPins.map((pin) => ({ ...pin, projectId, planId, page: 1 })));
  });

// Etappe 4: Angaben für den Bericht pro Projekt merken
db.version(3).stores({
  // logo: fehlt = Standardlogo (public/logo.png), null = kein Logo, sonst eigenes Bild
  reportSettings: 'projectId', // { projectId, name, address, creator, coverPhoto, logo }
});

// Wichtigkeit und "Erledigt" statt Status: Aus "offen" wird "Wichtig", aus "erledigt"
// wird "Wichtig" plus "Erledigt". Geht etwas schief, bleiben die alten Daten unverändert.
db.version(4)
  .stores({
    defects: '++id, projectId, planId', // { id, projectId, planId, page, x, y, title, notes, importance, done }
  })
  .upgrade((tx) =>
    tx.table('defects').toCollection().modify((pin) => {
      Object.assign(pin, readMarking(pin));
      delete pin.status;
    })
  );

// Feste Nummern, Gewerk, Firma, Termine und Textbausteine. Die Nummern entsprechen genau
// den bisher angezeigten, denn toCollection liefert die Mängel nach id sortiert.
// Ein altes Datum "festgestellt am" ist unbekannt und bleibt darum leer.
db.version(5)
  .stores({
    // defects zusätzlich: { number, trade, company, foundAt, dueDate, doneAt }
    // photos zusätzlich: { caption, marks }
    // projects zusätzlich: { nextDefectNumber, lastBackupAt, lastBackupNumber }
    textBlocks: '++id', // { id, text } – gelten für alle Projekte
  })
  .upgrade(async (tx) => {
    const counts = new Map<number, number>();
    await tx.table('defects').toCollection().modify((pin) => {
      const number = (counts.get(pin.projectId) ?? 0) + 1;
      counts.set(pin.projectId, number);
      Object.assign(pin, { number, trade: '', company: '', foundAt: null, dueDate: null, doneAt: null });
    });
    await tx.table('projects').toCollection().modify((project) => {
      project.nextDefectNumber = (counts.get(project.id) ?? 0) + 1;
    });
    await tx.table('textBlocks').bulkAdd(DEFAULT_TEXT_BLOCKS.map((text) => ({ text })));
  });

// Profile: Neue Mängel merken sich, wer sie erfasst hat. Bei den vorhandenen ist das unbekannt.
db.version(6)
  .stores({
    // defects zusätzlich: { createdBy } – der Name als Text, damit er auch im Backup und
    // nach dem Löschen des Profils erhalten bleibt
    profiles: '++id', // { id, name } – gelten nur auf diesem Gerät
  })
  .upgrade((tx) =>
    tx.table('defects').toCollection().modify((pin) => {
      pin.createdBy = null;
    })
  );

// Reihenfolge der Pläne: Bisher galt die Reihenfolge des Hinzufügens, also die der ids.
// Die bleibt erhalten, kann jetzt aber im Plan-Menü geändert werden.
db.version(7)
  .stores({
    planMeta: '++id, projectId', // zusätzlich: { position }
  })
  .upgrade(async (tx) => {
    const plans = await tx.table('planMeta').toArray();
    const counts = new Map<number, number>();
    for (const plan of plans.sort((a, b) => a.id - b.id)) {
      const position = counts.get(plan.projectId) ?? 0;
      counts.set(plan.projectId, position + 1);
      await tx.table('planMeta').update(plan.id, { position });
    }
  });

// Bereiche (Büros): Jedes Projekt gehört zu einem Bereich oder zu keinem. Die vorhandenen Projekte
// kommen unter "Ohne Bereich" und lassen sich über "Projekt bearbeiten" zuordnen.
db.version(8)
  .stores({
    projects: '++id', // zusätzlich: { division } – die id aus divisions.ts, null = ohne Bereich
  })
  .upgrade((tx) =>
    tx.table('projects').toCollection().modify((project) => {
      project.division ??= null;
    })
  );

// Neue Stufen (Etappe 4.24): Wichtig wird zu Mangel, Relevant zu Intern, Hinweis bleibt (readMarking).
// Dazu die Gewerke-Liste für das Auswahlfenster, gefüllt mit den bisherigen Vorschlägen.
db.version(9)
  .stores({
    trades: '++id', // { id, name } – gelten für alle Projekte
  })
  .upgrade(async (tx) => {
    await tx.table('defects').toCollection().modify((pin) => {
      pin.importance = readMarking(pin).importance;
    });
    await tx.table('trades').bulkAdd(TRADES.map((name) => ({ name })));
  });

// Stammdaten (Etappe 4.29): Die Gewerke ziehen in die gemeinsame Tabelle masterData um und bekommen
// feste Kennungen, Änderungszeit und Lösch-Vermerk für den Abgleich (master-entries.ts). Vorgaben
// behalten ihre feste uid, selbst angelegte Gewerke bekommen eine neue. Die Tabelle trades entfällt
// (Dexie löscht sie erst nach dieser Umstellung, darum lässt sie sich hier noch lesen).
db.version(10)
  .stores({
    masterData: 'uid, kind', // { uid, kind, name, updatedAt, deleted }
    trades: null,
  })
  .upgrade(async (tx) => {
    const defaults = new Set(TRADES.map(nameKey));
    const now = Date.now();
    const entries = new Map<string, MasterEntry>();
    for (const { name } of await tx.table('trades').toArray()) {
      const isDefault = defaults.has(nameKey(name));
      const uid = isDefault ? defaultUid('trade', name) : newUid();
      if (!entries.has(nameKey(name))) {
        entries.set(nameKey(name), { uid, kind: 'trade', name, updatedAt: isDefault ? 0 : now, deleted: false });
      }
    }
    // Gelöschte Vorgaben bekommen einen Lösch-Vermerk, sonst kämen sie beim Abgleich zurück
    for (const entry of defaultEntries()) {
      if (!entries.has(nameKey(entry.name))) entries.set(nameKey(entry.name), { ...entry, deleted: true, updatedAt: now });
    }
    await tx.table('masterData').bulkAdd([...entries.values()]);
  });

// Läuft nur beim allerersten Start, sonst übernehmen das die Umstellungen oben
db.on('populate', async (tx) => {
  await tx.table('textBlocks').bulkAdd(DEFAULT_TEXT_BLOCKS.map((text) => ({ text })));
  await tx.table('masterData').bulkAdd(defaultEntries());
});

// ---------- Projekte ----------

export async function listProjects() {
  const projects = await db.projects.toArray();
  return projects.filter((p) => !p.importing).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getProject(id: number) {
  return db.projects.get(id);
}

export function addProject(name: string, extra: Partial<Project> = {}) {
  const now = Date.now();
  return db.projects.add({ name, createdAt: now, updatedAt: now, nextDefectNumber: 1, ...extra });
}

export function updateProject(id: number, changes: Partial<Project>) {
  return db.projects.update(id, changes);
}

// Name, Adresse und Beteiligte aus dem Fenster "Neues Projekt". Adresse und Beteiligte liegen bei
// den Angaben für den Bericht: Es gibt sie nur einmal pro Projekt, eine Korrektur gilt so überall.
export type ProjectDetails = Pick<ReportSettings, 'address' | PartyKey>;

export function createProject(name: string, details: ProjectDetails, division: string | null) {
  return db.transaction('rw', db.projects, db.reportSettings, async () => {
    const id = await addProject(name, { division });
    if (Object.values(details).some(Boolean)) await saveReportSettings(id, details);
    return id;
  });
}

export function saveProjectDetails(id: number, name: string, details: ProjectDetails, division: string | null) {
  return db.transaction('rw', db.projects, db.reportSettings, async () => {
    await db.projects.update(id, { name, division, updatedAt: Date.now() });
    await saveReportSettings(id, details);
  });
}

// Für die Anzeige "zuletzt geändert"
function touchProject(id: number) {
  return db.projects.update(id, { updatedAt: Date.now() });
}

// open: offene Mängel je Wichtigkeit, doneCount: erledigte Mängel
export async function getProjectStats(id: number): Promise<ProjectStats> {
  const [planCount, defects] = await Promise.all([
    db.planMeta.where('projectId').equals(id).count(),
    db.defects.where('projectId').equals(id).toArray(),
  ]);
  const open = Object.fromEntries(IMPORTANCE.map((level) => [level, 0])) as Record<Importance, number>;
  let doneCount = 0;
  for (const defect of defects) {
    const { importance, done } = readMarking(defect);
    if (done) doneCount++;
    else open[importance]++;
  }
  return { planCount, defectCount: defects.length, open, doneCount };
}

export function deleteProject(id: number) {
  const tables = [db.projects, db.planMeta, db.planData, db.defects, db.photos, db.reportSettings];
  return db.transaction('rw', tables, async () => {
    await db.reportSettings.delete(id);
    const planIds = await db.planMeta.where('projectId').equals(id).primaryKeys();
    const defectIds = await db.defects.where('projectId').equals(id).primaryKeys();
    await db.photos.where('pinId').anyOf(defectIds).delete();
    await db.defects.where('projectId').equals(id).delete();
    await db.planData.bulkDelete(planIds);
    await db.planMeta.where('projectId').equals(id).delete();
    await db.projects.delete(id);
  });
}

// Ein abgebrochener Import (z. B. App geschlossen) hinterlässt ein halbes Projekt
export async function removeUnfinishedImports() {
  const projects = await db.projects.toArray();
  for (const project of projects) {
    if (project.importing) await deleteProject(project.id);
  }
}

// ---------- Angaben für den Bericht ----------

export function getReportSettings(projectId: number) {
  return db.reportSettings.get(projectId);
}

// Für die Suche auf der Startseite: Projekt-id -> Angaben
export async function getAllReportSettings() {
  const all = await db.reportSettings.toArray();
  return new Map(all.map((settings) => [settings.projectId, settings]));
}

export function saveReportSettings(projectId: number, changes: Partial<ReportSettings>) {
  return db.transaction('rw', db.reportSettings, async () => {
    const settings = (await db.reportSettings.get(projectId)) ?? { projectId };
    await db.reportSettings.put({ ...settings, ...changes });
  });
}

// Begehungen (siehe inspections.ts): immer die ganze Liste, sie ist klein
export function saveInspections(projectId: number, inspections: Inspection[]) {
  return db.transaction('rw', db.reportSettings, db.projects, async () => {
    await saveReportSettings(projectId, { inspections });
    await touchProject(projectId);
  });
}

// ---------- Pläne ----------

// In der festgelegten Reihenfolge. Das Backup schreibt die Pläne in dieser Reihenfolge, und der
// Import legt sie nacheinander an. So reist die Reihenfolge ohne eigenes Feld im Backup mit.
export async function listPlans(projectId: number) {
  const plans = await db.planMeta.where('projectId').equals(projectId).toArray();
  return plans.sort((a, b) => a.position - b.position || a.id - b.id);
}

// Ein neuer Plan kommt ans Ende der Liste
export function addPlan(projectId: number, name: string, data: ArrayBuffer, pageCount: number | null) {
  return db.transaction('rw', db.projects, db.planMeta, db.planData, async () => {
    const others = await db.planMeta.where('projectId').equals(projectId).toArray();
    const position = others.reduce((max, plan) => Math.max(max, plan.position + 1), 0);
    const planId = await db.planMeta.add({ projectId, name, pageCount, createdAt: Date.now(), position });
    await db.planData.add({ planId, data });
    await touchProject(projectId);
    return planId;
  });
}

export async function getPlanData(planId: number) {
  const row = await db.planData.get(planId);
  return row!.data;
}

// Tauscht das PDF aus, die Mängel bleiben. Hat der neue Plan weniger Seiten,
// wandern die Mängel von den weggefallenen Seiten auf die letzte Seite.
export function replacePlan(plan: Plan, name: string, data: ArrayBuffer, pageCount: number) {
  return db.transaction('rw', db.projects, db.planMeta, db.planData, db.defects, async () => {
    await db.planData.put({ planId: plan.id, data });
    await db.planMeta.update(plan.id, { name, pageCount, thumb: null }); // Vorschau neu erzeugen
    await db.defects
      .where('planId')
      .equals(plan.id)
      .filter((pin) => pin.page > pageCount)
      .modify({ page: pageCount });
    await touchProject(plan.projectId);
  });
}

// Speichert die Reihenfolge aus dem Plan-Menü: Die Liste nennt alle Pläne eines Projekts
export function setPlanOrder(planIds: number[]) {
  return db.transaction('rw', db.planMeta, () =>
    Promise.all(planIds.map((id, position) => db.planMeta.update(id, { position })))
  );
}

export function setPlanPageCount(planId: number, pageCount: number) {
  return db.planMeta.update(planId, { pageCount });
}

export function setPlanThumb(planId: number, thumb: ArrayBuffer) {
  return db.planMeta.update(planId, { thumb });
}

export function deletePlan(plan: Plan) {
  return db.transaction('rw', db.projects, db.planMeta, db.planData, db.defects, db.photos, async () => {
    const defectIds = await db.defects.where('planId').equals(plan.id).primaryKeys();
    await db.photos.where('pinId').anyOf(defectIds).delete();
    await db.defects.where('planId').equals(plan.id).delete();
    await db.planData.delete(plan.id);
    await db.planMeta.delete(plan.id);
    await touchProject(plan.projectId);
  });
}

// ---------- Mängelpunkte ----------

// Sortiert nach id, also in Erfassungs-Reihenfolge
export async function listPins(projectId: number) {
  const pins = await db.defects.where('projectId').equals(projectId).toArray();
  return pins.sort((a, b) => a.id - b.id);
}

// Vergibt die nächste freie Nummer, außer der Mangel bringt schon eine mit (Backup).
// Der Zähler läuft nur vorwärts, die Nummer eines gelöschten Mangels kommt nie wieder.
export function addPin(pin: NewDefect) {
  return db.transaction('rw', db.projects, db.defects, async () => {
    const project = await db.projects.get(pin.projectId);
    const next = project!.nextDefectNumber ?? 1;
    pin.number ??= next;
    await db.projects.update(pin.projectId, {
      nextDefectNumber: Math.max(next, pin.number + 1),
      updatedAt: Date.now(),
    });
    return db.defects.add(pin as Defect);
  });
}

export function savePin(pin: Defect) {
  touchProject(pin.projectId);
  return db.defects.put(pin);
}

// Rückgängig/Wiederholen (history.ts): bringt einen Mangel genau auf einen früheren Stand, mit
// derselben id und Nummer. photos: die Fotos des Mangels genau auf diesen Stand bringen (fehlt = Fotos
// bleiben, wie sie sind). Der Zähler für neue Nummern läuft dabei mit.
export function restorePin(pin: Defect, photos?: Photo[]) {
  return db.transaction('rw', db.projects, db.defects, db.photos, async () => {
    await db.defects.put(pin);
    if (photos) {
      await db.photos.where('pinId').equals(pin.id).delete();
      await db.photos.bulkPut(photos);
    }
    const project = await db.projects.get(pin.projectId);
    await db.projects.update(pin.projectId, {
      nextDefectNumber: Math.max(project?.nextDefectNumber ?? 1, pin.number + 1),
      updatedAt: Date.now(),
    });
  });
}

// Entfernt einen Mangel mit seinen Fotos wie deletePin. releaseNumber: Der Mangel wird gerade
// "ungesetzt" (Rückgängig nach dem Setzen). War er der zuletzt nummerierte, wird seine Nummer wieder frei.
export function removePin(pin: Defect, releaseNumber: boolean) {
  return db.transaction('rw', db.projects, db.defects, db.photos, async () => {
    await db.defects.delete(pin.id);
    await db.photos.where('pinId').equals(pin.id).delete();
    const project = await db.projects.get(pin.projectId);
    const release = releaseNumber && project?.nextDefectNumber === pin.number + 1;
    await db.projects.update(pin.projectId, {
      ...(release ? { nextDefectNumber: pin.number } : {}),
      updatedAt: Date.now(),
    });
  });
}

export function deletePin(pin: Defect) {
  touchProject(pin.projectId);
  return db.transaction('rw', db.defects, db.photos, async () => {
    await db.defects.delete(pin.id);
    await db.photos.where('pinId').equals(pin.id).delete();
  });
}

// ---------- Fotos ----------

export function getPhotos(pinId: number) {
  return db.photos.where('pinId').equals(pinId).toArray();
}

export function countPhotos(pinId: number) {
  return db.photos.where('pinId').equals(pinId).count();
}

export function addPhoto(
  pin: Pick<Defect, 'id' | 'projectId'>,
  data: ArrayBuffer,
  details: Pick<Photo, 'caption' | 'marks'> = {}
) {
  touchProject(pin.projectId);
  return db.photos.add({ pinId: pin.id, data, ...details });
}

export function updatePhoto(id: number, projectId: number, changes: Partial<Photo>) {
  touchProject(projectId);
  return db.photos.update(id, changes);
}

export function deletePhoto(id: number, projectId: number) {
  touchProject(projectId);
  return db.photos.delete(id);
}

// ---------- Textbausteine ----------

export async function listTextBlocks() {
  const blocks = await db.textBlocks.toArray();
  return blocks.sort((a, b) => a.text.localeCompare(b.text, 'de'));
}

export function addTextBlock(text: string) {
  return db.textBlocks.add({ text });
}

export function deleteTextBlock(id: number) {
  return db.textBlocks.delete(id);
}

// ---------- Stammdaten (Gewerke usw.), siehe master-entries.ts ----------

// Die Einträge einer Liste ohne die gelöschten, alphabetisch
export async function listMaster(kind: MasterKind) {
  const entries = await db.masterData.where('kind').equals(kind).toArray();
  return entries.filter((entry) => !entry.deleted).sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

// Alle Einträge mit den Lösch-Vermerken, zum Weitergeben
export function allMasterEntries() {
  return db.masterData.toArray();
}

// Legt einen Eintrag an. Gibt es den Namen schon, bleibt es bei dem; war er gelöscht, kommt er zurück.
export function addMaster(kind: MasterKind, name: string) {
  return db.transaction('rw', db.masterData, async () => {
    const key = nameKey(name);
    const same = (await db.masterData.where('kind').equals(kind).toArray()).filter((e) => nameKey(e.name) === key);
    const active = same.find((entry) => !entry.deleted);
    if (active) return active;
    if (same.length) {
      await db.masterData.update(same[0].uid, { name, deleted: false, updatedAt: Date.now() });
      return { ...same[0], name, deleted: false };
    }
    const entry: MasterEntry = { uid: newUid(), kind, name, updatedAt: Date.now(), deleted: false };
    await db.masterData.add(entry);
    return entry;
  });
}

// Lösch-Vermerk statt Entfernen. Mängel mit diesem Gewerk behalten es, es fehlt nur in der Auswahl.
export function deleteMaster(uid: string) {
  return db.masterData.update(uid, { deleted: true, updatedAt: Date.now() });
}

// Übernimmt Einträge von einem anderen Gerät (Datei, später SharePoint):
// - unbekannte Kennung: neu, außer es gibt den Namen hier schon (dann zählt der vorhandene Eintrag)
// - bekannte Kennung: die neuere Fassung gilt, auch für Löschungen
export function mergeMaster(incoming: MasterEntry[]) {
  return db.transaction('rw', db.masterData, async () => {
    const local = await db.masterData.toArray();
    const byUid = new Map(local.map((entry) => [entry.uid, entry]));
    const activeNames = new Set(local.filter((e) => !e.deleted).map((e) => `${e.kind}|${nameKey(e.name)}`));
    let added = 0;
    let changed = 0;
    for (const entry of incoming) {
      const known = byUid.get(entry.uid);
      if (!known) {
        const key = `${entry.kind}|${nameKey(entry.name)}`;
        if (activeNames.has(key)) continue;
        await db.masterData.add(entry);
        byUid.set(entry.uid, entry);
        if (!entry.deleted) {
          activeNames.add(key);
          added++;
        }
      } else if (entry.updatedAt > known.updatedAt) {
        await db.masterData.put(entry);
        byUid.set(entry.uid, entry);
        changed++;
      }
    }
    return { added, changed };
  });
}

// Ergänzt beim Import eines Projekt-Backups die Gewerke, die es hier noch nicht gibt (dort nur als Namen)
export async function addMissingTrades(names: string[]) {
  for (const name of new Set(names)) await addMaster('trade', name);
}

// ---------- Profile ----------

export async function listProfiles() {
  const profiles = await db.profiles.toArray();
  return profiles.sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

export function getProfile(id: number) {
  return db.profiles.get(id);
}

export function addProfile(name: string) {
  return db.profiles.add({ name });
}

// Die Mängel behalten den Namen, siehe Profile in types.ts
export function deleteProfile(id: number) {
  return db.profiles.delete(id);
}

// Ergänzt beim Import die Bausteine, die es auf diesem Gerät noch nicht gibt
export function addMissingTextBlocks(texts: string[]) {
  return db.transaction('rw', db.textBlocks, async () => {
    const known = new Set((await db.textBlocks.toArray()).map((block) => block.text));
    const missing = [...new Set(texts)].filter((text) => !known.has(text));
    await db.textBlocks.bulkAdd(missing.map((text) => ({ text })));
  });
}
