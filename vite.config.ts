import { defineConfig, loadEnv } from "vite";

import react from "@vitejs/plugin-react";

import path from "path";

import { componentTagger } from "lovable-tagger";



function parseLocalApiPaths(raw: string | undefined): string[] {

  if (!raw?.trim()) return [];

  return raw

    .split(",")

    .map((entry) => entry.trim())

    .filter(Boolean)

    .sort((a, b) => b.length - a.length);

}



function remoteProxyTarget(apiBase: string | undefined): string {

  const fallback = "http://13.236.183.142:5050";

  const base = (apiBase || fallback).trim().replace(/\/+$/, "");

  if (base.endsWith("/api")) return base.slice(0, -"/api".length);

  return base || fallback;

}



// https://vitejs.dev/config/

export default defineConfig(({ mode }) => {

  const env = loadEnv(mode, process.cwd(), "");

  const localPaths = parseLocalApiPaths(

    env.VITE_LOCAL_API_PATHS || env.LOCAL_API_PATHS,

  );

  const remoteTarget = remoteProxyTarget(env.VITE_API_BASE);



  const proxy: Record<string, object> = {};

  for (const localPath of localPaths) {

    proxy[localPath] = {

      target: "http://localhost:5050",

      changeOrigin: true,

      secure: false,

    };

  }

  proxy["/api"] = {

    target: remoteTarget,

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

      /**

       * Proxy `/api/*` in dev. Paths in VITE_LOCAL_API_PATHS (or LOCAL_API_PATHS)

       * go to localhost:5050; everything else uses VITE_API_BASE (EC2 by default).

       * Order matters — longer local prefixes are registered first.

       */

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


