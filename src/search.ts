// =============================================================
// Suche: gemeinsame Regeln für die Projektsuche und die Suche in der Mängelliste
// =============================================================

// Groß- und Kleinschreibung, Akzente und ß spielen keine Rolle: "muller" findet "Müller"
export function normalize(text: string): string {
  return text
    .toLocaleLowerCase('de-DE')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// Zerlegt die Eingabe in Wörter. Jedes muss irgendwo vorkommen, die Reihenfolge ist egal.
export function searchWords(query: string): string[] {
  return normalize(query).split(/\s+/).filter(Boolean);
}
