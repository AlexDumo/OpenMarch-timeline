// cspell:ignore pdfmake pdfs dont ijlft helv xthrottle Dvořák Émile García Łukasz Nguyễn Núñez Østergaard Šťastný Ελένη Παπαδοπούλου Иванова Ольга محمد
import path from "node:path";
import { defineConfig } from "vite";

// Minimal build of the prototype page: just the PDF module and its lazy chunks.
const desktop = path.join(__dirname, "..");
export default defineConfig({
    root: __dirname,
    base: "./",
    resolve: {
        alias: [{ find: /^@\//, replacement: path.join(desktop, "src") + "/" }],
    },
    build: {
        outDir: process.env.PROTO_OUT ?? path.join(__dirname, "dist"),
        emptyOutDir: true,
        target: "es2022",
        chunkSizeWarningLimit: 8000,
    },
    clearScreen: false,
});
