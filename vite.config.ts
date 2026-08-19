import { defineConfig, type Plugin, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

/**
 * getUserMedia needs a secure context, and iOS Safari grants no exception for a LAN
 * IP, so the dev server must speak HTTPS with a certificate the iPad trusts. See
 * docs/DEV_SETUP.md. Absent certs/, the server falls back to plain HTTP, which is
 * fine for desktop localhost (a secure context) but will NOT let the iPad open a
 * camera.
 */
/**
 * Bumped only when the MediaPipe wasm or model files themselves change. The runtime
 * cache name embeds it, so a redeploy that does NOT touch those 17 MB of assets
 * reuses the cached copies instead of re-downloading them, while a genuine asset
 * change forces a fresh fetch.
 */
const MEDIAPIPE_ASSET_VERSION = 'v1';

const CERT_DIR = path.resolve(__dirname, 'certs');
const certPath = path.join(CERT_DIR, 'dev-cert.pem');
const keyPath = path.join(CERT_DIR, 'dev-key.pem');
const httpsCerts =
  fs.existsSync(certPath) && fs.existsSync(keyPath)
    ? { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }
    : undefined;

function lanAddress(): string | null {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const e of entries ?? []) {
      if (e.family === 'IPv4' && !e.internal) return e.address;
    }
  }
  return null;
}

/**
 * Serves the mkcert root CA so the iPad can install it, and prints the LAN URL.
 * Dev-only middleware rather than a file in public/, so the CA never ends up in
 * dist/ or the service worker precache.
 */
function devCertPlugin(): Plugin {
  return {
    name: 'trainr-dev-cert',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      const caRoot = process.env.LOCALAPPDATA
        ? path.join(process.env.LOCALAPPDATA, 'mkcert', 'rootCA.pem')
        : path.join(os.homedir(), '.local/share/mkcert/rootCA.pem');

      // .crt is what iOS recognises as an installable certificate.
      server.middlewares.use('/rootCA.crt', (_req, res) => {
        if (!fs.existsSync(caRoot)) {
          res.statusCode = 404;
          res.end('mkcert root CA not found; run `mkcert -install` first.');
          return;
        }
        res.setHeader('Content-Type', 'application/x-x509-ca-cert');
        res.setHeader('Content-Disposition', 'attachment; filename="trainr-dev-rootCA.crt"');
        res.end(fs.readFileSync(caRoot));
      });

      const ip = lanAddress();
      const scheme = httpsCerts ? 'https' : 'http';
      if (ip) {
        // eslint-disable-next-line no-console
        console.log(
          `\n  Trainr on this LAN:  ${scheme}://${ip}:5173` +
            (httpsCerts
              ? `\n  iPad root CA:        ${scheme}://${ip}:5173/rootCA.crt\n`
              : `\n  WARNING: no certs/, so HTTP only. The iPad cannot open a camera.\n`),
        );
      }
    },
  };
}

export default defineConfig({
  plugins: [
    devCertPlugin(),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'fonts/**/*.woff2'],
      manifest: {
        name: 'Trainr — Pitch Tracker',
        short_name: 'Trainr',
        description: 'Real-time fastpitch softball pitch tracking from a webcam.',
        theme_color: '#2E3391',
        background_color: '#F6F7FB',
        display: 'fullscreen',
        orientation: 'landscape',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        /**
         * MediaPipe's wasm (11.2 MB) and pose model (5.6 MB) are deliberately NOT
         * precached. Precaching them made a cold visit download ~19 MB before the
         * app was usable, which over cellular is minutes of blank screen.
         *
         * They are needed only by AUTOMATIC strike-zone detection, one optional
         * branch of the setup wizard — manual zone entry needs neither. So they are
         * runtime-cached instead: fetched on first use, then permanently available
         * offline. Offline cold start of the app itself is unaffected; what degrades
         * is automatic zone detection before it has been used once, which is stated
         * in DEPLOYMENT.md rather than hidden.
         */
        globPatterns: ['**/*.{js,css,html,woff2,png,svg}'],
        /**
         * eruda is ~493 KiB and is only ever loaded behind `?debug`. Left in the
         * precache it would be downloaded by every visitor on first load, which is
         * a third of the entire app payload spent on a debug tool almost nobody
         * opens. Excluded here so it stays a genuine on-demand fetch; the dynamic
         * import still works, and once fetched the runtime cache keeps it.
         *
         * Source maps are excluded for the same reason — they are for reading a
         * relayed stack trace on a laptop, not for the device to carry offline.
         */
        globIgnores: ['**/eruda-*.js', '**/*.map'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // Old precaches are dropped on activate, so a redeploy cannot leave a
        // device serving a mix of old and new chunks.
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/mediapipe\//, /^\/models\//],
        runtimeCaching: [
          {
            urlPattern: /\/(mediapipe|models)\/.*\.(wasm|js|task|binarypb)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: `mediapipe-${MEDIAPIPE_ASSET_VERSION}`,
              expiration: { maxEntries: 12 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  build: {
    /**
     * There is no debugger for iOS on a Windows laptop, so a relayed stack trace is
     * the only forensic evidence a crash on a tripod will ever leave. Minified
     * frames make that evidence useless, so maps ship. The bundle is not secret and
     * the deploy sits behind a passphrase; if that changes, switch to 'hidden' and
     * upload the maps to Vercel instead of dropping them.
     */
    sourcemap: true,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  worker: {
    format: 'es',
  },
  server: {
    port: 5173,
    host: true,
    https: httpsCerts,
    headers: {
      // Required for SharedArrayBuffer-backed paths and consistent worker timing.
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
});
