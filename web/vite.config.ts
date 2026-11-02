import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// XI_BASE lets the same build live at gafferbot.app/fut/ later (XI_BASE=/fut/ npm run build:web).
export default defineConfig({
  root: "web",
  base: process.env.XI_BASE ?? "/",
  build: {
    outDir: "../out/web",
    emptyOutDir: true,
    // Two pages: the squad builder and Market Lab.
    rollupOptions: { input: { main: fileURLToPath(new URL("./index.html", import.meta.url)), market: fileURLToPath(new URL("./market.html", import.meta.url)) } },
  },
});
