// =============================================================
// Projektadresse in Google Maps zeigen
// =============================================================
//
// Die offizielle Google-Maps-Adresse ("Maps URL") funktioniert auf allen Geräten: am PC und
// Surface öffnet sie die Webseite, auf Android und iPad die Google-Maps-App, falls installiert,
// sonst die Webseite. Ohne Internet lädt die Karte natürlich nicht.

// "Musterstraße 12" + Zeilenumbruch + "12345 Musterstadt" wird zu "Musterstraße 12, 12345 Musterstadt"
export function oneLineAddress(address: string | null | undefined): string {
  return String(address ?? '')
    .split(/\r?\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ');
}

// null, wenn das Projekt keine Adresse hat
export function googleMapsUrl(address: string | null | undefined): string | null {
  const query = oneLineAddress(address);
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : null;
}
