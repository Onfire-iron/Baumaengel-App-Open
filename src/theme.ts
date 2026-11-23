// =============================================================
// Darstellung: Glas, Dunkel oder Sonne. Gilt für dieses Gerät.
// =============================================================

const KEY = 'baumaengel-theme';
const BAR_COLOR = { glas: '#edf1f5', dunkel: '#0d141c', sonne: '#ffffff' };

type Theme = keyof typeof BAR_COLOR; // 'glas' | 'dunkel' | 'sonne'

const choices = document.querySelectorAll<HTMLElement>('[data-theme-choice]');
const barColor = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement;

function apply(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  barColor.content = BAR_COLOR[theme];
  choices.forEach((btn) => {
    const active = btn.dataset.themeChoice === theme;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
}

// Ohne Speicher (privater Modus) gilt die Wahl eben nur bis zum Schließen
function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY) as Theme;
    return saved in BAR_COLOR ? saved : 'glas';
  } catch {
    return 'glas';
  }
}

choices.forEach((btn) => {
  btn.addEventListener('click', () => {
    apply(btn.dataset.themeChoice as Theme);
    try {
      localStorage.setItem(KEY, btn.dataset.themeChoice as Theme);
    } catch {
      // siehe readTheme
    }
  });
});

apply(readTheme());
