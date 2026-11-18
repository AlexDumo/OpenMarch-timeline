import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * The web build's backend worker (the database, file open and conversion) must stay free of the
 * editor's UI and tools. A path from a module it bundles (such as the low-level transition
 * writers) to a trail, shape, shortcut or React module drags the whole UI into the worker, where
 * `localStorage` doesn't exist. As a dynamic `import()`, it also splits chunks so that drizzle's
 * classes evaluate out of order: the web app stays on a blank screen with "Class extends value
 * undefined" (pathways L.18, 2026-11-17). This walks the worker's imports from source, static and
 * dynamic, as the build resolves them (`@/` and `@om-electron/`), each file transpiled first so
 * imports used only as types drop out as they do in the build, and fails on the first such
 * module, naming the chain that reached it.
 */

const desktop = path.resolve(__dirname, "../../..");
const entry = path.join(desktop, "web/worker/backend.worker.ts");

/** Modules the worker must never reach, with why */
const FORBIDDEN: readonly [RegExp, string][] = [
    [/\/src\/pathways\//, "the pathways tools"],
    [/\/src\/shapes\//, "the shape tools"],
    [/\/src\/shortcuts\//, "the shortcuts (localStorage)"],
    [/\/src\/db-functions\/timelineTrail/, "the trail writers"],
    [/\.tsx$/, "a React component"],
];
/** Packages the worker must never import */
const FORBIDDEN_PACKAGES =
    /^(react|react-dom|@radix-ui\/|zustand|sonner)(\/|$)/;

const IMPORT =
    /(?:^|[\s;])(?:import|export)\s*(?:[^"'`;]*?\s*from\s*)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/gm;

/** The file as the build sees it: TypeScript, with imports used only as types dropped */
const asJs = (file: string) =>
    ts.transpileModule(fs.readFileSync(file, "utf8"), {
        fileName: file,
        compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
            jsx: ts.JsxEmit.ReactJSX,
            removeComments: true,
        },
    }).outputText;

function resolve(spec: string, from: string): string | null {
    let base: string;
    if (spec.startsWith("@/")) base = path.join(desktop, "src", spec.slice(2));
    else if (spec.startsWith("@om-electron/"))
        base = path.join(desktop, "electron", spec.slice(13));
    else if (spec.startsWith("."))
        base = path.resolve(path.dirname(from), spec);
    else return null;
    const stem = base.replace(/\.(js|mjs)$/, "");
    for (const candidate of [
        base,
        `${stem}.ts`,
        `${stem}.tsx`,
        `${stem}.mts`,
        path.join(base, "index.ts"),
        path.join(base, "index.tsx"),
    ])
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile())
            return candidate;
    return null;
}

describe("the web backend worker's imports", () => {
    it("reach no trail, shape, shortcut or React module", () => {
        const via = new Map<string, string | null>([[entry, null]]);
        const queue = [entry];
        const packages = new Map<string, string>();
        while (queue.length > 0) {
            const file = queue.shift()!;
            if (!/\.(ts|tsx|mts)$/.test(file)) continue;
            const source = asJs(file);
            for (const m of source.matchAll(IMPORT)) {
                const spec = m[1] ?? m[2]!;
                const target = resolve(spec, file);
                if (target === null) {
                    if (!spec.startsWith(".") && !spec.startsWith("@/"))
                        packages.set(spec, file);
                    continue;
                }
                if (via.has(target)) continue;
                via.set(target, file);
                queue.push(target);
            }
        }
        const chain = (file: string) => {
            const out: string[] = [];
            for (let f: string | null = file; f; f = via.get(f) ?? null)
                out.unshift(path.relative(desktop, f));
            return out.join("\n  → ");
        };
        for (const file of via.keys())
            for (const [pattern, what] of FORBIDDEN)
                expect(
                    pattern.test(file),
                    `the worker reaches ${what}:\n  ${chain(file)}`,
                ).toBe(false);
        for (const [spec, file] of packages)
            expect(
                FORBIDDEN_PACKAGES.test(spec),
                `the worker imports ${spec}:\n  ${chain(file)}`,
            ).toBe(false);
        // The walk found the database layer, so it really followed the imports
        expect(
            [...via.keys()].some((f) =>
                f.endsWith(
                    "src/db-functions/timelineTransitionsInTransaction.ts",
                ),
            ),
        ).toBe(true);
    });
});
