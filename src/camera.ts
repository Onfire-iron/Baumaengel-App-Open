// =============================================================
// Kamera am Laptop oder PC
// =============================================================
//
// Auf iPad und Handy öffnet <input capture> die Kamera-App des Geräts. Browser am Computer
// ignorieren das und zeigen nur die Dateiauswahl. Dort öffnet die App deshalb ein eigenes
// Fenster mit Live-Bild der eingebauten Kamera (getUserMedia). Geht nur über https oder localhost.

const dialog = document.getElementById('camera-dialog') as HTMLElement;
const video = document.getElementById('camera-video') as HTMLVideoElement;
const message = document.getElementById('camera-message') as HTMLElement;
const select = document.getElementById('camera-select') as HTMLSelectElement;
const shootBtn = document.getElementById('camera-shoot') as HTMLButtonElement;
const fileBtn = document.getElementById('camera-file') as HTMLButtonElement;
const retryBtn = document.getElementById('camera-retry') as HTMLButtonElement;

let stream: MediaStream | null = null;
let request = 0; // schnelles Umschalten: nur die zuletzt angeforderte Kamera zählt
let handlePhoto: (photo: Blob) => void = () => {};
let handleFile: () => void = () => {};

// Eigenes Fenster nur, wo Finger nicht das Hauptbedienmittel sind (Maus, Touchpad)
export function useOwnCamera(): boolean {
  return !matchMedia('(pointer: coarse)').matches && Boolean(navigator.mediaDevices?.getUserMedia);
}

// onPhoto bekommt das Foto als JPEG. onFile öffnet stattdessen die Dateiauswahl, falls die Kamera
// nicht geht (muss direkt aus dem Fingertipp auf "Datei wählen" kommen, darum hier als Rückruf).
export function openCamera(onPhoto: (photo: Blob) => void, onFile: () => void): void {
  handlePhoto = onPhoto;
  handleFile = onFile;
  dialog.hidden = false;
  start(null);
}

// Was beim Start nacheinander versucht wird. Zuerst mit Wunschgröße für gute Fotos. Manche Kameras
// (z. B. am Surface mit Edge) brauchen dafür so lange, dass der Browser mit "Timeout starting video
// source" abbricht. Dann geht es ohne Größe weiter und zuletzt mit "irgendeine Kamera".
function attempts(deviceId: string | null): MediaTrackConstraints[] {
  const size = { width: { ideal: 1920 }, height: { ideal: 1080 } };
  if (deviceId) return [{ deviceId: { exact: deviceId }, ...size }, { deviceId: { exact: deviceId } }];
  // Am Laptop zeigt die Kamera meist zum Nutzer, "environment" ist nur ein Wunsch für Geräte mit zwei
  return [{ facingMode: 'environment', ...size }, { facingMode: 'environment' }, {}];
}

// Bei diesen Fehlern hilft ein zweiter Versuch mit anderen Vorgaben nicht
const FINAL_ERRORS = ['NotAllowedError', 'SecurityError', 'NotFoundError'];

async function start(deviceId: string | null) {
  const current = ++request;
  stop();
  shootBtn.disabled = true;
  fileBtn.hidden = true;
  retryBtn.hidden = true;
  showMessage('Kamera wird gestartet …');

  let lastError: Error | null = null;
  for (const constraints of attempts(deviceId)) {
    try {
      const next = await navigator.mediaDevices.getUserMedia({ video: constraints, audio: false });
      if (current !== request || dialog.hidden) {
        next.getTracks().forEach((track) => track.stop()); // inzwischen geschlossen oder umgeschaltet
        return;
      }
      stream = next;
      video.srcObject = stream;
      await video.play();
      showMessage('');
      shootBtn.disabled = false;
      await fillCameraList(stream.getVideoTracks()[0]?.getSettings().deviceId ?? deviceId);
      return;
    } catch (err) {
      if (current !== request) return;
      console.error(err);
      lastError = err as Error;
      stop();
      if (FINAL_ERRORS.includes(lastError.name)) break;
    }
  }

  showMessage(cameraError(lastError!));
  fileBtn.hidden = false;
  retryBtn.hidden = lastError!.name === 'NotFoundError';
  // Vielleicht klappt eine andere Kamera (vorne/hinten, angesteckte Webcam)
  await fillCameraList(deviceId ?? undefined).catch(() => {});
}

// Mehrere Kameras (z. B. eingebaute und angesteckte): Auswahl anzeigen.
// Die Namen gibt der Browser erst heraus, wenn die Kamera erlaubt wurde.
async function fillCameraList(activeId: string | null | undefined) {
  const cameras = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  select.hidden = cameras.length < 2;
  select.replaceChildren(
    ...cameras.map((camera, index) => {
      const option = document.createElement('option');
      option.value = camera.deviceId;
      option.textContent = camera.label || `Kamera ${index + 1}`;
      return option;
    })
  );
  if (activeId) select.value = activeId;
}

function cameraError(err: Error) {
  switch (err.name) {
    case 'NotAllowedError':
      return 'Der Zugriff auf die Kamera wurde nicht erlaubt. Das lässt sich in den Einstellungen des Browsers für diese Seite ändern.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'Es wurde keine Kamera gefunden.';
    case 'NotReadableError':
    case 'AbortError': // Edge und Chrome: "Timeout starting video source"
      return (
        'Die Kamera hat nicht rechtzeitig gestartet. Meist benutzt sie gerade ein anderes Programm ' +
        '(z. B. Teams oder die Kamera-App). Das Programm schließen und „Erneut versuchen“ antippen. ' +
        'Unter Windows muss außerdem in den Einstellungen unter Datenschutz → Kamera der Zugriff für ' +
        'Desktop-Apps erlaubt sein.'
      );
    default:
      return `Die Kamera konnte nicht gestartet werden (${err.message}).`;
  }
}

function showMessage(text: string) {
  message.textContent = text;
  message.hidden = !text;
}

function stop() {
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  video.srcObject = null;
}

function close() {
  request++; // eine noch laufende Anfrage verwirft ihr Ergebnis
  stop();
  dialog.hidden = true;
}

// Das Foto hat die volle Auflösung der Kamera, verkleinert wird es wie jedes andere in addPhotos
shootBtn.addEventListener('click', () => {
  if (!video.videoWidth) return;
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d')!.drawImage(video, 0, 0);
  const onPhoto = handlePhoto;
  close();
  canvas.toBlob((blob) => blob && onPhoto(blob), 'image/jpeg', 0.92);
});

select.addEventListener('change', () => start(select.value));
retryBtn.addEventListener('click', () => start(select.value || null));
document.getElementById('camera-cancel')!.addEventListener('click', close);
fileBtn.addEventListener('click', () => {
  close();
  handleFile();
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !dialog.hidden) close();
});
