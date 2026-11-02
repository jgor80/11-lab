// Builds the XI Lab price-capture browser helper into extension/dist. Load extension/ in Chrome as an unpacked extension.
import { build } from "esbuild";
for (const name of ["hook", "relay", "popup"])
  await build({ entryPoints: [`extension/src/${name}.ts`], bundle: true, format: "iife", target: "chrome111", outfile: `extension/dist/${name}.js`, logLevel: "warning" });
console.log("Built extension/dist (hook.js, relay.js, popup.js). Load the extension/ folder in chrome://extensions with Developer mode on.");
