import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Macht das Zertifikat der Test-Zertifizierungsstelle fürs iPad abrufbar (nur bei "npm run wlan")
function caCertificateDownload(): Plugin {
  return {
    name: 'ca-certificate-download',
    configurePreviewServer(server) {
      server.middlewares.use('/baumaengel-ca.crt', (req, res) => {
        res.setHeader('Content-Type', 'application/x-x509-ca-cert');
        res.end(readFileSync('.cert/baumaengel-ca.crt'));
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  // iPadOS 16 stolpert über Klassenfelder ("undefined is not a function"), darum werden sie
  // beim Bauen in älteres JavaScript übersetzt
  build: {
    target: 'es2021',
    cssTarget: 'safari16',
  },
  worker: {
    format: 'es', // PDF.js startet seinen Worker als Modul
  },
  plugins: [
    VitePWA({
      // Android-App (npm run android): Alle Dateien liegen in der App, ein Service Worker würde
      // dort nach Updates nur alte Dateien ausliefern
      disable: mode === 'android',
      registerType: 'autoUpdate', // neue Versionen werden automatisch übernommen
      manifest: {
        name: 'Baumängel',
        short_name: 'Baumängel',
        description: 'Baumängel auf Plänen erfassen und dokumentieren, auch ohne Internet.',
        lang: 'de',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#edf1f5',
        background_color: '#edf1f5',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Alles, was die App braucht, inklusive PDF.js-Worker, Schriften (auch Inter als woff2)
        // und Scan-Decodern.
        // Die Dateien ohne Endung in standard_fonts sind nur Lizenztexte.
        globPatterns: ['**/*.{html,js,mjs,css,svg,png,webmanifest,wasm,bcmap,pfb,ttf,woff2,icc}'],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        navigateFallbackDenylist: [/\.crt$/],
      },
    }),
    mode === 'wlan' && caCertificateDownload(),
  ],
  preview:
    mode === 'wlan'
      ? {
          host: true,
          port: 4173,
          strictPort: true, // immer dieselbe Adresse, sonst wären die Daten auf dem iPad "weg"
          https: {
            key: readFileSync('.cert/server.key'),
            cert: readFileSync('.cert/server.crt'),
          },
        }
      : {},
}));
