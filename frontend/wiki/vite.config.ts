import { defineConfig } from "vite";

// Relative base so the built page works behind a path-rewriting proxy.
export default defineConfig({
  base: "./",
  build: { outDir: "dist", emptyOutDir: true, target: "es2022" },
});
