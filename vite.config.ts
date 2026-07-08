/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      // Keep the SW out of `vite dev` so it can't cache stale HMR modules.
      devOptions: { enabled: false },
      includeAssets: ["icon.svg", "mask-icon.svg"],
      manifest: {
        name: "Memora",
        short_name: "Memora",
        description: "Client-side semantic search & Q&A over your Obsidian vault. Zero backend.",
        theme_color: "#0a0a0a",
        background_color: "#0a0a0a",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "mask-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
        ],
      },
      workbox: {
        // Precache the app shell + worker chunks (.mjs = pdf.js's own worker) so
        // the app loads offline. Raise the size cap to fit the ~1.4 MB worker.
        globPatterns: ["**/*.{js,mjs,css,html,svg,woff2}"],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            // Model weights fetched from the Hugging Face hub — cache on first
            // load so embedding works fully offline afterwards.
            urlPattern: ({ url }) => url.origin.includes("huggingface.co"),
            handler: "CacheFirst",
            options: {
              cacheName: "hf-model-cache",
              cacheableResponse: { statuses: [0, 200] }, // 0 allows opaque cross-origin
              expiration: { maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 * 90 },
              rangeRequests: true, // large weight files are fetched with Range
            },
          },
          {
            // ONNX runtime WASM (21 MB, too big to precache) — cache on demand.
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.endsWith(".wasm"),
            handler: "CacheFirst",
            options: {
              cacheName: "onnx-wasm-cache",
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 90 },
            },
          },
        ],
      },
    }),
  ],
  worker: {
    // Web Workers (embedding, PDF parsing) are authored as ES modules.
    format: "es",
  },
  test: {
    // Chunking / BM25 pure functions are unit-tested in a node environment.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
