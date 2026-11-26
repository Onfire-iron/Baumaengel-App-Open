// Automatische Tests (npm test), siehe tests/ und UEBERGABE.md
// - jsdom stellt im Test Browser-Teile bereit (DOMParser, Blob, document)
// - fake-indexeddb ersetzt die Datenbank des Browsers, jede Testdatei bekommt eine leere
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['fake-indexeddb/auto', './tests/helpers/setup.ts'],
    include: ['tests/**/*.test.ts'],
  },
});
