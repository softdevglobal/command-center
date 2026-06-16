import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  /**
   * Split-proxy strategy:
   *
   *  LOCAL_API_PATHS  – comma-separated list of /api sub-paths that are still
   *                     running on localhost:5050 (under development / testing).
   *                     Example: /api/auth,/api/agents
   *
   *  DEPLOYED_API_URL – the remote backend that handles every other /api/* call.
   *                     Defaults to the EC2 instance.
   *
   * Any path listed in LOCAL_API_PATHS gets its own proxy rule pointing at
   * localhost:5050; the catch-all /api rule points at the deployed server.
   * If LOCAL_API_PATHS is empty, ALL /api traffic goes to the deployed server.
   */
  const deployedApiUrl =
    env.DEPLOYED_API_URL?.trim() || "http://13.236.183.142:5050";

  const localPaths: string[] = (env.LOCAL_API_PATHS || "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  type ProxyEntry = {
    target: string;
    changeOrigin: boolean;
    secure: boolean;
  };

  const proxy: Record<string, ProxyEntry> = {};

  // Specific rules for locally-running routes (higher priority — Vite matches first)
  for (const localPath of localPaths) {
    proxy[localPath] = {
      target: "http://localhost:5050",
      changeOrigin: true,
      secure: false,
    };
  }

  // Catch-all: remaining /api/* traffic → deployed EC2 backend
  proxy["/api"] = {
    target: deployedApiUrl,
    changeOrigin: true,
    secure: false,
  };

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
      proxy,
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
