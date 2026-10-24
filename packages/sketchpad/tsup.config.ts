import { cpSync, existsSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { defineConfig } from "tsup";
import baseConfig from "@openmarch/config/tsup";

const require = createRequire(import.meta.url);

/** Excalidraw's fonts, shipped with the package so nothing loads from a CDN (ADR 0006 D-1) */
function copyExcalidrawFonts() {
    // The package's main entry is dist/prod/index.js; its fonts sit next to it
    const from = join(
        dirname(require.resolve("@excalidraw/excalidraw")),
        "fonts",
    );
    const to = join("dist", "fonts");
    if (!existsSync(from))
        throw new Error(`Excalidraw fonts not found at ${from}`);
    rmSync(to, { recursive: true, force: true });
    cpSync(from, to, { recursive: true });
}

export default defineConfig({
    ...baseConfig,
    entry: { index: "src/index.ts" },
    // ESM only: the hosts are Vite apps and Electron's renderer
    format: ["esm"],
    // jsPDF and svg2pdf.js load only when a PDF is exported
    splitting: true,
    loader: { ".woff2": "file" },
    esbuildOptions(options) {
        // Excalidraw's CSS is exported under the "production" condition only
        options.conditions = ["production", "style", "import", "default"];
    },
    async onSuccess() {
        copyExcalidrawFonts();
    },
});
