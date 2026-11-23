// =============================================================
// Kurze Meldungen unten auf dem Bildschirm
// =============================================================

const statusBar = document.getElementById('status') as HTMLElement;
let timer: number | undefined;

// Meldungen verschwinden von selbst, und zwar umso später, je länger sie sind.
// Was noch läuft ("Plan wird geladen …"), bleibt stehen, bis die nächste Meldung kommt.
export function setStatus(text: string): void {
  statusBar.textContent = text;
  clearTimeout(timer);
  if (!text || text.endsWith('…')) return;
  timer = setTimeout(() => (statusBar.textContent = ''), Math.max(3500, text.length * 70));
}
