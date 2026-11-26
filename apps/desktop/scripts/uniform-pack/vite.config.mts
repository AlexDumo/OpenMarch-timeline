import path from "node:path";
import { defineConfig } from "vite";

const desktop = path.resolve(__dirname, "../..");

/**
 * The page `build.ts` and `render.ts` drive in headless Chromium (README.md). It runs the app's own
 * import, worker, atlas and marcher code; only the show database is replaced, by `packStore.ts`,
 * which hands the atlas composer the pack being rendered. Not part of any app build.
 */
export default defineConfig({
    root: path.join(__dirname, "page"),
    resolve: {
        alias: [
            {
                find: "@/hooks/queries/useUniformPack",
                replacement: path.join(__dirname, "page/packStore.ts"),
            },
            { find: "@", replacement: path.join(desktop, "src") },
            {
                find: "@om-electron",
                replacement: path.join(desktop, "electron"),
            },
        ],
    },
    server: { fs: { allow: [path.resolve(desktop, "../..")] } },
    logLevel: "error",
});
