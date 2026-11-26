// =============================================================
// Rückgängig und Wiederholen (Pfeile in der unteren Leiste, Strg+Z / Strg+Y)
// =============================================================
//
// Jeder Schritt merkt sich einen Mangel vorher und nachher. Rückgängig stellt "vorher" wieder her,
// Wiederholen "nachher". null heißt: Den Mangel gab es (noch) nicht. So decken wenige Bausteine alles ab:
// Punkt setzen (null -> Mangel), löschen (Mangel -> null), Felder ändern, verschieben, duplizieren.
// photos ist nur dabei, wenn sich die Fotos geändert haben (hinzugefügt, gelöscht, mit dem Mangel
// gelöscht). Dann werden die Fotos des Mangels genau auf diesen Stand gebracht.
//
// Der Verlauf gilt für das geöffnete Projekt und lebt nur im Arbeitsspeicher: Er endet beim Verlassen
// des Projekts und beim Neuladen. Höchstens MAX_STEPS Schritte, die ältesten fallen weg.
// Tippen in einem Feld wird zu einem Schritt zusammengefasst (mergeKey), bis eine Pause entsteht oder
// etwas anderes geändert wird.

import type { Defect, Photo } from './types.ts';

export interface PinState {
  pin: Defect;
  photos?: Photo[];
}

export interface Step {
  label: string; // z. B. "Punkt 7 gesetzt", erscheint als "Rückgängig: Punkt 7 gesetzt"
  pinId: number;
  before: PinState | null;
  after: PinState | null;
  mergeKey?: string;
  at: number;
}

const MAX_STEPS = 50;
const MERGE_PAUSE = 2500; // so lange Tipp-Pause, dann beginnt ein neuer Schritt

let undoStack: Step[] = [];
let redoStack: Step[] = [];
let listener: () => void = () => {};

// Kopie ohne Verweise auf das Original. Fotos teilen sich die Bilddaten (ArrayBuffer werden nie
// verändert, nur ersetzt), darum reicht dort eine flache Kopie.
export function snapshot(pin: Defect, photos?: Photo[]): PinState {
  return { pin: { ...pin }, ...(photos ? { photos: photos.map((photo) => ({ ...photo })) } : {}) };
}

export function onHistoryChange(callback: () => void): void {
  listener = callback;
}

export function record(step: Omit<Step, 'at'>): void {
  const last = undoStack.at(-1);
  const now = Date.now();
  if (step.mergeKey && last?.mergeKey === step.mergeKey && now - last.at < MERGE_PAUSE) {
    last.after = step.after;
    last.at = now;
  } else {
    undoStack.push({ ...step, at: now });
    if (undoStack.length > MAX_STEPS) undoStack.shift();
  }
  redoStack = [];
  listener();
}

// Das Tippen in einem Feld ist abgeschlossen: Die nächste Eingabe beginnt einen neuen Schritt
export function endMerge(): void {
  const last = undoStack.at(-1);
  if (last) last.mergeKey = undefined;
}

export function clearHistory(): void {
  undoStack = [];
  redoStack = [];
  listener();
}

export function nextUndo(): Step | undefined {
  return undoStack.at(-1);
}

export function nextRedo(): Step | undefined {
  return redoStack.at(-1);
}

// Nimmt den Schritt vom Stapel, wenn apply geklappt hat. Schlägt es fehl, bleibt alles, wie es war.
export async function undo(apply: (target: PinState | null, step: Step) => Promise<void>): Promise<Step | null> {
  const step = undoStack.at(-1);
  if (!step) return null;
  await apply(step.before, step);
  undoStack.pop();
  redoStack.push({ ...step, mergeKey: undefined });
  listener();
  return step;
}

export async function redo(apply: (target: PinState | null, step: Step) => Promise<void>): Promise<Step | null> {
  const step = redoStack.at(-1);
  if (!step) return null;
  await apply(step.after, step);
  redoStack.pop();
  undoStack.push(step);
  listener();
  return step;
}
