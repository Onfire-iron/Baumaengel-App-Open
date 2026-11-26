// Backup (backup.ts): Ein gesichertes Projekt muss auf einem leeren Gerät genau so wieder entstehen,
// und alte Backups müssen sich weiter einlesen lassen
import { BlobWriter, TextReader, Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js';
import { describe, expect, it } from 'vitest';
import type { Defect } from '../src/types.ts';
import { freshStore } from './helpers/database.ts';

// db.ts und backup.ts gemeinsam frisch laden, damit beide dieselbe (leere) Datenbank benutzen
async function freshApp() {
  const store = await freshStore();
  const backup = await import('../src/backup.ts');
  return { store, backup };
}

const bytes = (...values: number[]) => new Uint8Array(values).buffer;
const asArray = (buffer: ArrayBuffer | null | undefined) => (buffer ? [...new Uint8Array(buffer)] : buffer);

const newPin = (projectId: number, planId: number, fields: Partial<Defect> = {}) => ({
  projectId,
  planId,
  page: 1,
  x: 0.25,
  y: 0.75,
  title: '',
  notes: '',
  importance: 'mangel' as const,
  done: false,
  trade: '',
  company: '',
  foundAt: null,
  dueDate: null,
  doneAt: null,
  createdBy: null,
  ...fields,
});

// Ein Projekt mit allem, was ein Backup enthalten kann
async function buildProject(store: Awaited<ReturnType<typeof freshStore>>) {
  const projectId = await store.createProject('Schule', { address: 'Musterweg 1, Musterstadt', owner: 'Stadt Musterstadt' }, null);
  const eg = await store.addPlan(projectId, 'EG', bytes(37, 80, 68, 70, 1), 1);
  const og = await store.addPlan(projectId, 'OG', bytes(37, 80, 68, 70, 2), 2);
  const first = await store.addPin(
    newPin(projectId, eg, {
      title: 'Tür schließt nicht',
      notes: 'Zeile 1\nZeile 2',
      trade: 'Fenster und Türen',
      company: 'Musterbau GmbH',
      foundAt: '2026-11-01',
      dueDate: '2026-11-15',
      createdBy: 'Max Muster',
    })
  );
  const second = await store.addPin(newPin(projectId, eg, { title: 'wird gelöscht' }));
  await store.addPin(newPin(projectId, og, { title: 'Hinweis OG', importance: 'hinweis', done: true, doneAt: '2026-11-20', page: 2 }));
  await store.deletePin((await store.listPins(projectId)).find((p) => p.id === second)!);
  await store.addPhoto({ id: first, projectId }, bytes(255, 216, 1, 2, 3), {
    caption: 'Blick von Süden',
    marks: [{ type: 'arrow', x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.4 }],
  });
  await store.saveReportSettings(projectId, {
    creator: 'Max Muster',
    occasion: '', // bewusst geleert: darf nicht wieder zur Vorgabe werden
    documents: '• Grundriss EG\n• Schnitt A',
    executionState: 'Rohbau fertig',
    inspectedPlanIds: [og],
    coverPhoto: bytes(9, 9, 9),
    logo: null,
    inspections: [{ date: '2026-11-01', participants: [{ name: 'Max Muster', org: 'Musterbau GmbH' }] }],
  });
  await store.addMaster('trade', 'Gerüstbau');
  return projectId;
}

describe('Backup sichern und einlesen', () => {
  it('stellt ein Projekt auf einem leeren Gerät vollständig wieder her', async () => {
    let app = await freshApp();
    const projectId = await buildProject(app.store);
    const exported = await app.backup.exportProject(projectId);
    expect(exported.fileName).toMatch(/^Baumaengel-Backup Schule \d{4}-\d{2}-\d{2}\.zip$/);
    expect(exported.marks).toEqual([{ projectId, mark: { lastBackupAt: expect.any(Number), lastBackupNumber: 4 } }]);
    app.store.db.close();

    // Neues Gerät
    app = await freshApp();
    const { store, backup } = app;
    expect(await backup.importBackup(exported.blob)).toEqual({ imported: 1, failed: [] });

    const [project] = await store.listProjects();
    expect(project.name).toBe('Schule');
    expect(project.importing).toBe(false);
    expect(project.nextDefectNumber).toBe(4); // Nummer 2 bleibt gesperrt, obwohl der Mangel gelöscht ist

    const plans = await store.listPlans(project.id);
    expect(plans.map((p) => [p.name, p.pageCount])).toEqual([
      ['EG', 1],
      ['OG', 2],
    ]);
    expect(asArray(await store.getPlanData(plans[1].id))).toEqual([37, 80, 68, 70, 2]);

    const pins = await store.listPins(project.id);
    expect(pins.map((p) => p.number)).toEqual([1, 3]);
    expect(pins[0]).toMatchObject({
      planId: plans[0].id,
      title: 'Tür schließt nicht',
      notes: 'Zeile 1\nZeile 2',
      trade: 'Fenster und Türen',
      company: 'Musterbau GmbH',
      foundAt: '2026-11-01',
      dueDate: '2026-11-15',
      createdBy: 'Max Muster',
      importance: 'mangel',
      done: false,
      x: 0.25,
      y: 0.75,
    });
    expect(pins[1]).toMatchObject({ planId: plans[1].id, importance: 'hinweis', done: true, doneAt: '2026-11-20', page: 2 });

    const photos = await store.getPhotos(pins[0].id);
    expect(photos).toHaveLength(1);
    expect(asArray(photos[0].data)).toEqual([255, 216, 1, 2, 3]);
    expect(photos[0].caption).toBe('Blick von Süden');
    expect(photos[0].marks).toEqual([{ type: 'arrow', x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.4 }]);

    const settings = await store.getReportSettings(project.id);
    expect(settings).toMatchObject({
      address: 'Musterweg 1, Musterstadt',
      owner: 'Stadt Musterstadt',
      creator: 'Max Muster',
      occasion: '',
      documents: '• Grundriss EG\n• Schnitt A',
      executionState: 'Rohbau fertig',
      inspectedPlanIds: [plans[1].id], // auf die neue id umgesetzt
      logo: null,
      inspections: [{ date: '2026-11-01', participants: [{ name: 'Max Muster', org: 'Musterbau GmbH' }] }],
    });
    expect(asArray(settings?.coverPhoto)).toEqual([9, 9, 9]);
    expect((await store.listMaster('trade')).some((t) => t.name === 'Gerüstbau')).toBe(true);

    // Ein zweites Mal: neues Projekt mit Zusatz im Namen, das erste bleibt unverändert
    await backup.importBackup(exported.blob);
    const names = (await store.listProjects()).map((p) => p.name).sort();
    expect(names[0]).toBe('Schule');
    expect(names[1]).toMatch(/^Schule \(Import /);
    store.db.close();
  });

  it('Sammelbackup mit mehreren Projekten', async () => {
    let app = await freshApp();
    await buildProject(app.store);
    await app.store.createProject('Leer', { address: '' }, null);
    const exported = await app.backup.exportAllProjects();
    app.store.db.close();

    app = await freshApp();
    let asked: string[] = [];
    const result = await app.backup.importBackup(exported.blob, undefined, (contents) => {
      asked = contents.projects.map((p) => p.name);
      return contents.collection;
    });
    expect(asked.sort()).toEqual(['Leer', 'Schule']);
    expect(result).toEqual({ imported: 2, failed: [] });
    app.store.db.close();
  });

  it('Abbrechen bei der Rückfrage liest nichts ein', async () => {
    let app = await freshApp();
    const exported = await app.backup.exportProject(await buildProject(app.store));
    app.store.db.close();
    app = await freshApp();
    expect(await app.backup.importBackup(exported.blob, undefined, () => false)).toBeNull();
    expect(await app.store.listProjects()).toEqual([]);
    app.store.db.close();
  });
});

// Ein ZIP von Hand, wie es eine alte App-Version geschrieben hat
async function oldBackup(json: object, files: Record<string, number[]> = {}) {
  const zip = new ZipWriter(new BlobWriter('application/zip'));
  await zip.add('projekt.json', new TextReader(JSON.stringify(json)));
  for (const [name, data] of Object.entries(files)) await zip.add(name, new Uint8ArrayReader(new Uint8Array(data)));
  return zip.close();
}

describe('Alte und fremde Dateien', () => {
  it('liest ein Backup der Version 2 (Status statt Stufe, ohne Nummern, Fotos nur als Name)', async () => {
    const { store, backup } = await freshApp();
    const file = await oldBackup(
      {
        format: 'baumaengel-backup',
        version: 2,
        project: { name: 'Uralt' },
        plans: [{ id: 7, name: 'Plan', file: 'plaene/plan-1.pdf' }],
        defects: [
          { planId: 7, page: 1, x: 2, y: -1, title: 'offen', status: 'offen', photos: ['fotos/a.jpg'] },
          { planId: 7, page: 1, x: 0.5, y: 0.5, title: 'fertig', status: 'erledigt' },
          { planId: 7, page: 1, x: 0.5, y: 0.5, title: 'wichtig', importance: 'wichtig' },
        ],
      },
      { 'plaene/plan-1.pdf': [1], 'fotos/a.jpg': [2] }
    );
    await backup.importBackup(file);
    const [project] = await store.listProjects();
    const pins = await store.listPins(project.id);
    expect(pins.map((p) => [p.number, p.title, p.importance, p.done, p.x, p.y])).toEqual([
      [1, 'offen', 'mangel', false, 1, 0], // Koordinaten auf den Plan begrenzt
      [2, 'fertig', 'mangel', true, 0.5, 0.5],
      [3, 'wichtig', 'mangel', false, 0.5, 0.5],
    ]);
    expect(await store.getPhotos(pins[0].id)).toHaveLength(1);
    expect(project.nextDefectNumber).toBe(4);
    store.db.close();
  });

  it('lehnt neuere, fremde und beschädigte Dateien ab und hinterlässt nichts', async () => {
    const { store, backup } = await freshApp();
    const newer = await oldBackup({ format: 'baumaengel-backup', version: 999, project: { name: 'X' }, plans: [], defects: [] });
    await expect(backup.importBackup(newer)).rejects.toThrow(/neueren App-Version/);
    const foreign = await oldBackup({ format: 'etwas-anderes', version: 1 });
    await expect(backup.importBackup(foreign)).rejects.toThrow(/kein Baumängel-Backup/);
    const missingPlan = await oldBackup({
      format: 'baumaengel-backup',
      version: 9,
      project: { name: 'Kaputt' },
      plans: [{ id: 1, name: 'EG', file: 'plaene/fehlt.pdf' }],
      defects: [],
    });
    await expect(backup.importBackup(missingPlan)).rejects.toThrow(/fehlt/);
    expect(await store.listProjects()).toEqual([]); // halb eingelesenes Projekt wurde entfernt
    store.db.close();
  });
});
