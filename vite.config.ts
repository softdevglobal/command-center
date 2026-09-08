import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiProxyTarget =
    env.VITE_API_PROXY_TARGET?.trim().replace(/\/+$/, "") || "http://localhost:5050";

  return {
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
      /** Forward `/api/*` from localhost:8080 to the Command Center backend. */
      proxy: {
        "/api": {
          target: apiProxyTarget,
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
  };
});
