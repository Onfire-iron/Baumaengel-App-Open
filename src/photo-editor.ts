// =============================================================
// Foto ansehen, mit Pfeilen und Kreisen markieren, Bildunterschrift
// =============================================================
//
// Wie im restlichen Programm wird jede Änderung sofort gespeichert.

import * as store from './db.ts';
import { drawMarks, loadImage } from './photos.ts';
import type { Photo, PhotoMark } from './types.ts';

const editor = document.getElementById('photo-editor') as HTMLElement;
const stage = document.getElementById('editor-stage') as HTMLElement;
const canvas = document.getElementById('editor-canvas') as HTMLCanvasElement;
const toolBtns = editor.querySelectorAll<HTMLElement>('[data-tool]');
const undoBtn = document.getElementById('editor-undo') as HTMLButtonElement;
const doneBtn = document.getElementById('editor-done') as HTMLButtonElement;
const captionInput = document.getElementById('editor-caption') as HTMLInputElement;
const message = document.getElementById('editor-message') as HTMLElement;

const MIN_DRAG = 12; // kürzere Bewegungen auf dem Bildschirm gelten als Versehen

let current: {
  photo: Photo;
  projectId: number;
  image: HTMLImageElement;
  imageUrl: string;
  onClose: () => void;
} | null = null;
let tool: PhotoMark['type'] = 'arrow';
let draft: PhotoMark | null = null; // die Markierung, die gerade gezogen wird
let draftPointer: number | null = null;

export async function openPhotoEditor(photo: Photo, projectId: number, onClose: () => void): Promise<void> {
  const imageUrl = URL.createObjectURL(new Blob([photo.data], { type: 'image/jpeg' }));
  try {
    current = { photo, projectId, image: await loadImage(imageUrl), imageUrl, onClose };
  } catch (err) {
    URL.revokeObjectURL(imageUrl);
    throw err;
  }

  photo.marks ??= [];
  canvas.width = current!.image.naturalWidth;
  canvas.height = current!.image.naturalHeight;
  captionInput.value = photo.caption ?? '';
  message.textContent = '';
  editor.hidden = false;
  showTool();
  fitCanvas();
  draw();
}

function closeEditor() {
  const { imageUrl, onClose } = current!;
  editor.hidden = true;
  URL.revokeObjectURL(imageUrl);
  current = null;
  draft = null;
  draftPointer = null;
  canvas.width = 0; // gibt den Speicher auf dem iPad sofort frei
  onClose();
}

// Das Foto so groß wie möglich zeigen, ohne es zu verzerren
function fitCanvas() {
  const padding = parseFloat(getComputedStyle(stage).paddingTop) * 2;
  const width = stage.clientWidth - padding;
  const height = stage.clientHeight - padding;
  const factor = Math.max(0, Math.min(width / canvas.width, height / canvas.height));
  canvas.style.width = `${canvas.width * factor}px`;
  canvas.style.height = `${canvas.height * factor}px`;
}

function draw() {
  const { photo, image } = current!;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  drawMarks(ctx, draft ? [...photo.marks!, draft] : photo.marks!, canvas.width, canvas.height);
  undoBtn.disabled = photo.marks!.length === 0;
}

function save(changes: Partial<Photo>) {
  Object.assign(current!.photo, changes);
  store.updatePhoto(current!.photo.id, current!.projectId, changes).catch((err) => {
    console.error(err);
    message.textContent = 'Speichern fehlgeschlagen. Ist der Speicher voll?';
  });
}

function showTool() {
  toolBtns.forEach((btn) => {
    const active = btn.dataset.tool === tool;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
}

// Bildschirmposition auf dem Foto, von 0 bis 1. Am Rand bleibt der Finger im Bild.
function toPhoto(e: PointerEvent) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
  };
}

// Zeichnen mit einem Finger. Ein zweiter Finger bricht die Markierung ab.
canvas.addEventListener('pointerdown', (e) => {
  if (draftPointer !== null) {
    draft = null;
    draftPointer = null;
    draw();
    return;
  }
  if (e.button !== 0) return;
  canvas.setPointerCapture(e.pointerId);
  const { x, y } = toPhoto(e);
  draftPointer = e.pointerId;
  draft = { type: tool, x1: x, y1: y, x2: x, y2: y };
  message.textContent = '';
});

canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId !== draftPointer) return;
  const { x, y } = toPhoto(e);
  draft!.x2 = x;
  draft!.y2 = y;
  draw();
});

function endDraft(e: PointerEvent) {
  if (e.pointerId !== draftPointer) return;
  const mark = draft!;
  draft = null;
  draftPointer = null;

  const rect = canvas.getBoundingClientRect();
  const length = Math.hypot((mark.x2 - mark.x1) * rect.width, (mark.y2 - mark.y1) * rect.height);
  if (e.type === 'pointerup' && length >= MIN_DRAG) {
    save({ marks: [...current!.photo.marks!, mark] });
  } else if (e.type === 'pointerup') {
    message.textContent = 'Zum Markieren mit dem Finger über das Foto ziehen.';
  }
  draw();
}

canvas.addEventListener('pointerup', endDraft);
canvas.addEventListener('pointercancel', endDraft);

toolBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    tool = btn.dataset.tool as PhotoMark['type'];
    showTool();
  });
});

undoBtn.addEventListener('click', () => {
  save({ marks: current!.photo.marks!.slice(0, -1) });
  draw();
});

captionInput.addEventListener('input', () => save({ caption: captionInput.value }));
doneBtn.addEventListener('click', closeEditor);

// iPad: Die Tastatur schiebt die Seite manchmal nach oben. Danach wieder zurückholen.
editor.addEventListener('focusout', () => window.scrollTo(0, 0));

// Die Fläche ändert sich beim Drehen des iPads, durch die Tastatur und durch Meldungen
new ResizeObserver(() => {
  if (current) fitCanvas();
}).observe(stage);
