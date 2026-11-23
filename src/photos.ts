// =============================================================
// Fotos verkleinern, damit der Speicher auf dem iPad nicht vollläuft
// =============================================================

import type { PhotoMark } from './types.ts';

const MAX_SIDE = 1600; // lange Seite in Pixeln
const JPEG_QUALITY = 0.8;
const MARK_COLOR = '#d93030';

// Liefert das verkleinerte Foto als JPEG-Bytes (ArrayBuffer), auf Wunsch mit Markierungen.
// Der Browser dreht das Bild dabei automatisch richtig herum (Hochformat-Fotos).
export async function shrinkPhoto(
  file: Blob,
  maxSide: number = MAX_SIDE,
  quality: number = JPEG_QUALITY,
  marks: PhotoMark[] = []
): Promise<ArrayBuffer> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const factor = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * factor);
    canvas.height = Math.round(img.naturalHeight * factor);

    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff'; // JPEG kennt keine Transparenz
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    drawMarks(ctx, marks, canvas.width, canvas.height);

    const jpeg = await canvasToJpeg(canvas, quality);
    canvas.width = 0; // gibt den Speicher auf dem iPad sofort frei
    return jpeg;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Packt eine Zeichenfläche als JPEG. Android (App und Chrome) verschiebt das asynchrone toBlob,
// bis es "Leerlauf" hat: Ohne Berührung des Bildschirms dauerte das auf dem Tab S7 FE jedes Mal
// rund 4 Sekunden, das direkte toDataURL dagegen 50 bis 110 ms. Auf iPad und PC bleibt es bei
// toBlob, das blockiert die Oberfläche nicht.
const ANDROID = /Android/.test(navigator.userAgent);

export async function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<ArrayBuffer> {
  if (ANDROID) {
    const base64 = canvas.toDataURL('image/jpeg', quality).split(',')[1] ?? '';
    const binary = atob(base64);
    if (!binary) throw new Error('Bild konnte nicht umgewandelt werden');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('Bild konnte nicht umgewandelt werden');
  return blob.arrayBuffer();
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Bild konnte nicht gelesen werden'));
    img.src = url;
  });
}

// ---------- Markierungen ----------
//
// Pfeile und Kreise liegen als Koordinaten von 0 bis 1 neben dem Foto:
// { type: 'arrow' | 'circle', x1, y1, x2, y2 }. Das Foto selbst bleibt unverändert.

// Rot mit weißem Rand, damit die Markierung auf jedem Untergrund sichtbar bleibt
export function drawMarks(
  ctx: CanvasRenderingContext2D,
  marks: PhotoMark[],
  width: number,
  height: number
): void {
  const line = Math.max(width, height) * 0.006;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [color, lineWidth] of [['#fff', line * 2], [MARK_COLOR, line]] as [string, number][]) {
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    for (const mark of marks) strokeMark(ctx, mark, width, height, line * 5);
  }
}

function strokeMark(
  ctx: CanvasRenderingContext2D,
  mark: PhotoMark,
  width: number,
  height: number,
  headLength: number
): void {
  const x1 = mark.x1 * width;
  const y1 = mark.y1 * height;
  const x2 = mark.x2 * width;
  const y2 = mark.y2 * height;

  ctx.beginPath();
  if (mark.type === 'circle') {
    const radiusX = Math.abs(x2 - x1) / 2;
    const radiusY = Math.abs(y2 - y1) / 2;
    ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, radiusX, radiusY, 0, 0, Math.PI * 2);
  } else {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.moveTo(x2 - headLength * Math.cos(angle - 0.5), y2 - headLength * Math.sin(angle - 0.5));
    ctx.lineTo(x2, y2);
    ctx.lineTo(x2 - headLength * Math.cos(angle + 0.5), y2 - headLength * Math.sin(angle + 0.5));
  }
  ctx.stroke();
}

// Prüft Markierungen aus einem Backup und lässt alles Unbrauchbare weg
export function readMarks(marks: unknown): PhotoMark[] {
  if (!Array.isArray(marks)) return [];
  return marks
    .filter(
      (mark) =>
        ['arrow', 'circle'].includes(mark?.type) &&
        [mark.x1, mark.y1, mark.x2, mark.y2].every(
          (value) => typeof value === 'number' && value >= 0 && value <= 1
        )
    )
    .map(({ type, x1, y1, x2, y2 }) => ({ type, x1, y1, x2, y2 }));
}
