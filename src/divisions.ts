// =============================================================
// Bereiche: z. B. Büros oder Arbeitsplätze, jeweils mit eigenem Logo
// =============================================================
//
// Jedes Projekt gehört zu einem Bereich oder zu "Ohne Bereich". Die Startseite zeigt nur die Projekte
// des gewählten Bereichs, und das Logo des Bereichs ist das Standardlogo im Bericht.
// Die Bereiche stehen fest in der App. Ein neuer Bereich: Logos nach public/bereiche/ legen
// (Bericht mit weißem, Leiste mit durchsichtigem Hintergrund) und hier eintragen. Die id wird im
// Projekt und im Backup gespeichert und darf sich deshalb nie ändern.

export interface Division {
  id: string;
  name: string; // für Vorleser und Auswahllisten, angezeigt wird sonst das Logo
  reportLogo: string; // Standardlogo im Bericht, Pfad in public/
  headerLogo: string; // Logo oben links auf der Startseite, mit durchsichtigem Hintergrund
}

export const DIVISIONS: readonly Division[] = [
  // Platzhalter: Namen und Logos durch die eigenen ersetzen (die ids dürfen bleiben)
  {
    id: 'arbeitsplatz-1',
    name: 'Arbeitsplatz 1',
    reportLogo: 'bereiche/arbeitsplatz-1.png',
    headerLogo: 'bereiche/arbeitsplatz-1-leiste.png',
  },
  {
    id: 'arbeitsplatz-2',
    name: 'Arbeitsplatz 2',
    reportLogo: 'bereiche/arbeitsplatz-2.png',
    headerLogo: 'bereiche/arbeitsplatz-2-leiste.png',
  },
  {
    id: 'arbeitsplatz-3',
    name: 'Arbeitsplatz 3',
    reportLogo: 'bereiche/arbeitsplatz-3.png',
    headerLogo: 'bereiche/arbeitsplatz-3-leiste.png',
  },
];

export const NO_DIVISION = 'Ohne Bereich';

// null = ohne Bereich. Unbekannte ids (z. B. aus einem Backup einer neueren App) zählen auch so.
export function findDivision(id: string | null | undefined): Division | null {
  return DIVISIONS.find((division) => division.id === id) ?? null;
}

// Für Backups: nur bekannte ids übernehmen, alles andere wird "ohne Bereich"
export function readDivision(value: unknown): string | null {
  return findDivision(typeof value === 'string' ? value : null)?.id ?? null;
}

export function divisionName(id: string | null | undefined): string {
  return findDivision(id)?.name ?? NO_DIVISION;
}

export function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

// Ohne Bereich bleibt es beim bisherigen Standardlogo, damit sich ältere Berichte nicht ändern
export function reportLogoUrl(id: string | null | undefined): string {
  return assetUrl(findDivision(id)?.reportLogo ?? 'logo.png');
}

// ---------- Gewählter Bereich, gilt nur auf diesem Gerät (wie das Profil) ----------

const STORAGE_KEY = 'baumaengel-division';

// Ohne Speicher (privates Fenster, gesperrt) gilt die Auswahl bis zum Neuladen
let active: string | null = (() => {
  try {
    return findDivision(localStorage.getItem(STORAGE_KEY))?.id ?? null;
  } catch {
    return null;
  }
})();

export function activeDivision(): string | null {
  return active;
}

export function setActiveDivision(id: string | null): void {
  active = findDivision(id)?.id ?? null;
  try {
    if (active) localStorage.setItem(STORAGE_KEY, active);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // siehe oben
  }
}
