// =============================================================
// Aufklappbare Menüs: "…" im Projekt und auf den Projektkarten
// =============================================================

export function closeMenus(): void {
  document.querySelectorAll<HTMLElement>('.menu:not([hidden])').forEach((menu) => (menu.hidden = true));
  document.querySelectorAll('[aria-haspopup][aria-expanded="true"]').forEach((btn) => {
    btn.setAttribute('aria-expanded', 'false');
  });
}

export function bindMenu(button: HTMLElement, menu: HTMLElement): void {
  button.addEventListener('click', () => {
    const open = menu.hidden;
    closeMenus();
    menu.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  });
  // Eine Aktion schließt das Menü, die Wahl der Darstellung lässt es offen
  menu.addEventListener('click', (e) => {
    if ((e.target as Element).closest('.menu-item')) closeMenus();
  });
}

// Tippen außerhalb schließt das Menü. "capture", weil der Plan die Finger selbst verarbeitet.
document.addEventListener(
  'pointerdown',
  (e) => {
    if (!(e.target as Element).closest('.menu, [aria-haspopup]')) closeMenus();
  },
  true
);
