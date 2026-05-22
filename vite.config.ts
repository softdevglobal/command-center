import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    /** Avoid Chrome ERR_CACHE_READ_FAILURE on lazy `import()` chunks in dev. */
    headers: {
      "Cache-Control": "no-store",
    },
    hmr: {
      overlay: false,
    },
    /**
     * BMS does not send CORS headers for localhost. In dev, point
     * `VITE_BMS_API_URL` at `/api/call-center` (see `.env.development`) so the
     * browser only talks to this server; we forward to production.
     */
    proxy: {
      "/api/call-center": {
        target: "https://black.bmspros.com.au",
        changeOrigin: true,
        secure: true,
      },
      "/bms-black": {
        target: "https://black.bmspros.com.au",
        changeOrigin: true,
        secure: true,
      },
      "/api/support-chat": {
        target: "https://black.bmspros.com.au",
        changeOrigin: true,
        secure: true,
      },
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime"],
  },
}));
