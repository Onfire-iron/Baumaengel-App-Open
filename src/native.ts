// =============================================================
// Android-App (Capacitor): was dort anders läuft als im Browser
// =============================================================
//
// Dieselbe App läuft im Browser und als Android-App. In der App fehlen einige Browser-Funktionen
// (Herunterladen), dafür gibt es Dinge, die eine Webseite nicht darf (Fotos in die Galerie
// speichern, Dateien in "Documents" ablegen). Alles, was nur in der App gilt, steht hier.
// Die Erweiterungen werden erst bei Bedarf geladen, im Browser also nie.

import { Capacitor, registerPlugin } from '@capacitor/core';

export const isNativeApp = Capacitor.isNativePlatform();

// ---------- Kamera ----------

// Abbruch in der Kamera-App ist kein Fehler. getPhoto meldet ihn nur als Text.
const CAMERA_CANCELED = /cancel/i;

// Zu welchem Mangel das Foto gehört. Android beendet die App manchmal, während die Kamera offen ist
// (wenig Arbeitsspeicher, z. B. Tab S7 FE). Beim Neustart steht dann nur noch hier, wohin es gehört.
const PHOTO_TARGET_KEY = 'baumaengel-foto-fuer';

export interface PhotoTarget {
  projectId: number;
  pinId: number;
}

// Öffnet die Kamera des Geräts. Das Foto landet in voller Auflösung zusätzlich in der Galerie,
// im Album "Baumängel" (siehe saveToGallery). null = abgebrochen.
// Bewusst das ältere getPhoto und nicht takePhoto: takePhoto (Camera 8) nimmt das Ergebnis an
// Capacitor vorbei entgegen und verliert es, wenn Android die App inzwischen beendet hat
// (im Protokoll: "Unable to find a Capacitor plugin to handle requestCode"). getPhoto merkt sich
// den Dateipfad und liefert das Foto nach dem Neustart über appRestoredResult.
export async function takeNativePhoto(target: PhotoTarget): Promise<Blob | null> {
  const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
  remember(target);
  try {
    const photo = await Camera.getPhoto({
      source: CameraSource.Camera,
      resultType: CameraResultType.Uri,
      quality: 90,
      correctOrientation: true,
      saveToGallery: false, // die Erweiterung kennt nur DCIM, das eigene Album macht saveToGallery
    });
    const blob = await loadPhoto(photo.webPath);
    await saveToGallery(blob);
    return blob;
  } catch (err) {
    if (CAMERA_CANCELED.test((err as Error).message ?? '')) return null;
    throw err;
  } finally {
    // Wurde die App unterwegs beendet, kommt sie hier nie an: Dann bleibt der Eintrag für den Neustart
    forget();
  }
}

// Nach einem Neustart durch Android: Capacitor liefert das Foto nach, das noch unterwegs war
export async function onRestoredPhoto(handler: (target: PhotoTarget, photo: Blob) => void): Promise<void> {
  if (!isNativeApp) return;
  const { App } = await import('@capacitor/app');
  await App.addListener('appRestoredResult', async (event) => {
    if (event.pluginId !== 'Camera' || event.methodName !== 'getPhoto') return;
    const target = recall();
    forget();
    if (!event.success || !target) return;
    try {
      const blob = await loadPhoto((event.data as { webPath?: string } | undefined)?.webPath);
      await saveToGallery(blob);
      handler(target, blob);
    } catch (err) {
      console.error(err);
    }
  });
}

// Eigene Android-Erweiterung (android/.../GalleryPlugin.java): legt das Foto in "Bilder/Baumängel",
// das zeigt die Galerie als eigenes Album. Klappt das nicht, bleibt das Foto trotzdem in der App.
interface GalleryPlugin {
  saveImage(options: { data: string; fileName: string; album: string }): Promise<void>;
}
const Gallery = registerPlugin<GalleryPlugin>('Gallery');
const ALBUM = 'Baumängel';

async function saveToGallery(photo: Blob) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '_');
  try {
    const data = toBase64(new Uint8Array(await photo.arrayBuffer()));
    await Gallery.saveImage({ data, fileName: `Baumaengel_${stamp}.jpg`, album: ALBUM });
  } catch (err) {
    console.warn('Foto nicht in der Galerie gespeichert', err);
  }
}

async function loadPhoto(webPath: string | undefined) {
  if (!webPath) throw new Error('Die Kamera hat kein Foto geliefert.');
  return (await fetch(webPath)).blob();
}

function remember(target: PhotoTarget) {
  try {
    localStorage.setItem(PHOTO_TARGET_KEY, JSON.stringify(target));
  } catch {
    // ohne Speicher geht nur die Rettung nach einem Neustart verloren
  }
}

function recall(): PhotoTarget | null {
  try {
    const value = JSON.parse(localStorage.getItem(PHOTO_TARGET_KEY) ?? 'null');
    return Number.isInteger(value?.projectId) && Number.isInteger(value?.pinId) ? value : null;
  } catch {
    return null;
  }
}

function forget() {
  try {
    localStorage.removeItem(PHOTO_TARGET_KEY);
  } catch {
    // siehe remember
  }
}

// ---------- Dateien (Backups, Berichte) ----------

// Gespeichert wird in Documents/Baumaengel. Der Bericht öffnet sich danach gleich (openNativeFile).

// Ab Android 11 darf die App ohne Berechtigung im öffentlichen Ordner "Documents" eigene Dateien
// anlegen. Dort findet man sie in "Eigene Dateien" bzw. "Dateien". Stückweise geschrieben, damit
// große Backups nicht auf einmal im Speicher landen.
const FOLDER = 'Baumaengel';
const CHUNK = 3 * 1024 * 1024; // durch 3 teilbar, damit sich die Base64-Stücke sauber aneinanderreihen

// Liefert, wo die Datei liegt, zum Anzeigen für den Nutzer
export async function saveNativeFile(blob: Blob, fileName: string): Promise<string> {
  const { Directory, Filesystem } = await import('@capacitor/filesystem');
  let name = fileName;
  try {
    await writeChunks(Filesystem, Directory.Documents, `${FOLDER}/${name}`, blob);
  } catch (err) {
    // Gleichnamige Datei, die nicht dieser Installation gehört (z. B. nach Neuinstallation der App):
    // Android verbietet das Überschreiben. Dann mit Uhrzeit im Namen.
    console.warn(err);
    const time = new Date().toTimeString().slice(0, 8).replace(/:/g, '-');
    name = fileName.replace(/(\.[^.]+)?$/, ` ${time}$1`);
    await writeChunks(Filesystem, Directory.Documents, `${FOLDER}/${name}`, blob);
  }
  return `Documents/${FOLDER}/${name}`;
}

// Eigene Android-Erweiterung (android/.../FileViewerPlugin.java): öffnet eine gespeicherte Datei in der
// passenden App, z. B. den Bericht in der PDF-Anzeige. savedAt wie von saveNativeFile geliefert.
interface FileViewerPlugin {
  open(options: { path: string; mimeType: string }): Promise<void>;
}
const FileViewer = registerPlugin<FileViewerPlugin>('FileViewer');

export async function openNativeFile(savedAt: string, mimeType: string): Promise<void> {
  const { Directory, Filesystem } = await import('@capacitor/filesystem');
  const { uri } = await Filesystem.getUri({ directory: Directory.Documents, path: savedAt.replace(/^Documents\//, '') });
  await FileViewer.open({ path: uri, mimeType });
}

type FilesystemApi = typeof import('@capacitor/filesystem').Filesystem;
type DirectoryValue = (typeof import('@capacitor/filesystem').Directory)[keyof typeof import('@capacitor/filesystem').Directory];

async function writeChunks(fs: FilesystemApi, directory: DirectoryValue, path: string, blob: Blob) {
  let start = 0;
  do {
    const data = toBase64(new Uint8Array(await blob.slice(start, start + CHUNK).arrayBuffer()));
    if (start === 0) await fs.writeFile({ path, data, directory, recursive: true });
    else await fs.appendFile({ path, data, directory });
    start += CHUNK;
  } while (start < blob.size);
}

function toBase64(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// ---------- Links ----------

// Links zu anderen Seiten (Google Maps) öffnet die App nicht selbst, sondern Android: Google Maps
// öffnet dann die Maps-App, sonst der Browser. Dafür reicht es, im selben Fenster zu navigieren,
// Capacitor reicht fremde Adressen an Android weiter. target="_blank" würde dagegen ins Leere laufen.
export function openLinksWithAndroid(): void {
  if (!isNativeApp) return;
  document.addEventListener(
    'click',
    (e) => {
      const link = (e.target as Element).closest<HTMLAnchorElement>('a[target="_blank"]');
      if (!link || !/^https?:/.test(link.href)) return;
      e.preventDefault();
      window.location.href = link.href;
    },
    true
  );
}
