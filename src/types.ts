// =============================================================
// Zentrale Typen: So sehen die Daten der App aus
// =============================================================
//
// Diese Datei beschreibt nur und erzeugt keinen Programmcode. Beim Bauen fällt sie ganz weg.
// Die Felder entsprechen dem, was in der IndexedDB und in den Backups liegt, siehe db.ts.

import type { PartyKey } from './parties.ts';

// Mangel: muss behoben werden. Hinweis: gut zu wissen. Intern: nur für den Verfasser, z. B. Rückfragen.
export type Importance = 'mangel' | 'hinweis' | 'intern';

// Ein Datum als Text im Format JJJJ-MM-TT, null = kein Datum. Siehe defects.ts
export type IsoDate = string | null;

export interface Project {
  id: number;
  name: string;
  createdAt: number; // Zeitstempel in Millisekunden
  updatedAt: number;
  nextDefectNumber: number;
  lastPlanId?: number;
  lastPage?: number;
  importing?: boolean; // ein Import läuft noch, das Projekt bleibt versteckt
  lastBackupAt?: number;
  lastBackupNumber?: number;
  division?: string | null; // Bereich (Büro), siehe divisions.ts. null = ohne Bereich
}

// Ein Plan ohne die PDF-Daten, die liegen getrennt in PlanData
export interface Plan {
  id: number;
  projectId: number;
  name: string;
  pageCount: number | null; // null = noch unbekannt, wird beim ersten Öffnen ergänzt
  createdAt: number;
  position: number; // Reihenfolge im Projekt (Plan-Menü, Bericht, Backup), kleinste zuerst
  thumb?: ArrayBuffer | null;
}

export interface PlanData {
  planId: number;
  data: ArrayBuffer;
}

// Ein Mangel. x und y laufen von 0 bis 1, die Nummer gilt im ganzen Projekt.
export interface Defect {
  id: number;
  projectId: number;
  planId: number;
  number: number;
  page: number;
  x: number;
  y: number;
  title: string;
  notes: string;
  importance: Importance;
  done: boolean;
  trade: string;
  company: string;
  foundAt: IsoDate;
  dueDate: IsoDate;
  doneAt: IsoDate;
  createdBy: string | null; // Name des Profils beim Erfassen, null = unbekannt (ältere Mängel)
}

// Ein neuer Mangel: Die id vergibt die Datenbank, die Nummer vergibt addPin
export type NewDefect = Omit<Defect, 'id' | 'number'> & { number?: number };

// Pfeil oder Kreis auf einem Foto, Koordinaten von 0 bis 1
export interface PhotoMark {
  type: 'arrow' | 'circle';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Photo {
  id: number;
  pinId: number; // die id aus "defects"
  data: ArrayBuffer;
  caption?: string;
  marks?: PhotoMark[];
}

export interface TextBlock {
  id: number;
  text: string;
}

// Eintrag in der Gewerke-Liste (für alle Projekte), siehe trades-dialog.ts
export interface Trade {
  id: number;
  name: string;
}

// Begehung: wer an welchem Tag dabei war, siehe inspections.ts
export interface Participant {
  name: string;
  org: string; // Amt, Büro oder Firma
}

export interface Inspection {
  date: string; // JJJJ-MM-TT, immer gesetzt
  participants: Participant[];
}

// Beteiligte (Bauherrschaft usw.), siehe parties.ts
export type PartyTexts = Partial<Record<PartyKey, string>>;

export interface ReportSettings extends PartyTexts {
  projectId: number;
  name?: string;
  address?: string;
  creator?: string;
  coverPhoto?: ArrayBuffer | null;
  logo?: ArrayBuffer | null; // fehlt = Standardlogo, null = kein Logo, sonst eigenes Bild
  inspections?: Inspection[]; // nach Datum sortiert, älteste zuerst
  // Welche Punkttypen in den Bericht kommen. Fehlt = Mangel und Hinweis (Intern bleibt intern).
  // Gilt nur auf diesem Gerät, kommt nicht ins Backup.
  reportLevels?: Importance[];
  // Angaben zur Baukontrolle, siehe control-fields.ts. Fehlt = Vorgabe bzw. leer.
  occasion?: string; // Veranlassung
  documents?: string; // Unterlagen, Zeilen mit "• " sind Aufzählungspunkte
  inspectedPlanIds?: number[]; // begangene Gebäudeteile: ids der Pläne
  executionState?: string; // Ausführungsstand
  requiredProofs?: string; // Liste unter "Vorzulegende Unterlagen"
}

// Wer gerade mit dem Gerät arbeitet. Gilt nur auf diesem Gerät und kommt nicht ins Backup.
// Die Mängel merken sich den Namen selbst, nicht die id des Profils.
export interface Profile {
  id: number;
  name: string;
}

export interface ProjectStats {
  planCount: number;
  defectCount: number;
  open: Record<Importance, number>; // offene Mängel je Wichtigkeit
  doneCount: number;
}

// ---------- Backup: projekt.json im ZIP ----------

// So schreibt die aktuelle App die Datei (Version 4)
export interface BackupFile {
  format: string;
  version: number;
  exportedAt: number;
  project: BackupProject;
  plans: BackupPlan[];
  defects: BackupDefect[];
  textBlocks: string[];
  trades?: string[]; // seit Version 8
  report?: BackupReport; // Backups von Etappe 3 haben diesen Teil noch nicht
}

export interface BackupProject {
  name: string;
  createdAt: number;
  updatedAt: number;
  nextDefectNumber: number;
  division: string | null; // seit Version 5, siehe divisions.ts
}

export interface BackupPlan {
  id: number;
  name: string;
  pageCount: number | null;
  file: string;
}

export interface BackupPhoto {
  file: string;
  caption: string;
  marks: PhotoMark[];
}

export interface BackupDefect extends Omit<Defect, 'id' | 'projectId'> {
  photos: BackupPhoto[];
}

export interface BackupReport extends PartyTexts {
  name?: string;
  address?: string;
  creator?: string;
  coverPhoto?: string; // Dateiname im ZIP
  logo?: string | null; // Dateiname im ZIP, null = bewusst kein Logo
  inspections?: Inspection[]; // seit Version 7, beim Import ungeprüft (readInspections)
  // seit Version 9: Angaben zur Baukontrolle. inspectedPlanIds sind die ids aus "plans" im Backup.
  occasion?: string;
  documents?: string;
  inspectedPlanIds?: number[];
  executionState?: string;
  requiredProofs?: string;
}

// So kann die Datei beim Import aussehen: Alte Backups kennen viele Felder noch nicht,
// und von außen kommt grundsätzlich alles infrage. Darum prüft importProjectFrom jeden Wert.
export interface IncomingBackupFile {
  format: unknown;
  version: number;
  exportedAt?: number;
  project: Partial<BackupProject>;
  plans: (Omit<BackupPlan, 'pageCount'> & { pageCount?: number | null })[];
  defects: IncomingBackupDefect[];
  textBlocks?: unknown;
  trades?: unknown;
  report?: BackupReport;
}

export interface IncomingBackupDefect extends Partial<Omit<BackupDefect, 'planId' | 'photos' | 'importance'>> {
  planId: number;
  importance?: unknown;
  status?: unknown; // alte Backups: "offen" oder "erledigt"
  photos?: (string | IncomingBackupPhoto)[]; // alte Backups führen nur den Dateinamen
}

export interface IncomingBackupPhoto {
  file: string;
  caption?: string;
  marks?: unknown;
}

// Ein fertiges Backup, das auf den Fingertipp zum Sichern wartet. marks: für jedes enthaltene
// Projekt, was nach dem Sichern als "letztes Backup" eingetragen wird.
export interface ExportedBackup {
  blob: Blob;
  fileName: string;
  marks: { projectId: number; mark: Pick<Project, 'lastBackupAt' | 'lastBackupNumber'> }[];
}

// ---------- Sammelbackup: sammlung.json im ZIP ----------

// In jedem Ordner liegt ein vollständiges Backup wie oben (projekt.json, plaene/, fotos/, bericht/)
export interface BackupCollectionFile {
  format: string;
  version: number;
  exportedAt: number;
  projects: { name: string; folder: string }[];
}
