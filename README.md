# Baumängel

Web-App (PWA) und Android-App zum Erfassen von Baumängeln direkt auf PDF-Plänen, gedacht für Tablets
auf der Baustelle. Die App läuft auch ohne Internet, alle Daten bleiben auf dem Gerät.

## Funktionen

- **Pläne:** PDF-Pläne laden, mehrere Pläne pro Projekt, Reihenfolge festlegen, zoomen und verschieben
- **Mängel:** Punkte auf dem Plan setzen, Überschrift, Notizen, Wichtigkeit, Gewerk, Firma, Fristen,
  „Erledigt“, Textbausteine
- **Fotos:** mit der Kamera aufnehmen oder aus der Galerie wählen, mit Pfeilen und Kreisen markieren,
  Bildunterschrift
- **Projekte:** Adresse (mit Link zu Google Maps), Beteiligte (Bauherrschaft, Bauleitung usw.),
  Projektnummer, Begehungen mit Teilnehmern, Bereiche mit eigenem Logo
- **PDF-Bericht:** Deckblatt, Projektangaben, Teilnehmer der Begehungen, Legende und Mängeltabelle,
  Übersichtspläne und eine Seite je Mangel mit Planausschnitt und Fotos
- **Sicherung:** Backup als ZIP pro Projekt oder für alle Projekte, Import auf einem anderen Gerät
- **Offline:** einmal geöffnet, funktioniert die App auch ohne Netz (Service Worker, IndexedDB)

## Schnellstart

Voraussetzung: Node.js ab 22.18 (getestet mit Node 26).

```
npm install
npm run dev          # Entwicklungsserver
npm run build        # fertige App nach dist/
npm run typecheck    # Typen prüfen
```

Die fertige App in `dist/` ist eine Sammlung statischer Dateien und läuft auf jedem Webserver mit
HTTPS. Für Apache liegt eine passende `.htaccess` bei. Die Android-App wird mit Capacitor gebaut
(`npm run android`, braucht Android SDK und JDK 21).

## Anpassen

- **Bereiche (z. B. Büros oder Arbeitsplätze):** in `src/divisions.ts`. Ausgeliefert werden die
  Platzhalter „Arbeitsplatz 1“ bis „Arbeitsplatz 3“ mit Logos in `public/bereiche/`.
- **Logo und Farben:** App-Logo in `public/logo.png` (Bericht) und `public/logo-glas.png` (Startseite),
  Symbol in `public/favicon.svg`, Farben am Anfang von `src/style.css` und in `COLOR` in `src/report.ts`.
- **App-Symbol der Android-App:** `sh scripts/android-icons.sh` (braucht ImageMagick).

Mehr zu Aufbau, Datenhaltung, Backup-Format, Veröffentlichen und Android-App steht in
[UEBERGABE.md](UEBERGABE.md).
