// =============================================================
// Kleine Vorschau eines Plans für die Projektkarten
// =============================================================

import * as store from './db.ts';
import { openPdf } from './pdf.ts';
import { canvasToJpeg } from './photos.ts';
import type { Plan } from './types.ts';

const THUMB_WIDTH = 720; // Karten sind etwa 360 Punkte breit, auf dem iPad doppelt so viele Pixel

// Wird einmal erzeugt und dann gemerkt. Backups enthalten die Vorschau nicht,
// nach einem Import entsteht sie hier neu.
export async function getPlanThumb(plan: Plan): Promise<ArrayBuffer> {
  if (plan.thumb) return plan.thumb;

  const pdf = await openPdf(await store.getPlanData(plan.id));
  try {
    const page = await pdf.getPage(1);
    const scale = THUMB_WIDTH / page.getViewport({ scale: 1 }).width;
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport }).promise;

    const thumb = await canvasToJpeg(canvas, 0.75);
    canvas.width = 0; // gibt den Speicher auf dem iPad sofort frei
    await store.setPlanThumb(plan.id, thumb);
    return thumb;
  } finally {
    pdf.loadingTask.destroy();
  }
}
