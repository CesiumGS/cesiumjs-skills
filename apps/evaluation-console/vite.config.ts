import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" so the built assets load when the Python server serves dist/ from any path.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true
  },
  server: {
    host: "127.0.0.1",
    port: 5174,
    proxy: {
      "/api": "http://127.0.0.1:8933"
    }
  }
});
