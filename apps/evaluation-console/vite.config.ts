import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// base "./" so the built assets load when the Python server serves dist/ from any path.
export default defineConfig(({ command }) => {
  const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
  const config = JSON.parse(readFileSync(path.join(repoRoot, "eval.config.json"), "utf8"));
  const apiOrigin =
    process.env.CESIUM_EVAL_API_ORIGIN ??
    `http://${config.server?.host ?? "127.0.0.1"}:${config.server?.port ?? 8933}`;

  return {
    base: "./",
    plugins: [react()],
    define: {
      // Avoid embedding a developer's absolute path in production assets. The
      // built SPA is served by its owning backend; the guard is for dev proxies.
      __EXPECTED_REPO_ROOT__: JSON.stringify(command === "serve" ? repoRoot.replace(/\/+$/, "") : "")
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      sourcemap: true
    },
    server: {
      host: "127.0.0.1",
      port: 5174,
      proxy: {
        "/api": {
          target: apiOrigin,
          headers: {
            "X-Cesium-Skills-Root": repoRoot
          }
        }
      }
    }
  };
});
