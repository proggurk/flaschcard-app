/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Requests to /api go to the backend, so the app and API share one origin
// (simpler cookies, no CORS). In production, serve both from the same domain.
const apiProxy = { '/api': 'http://localhost:3000' }

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Service worker: caches the app's files so it opens without internet.
      // Only active in `npm run build` + `npm run preview`, not in `npm run dev`.
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-180.png'],
      manifest: {
        name: 'Memcard',
        short_name: 'Memcard',
        start_url: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#121214',
        theme_color: '#121214',
        // PNGs from scripts/make-icons.mjs. The design keeps a safe margin, so it doubles as "maskable".
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Include the SQLite engine (.wasm) so Anki import works offline too
        globPatterns: ['**/*.{js,css,html,svg,png,wasm,webmanifest}'],
        // API data lives in IndexedDB; never serve /api pages from the cache
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [{
          // Card images/audio never change (the URL is the file's hash): cache forever.
          // Same cache name the import code writes to, so imported media works offline.
          urlPattern: ({ url }) => url.pathname.startsWith('/api/media/'),
          handler: 'CacheFirst',
          options: { cacheName: 'media', cacheableResponse: { statuses: [200] } },
        }],
      },
    }),
  ],
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy },
  // `npm test` (shared/*.test.ts use Node's own runner: `npm run test:srs` in server/)
  test: { include: ['src/**/*.test.ts'] },
})
