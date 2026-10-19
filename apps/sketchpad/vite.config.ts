import { cpSync, existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, normalize } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const require = createRequire(import.meta.url);

/** Where the Sketchpad's fonts are served from; the app passes this as `assetPath` */
const ASSET_BASE = "sketchpad-assets";

/**
 * Serves the package's Excalidraw fonts in dev and copies them into the build, so the site never
 * loads fonts from a CDN (ADR 0006 D-1).
 */
function sketchpadFonts(): Plugin {
    const fontsDir = () => {
        const dir = join(
            dirname(require.resolve("@openmarch/sketchpad")),
            "fonts",
        );
        if (!existsSync(dir))
            throw new Error(
                `Build @openmarch/sketchpad first: ${dir} is missing`,
            );
        return dir;
    };
    let outDir = "dist";
    return {
        name: "openmarch-sketchpad-fonts",
        configResolved(config) {
            outDir = config.build.outDir;
        },
        configureServer(server) {
            const dir = fontsDir();
            server.middlewares.use(`/${ASSET_BASE}/fonts`, (req, res, next) => {
                const file = normalize(
                    join(
                        dir,
                        decodeURIComponent((req.url ?? "").split("?")[0]!),
                    ),
                );
                if (
                    !file.startsWith(dir) ||
                    !existsSync(file) ||
                    !statSync(file).isFile()
                )
                    return next();
                res.setHeader("Content-Type", "font/woff2");
                res.end(readFileSync(file));
            });
        },
        closeBundle() {
            cpSync(fontsDir(), join(outDir, ASSET_BASE, "fonts"), {
                recursive: true,
            });
        },
    };
}

export default defineConfig({
    plugins: [react(), tailwindcss(), sketchpadFonts()],
    define: {
        // Excalidraw reads this at module load
        "process.env.IS_PREACT": JSON.stringify("false"),
    },
    server: { port: 5290, strictPort: true },
    build: { chunkSizeWarningLimit: 5000, sourcemap: false },
});
