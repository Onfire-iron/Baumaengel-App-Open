// Läuft vor jeder Testdatei
import { configure } from '@zip.js/zip.js';

// Im Test gibt es keine Web Worker, zip.js arbeitet dann direkt
configure({ useWebWorkers: false });
