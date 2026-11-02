import { defineConfig } from "vite";

// XI_BASE lets the same build live at gafferbot.app/fut/ later (XI_BASE=/fut/ npm run build:web).
export default defineConfig({
  root: "web",
  base: process.env.XI_BASE ?? "/",
  build: { outDir: "../out/web", emptyOutDir: true },
});
