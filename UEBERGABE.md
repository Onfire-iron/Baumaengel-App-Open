# Technische Übersicht: Baumängel-App

Web-App (PWA) zum Erfassen von Baumängeln auf PDF-Plänen, gedacht vor allem fürs iPad. Sie läuft
auch ohne Internet. Alle Daten bleiben auf dem Gerät, einen Server gibt es nicht. Projekte lassen
sich als ZIP-Backup sichern und als PDF-Bericht ausgeben.

Bisherige Etappen: 1 PDF anzeigen und Punkte setzen, 2 Mängel mit Texten und Fotos,
3 Projekte, Offline-Betrieb und Backup, 4 bis 4.8 PDF-Bericht, 4.9 Umstellung auf TypeScript,
4.10 Profile ("Erfasst von") und Suche auf der Startseite, 4.11 Sperre der Punkte, neuer
Planwechsel, mehrere Pläne auf einmal hinzufügen und Reihenfolge der Pläne, 4.12 Suche in der
Mängelliste und Sammelbackup aller Projekte, 4.13 Vorbereitung fürs Veröffentlichen,
4.14 Kamerafenster für Laptop und PC sowie Projektadresse in Google Maps,
4.15 Veröffentlichen per SFTP, Kamera-Start robuster für Edge,
4.16 Passwortabfrage und Fortschritt beim Hochladen,
Wechsel auf https, Anzeige "Offline wird eingerichtet", 4.17 Bereiche (z. B. Büros) mit eigenem Logo, 4.18 Android-App (Capacitor) mit Galerie-Album,
4.19 App-Symbol und Startbild der Android-App, 4.20 Beteiligte (Bauherrschaft, Entwurfsverfassende,
Bauaufsichtsbehörde, Brandschutzdienststelle, Bauleitung) und Projektnummer auf eigener Berichtsseite
"Projektangaben", 4.21 Begehungen mit Teilnehmern (eigene Berichtsseite), 4.22 und 4.23 Projektnummer in der
Kopfzeile und auf dem Deckblatt.

## Technik

| Bereich | Verwendet |
|---|---|
| Sprache | TypeScript 7 mit `"strict": true` |
| Bauen und Entwickeln | Vite 8, Ziel `es2021` und `safari16` (iPadOS 16 kann keine Klassenfelder) |
| Offline | `vite-plugin-pwa` (Service Worker, Manifest) |
| Speicher | Dexie (IndexedDB) |
| PDF anzeigen und zeichnen | `pdfjs-dist` in der `legacy`-Ausgabe für ältere iPads |
| PDF-Bericht erzeugen | `pdf-lib` und `@pdf-lib/fontkit` |
| Backup | `@zip.js/zip.js` |
| Schrift | Inter (`@fontsource-variable/inter`) |
| HTTPS-Test im WLAN | `node-forge` |

Die Oberfläche ist normales HTML in `index.html` mit CSS in `src/style.css`, ohne UI-Framework.

**Node:** `scripts/*.ts` laufen direkt mit `node`, ohne Zwischenschritt. Das braucht eine
Node-Version, die TypeScript selbst ausführen kann (ab 22.18). Getestet ist Node 26.

## Befehle

| Befehl | Zweck |
|---|---|
| `npm run dev` | Entwicklungsserver. Offline ist hier abgeschaltet. |
| `npm run build` | Baut die App nach `dist/`. |
| `npm run typecheck` | Prüft die Typen in App, `vite.config.ts` und `scripts/`. **Neu.** |
| `npm run preview` | Zeigt den fertigen Build lokal an. |
| `npm run wlan` | Baut und startet HTTPS auf Port 4173 fürs iPad im selben WLAN. |
| `npm run deploy` | Prüft, baut und lädt die App per SFTP auf den Webspace, siehe unten. |
| `npm run android` | Baut die Android-App als Debug-APK, siehe "Android-App". |

`npm run build` prüft keine Typen, denn Vite entfernt sie nur. Vor jedem Commit deshalb
`npm run typecheck` **und** `npm run build` ausführen.

## Veröffentlichen (Webhoster mit Apache, SFTP)

Die App kann auf einer (Sub-)Domain bei einem beliebigen Webhoster liegen. Sie ist nur eine Sammlung fertiger
Dateien (`dist/`): kein PHP, keine Datenbank, kein Node auf dem Server. Die Daten liegen auf den Geräten,
der Server liefert nur die App aus. Gebaut wird lokal, `.node-version` nennt die getestete Node-Version.

**Was der Server braucht**

- HTTPS mit gültigem Zertifikat (z. B. kostenlos über Let's Encrypt) und "HTTPS erzwingen".
  Ohne HTTPS gehen Offline-Betrieb, Kamera und "Zum Home-Bildschirm" nicht. Zusätzlich wechselt ein kleines
  Skript ganz oben in `index.html` von `http://` auf `https://` (außer bei `localhost` und IP-Adressen),
  denn `http` und `https` sind für den Browser verschiedene Adressen mit getrenntem Speicher.
- Apache mit `.htaccess`. `public/.htaccess` setzt die Dateitypen (`.wasm`,
  `.webmanifest`, `.mjs`, `.woff2`), ein paar Sicherheits-Header und das Zwischenspeichern: `index.html`,
  `sw.js`, `registerSW.js` und das Manifest nie lange, sonst kommen Updates nicht an; `assets/` dauerhaft.
  Alles steht in `<IfModule>`, ein fehlendes Modul führt also nicht zu einem Serverfehler.
- Etwa 10 MB Platz. Die Subdomain zeigt direkt auf den Ordner mit `index.html` (kein Unterordner,
  sonst müsste `base` in `vite.config.ts` angepasst werden).

**Einmalig einrichten**

1. Im Projektordner die Datei `.deploy.local` anlegen (ist nicht in Git):
   ```
   SFTP_HOST=<Host aus den Zugangsdaten>
   SFTP_USER=<SFTP-Benutzer>
   SFTP_DIR=<Ordner der Subdomain, in dem index.html liegen soll>
   ```
   Das Passwort kommt dort nicht hinein.
2. `npm run deploy` – prüft, baut und lädt hoch (`scripts/deploy-sftp.ts`). `sftp` fragt im Terminal nach
   dem Passwort, beim allerersten Mal außerdem, ob dem Server vertraut werden soll (`yes`).

Wer das Passwort nicht jedes Mal eingeben will, hinterlegt beim Hoster für den SFTP-Benutzer einen
SSH-Schlüssel (`ssh-keygen -t ed25519`, dann den Inhalt von `~/.ssh/id_ed25519.pub` eintragen).

**Updates:** `npm run deploy`. Die Geräte übernehmen die neue Version beim nächsten Öffnen von selbst.
Hochgeladen wird erst alles andere, zum Schluss `index.html` und der Service Worker. So verweist eine
neue Version nie auf Dateien, die noch fehlen. Alte Dateien in `assets/` bleiben liegen und stören nicht;
wer aufräumen will, löscht den Ordner `assets/` per SFTP und ruft danach `npm run deploy` auf.

Ohne Terminal geht es auch mit einem SFTP-Programm wie FileZilla: den **Inhalt** von `dist/` in den
Ordner der Subdomain ziehen, auch die versteckte Datei `.htaccess`.

**Erstes Öffnen:** Der Service Worker lädt alle gut 200 Dateien nacheinander in den Offline-Speicher. Mit
normalem Internet dauert das etwa 40 Sekunden bis eine Minute. Die Startseite zeigt so lange "Offline wird
eingerichtet …" und danach von selbst "Offline bereit". Erst dann funktioniert die App ohne Netz.

**Worauf man achten muss**

- **Nur diese eine Adresse benutzen.** Die Daten im Gerät hängen an der Adresse (siehe Zertifikate unten).
  Auf den Geräten die App nur über die Subdomain öffnen und auf den Home-Bildschirm legen.
- **Umzug vom WLAN-Test:** Was unter `https://<IP>:4173` auf einem Gerät liegt, ist unter der neuen Adresse
  nicht zu sehen. Dort zuerst "Alle sichern", dann unter der neuen Adresse "Backup importieren".

## Android-App (Capacitor)

Dieselbe App gibt es zusätzlich als Android-App, im Test auf einem Galaxy Tab S7 FE. Capacitor packt
`dist/` in eine Android-Hülle (Ordner `android/`). Grund: Eine App darf Fotos direkt in die Galerie
speichern, eine Webseite nicht.

**Werkzeuge auf dem Rechner:** Java 21 (`jdk21-openjdk`), `android-udev` für USB, Android SDK in
`~/Android/Sdk` (Kommandozeilenwerkzeuge 23 mit dem neuen Befehl `android sdk` statt `sdkmanager`;
installiert: `platform-tools`, `platforms/android-36`, `build-tools/35.0.0`). `android/local.properties`
nennt den SDK-Pfad und ist nicht in Git. Capacitor 8.6.2 verlangt compileSdk 36 und Java 21.

**Bauen:** `npm run android` – baut die Web-App im Modus `android` (ohne Service Worker, siehe
`vite.config.ts`), kopiert sie mit `cap sync` in die Hülle und baut mit Gradle eine Debug-APK:
`android/app/build/outputs/apk/debug/app-debug.apk`. Danach liegt in `dist/` die Android-Fassung;
`npm run deploy` baut für die Webseite ohnehin neu.

**Was in der App anders ist (`src/native.ts`):**
- "Aufnehmen" nutzt die Kamera-Erweiterung, und zwar bewusst das ältere `getPhoto`: Das neue
  `takePhoto` (Camera 8) nimmt das Ergebnis an Capacitor vorbei entgegen und verliert es, wenn Android
  die App inzwischen beendet hat (Protokoll: "Unable to find a Capacitor plugin to handle requestCode").
- **Galerie-Album:** Die Kamera-Erweiterung kann nur nach DCIM speichern. Darum `saveToGallery: false`
  und eine eigene kleine Android-Erweiterung `android/app/src/main/java/de/baumaengel/app/GalleryPlugin.java`
  (angemeldet in `MainActivity.java`): legt das Foto in voller Auflösung über den MediaStore nach
  `Bilder/Baumängel`, die Galerie zeigt das als Album "Baumängel". Ohne Berechtigung, ab Android 10.
- **Beenden durch Android:** Auf Geräten mit wenig Arbeitsspeicher (Tab S7 FE) beendet Android die App
  oft beim ersten Kamerastart einer Sitzung. Vor der Aufnahme steht deshalb im `localStorage`
  (`baumaengel-foto-fuer`), zu welchem Mangel das Foto gehört. Nach dem Neustart liefert Capacitor das
  Foto über `appRestoredResult` (Erweiterung `@capacitor/app`) nach; `saveRestoredPhoto` in `main.ts`
  speichert es und öffnet den Mangel. Testen: Während die Kamera offen ist,
  `adb shell am kill de.baumaengel.app` (genau wie Android bei Speichermangel). Die Entwickleroption
  "Aktivitäten nicht speichern" ist dafür zu grob: Sie startet die App auch nach jeder Dateiauswahl neu.
- **Noch nicht abgesichert:** Dateiauswahl (Plan-PDF, Fotos aus der Galerie, Backup importieren) läuft
  über das Auswahlfenster des WebViews. Beendet Android die App währenddessen, ist die Auswahl verloren.
  Kam im Test ohne Entwickleroption nicht vor (die Auswahl braucht kaum Speicher).
- Backups und Berichte: Herunterladen gibt es in der Hülle nicht. `saveFile` schreibt die Datei
  stückweise nach `Documents/Baumaengel/` (ab Android 11 ohne Berechtigung, die App darf dort nur ihre
  eigenen Dateien ändern; gibt es den Namen schon von einer früheren Installation, kommt die Uhrzeit dazu).
- Links mit `target="_blank"` (Google Maps) gibt die App an Android weiter, damit die Maps-App öffnet.
- Kein Service Worker: Alle Dateien stecken in der APK. Updates der App gibt es nur mit neuer APK.
- Die Daten der App liegen getrennt von denen in Chrome (andere Adresse: `https://localhost`).
  Umzug wie immer über "Alle sichern" und "Backup importieren".
- **JPEG-Packen auf Android:** `canvas.toBlob` wartet in Android auf "Leerlauf" und brauchte auf dem
  Tab S7 FE ohne Berührung jedes Mal rund 4 Sekunden (gemessen über die Debug-Schnittstelle), `toDataURL`
  50 bis 110 ms. `canvasToJpeg` in `photos.ts` nimmt deshalb auf Android `toDataURL`, sonst `toBlob`.

**Fehlersuche auf dem Tablet:** Die Debug-APK lässt sich mit Chrome-Werkzeugen untersuchen:
`adb shell cat /proc/net/unix | grep webview_devtools_remote`, dann
`adb forward tcp:9333 localabstract:<Name>`; danach ist die App unter `http://127.0.0.1:9333`
erreichbar (z. B. mit puppeteer-core). Abstürze und Beenden: `adb logcat -d -b crash` bzw. nach
"has died" suchen.

**App-Symbol und Startbild:** `sh scripts/android-icons.sh` erzeugt alle Größen in `android/app/src/main/res`
aus dem Logo-Symbol (dasselbe wie `scripts/app-icon.svg` für die Web-Icons). Braucht ImageMagick. Das
adaptive Symbol bleibt im sicheren Kreis (66 von 108 Einheiten), damit es bei jeder Launcher-Form ganz
sichtbar ist.

**Signieren:** Die Debug-APK ist mit dem automatischen Testschlüssel signiert und nur zum Ausprobieren
gedacht. Für die echte Verteilung braucht es einen eigenen Schlüssel, der sicher verwahrt werden muss
(ohne ihn lassen sich spätere Versionen nicht über die alte installieren).

## Projektaufbau

```
index.html            Seite mit allen Ansichten und Fenstern, lädt src/main.ts
vite.config.ts        Build, PWA, WLAN-Vorschau
tsconfig.json         TypeScript-Einstellungen für src/ (Browser)
tsconfig.node.json    TypeScript-Einstellungen für vite.config.ts und scripts/ (Node)
scripts/
  copy-pdfjs-assets.ts  kopiert PDF.js-Hilfsdateien nach public/pdfjs (läuft vor dev und build)
  make-cert.ts          Zertifikate für den WLAN-Test
  android-icons.sh      App-Symbol und Startbild der Android-App
  deploy-sftp.ts        lädt dist/ per SFTP hoch (npm run deploy)
public/               Logo, Icons, .htaccess (Apache); public/pdfjs wird erzeugt und ist nicht in Git
src/
  types.ts            zentrale Typen: Project, Plan, Defect, Importance, Photo, BackupFile ...
  main.ts             Plan-Ansicht: Zoom, Finger, Punkte, Bearbeitungsfenster, Mängelliste
  home.ts             Startseite: Projektliste, Suche, Backup-Knöpfe, Speicher-Anzeige
  profiles.ts         Fenster "Wer arbeitet gerade?", gewähltes Profil für neue Mängel
  project-dialog.ts   Fenster "Neues Projekt" / "Projekt bearbeiten": Name, Adresse, Beteiligte, Bereich
  parties.ts          Beteiligte (Bauherrschaft usw.) und Projektnummer: Liste der Felder für beide Fenster
  inspections.ts      Begehungen: Regeln für die Daten (Sortierung, Termine für die Kopfzeile, Backup prüfen)
  inspections-dialog.ts  Fenster "Begehungen": Liste, eine Begehung mit Teilnehmern bearbeiten
  db.ts               Datenbank: Tabellen, Versionen, alle Lese- und Schreibzugriffe
  defects.ts          Stufen (Mangel/Hinweis/Intern), Erledigt, Termine, Sortierung, Gewerke, Standard-Textbausteine
  backup.ts           ZIP-Export und -Import, Backup-Erinnerung
  report.ts           PDF-Bericht erzeugen (wird erst bei Bedarf geladen)
  report-dialog.ts    Fenster "Bericht erstellen"
  pdf.ts              PDF.js einrichten
  plan-thumb.ts       Plan-Vorschau für die Projektkarten
  photos.ts           Fotos verkleinern, Markierungen zeichnen und prüfen
  photo-editor.ts     Foto ansehen, Pfeile und Kreise, Bildunterschrift
  camera.ts           Kamerafenster für Laptop und PC (Live-Bild, Auslöser)
  maps.ts             Projektadresse als Google-Maps-Link (Menüs und Deckblatt des Berichts)
  divisions.ts        Bereiche (Büros) mit Logos, gewählter Bereich
  native.ts           nur in der Android-App: Kamera mit Galerie-Album, Speichern in Documents, Links
  text-blocks.ts      Fenster "Textbausteine" (vorerst Platzhalter)
  trades-dialog.ts    Fenster "Gewerk wählen": Gewerke-Liste mit Suche, Ergänzen, Löschen
  master-entries.ts   Stammdaten: Aufbau der Einträge, Vorgaben, feste Kennungen
  master-data.ts      Stammdaten als Datei: "Listen sichern" / "Listen einlesen"
  outside-tap.ts      Tippen neben ein Fenster schließt es (wie sein Schließen-Knopf)
  control-fields.ts   Angaben zur Baukontrolle: Vorgaben, feste Texte, Aufzählungen erkennen
  bullet-field.ts     Textfeld mit Aufzählungspunkten ("• Aufzählung", Enter setzt fort)
  date-tile.ts        Datumskachel (Datum als Text, unsichtbares Datumsfeld darüber)
  search.ts           gemeinsame Suchregeln für Projektsuche und Mängelliste
  menu.ts, share.ts, status.ts, theme.ts   Menüs, Datei herausgeben, Meldungen, Darstellung
  style.css           alle Styles
```

`src/counter.ts` und die Dateien in `src/assets/` sind Reste der Vite-Vorlage und werden nicht benutzt.

## TypeScript im Projekt

- Typen, die mehrere Dateien brauchen, stehen in `src/types.ts`, alle anderen direkt in der Datei.
- Importe nennen die Endung: `import { openPdf } from './pdf.ts'`.
- Reine Typen kommen mit `import type`.
- Nur Syntax verwenden, die beim Übersetzen einfach wegfällt (`erasableSyntaxOnly`), also kein `enum`.
- `!` ("ist hier sicher nicht leer") und `as` ("ist dieser Typ") prüfen nichts zur Laufzeit. Bei der
  Umstellung wurde so das bisherige Verhalten exakt erhalten. Diese Stellen sind deshalb Versprechen
  und keine Prüfung. In neuem Code ist eine echte Abfrage vorzuziehen, wenn ein Wert wirklich fehlen kann.
- Daten von außen (Backups) sind bewusst locker typisiert (`IncomingBackupFile`, `unknown`) und
  werden beim Einlesen Wert für Wert geprüft.

## Regeln für gespeicherte Daten

**Datenbank (`db.ts`):** Der Name ist `baumaengel`, aktuell gilt Version 10.

- Bestehende `db.version(...)`-Blöcke nie ändern. Änderungen kommen als neue Version mit `.upgrade(...)`.
- Geänderte Felder auch in `types.ts` nachziehen.
- PDFs und Fotos liegen als `ArrayBuffer`, weil Safari mit Blobs in IndexedDB Probleme hatte.

**Backup (`backup.ts`):** Ein ZIP mit `projekt.json`, `plaene/`, `fotos/` und `bericht/`, aktuell Format-Version 9.

- Alte Backups müssen importierbar bleiben: ohne Nummern, mit `status` statt Wichtigkeit, Fotos nur
  als Dateiname, ohne `report`, `textBlocks`, `trades` und `createdBy`, mit den alten Stufen
  `wichtig`/`relevant` (werden in `readMarking` zu Mangel/Intern).
- Ein Backup einer neueren Version lässt sich in einer älteren App nicht einlesen (z. B. 7 in einer App mit 6). Alle Geräte sollten
  deshalb dieselbe App-Version haben (sie aktualisieren sich von selbst, sobald sie die App öffnen).
- Bei Änderungen am Format `VERSION` erhöhen. `BackupFile` beschreibt, was geschrieben wird,
  `IncomingBackupFile`, was ankommen kann.
- Ein Import legt immer ein neues Projekt an und überschreibt nie ein vorhandenes.

**Sammelbackup ("Alle sichern" auf der Startseite):** Alle Projekte in einem ZIP. Jedes Projekt liegt in
einem eigenen Ordner (`projekte/01 Name/`) mit genau dem Inhalt eines einzelnen Backups, dazu kommt
`sammlung.json` (Format `baumaengel-sammelbackup`, Version 1) mit der Liste der Ordner.

- Bewusst kein ZIP im ZIP: Sonst lägen beim Erstellen auf dem iPad alle Daten zweimal im Speicher.
- "Backup importieren" erkennt beide Arten selbst (`importBackup` in `backup.ts`). Beim Sammelbackup
  fragt die App vorher nach und sagt, welche Projekte es schon gibt (die kommen als Kopie dazu).
  Scheitert ein Projekt, geht es mit den übrigen weiter, die Meldung nennt das gescheiterte.
- Nach "Datei sichern" gilt jedes enthaltene Projekt als gesichert (Backup-Erinnerung).
- Das ganze ZIP entsteht im Arbeitsspeicher. Bei sehr vielen großen Projekten kann das auf dem iPad
  knapp werden, dann einzelne Projekte sichern.

## Worauf man achten muss

- **Zertifikate:** `scripts/make-cert.ts` erzeugt eine neue Zertifizierungsstelle, sobald die IP-Adresse
  nicht mehr passt oder das Zertifikat bald abläuft. Sie muss dann neu aufs iPad. Port 4173 bleibt
  fest, sonst wären die Daten auf dem iPad "weg" (IndexedDB hängt an der Adresse). `.cert/` enthält
  einen geheimen Schlüssel und gehört nicht in Git.
- **Speicher auf dem iPad:** höchstens ca. 16 Mio. Pixel pro Zeichenfläche. PDFs und Fotos werden
  deshalb nacheinander verarbeitet, und im Bericht ist immer nur ein PDF geöffnet.
- **Bereiche (z. B. Büros oder Arbeitsplätze):** jeder mit eigenem Logo. Sie stehen fest in
  `divisions.ts`, die Logos in `public/bereiche/` (Bericht mit weißem, Leiste mit durchsichtigem
  Hintergrund). Ausgeliefert werden die Platzhalter "Arbeitsplatz 1" bis "Arbeitsplatz 3", Namen und
  Logos lassen sich dort einfach austauschen. Jedes Projekt speichert die **id** des
  Bereichs in `division` (`null` = "Ohne Bereich"), sie reist im Backup mit (ab Format 5) und darf sich daher
  nie ändern. Unbekannte ids zählen als "Ohne Bereich". Antippen des Logos oben links wählt den Bereich; die
  Startseite zeigt nur dessen Projekte, die Wahl steht wie das Profil im `localStorage`
  (`baumaengel-division`). Neue Projekte kommen in den gewählten Bereich, ändern lässt er sich in
  "Projekt bearbeiten". Das Standardlogo im Bericht ist das des Bereichs, ohne Bereich das App-Logo
  (`public/logo.png`). "Alle sichern" sichert alle Projekte aller Bereiche. Projekte von vor DB-Version 8 sind
  "Ohne Bereich".
- **Karte:** "In Google Maps" in den "…"-Menüs (Projektkarte und Projekt) und die Adresse auf dem
  Deckblatt des Berichts öffnen `https://www.google.com/maps/search/?api=1&query=…`. Das geht auf iPad,
  Android, Surface und PC gleich (App, falls installiert, sonst Webseite). Die automatische Erkennung von
  Adressen und Telefonnummern durch das iPad ist per `format-detection` in `index.html` abgeschaltet,
  sonst öffnete sie Apple Karten. In einem PDF erkennt das iPad Adressen trotzdem selbst.
- **Fotos aufnehmen:** Auf iPad und Handy öffnet "Aufnehmen" die Kamera-App des Geräts
  (`<input capture>`). Browser am Computer ignorieren `capture` und zeigen nur die Dateiauswahl. Dort
  öffnet die App ein eigenes Kamerafenster (`camera.ts`, `getUserMedia`). Unterschieden wird über
  `(pointer: coarse)`: Finger als Hauptbedienung = Kamera-App. Die Kamera geht nur über https oder
  localhost. Geht sie nicht (verweigert, keine Kamera), bietet das Fenster "Datei wählen" an.
  Edge und Chrome brechen manchmal mit "Timeout starting video source" ab (`AbortError`, z. B. am
  Surface oder wenn ein anderes Programm die Kamera hat). Darum versucht `camera.ts` nacheinander:
  mit Wunschgröße 1920×1080, ohne Größe, dann beliebige Kamera. Danach gibt es "Erneut versuchen".
- **Teilen auf dem iPad:** `navigator.share` geht nur direkt nach einem Fingertipp. Darum läuft das
  Sichern in zwei Schritten (erst erstellen, dann "Datei sichern" antippen).
- **PDF.js** verbraucht die übergebenen Daten. Wer sie danach noch braucht, gibt eine Kopie weiter.
- **Mängel-Nummern** werden einmal vergeben und nie neu verteilt, damit verschickte Berichte stimmen.
- **Profile** sind keine Konten: Es gibt kein Passwort, jeder kann jedes Profil wählen. Sie liegen in der
  Tabelle `profiles` und kommen nicht ins Backup. Welches gewählt ist, steht wie die Darstellung im
  `localStorage` (`baumaengel-profile`). Ein Mangel speichert in `createdBy` den **Namen**, nicht die id,
  damit er im Backup mitreist und erhalten bleibt, wenn das Profil gelöscht wird. `null` heißt unbekannt
  (Mängel von vor den Profilen oder ohne gewähltes Profil erfasst). "Erfasst von" lässt sich nicht ändern.
- **Adresse eines Projekts:** Es gibt nur eine, sie steht in `reportSettings.address`. Das Fenster
  "Neues Projekt", "Projekt bearbeiten" und das Berichtsformular ändern alle dasselbe Feld. Deshalb war
  dafür keine neue DB- oder Backup-Version nötig. Ältere Projekte haben eine Adresse nur, wenn der Bericht
  schon ausgefüllt wurde.
- **Beteiligte und Projektnummer** (Bauherrschaft, Entwurfsverfassende, Bauaufsichtsbehörde,
  Brandschutzdienststelle, Bauleitung, Projektnummer) funktionieren genauso: freie Textfelder in beiden
  Fenstern, gespeichert in `reportSettings` (`owner`, `designer`, `buildingAuthority`, `fireAuthority`,
  `siteManager`, `projectNumber`), keines ist Pflicht. Die Liste steht nur in `src/parties.ts`, beide
  Fenster, der Bericht, Backup und Suche bauen sich daraus. Im Bericht endet das Deckblatt mit der
  Adresse. Danach kommt die Seite "Projektangaben" (`drawProjectInfo`): Beteiligte, Projektnummer,
  Datum und Ersteller als Tabelle, leere fallen weg, ganz ohne Angaben entfällt die Seite. Die Vorschau
  im Berichtsfenster zeigt beide Seiten untereinander. Keine neue DB-Version nötig (keine Indexfelder),
  im Backup ab Version 6. Die Projektnummer steht nicht auf "Projektangaben", sondern auf dem
  Deckblatt unter der Adresse ("Projektnummer: …") und in der Kopfzeile direkt unter der Adresse
  (ohne Bezeichnung). Dafür gibt es `INFO_PAGE_PARTIES`.
- **Begehungen:** Wer an welchem Tag dabei war (Name, Amt/Büro/Firma). Liegen als Liste in
  `reportSettings.inspections`, nach Datum sortiert (keine neue DB-Version nötig), im Backup ab Version 7.
  Fenster über das "…"-Menü im Projekt ("Begehungen") und über "Bericht erstellen". Nichts davon ist
  Pflicht, eine Begehung entsteht nur über "Neue Begehung". Die übernimmt das heutige Datum und die
  Teilnehmer der letzten Begehung (gibt es für heute schon eine, öffnet sich die). Beim Tippen gibt es
  Vorschläge aus den Begehungen aller Projekte, zu einem bekannten Namen wird die Firma ergänzt.
  Im Bericht folgt nach "Projektangaben" die Seite "Teilnehmer der Begehungen", je Begehung eine
  Tabelle, älteste zuerst. Tabellen werden nur zerteilt, wenn sie länger als eine Seite sind.
  (Die Termine standen in 4.21 kurz auch in der Kopfzeile, das wurde in 4.23 wieder entfernt.)
- **Suche auf der Startseite** durchsucht Projektname sowie Projektname, Adresse, Beteiligte und Projektnummer aus `reportSettings`.
- **Backup-Erinnerung im Projekt** liegt oben links wie Mängelliste und Schnellerfassung. Solange eines
  davon offen ist, wird sie ausgeblendet, neben dem Bearbeitungsfenster wird sie schmaler.
- **Suche in der Mängelliste** durchsucht Nummer und Überschrift. Eine reine Zahl ("12", "#12", "Nr. 12")
  findet den Mangel mit genau dieser Nummer und Überschriften, in denen die Zahl vorkommt. Die Suche gilt
  nur für die Liste, die Filter (Wichtigkeit, Erledigte) gelten für Liste und Plan. Blendet ein Filter
  Treffer aus, sagt die Liste das. Beide Suchen nutzen `search.ts` (Groß/klein, Umlaute und ß egal).
- **Stufen (seit 4.24):** Mangel (rot, Kreis), Hinweis (grün, Raute), Intern (petrol, Quadrat), in dieser
  Reihenfolge. Vorher Wichtig/Relevant/Hinweis: DB-Version 9 und `readMarking` setzen Wichtig auf Mangel
  und Relevant auf Intern um (gleiche Form). Im Code heißt das Feld weiter `importance`, im Bericht
  die Spalte "Art". Welche Stufen in den Bericht kommen, wird beim Erstellen gewählt (siehe Bericht).
- **Stammdaten (seit 4.29):** Listen für alle Projekte liegen in der Tabelle `masterData` (DB-Version 10),
  bisher nur die Gewerke (`kind: 'trade'`), später Kontakte, Textbausteine usw. Jeder Eintrag hat eine feste
  `uid`, `updatedAt` und beim Löschen `deleted: true` statt Entfernen, damit sich Geräte abgleichen können
  (heute per Datei, später SharePoint). Vorgaben haben feste uids aus ihrem Namen (`vorgabe:trade:dach`),
  damit sie auf zwei Geräten nicht doppelt entstehen. Zusammenführen in `mergeMaster`: unbekannte uid kommt
  dazu (außer der Name ist schon da), sonst gilt die neuere Fassung. Grenze: Legen zwei Geräte denselben
  Namen getrennt an, behält jedes seine uid; ein späteres Löschen gilt dann nur für die eigene.
  Startseite, Menü (Sonne): "Listen sichern" / "Listen einlesen" (JSON, `master-data.ts`).
- **Gewerke-Liste (seit 4.24):** Die Kachel "Gewerk" öffnet das Fenster "Gewerk wählen" (`trades-dialog.ts`)
  mit Kacheln aus den Stammdaten (seit 4.29, vorher Tabelle `trades`; anfangs `TRADES` aus `defects.ts`). Tippen
  wählt, Suchen filtert, ein neuer Name lässt sich direkt hinzufügen, "Bearbeiten" löscht Einträge
  (Mängel behalten ihr Gewerk). Die Liste kommt ins Backup und wird beim Import ergänzt. Erster Test für
  die geplanten Auswahlfenster für Firmen und Namen.
- **Punkt-Menü (Schnellerfassung und Bearbeitungsfenster):** Seit 4.24 im neuen Aufbau: Überschrift oben,
  Foto aufnehmen und Aus Galerie nebeneinander, darunter die Miniaturen; Textbaustein als Kachel; Gewerk, Firma,
  Festgestellt und Frist als Kacheln im Raster (Firma noch als Eingabefeld mit Vorschlägen). Die Datumskacheln zeigen das Datum als Text, darüber liegt
  unsichtbar das Datumsfeld (`.date-tile`), das am Finger die Auswahl des Geräts öffnet und am Rechner per
  `showPicker()`. "×" oben rechts leert das Datum. Die Kachel "Textbaustein" öffnet vorerst nur einen
  Platzhalter; die Bausteine nach Kategorien kommen später. Die alten Bausteine bleiben in Datenbank und
  Backup, sind aber derzeit nicht auswählbar.
- **Bericht (seit 4.26):** Titel "Bauüberwachungsbericht". Deckblatt: Logo oben rechts, darunter die
  Adresse des Büros (`address` in `divisions.ts`, steht auch in jeder Kopfzeile unter dem Logo), kein Strich, dann Name, Adresse und Projektnummer des Objekts und
  kompakt die Projektangaben (Beteiligte, Begehungsdatum = letzte Begehung, Erstellungsdatum,
  Ersteller). Das Titelbild ist freiwillig und steht allein auf Seite 2, ohne Bild rückt der Rest nach.
  Kopfzeile: Projektnummer und Name blau und fett, darunter Datum und Ersteller, keine Objektadresse
  und keine Trennlinie mehr. Fußzeile nur noch mit der Seitenzahl. Tabelle und Mängelseiten nach Nummer (`sortForReport`),
  die erledigten weiter am Ende in ihrem Abschnitt. Im Berichtsfenster unter "Im Bericht" wählbar, welche
  Punkttypen hineinkommen (`reportLevels`, ohne Wahl Mangel und Hinweis). Nicht gewählte fehlen
  überall, auch auf den Plänen und in der Legende; die Nummern der übrigen bleiben (Lücken möglich).
  `reportLevels` gilt nur auf dem Gerät und kommt nicht ins Backup.
- **Angaben zur Baukontrolle (seit 4.27):** Tabelle nach dem Deckblatt (nach dem Titelbild, falls es
  eines gibt). Eingetragen im Berichtsfenster: Veranlassung (Vorgabe aus `OCCASIONS`, später aus den
  Textbausteinen), Unterlagen (mit Aufzählung),
  begangene Gebäudeteile (Auswahl aus den Plänen, `inspectedPlanIds`), Ausführungsstand und die Liste
  der vorzulegenden Unterlagen (ohne Vorgabe, sie hängt vom Projekt ab). Fest im Bericht: der Absatz vor
  dieser Liste (mit dem Empfänger je Bereich, `recipient` in `divisions.ts`), Sachverständige und
  Abnahmebefund. Alle festen Texte in `control-fields.ts` sind Beispiele und durch eigene zu ersetzen. Leere Eingaben fallen weg. Alles gilt fürs Projekt und kommt ins
  Backup (Format 9, die Plan-ids werden beim Import umgesetzt).
- **Berichtsfenster (seit 4.27):** Aufbau wie "Alle Details": oben Kacheln für Erstellungsdatum,
  Ersteller und Begehungen, die Auswahl der Punkttypen, darunter aufklappbare Abschnitte (`<details>`)
  "Angaben zur Baukontrolle", "Projekt und Beteiligte", "Titelbild und Logo" mit einer Zusammenfassung
  in der Kopfzeile (`showSummaries`). Schließen und Bericht erstellen bleiben unten stehen.
  Die Vorschau rechts zeigt Deckblatt, Titelbild-Seite und die Tabelle (`renderControlPreview`).
- **Daneben tippen schließt:** Bei allen Fenstern mit abgedunkeltem Hintergrund wirkt ein Tipp auf die
  dunkle Fläche wie der Schließen-Knopf (`outside-tap.ts`), nur wenn der Finger auch dort aufgesetzt hat.
  Ausnahmen: Während der Bericht entsteht, bleibt das Fenster offen. Im Projektfenster wird bei
  geänderten Eingaben erst nachgefragt. Eine offene Begehung wird vorher wie mit "Fertig" abgeschlossen.
  Bearbeitungsfenster, Schnellerfassung und Mängelliste schließt ein Tipp auf eine freie Stelle im Plan.
- **Sperre der Punkte:** Gesetzte Punkte lassen sich nicht einfach ziehen (sonst verrutschen sie bei
  einem Vertipper auf der Baustelle). Zum Verschieben im Bearbeitungsfenster "Verschieben" einschalten.
  Die Freigabe gilt nur für diesen einen Punkt und endet, sobald er abgewählt wird. Ein gerade neu
  gesetzter Punkt ist bis dahin noch frei. Die Freigabe wird nicht gespeichert, deshalb war keine neue
  DB- oder Backup-Version nötig (`movableId` in `main.ts`).
- **Plan wechseln:** Oben links steht der Name des angezeigten Plans (der Dateiname ohne `.pdf`).
  Antippen öffnet ein Menü mit allen Plänen, ihren offenen Mängeln und "Plan hinzufügen". Lange
  Namen werden in der Mitte gekürzt, weil am Ende meist das Geschoss steht (`setPlanName` in `main.ts`).
  Beim Hinzufügen lassen sich mehrere PDFs auf einmal wählen, sie werden nacheinander eingelesen.
- **Reihenfolge der Pläne:** Steht in `planMeta.position` (seit DB-Version 7, vorher galt die Reihenfolge
  der ids). Sie wird im Plan-Menü über "Reihenfolge" geändert und gilt auch für den Bericht. Im Backup
  gibt es dafür kein eigenes Feld: Der Export schreibt die Pläne in dieser Reihenfolge, der Import legt
  sie nacheinander an. Deshalb blieb es bei Backup-Version 4.
