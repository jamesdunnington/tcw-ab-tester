import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: vite dev server proxies /api and /ingest to the local API so cookies
// stay same-site. Prod: Caddy does this same proxying (see hub/Caddyfile).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4000",
      "/wp": "http://localhost:4000",
    },
  },
});
