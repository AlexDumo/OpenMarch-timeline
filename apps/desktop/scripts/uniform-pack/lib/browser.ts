// cspell:words adreno radeon softpipe
/**
 * Opens the tool page (`../page`, served by its own Vite dev server) in headless Chromium.
 *
 * Every run is independent, so runs with different output folders can go at once: its own
 * server on a free port, its own Vite cache in a fresh temporary folder (never the checkout's
 * `node_modules/.vite`), its own browser.
 *
 * With `gpu`, Chromium draws WebGL with ANGLE on Vulkan, the flags this machine's GPU rule asks
 * for; the caller checks the renderer string with {@link gpuProblem} and refuses a software one.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const tool = path.resolve(here, "..");
const desktop = path.resolve(tool, "../..");

/** Chromium flags for WebGL on the GPU through ANGLE on Vulkan (headless: no X server needed) */
export const GPU_FLAGS = [
    "--use-gl=angle",
    "--use-angle=vulkan",
    "--enable-features=Vulkan",
    "--ignore-gpu-blocklist",
];

/**
 * Why a WebGL renderer string isn't a GPU to render on, or null when it is. Software renderers
 * (SwiftShader, llvmpipe, Mesa's softpipe, Microsoft Basic Render) are refused: the uniform
 * shader runs, but the run would take minutes and the app would be in low-quality mode.
 */
export function gpuProblem(renderer: string): string | null {
    if (!renderer.trim()) return "WebGL has no renderer: no GPU context";
    if (
        /swiftshader|llvmpipe|softpipe|software|microsoft basic render/i.test(
            renderer,
        )
    )
        return `WebGL is drawing in software ("${renderer}"), not on a GPU`;
    if (!/nvidia|amd|radeon|intel|apple|mali|adreno/i.test(renderer))
        return `WebGL's renderer "${renderer}" isn't a known GPU`;
    return null;
}

/** The page's functions, as `page/main.ts` exposes them */
export interface ToolPage {
    rasterLayer(
        name: string,
        data: string,
    ): Promise<{ png: string; notes: string[] } | { error: string }>;
    rasterItem(
        name: string,
        data: string,
    ): Promise<
        { png: string; width: number; height: number } | { error: string }
    >;
    /** The app's own import of a file, untouched, as base64 (`page/raster.ts`) */
    appImport(
        kind: "page" | "item",
        name: string,
        data: string,
    ): Promise<string>;
    /** Calls `page/render.ts`'s export `fn` with `args` */
    render<T>(fn: string, ...args: unknown[]): Promise<T>;
    /** Calls `page/image.ts`'s export `fn` with `args` */
    image<T>(fn: string, ...args: unknown[]): Promise<T>;
    /** Console errors and page errors so far */
    errors: string[];
    close(): Promise<void>;
}

const CACHE_PREFIX = "uniform-tool-";

/**
 * Removes the Vite caches of runs whose process is gone (killed before they could clean up).
 * Each cache is named for its run's process, `uniform-tool-<pid>-…`.
 */
export function sweepStaleCaches(root = os.tmpdir()): string[] {
    const removed: string[] = [];
    for (const name of fs.readdirSync(root)) {
        const m = new RegExp(`^${CACHE_PREFIX}(\\d+)-`).exec(name);
        if (!m) continue;
        const pid = Number(m[1]);
        let alive = true;
        try {
            process.kill(pid, 0);
        } catch (error) {
            alive = (error as NodeJS.ErrnoException).code === "EPERM";
        }
        if (alive) continue;
        fs.rmSync(path.join(root, name), { recursive: true, force: true });
        removed.push(name);
    }
    return removed;
}

/**
 * Opens the page. With `handleSignals` (the default), SIGINT and SIGTERM close the browser and
 * the server, remove the cache and exit with 130; `uniform:render` handles them itself.
 */
export async function openToolPage({
    gpu,
    handleSignals = true,
}: {
    gpu: boolean;
    handleSignals?: boolean;
}): Promise<ToolPage> {
    const req = createRequire(path.join(desktop, "package.json"));
    const { chromium } = req("playwright") as typeof import("playwright");
    const { createServer } = req("vite") as typeof import("vite");
    sweepStaleCaches();
    const cacheDir = fs.mkdtempSync(
        path.join(os.tmpdir(), `${CACHE_PREFIX}${process.pid}-`),
    );
    const server = await createServer({
        configFile: path.join(tool, "vite.config.mts"),
        cacheDir,
        server: { port: 0, host: "127.0.0.1", strictPort: false },
        logLevel: "error",
    });
    let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
    const onSignal = () => {
        void close().then(() => process.exit(130));
    };
    const close = async () => {
        process.off("SIGINT", onSignal);
        process.off("SIGTERM", onSignal);
        await browser?.close().catch(() => undefined);
        await server.close().catch(() => undefined);
        fs.rmSync(cacheDir, { recursive: true, force: true });
    };
    if (handleSignals) {
        process.once("SIGINT", onSignal);
        process.once("SIGTERM", onSignal);
    }
    try {
        await server.listen();
        const url = server.resolvedUrls!.local[0];
        browser = await chromium.launch({
            args: gpu ? GPU_FLAGS : [],
        });
        const page = await browser.newPage({
            viewport: { width: 640, height: 480 },
        });
        const errors: string[] = [];
        page.on("console", (m) => {
            if (m.type() === "error") errors.push(m.text());
        });
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(url, { timeout: 180_000 });
        await page
            .waitForFunction(
                () => document.title === "uniform-tool-ready",
                null,
                {
                    timeout: 180_000,
                },
            )
            .catch((e: Error) => {
                throw new Error(
                    `the tool page didn't start: ${errors.join(" | ") || e.message}`,
                );
            });
        return {
            errors,
            close,
            rasterLayer: (name, data) =>
                page.evaluate(
                    ([n, d]) => window.uniformTool.rasterLayer(n, d),
                    [name, data] as const,
                ),
            appImport: (kind, name, data) =>
                page.evaluate(
                    ([k, n, d]) => window.uniformTool.appImport(k, n, d),
                    [kind, name, data] as const,
                ),
            rasterItem: (name, data) =>
                page.evaluate(([n, d]) => window.uniformTool.rasterItem(n, d), [
                    name,
                    data,
                ] as const),
            image: <T>(fn: string, ...args: unknown[]) =>
                page.evaluate(
                    async ([f, a]) => {
                        const m =
                            (await window.uniformTool.image()) as unknown as Record<
                                string,
                                (...x: unknown[]) => unknown
                            >;
                        return m[f](...a);
                    },
                    [fn, args] as const,
                ) as Promise<T>,
            render: <T>(fn: string, ...args: unknown[]) =>
                page.evaluate(
                    async ([f, a]) => {
                        const m =
                            (await window.uniformTool.render()) as unknown as Record<
                                string,
                                (...x: unknown[]) => unknown
                            >;
                        return m[f](...a);
                    },
                    [fn, args] as const,
                ) as Promise<T>,
        };
    } catch (error) {
        await close();
        throw error;
    }
}
