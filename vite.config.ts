/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
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
