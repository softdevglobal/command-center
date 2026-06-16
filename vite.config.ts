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
   *  LOCAL_API_PATHS – comma-separated /api sub-paths still running on
   *                    localhost:5050 (under development / testing).
   *                    Example: /api/auth,/api/agents
   *
   *  VITE_API_BASE   – the deployed backend base URL (e.g. http://ec2:5050/api).
   *                    The proxy strips the trailing /api to get the host target.
   *                    Leave unset in dev so the browser uses the relative /api
   *                    path and the proxy handles routing.
   *
   * Paths in LOCAL_API_PATHS → localhost:5050.
   * Everything else (/api catch-all) → deployed backend host.
   */
  const viteApiBase = env.VITE_API_BASE?.trim().replace(/\/+$/, "");
  // Derive host from VITE_API_BASE by stripping the /api path segment
  const deployedApiUrl = viteApiBase
    ? viteApiBase.replace(/\/api$/, "")
    : "http://13.236.183.142:5050";

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
