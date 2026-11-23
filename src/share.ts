// =============================================================
// Fertige Dateien (Backup, Bericht) aus der App herausgeben
// =============================================================

// iPad: über "Teilen" (in Dateien sichern, AirDrop, Mail). Sonst: normaler Download.
// Muss direkt aus einem Fingertipp heraus aufgerufen werden.
import { isNativeApp, saveNativeFile } from './native.ts';

// Liefert in der Android-App, wo die Datei gespeichert wurde, sonst null (übergeben bzw. heruntergeladen)
export async function saveFile({ blob, fileName }: { blob: Blob; fileName: string }): Promise<string | null> {
  // Android-App: Herunterladen geht dort nicht, die Datei kommt direkt nach Documents
  if (isNativeApp) return saveNativeFile(blob, fileName);

  const file = new File([blob], fileName, { type: blob.type });
  const isIpadOrIphone =
    /iPad|iPhone/.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

  if (isIpadOrIphone && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file] });
    return null;
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return null;
}

// Entfernt Zeichen, die in Dateinamen Probleme machen
export function safeFileName(name: string, fallback: string): string {
  return name.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || fallback;
}
