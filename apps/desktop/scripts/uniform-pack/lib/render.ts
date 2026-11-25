// cspell:words omasset
/**
 * uniform:render (README.md): renders a pack on the 7 body types with the 3D View's own
 * renderer, on the GPU, and writes the views, a contact sheet per mode and `report.json`.
 *
 * It refuses, and draws nothing, when WebGL isn't on a GPU: there is no CPU fallback. An output
 * folder holds one run at a time (a lock file says which); runs into different folders share
 * nothing.
 */
import fs from "node:fs";
import path from "node:path";
import { openToolPage, gpuProblem, type ToolPage } from "./browser";
import { BODIES, type RenderArgs } from "./args";
import { buildFolder } from "./build";
import { PackSourceError } from "./packSource";

/** Exit codes, as the study harness had them */
export const EXIT = { ok: 0, failed: 2, noGpu: 3, refused: 4 } as const;

export interface RenderDeps {
    openPage: (o: { gpu: boolean }) => Promise<ToolPage>;
    log: (line: string) => void;
}

const LOCK = ".uniform-render.lock";

/** Takes the output folder's lock, or says whose run holds it */
function lockOut(out: string): (() => void) | string {
    fs.mkdirSync(out, { recursive: true });
    const lock = path.join(out, LOCK);
    try {
        fs.writeFileSync(lock, String(process.pid), { flag: "wx" });
    } catch {
        const pid = Number(fs.readFileSync(lock, "utf8"));
        let alive = false;
        try {
            process.kill(pid, 0);
            alive = true;
        } catch {
            alive = false;
        }
        if (alive)
            return `another render (process ${pid}) is writing to ${out}; use another output folder`;
        fs.writeFileSync(lock, String(process.pid));
    }
    return () => fs.rmSync(lock, { force: true });
}

interface ModeReport {
    name: string;
    layers: string[];
    items: string[];
    errors: string[];
    warnings: string[];
    atlasMB: number;
    seconds: { compose: number; shots: number; total: number };
    files: string[];
    contactSheet: string;
}

/** Runs a render; resolves with the exit code. Writes `report.json` whatever happens. */
export async function runRender(
    args: RenderArgs,
    deps: RenderDeps = {
        openPage: openToolPage,
        // eslint-disable-next-line no-console -- the command's output
        log: (l) => console.log(l),
    },
): Promise<number> {
    const t0 = Date.now();
    const unlock = lockOut(args.out);
    if (typeof unlock === "string") {
        deps.log(`refused: ${unlock}`);
        return EXIT.refused;
    }
    const report: Record<string, unknown> & {
        errors: string[];
        modes: Record<string, ModeReport>;
    } = {
        pack: args.pack,
        renderer: null,
        args: { ...args },
        errors: [],
        modes: {},
    };
    const write = (rel: string, b64: string) => {
        const file = path.join(args.out, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, Buffer.from(b64, "base64"));
        return rel;
    };
    let page: ToolPage | null = null;
    let code: number = EXIT.ok;
    try {
        page = await deps.openPage({ gpu: true });
        const init = await page.render<{ gpu: string; seconds: number }>(
            "init",
        );
        report.renderer = init.gpu;
        deps.log(`WebGL renderer: ${init.gpu}`);
        const problem = gpuProblem(init.gpu);
        if (problem) {
            report.errors.push(
                `${problem}; refusing to render without the GPU (no CPU fallback)`,
            );
            deps.log(`refused: ${report.errors.at(-1)}`);
            return (code = EXIT.noGpu);
        }
        report.setupSeconds = +init.seconds.toFixed(1);

        // a folder is built first, with the same page
        let packFile = args.pack;
        if (fs.statSync(args.pack).isDirectory()) {
            const tb = Date.now();
            const built = await buildFolder(args.pack, page);
            packFile = path.join(args.out, "pack.omasset");
            fs.writeFileSync(packFile, built.bytes);
            report.build = {
                file: "pack.omasset",
                warnings: built.warnings,
                seconds: (Date.now() - tb) / 1000,
            };
            deps.log(`built ${packFile}`);
        }
        const loaded = await page.render<{
            name: string;
            formatVersion: number;
            modes: { id: string | null; name: string }[];
        }>("loadPack", fs.readFileSync(packFile).toString("base64"));
        report.name = loaded.name;
        report.formatVersion = loaded.formatVersion;
        const modes = args.modes
            ? args.modes.map((id) => {
                  const m = loaded.modes.find(
                      (x) => x.id === id || (x.id === null && id === "default"),
                  );
                  if (!m)
                      throw new PackSourceError([
                          `the pack has no mode "${id}"; it has ${loaded.modes.map((x) => x.id ?? "default").join(", ")}`,
                      ]);
                  return m;
              })
            : loaded.modes;

        for (const mode of modes) {
            const tm = Date.now();
            const name = mode.id ?? "default";
            const prepared = await page.render<{
                errors: string[];
                warnings: string[];
                layers: string[];
                items: string[];
                atlasMB: number;
                composeSeconds: number;
                stride: unknown;
            }>("prepareMode", mode.id, args.dpi);
            report.stride = prepared.stride;
            const files: string[] = [];
            const ts = Date.now();
            for (const body of BODIES)
                for (const view of args.views)
                    files.push(
                        write(
                            `${name}/stand-${body}-${view}.png`,
                            await page.render<string>("shotStand", body, view),
                        ),
                    );
            for (const view of ["front", "side"])
                files.push(
                    write(
                        `${name}/stride-${view}.png`,
                        await page.render<string>("shotStride", view),
                    ),
                );
            if (args.stands) {
                files.push(
                    write(
                        `${name}/stands.png`,
                        await page.render<string>("shotStands", false),
                    ),
                );
                files.push(
                    write(
                        `${name}/stands-zoom.png`,
                        await page.render<string>("shotStands", true),
                    ),
                );
            }
            if (args.saveAtlas)
                files.push(
                    write(
                        `${name}/atlas-neutral-average.png`,
                        await page.render<string>("atlasPng"),
                    ),
                );
            const shots = (Date.now() - ts) / 1000;
            const sheet = write(
                `contact-${name}.png`,
                await page.render<string>(
                    "contactSheet",
                    `${loaded.name} · mode "${mode.name}"${mode.id ? ` (${mode.id})` : ""}`,
                    args.views,
                ),
            );
            report.modes[name] = {
                name: mode.name,
                layers: prepared.layers,
                items: prepared.items,
                errors: prepared.errors,
                warnings: prepared.warnings,
                atlasMB: prepared.atlasMB,
                seconds: {
                    compose: prepared.composeSeconds,
                    shots: +shots.toFixed(1),
                    total: +((Date.now() - tm) / 1000).toFixed(1),
                },
                files,
                contactSheet: sheet,
            };
            deps.log(
                `${name}: ${files.length} PNGs + ${sheet} in ${((Date.now() - tm) / 1000).toFixed(1)} s` +
                    `${prepared.errors.length ? `, ${prepared.errors.length} error(s)` : ""}` +
                    `${prepared.warnings.length ? `, ${prepared.warnings.length} warning(s)` : ""}`,
            );
            for (const e of prepared.errors) deps.log(`  error: ${e}`);
            for (const w of prepared.warnings) deps.log(`  warning: ${w}`);
        }
        if (page.errors.length) report.pageErrors = page.errors;
        return code;
    } catch (error) {
        if (error instanceof PackSourceError) {
            report.errors.push(...error.problems);
            for (const p of error.problems) deps.log(`refused: ${p}`);
            return (code = EXIT.refused);
        }
        report.errors.push((error as Error)?.message ?? String(error));
        if (page?.errors.length) report.pageErrors = page.errors;
        deps.log(`error: ${(error as Error)?.stack ?? String(error)}`);
        return (code = EXIT.failed);
    } finally {
        report.exitCode = code;
        report.seconds = +((Date.now() - t0) / 1000).toFixed(1);
        fs.writeFileSync(
            path.join(args.out, "report.json"),
            `${JSON.stringify(report, null, 2)}\n`,
        );
        await page?.close();
        unlock();
    }
}
