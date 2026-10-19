import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

/**
 * Custom fills without forking Excalidraw.
 *
 * Excalidraw passes `element.fillStyle` straight to rough.js as `options.fillStyle`,
 * and rough.js picks a filler by name in `roughjs/bin/fillers/filler.js` (unknown
 * names fall back to hachure). This build-time transform adds one line to that
 * function: names starting with "om-" go to our own fillers. It is the same edit a
 * `pnpm patch roughjs` would make (illustrative pnpm patch: patches/roughjs@4.6.4.patch).
 */
const omFillers = fileURLToPath(new URL("./src/fills/omFillers.ts", import.meta.url));
function roughFillersPlugin(): Plugin {
  return {
    name: "om-rough-fillers",
    enforce: "pre",
    transform(code, id) {
      if (!id.replace(/\\/g, "/").endsWith("roughjs/bin/fillers/filler.js")) return null;
      const patched = code
        .replace(
          "export function getFiller(o, helper) {",
          `import { getOmFiller } from ${JSON.stringify(omFillers)};\nexport function getFiller(o, helper) {\n    const om = getOmFiller(o, helper);\n    if (om) return om;`,
        );
      if (patched === code) throw new Error("om-rough-fillers: patch target not found");
      return { code: patched, map: null };
    },
  };
}

export default defineConfig({
  plugins: [roughFillersPlugin(), react()],
  // dev pre-bundling would skip the transform above, so keep these as source
  optimizeDeps: { exclude: ["roughjs", "@excalidraw/excalidraw"] },
  define: { "process.env.IS_PREACT": JSON.stringify("false") },
  build: { sourcemap: false, chunkSizeWarningLimit: 5000 },
});
