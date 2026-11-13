import path from "node:path";
import { defineConfig } from "vite";

// Builds the harness page: `OUT=<dir> vite build -c web/print-proto/vite.config.mts`
export default defineConfig({
    root: __dirname,
    base: "./",
    resolve: { alias: { "@": path.join(__dirname, "../../src") } },
    build: {
        outDir: process.env.OUT ?? path.join(__dirname, "dist"),
        emptyOutDir: true,
        minify: true,
    },
});
