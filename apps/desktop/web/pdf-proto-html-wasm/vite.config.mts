// cspell:words fulgur fulgur's ironpress dompdf fontkit krilla stylo nosplit asis breakbefore
// Standalone prototype page (not part of the app build).
// pnpm exec vite build --config web/pdf-proto-html-wasm/vite.config.mts
import { defineConfig } from "vite";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);

export default defineConfig({
    root: here,
    base: "./",
    publicDir: path.join(here, "public"),
    resolve: { alias: { "@": path.join(here, "../../src") } },
    build: {
        outDir: "/mnt/data/pdf-web-proto/html-wasm/dist",
        emptyOutDir: true,
        target: "es2022",
        assetsInlineLimit: 0,
        chunkSizeWarningLimit: 20000,
    },
    server: { port: 7791, fs: { allow: [path.join(here, "../..")] } },
});
