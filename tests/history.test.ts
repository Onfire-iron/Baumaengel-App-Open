// Rückgängig und Wiederholen (history.ts): Reihenfolge, Zusammenfassen beim Tippen, Grenze
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearHistory, endMerge, nextRedo, nextUndo, record, redo, snapshot, undo } from '../src/history.ts';
import type { PinState } from '../src/history.ts';
import type { Defect } from '../src/types.ts';

const pin = (title: string): Defect => ({
  id: 1,
  projectId: 1,
  planId: 1,
  number: 1,
  page: 1,
  x: 0,
  y: 0,
  title,
  notes: '',
  importance: 'mangel',
  done: false,
  trade: '',
  company: '',
  foundAt: null,
  dueDate: null,
  doneAt: null,
  createdBy: null,
});

// Merkt sich, welcher Stand zuletzt hergestellt wurde
let applied: (PinState | null)[] = [];
const apply = async (target: PinState | null) => {
  applied.push(target);
};

beforeEach(() => {
  clearHistory();
  applied = [];
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
});

afterEach(() => vi.useRealTimers());

describe('Verlauf', () => {
  it('nimmt zurück und stellt wieder her, in der richtigen Reihenfolge', async () => {
    record({ label: 'Punkt 1 gesetzt', pinId: 1, before: null, after: snapshot(pin('A')) });
    record({ label: 'Überschrift', pinId: 1, before: snapshot(pin('A')), after: snapshot(pin('B')) });
    expect(nextUndo()?.label).toBe('Überschrift');

    await undo(apply);
    expect(applied.at(-1)?.pin.title).toBe('A');
    await undo(apply);
    expect(applied.at(-1)).toBeNull(); // Punkt wieder weg
    expect(nextUndo()).toBeUndefined();
    expect(await undo(apply)).toBeNull();

    await redo(apply);
    expect(applied.at(-1)?.pin.title).toBe('A');
    expect(nextRedo()?.label).toBe('Überschrift');
  });

  it('eine neue Änderung verwirft das Wiederholen', async () => {
    record({ label: 'eins', pinId: 1, before: null, after: snapshot(pin('A')) });
    await undo(apply);
    expect(nextRedo()).toBeDefined();
    record({ label: 'zwei', pinId: 1, before: null, after: snapshot(pin('B')) });
    expect(nextRedo()).toBeUndefined();
  });

  it('fasst Tippen im selben Feld zusammen, bis eine Pause kommt', () => {
    record({ label: 'Titel', pinId: 1, before: snapshot(pin('')), after: snapshot(pin('A')), mergeKey: 'title:1' });
    vi.advanceTimersByTime(1000);
    record({ label: 'Titel', pinId: 1, before: snapshot(pin('A')), after: snapshot(pin('AB')), mergeKey: 'title:1' });
    expect(nextUndo()?.before?.pin.title).toBe('');
    expect(nextUndo()?.after?.pin.title).toBe('AB');

    vi.advanceTimersByTime(3000); // Pause: neuer Schritt
    record({ label: 'Titel', pinId: 1, before: snapshot(pin('AB')), after: snapshot(pin('ABC')), mergeKey: 'title:1' });
    expect(nextUndo()?.before?.pin.title).toBe('AB');

    endMerge(); // Feld verlassen: neuer Schritt auch ohne Pause
    record({ label: 'Titel', pinId: 1, before: snapshot(pin('ABC')), after: snapshot(pin('ABCD')), mergeKey: 'title:1' });
    expect(nextUndo()?.before?.pin.title).toBe('ABC');
  });

  it('behält höchstens 50 Schritte', async () => {
    for (let i = 0; i < 60; i++) record({ label: `Schritt ${i}`, pinId: 1, before: null, after: snapshot(pin(String(i))) });
    let count = 0;
    while (await undo(apply)) count++;
    expect(count).toBe(50);
    expect(applied).toHaveLength(50);
  });

  it('snapshot ist eine Kopie', () => {
    const original = pin('A');
    const copy = snapshot(original);
    original.title = 'geändert';
    expect(copy.pin.title).toBe('A');
  });
});
