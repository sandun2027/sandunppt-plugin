import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  base: "/",
  build: {
    outDir: resolve(import.meta.dirname, "../src/ppagent_local/static"),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/local": { target: "https://127.0.0.1:17667", secure: false },
      "/healthz": { target: "https://127.0.0.1:17667", secure: false },
    },
  },
});
