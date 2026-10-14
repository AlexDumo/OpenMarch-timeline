/**
 * PROTOTYPE (throwaway, see README.md). The three.js field editor spike:
 *
 *   pnpm run canvas-proto:dev
 */
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const desktop = path.join(__dirname, "..");

export default defineConfig({
    root: __dirname,
    base: "./",
    envDir: desktop,
    resolve: {
        alias: [
            { find: "@", replacement: path.join(desktop, "src") },
            {
                find: "@om-electron",
                replacement: path.join(desktop, "electron"),
            },
        ],
    },
    plugins: [react()],
    // The demo shows live in the 3D preview's public folder.
    publicDir: path.join(desktop, "view3d-web", "public"),
    server: { port: 5190, fs: { allow: [path.join(desktop, "..", "..")] } },
    build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 4000 },
});
