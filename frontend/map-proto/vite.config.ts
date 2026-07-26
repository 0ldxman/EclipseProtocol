import { defineConfig } from "vite";

// Relative base so the built page works when served from a path-rewriting
// proxy as well as from the server root.
export default defineConfig({
  base: "./",
  build: { outDir: "dist", emptyOutDir: true, target: "es2022" },
});
