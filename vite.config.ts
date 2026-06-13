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
     * Proxy `/api/*` dev calls to the Command Center backend.
     * Order matters: more specific prefixes first.
     * Routes that only exist locally (not yet deployed to EC2) go to
     * localhost:5050; everything else goes to the deployed backend.
     * Once a route is deployed, remove its localhost entry.
     */
    proxy: {
      "/api/bms-black/bookings/by-phone": {
        target: "http://localhost:5050",
        changeOrigin: true,
        secure: false,
      },
      "/api": {
        target: "http://13.236.183.142:5050",
        changeOrigin: true,
        secure: false,
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
