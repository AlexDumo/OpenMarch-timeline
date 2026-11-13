// Standalone page for the Typst PDF prototype.
//   npx vite --config web/renderer/typstPdf/proto/vite.config.mts          (dev, port 7790)
//   npx vite build --config web/renderer/typstPdf/proto/vite.config.mts    (sizes)
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
    root: __dirname,
    server: { port: 7790, fs: { allow: ["/"] } },
    preview: { port: 17791, host: "127.0.0.1" },
    worker: { format: "es" },
    build: {
        outDir: "/mnt/data/pdf-web-proto/typst-wasm/dist-proto",
        emptyOutDir: true,
        target: "es2022",
        assetsInlineLimit: 0,
    },
    resolve: { alias: { "@": path.join(__dirname, "../../../../src") } },
});
