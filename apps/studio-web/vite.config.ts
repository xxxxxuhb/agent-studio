import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Workspace packages ship CJS dist; Vite named-import interop fails on
    // tsc's Object.defineProperty re-exports. Point at TS source instead.
    alias: {
      "@agent-studio/agent-schema": path.resolve(
        root,
        "../../packages/agent-schema/src/index.ts",
      ),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8790",
        changeOrigin: true,
        timeout: 90_000,
        proxyTimeout: 90_000,
      },
      "/socket.io": {
        target: "http://127.0.0.1:8790",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
