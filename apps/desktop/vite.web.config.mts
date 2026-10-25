import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { version } from "./package.json";
import { DEMOS } from "./web/demos";

/**
 * Builds the web editor (editor.openmarch.com): the app in a browser tab,
 * with no Electron. See `web/README.md`.
 *
 *   pnpm run web:dev     # local server
 *   pnpm run web:build   # static site in dist-web/
 *
 * Environment:
 * `WEB_CHANNEL` ("stable" or "nightly"; "dev" if unset) names the release
 * channel; the nightly build says so next to the version. The fork's
 * "preview" channel also offers the example shows in `web/public/demos/` on
 * the start page.
 *
 * The fork's "lab" channel is a test build for lab.openmarch.com (see
 * `web/LAB.md`): it offers the example shows too, loads everything relative
 * to its folder (the lab serves each test at `/x/<test id>/`), and keeps what
 * it stores apart from every other test on that origin, by `LAB_TEST_ID`.
 * It opens straight into an example show, which `LAB_MANIFEST`, the test's
 * `lab/<id>/experiment.md`, may name.
 */

const channel = process.env.WEB_CHANNEL ?? "dev";
const isLab = channel === "lab";
const labTestId = process.env.LAB_TEST_ID ?? "";
if (isLab && !/^[a-z0-9-]+$/.test(labTestId))
    throw new Error(
        "WEB_CHANNEL=lab needs LAB_TEST_ID, the lab test's id (a-z, 0-9 and -)",
    );
const examples = channel === "preview" || isLab ? DEMOS : [];

/**
 * A field from the front matter of the lab test's manifest, the path in
 * `LAB_MANIFEST` (from the repository root; CI sets it to the test being
 * published). Only plain one-word values (`show: part1`), so no YAML parser.
 */
function labManifestField(name: string): string | undefined {
    const manifest = process.env.LAB_MANIFEST;
    if (!isLab || !manifest) return undefined;
    const text = fs.readFileSync(
        path.resolve(__dirname, "..", "..", manifest),
        "utf8",
    );
    const frontMatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
    return new RegExp(`^${name}:[ \\t]*["']?([\\w-]+)`, "m").exec(
        frontMatter,
    )?.[1];
}

/**
 * What a lab build opens straight away (`web/renderer/lab.ts`): the example
 * show the manifest's `show` names (an id in `web/demos.ts`), or the first,
 * in the editor mode its `mode` names ("basic" or "expert", the default).
 */
const labShow = isLab ? (labManifestField("show") ?? DEMOS[0].id) : "";
const labMode = isLab ? (labManifestField("mode") ?? "expert") : "";
if (isLab && !DEMOS.some((demo) => demo.id === labShow))
    throw new Error(
        `The lab manifest's show "${labShow}" isn't one of web/demos.ts: ${DEMOS.map((demo) => demo.id).join(", ")}`,
    );
if (isLab && labMode !== "basic" && labMode !== "expert")
    throw new Error(
        `The lab manifest's mode "${labMode}" isn't "basic" or "expert"`,
    );

/**
 * What names this build's browser storage (see `web/renderer/channel.ts`).
 * Lab tests all share one origin, so each test gets its own.
 */
const storageNamespace = isLab ? `lab-${labTestId}` : channel;
/**
 * Scripts the lab's feedback widget loads into a lab build's page, which the
 * content security policy must allow: Clerk's browser script, which signs
 * the widget's requests to the lab's API in.
 */
const labScriptHosts = isLab ? ["https://clerk.openmarch.com"] : [];

const web = (file: string) => path.join(__dirname, "web", file);
const outDir = path.join(__dirname, "dist-web");

/**
 * Cloudflare's static asset headers: hashed assets never change, so browsers
 * keep them; everything else (index.html) is checked on each visit, so a
 * deploy reaches people on their next load.
 */
const writeHeaders = (): Plugin => ({
    name: "openmarch-web-headers",
    // The lab serves its builds itself and ignores the file.
    apply: (_config, { command }) => command === "build" && !isLab,
    closeBundle() {
        fs.writeFileSync(
            path.join(outDir, "_headers"),
            [
                "/assets/*",
                "  Cache-Control: public, max-age=31536000, immutable",
                "/*",
                "  X-Content-Type-Options: nosniff",
                "  Referrer-Policy: strict-origin-when-cross-origin",
                "",
            ].join("\n"),
        );
    },
});

/**
 * Copies the example shows into the preview and lab builds, and serves them
 * from the dev server; other builds leave them out.
 */
const copyExamples = (): Plugin => {
    let building = false;
    return {
        name: "openmarch-web-examples",
        configResolved(config) {
            building = config.command === "build";
        },
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                const pathname = (req.url ?? "").split("?")[0];
                const example = examples.find((e) => pathname === `/${e.file}`);
                if (!example) return next();
                res.setHeader("Content-Type", "application/octet-stream");
                fs.createReadStream(
                    web(path.join("public", example.file)),
                ).pipe(res);
            });
        },
        closeBundle() {
            if (!building) return;
            for (const example of examples) {
                const target = path.join(outDir, example.file);
                fs.mkdirSync(path.dirname(target), { recursive: true });
                fs.copyFileSync(web(path.join("public", example.file)), target);
            }
        },
    };
};

/**
 * `electron` is two different modules here. Main-process code, which runs in
 * the worker, gets `ipcMain`; the preload, in the page, gets `ipcRenderer`.
 */
const resolveElectron = (): Plugin => ({
    name: "openmarch-web-electron",
    enforce: "pre",
    resolveId: {
        filter: { id: /^electron$/ },
        handler(_source, importer) {
            if (!importer) return;
            const file = importer.replace(/\\/g, "/");
            const inWorker =
                file.includes("/web/worker/") ||
                (file.includes("/electron/") &&
                    !file.includes("/electron/preload/"));
            return inWorker
                ? web("worker/electron.ts")
                : web("renderer/electron.ts");
        },
    },
});

/**
 * Starts the page with `web/renderer/index.ts`, which loads the preload and
 * the app once the worker is ready, and lets the page compile SQLite's
 * WebAssembly under the app's content security policy.
 */
const webEntry = (): Plugin => ({
    name: "openmarch-web-entry",
    transformIndexHtml: {
        order: "pre",
        handler: (html) =>
            html
                .replace(
                    '<script type="module" src="/src/main.tsx"></script>',
                    '<script type="module" src="/web/renderer/index.ts"></script>',
                )
                .replace(
                    "script-src 'self'",
                    [
                        "script-src 'self' 'wasm-unsafe-eval'",
                        ...labScriptHosts,
                    ].join(" "),
                )
                .replace(/<title>[^<]*<\/title>/, "<title>OpenMarch</title>"),
    },
});

export default defineConfig({
    // A lab build is served from a folder, so its URLs are relative.
    base: isLab ? "./" : "/",
    resolve: {
        alias: [
            { find: /^@\//, replacement: path.join(__dirname, "src") + "/" },
            {
                find: /^@om-electron\//,
                replacement: path.join(__dirname, "electron") + "/",
            },
            // Only the worker's main-process code imports these.
            { find: /^(node:)?fs$/, replacement: web("worker/fs.ts") },
            { find: /^(node:)?path$/, replacement: web("worker/path.ts") },
            { find: /^(node:)?sqlite$/, replacement: web("worker/sqlite.ts") },
            { find: /^(node:)?crypto$/, replacement: web("worker/crypto.ts") },
            {
                find: "@sentry/electron/renderer",
                replacement: web("renderer/sentry.ts"),
            },
        ],
        extensions: [".js", ".ts", ".jsx", ".tsx", ".json"],
    },
    plugins: [
        resolveElectron(),
        tailwindcss(),
        react(),
        webEntry(),
        writeHeaders(),
        copyExamples(),
    ],
    worker: {
        format: "es",
        plugins: () => [resolveElectron()],
    },
    define: {
        // The preload reads these from Node's `process` under Electron.
        "process.platform": "globalThis.__openmarchPlatform",
        "process.env.PLAYWRIGHT_CODEGEN": JSON.stringify(""),
        // Excalidraw (the Sketchpad window's lazy chunk) reads this at module load
        "process.env.IS_PREACT": JSON.stringify("false"),
        "process.env.PLAYWRIGHT_SESSION": JSON.stringify(""),
        "import.meta.env.VITE_PUBLIC_WEB_BUILD": JSON.stringify("true"),
        "import.meta.env.VITE_PUBLIC_WEB_CHANNEL": JSON.stringify(channel),
        "import.meta.env.VITE_PUBLIC_WEB_STORAGE_NAMESPACE":
            JSON.stringify(storageNamespace),
        "import.meta.env.VITE_PUBLIC_APP_VERSION": JSON.stringify(version),
        "import.meta.env.VITE_PUBLIC_WEB_EXAMPLES": JSON.stringify(
            JSON.stringify(examples),
        ),
        "import.meta.env.VITE_PUBLIC_LAB_SHOW": JSON.stringify(labShow),
        "import.meta.env.VITE_PUBLIC_LAB_MODE": JSON.stringify(labMode),
        // No analytics on the web (PostHog stays uninitialized; Sentry is
        // stubbed in renderer/sentry.ts).
        "import.meta.env.VITE_PUBLIC_POSTHOG_KEY": JSON.stringify(""),
    },
    optimizeDeps: {
        // Loads its .wasm next to itself, which pre-bundling breaks.
        // The migrator reads files with `fs`, which must reach worker/fs.ts.
        exclude: ["@sqlite.org/sqlite-wasm", "drizzle-orm/migrator"],
    },
    build: {
        outDir,
        emptyOutDir: true,
        sourcemap: true,
        target: "es2022",
        chunkSizeWarningLimit: 8000,
    },
    server: { port: 7780 },
    clearScreen: false,
});
