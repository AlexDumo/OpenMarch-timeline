// @vitest-environment node
/**
 * The main process's startup bundle loads no renderer module (P9.3). Bundles
 * `electron/main/index.ts` with Vite, as the app build does, and checks every
 * module in the entry chunk and in the chunks it loads statically. Chunks
 * loaded with a dynamic `import()` (the convert-on-open flow, only when its
 * gate is on) are allowed to hold renderer modules.
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { build, type Rollup } from "vite";
import { defaultConvertWorkerPath } from "../convertWorkerHost";

const root = path.resolve(__dirname, "../../..");

/** Renderer-only modules that must never load at startup. */
const RENDERER_ONLY = [
    /\/src\/global\/database\/db\.ts$/,
    /\/src\/App\.tsx$/,
    /\/src\/stores\//,
    /\/src\/components\/canvas\//,
    /\/src\/timeline\/convert\//,
    /\/electron\/database\/convertOnOpen\.ts$/,
    /\/electron\/main\/convertOnOpenFlow\.ts$/,
];

const isBare = (id: string) =>
    !id.startsWith(".") &&
    !id.startsWith("/") &&
    !id.startsWith("@/") &&
    !id.startsWith("@om-electron/") &&
    !id.startsWith("\0");

describe("the main-process startup bundle", () => {
    it("has no renderer module outside lazily loaded chunks", async () => {
        const output = (await build({
            configFile: false,
            logLevel: "silent",
            root,
            resolve: {
                alias: {
                    "@": path.join(root, "src"),
                    "@om-electron": path.join(root, "electron"),
                },
            },
            build: {
                write: false,
                minify: false,
                ssr: true,
                rollupOptions: {
                    input: path.join(root, "electron/main/index.ts"),
                    external: (id) => isBare(id) || id.startsWith("node:"),
                    output: { format: "cjs" },
                },
            },
        })) as Rollup.RollupOutput | Rollup.RollupOutput[];
        const chunks = (Array.isArray(output) ? output : [output])
            .flatMap((o) => o.output)
            .filter((c): c is Rollup.OutputChunk => c.type === "chunk");
        const byName = new Map(chunks.map((c) => [c.fileName, c]));

        // The entry chunk and everything it imports statically.
        const entry = chunks.find((c) => c.isEntry);
        expect(entry).toBeDefined();
        const startup = new Set<string>();
        const queue = [entry!.fileName];
        while (queue.length) {
            const name = queue.shift()!;
            if (startup.has(name)) continue;
            startup.add(name);
            queue.push(...(byName.get(name)?.imports ?? []));
        }
        const startupModules = [...startup].flatMap(
            (name) => byName.get(name)?.moduleIds ?? [],
        );
        const lazyModules = chunks
            .filter((c) => !startup.has(c.fileName))
            .flatMap((c) => c.moduleIds);

        const offenders = startupModules.filter((id) =>
            RENDERER_ONLY.some((pattern) => pattern.test(id)),
        );
        expect(offenders).toEqual([]);
        // The check sees the converter at all: it is in a lazily loaded chunk.
        expect(
            lazyModules.some((id) =>
                /\/electron\/database\/convertOnOpen\.ts$/.test(id),
            ),
        ).toBe(true);
    }, 120_000);
});

describe("the app build", () => {
    // Vite loads `vite.config.mjs` (tsc's output of `vite.config.mts`, checked in) before
    // `vite.config.mts`, so both must build the worker where the host looks for it (P9.8).
    it.each(["vite.config.mts", "vite.config.mjs"])(
        "%s builds the convert-on-open worker next to the main process",
        (file) => {
            const config = fs.readFileSync(path.join(root, file), "utf-8");
            expect(config).toContain(
                'entry: "electron/database/convertOnOpenWorker.ts"',
            );
            expect(config).toContain('outDir: "dist-electron/worker"');
            expect(
                defaultConvertWorkerPath(path.join(root, "dist-electron/main")),
            ).toBe(
                path.join(
                    root,
                    "dist-electron/worker",
                    `${path.parse("convertOnOpenWorker.ts").name}.js`,
                ),
            );
        },
    );
});
