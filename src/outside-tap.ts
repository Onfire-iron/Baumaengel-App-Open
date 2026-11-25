// =============================================================
// Tippen neben ein Fenster schließt es
// =============================================================
//
// Gilt für die Fenster mit abgedunkeltem Hintergrund. Das Antippen der dunklen Fläche wirkt wie der
// Schließen-Knopf des Fensters, die Knöpfe bleiben trotzdem. Nur wenn der Finger auch dort aufgesetzt
// hat: Wer im Fenster Text markiert und daneben loslässt, soll das Fenster nicht verlieren.
// Die Seitenfenster (Bearbeitungsfenster, Schnellerfassung, Mängelliste) schließt ein Tippen auf eine
// freie Stelle im Plan, siehe endPointer in main.ts.

export function closeOnOutsideTap(overlay: HTMLElement, close: () => void): void {
  let startedOutside = false;
  overlay.addEventListener('pointerdown', (e) => {
    startedOutside = e.target === overlay;
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay && startedOutside) close();
    startedOutside = false;
  });
}

// Klickt den ersten der Knöpfe, der gerade zu sehen ist (z. B. je nach Ansicht im Berichtsfenster)
export function clickVisible(...ids: string[]): void {
  for (const id of ids) {
    const btn = document.getElementById(id);
    if (btn && btn.offsetParent !== null) {
      btn.click();
      return;
    }
  }
}
