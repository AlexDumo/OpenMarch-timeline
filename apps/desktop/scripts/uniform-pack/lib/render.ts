// cspell:words omasset
/**
 * uniform:render (README.md): renders a pack on every body type with the 3D View's own
 * renderer, on the GPU, and writes the views, a contact sheet per mode and `report.json`.
 *
 * The GPU is checked first, before anything is loaded or drawn, and before the output folder is
 * locked: no WebGL context, or a software one, is refused with exit 3, and there is no CPU
 * fallback. Then the output folder is locked: it holds one run at a time (a lock directory, taken
 * atomically); runs into different folders share nothing. A run refused for want of a GPU writes
 * its `report.json` only when no other run holds the folder.
 */
import fs from "node:fs";
import path from "node:path";
import { openToolPage, gpuProblem, type ToolPage } from "./browser";
import { BODIES, type RenderArgs } from "./args";
import { buildFolder } from "./build";
import { PackSourceError } from "./packSource";

/**
 * Exit codes: the study harness's, plus `packErrors` for a render that finished but whose
 * `report.json` lists errors in a mode (the app's quiet notes that mean the pack is wrong).
 */
export const EXIT = {
    ok: 0,
    failed: 2,
    noGpu: 3,
    refused: 4,
    packErrors: 5,
    interrupted: 130,
} as const;

export interface RenderDeps {
    openPage: (o: { gpu: boolean }) => Promise<ToolPage>;
    log: (line: string) => void;
    /** Ends the process after a signal's cleanup; tests stand in for it */
    exit?: (code: number) => void;
    /** Where SIGINT and SIGTERM come from: the process, or a test's emitter */
    signals?: Pick<NodeJS.EventEmitter, "once" | "off">;
}

export const LOCK = ".uniform-render.lock";

const alive = (pid: number) => {
    if (!(pid > 0)) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        // EPERM: it exists, under another user
        return (error as NodeJS.ErrnoException).code === "EPERM";
    }
};

/**
 * Takes the output folder's lock, a directory made with one atomic `mkdir`, or says whose run
 * holds it. A lock whose process is gone is taken over by renaming it away (atomic too, so of two
 * runs taking it over at once, one wins and the other sees the winner's lock).
 */
export function lockOut(out: string): (() => void) | string {
    fs.mkdirSync(out, { recursive: true });
    const lock = path.join(out, LOCK);
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            fs.mkdirSync(lock);
            fs.writeFileSync(path.join(lock, "pid"), String(process.pid));
            return () => fs.rmSync(lock, { recursive: true, force: true });
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
        let pid = NaN;
        try {
            pid = Number(fs.readFileSync(path.join(lock, "pid"), "utf8"));
        } catch {
            // being made right now, or left without its pid: a moment decides
            pid = NaN;
        }
        if (alive(pid))
            return `another render (process ${pid}) is writing to ${out}; use another output folder`;
        if (Number.isNaN(pid) && attempt === 0) continue;
        const stale = `${lock}.stale-${process.pid}-${Date.now()}`;
        try {
            fs.renameSync(lock, stale);
            fs.rmSync(stale, { recursive: true, force: true });
        } catch {
            // another run took it over first; try again
        }
    }
    return `couldn't take the lock ${lock}; remove it if no render is running`;
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

type Report = Record<string, unknown> & {
    errors: string[];
    modes: Record<string, ModeReport>;
};

interface Mode {
    id: string | null;
    name: string;
}

/** Checks the GPU before anything else: the exit code to stop with, or null to go on */
async function checkGpu(
    page: ToolPage,
    report: Report,
    log: RenderDeps["log"],
): Promise<number | null> {
    const gpu = await page.render<{ renderer: string } | { error: string }>(
        "gpu",
    );
    const problem =
        "error" in gpu
            ? `no WebGL context could be made (${gpu.error})`
            : gpuProblem(gpu.renderer);
    if ("renderer" in gpu) {
        report.renderer = gpu.renderer;
        log(`WebGL renderer: ${gpu.renderer}`);
    }
    if (!problem) return null;
    report.errors.push(
        `${problem}; refusing to render without the GPU (no CPU fallback)`,
    );
    log(`refused: ${report.errors.at(-1)}`);
    return EXIT.noGpu;
}

/** The pack file to render: the one given, or a folder built into the output folder */
async function packFileOf(
    args: RenderArgs,
    page: ToolPage,
    report: Report,
    log: RenderDeps["log"],
): Promise<string> {
    if (!fs.statSync(args.pack).isDirectory()) return args.pack;
    const t0 = Date.now();
    const built = await buildFolder(args.pack, page);
    const file = path.join(args.out, "pack.omasset");
    fs.writeFileSync(file, built.bytes);
    report.build = {
        file: "pack.omasset",
        warnings: built.warnings,
        seconds: (Date.now() - t0) / 1000,
    };
    log(`built ${file}`);
    return file;
}

/** The modes asked for, by id (`default` for a pack without modes); refuses one it hasn't */
function pickModes(all: Mode[], asked: string[] | null): Mode[] {
    if (!asked) return all;
    return asked.map((id) => {
        const m = all.find(
            (x) => x.id === id || (x.id === null && id === "default"),
        );
        if (!m)
            throw new PackSourceError([
                `the pack has no mode "${id}"; it has ${all.map((x) => x.id ?? "default").join(", ")}`,
            ]);
        return m;
    });
}

/** Renders one mode: its shots, its contact sheet, and its part of the report */
async function renderMode(
    page: ToolPage,
    args: RenderArgs,
    packName: string,
    mode: Mode,
    report: Report,
    log: RenderDeps["log"],
) {
    const write = (rel: string, b64: string) => {
        const file = path.join(args.out, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, Buffer.from(b64, "base64"));
        return rel;
    };
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
    const shots: [string, string, ...unknown[]][] = [
        ...BODIES.flatMap((body) =>
            args.views.map(
                (view) =>
                    [
                        `${name}/stand-${body}-${view}.png`,
                        "shotStand",
                        body,
                        view,
                    ] as [string, string, ...unknown[]],
            ),
        ),
        [`${name}/stride-front.png`, "shotStride", "front"],
        [`${name}/stride-side.png`, "shotStride", "side"],
        ...(args.stands
            ? ([
                  [`${name}/stands.png`, "shotStands", false],
                  [`${name}/stands-zoom.png`, "shotStands", true],
              ] as [string, string, ...unknown[]][])
            : []),
        ...(args.saveAtlas
            ? ([[`${name}/atlas-neutral-average.png`, "atlasPng"]] as [
                  string,
                  string,
              ][])
            : []),
    ];
    const ts = Date.now();
    const files: string[] = [];
    for (const [rel, fn, ...rest] of shots)
        files.push(write(rel, await page.render<string>(fn, ...rest)));
    const shotSeconds = (Date.now() - ts) / 1000;
    const sheet = write(
        `contact-${name}.png`,
        await page.render<string>(
            "contactSheet",
            `${packName} · mode "${mode.name}"${mode.id ? ` (${mode.id})` : ""}`,
            args.views,
        ),
    );
    const total = (Date.now() - tm) / 1000;
    report.modes[name] = {
        name: mode.name,
        layers: prepared.layers,
        items: prepared.items,
        errors: prepared.errors,
        warnings: prepared.warnings,
        atlasMB: prepared.atlasMB,
        seconds: {
            compose: prepared.composeSeconds,
            shots: +shotSeconds.toFixed(1),
            total: +total.toFixed(1),
        },
        files,
        contactSheet: sheet,
    };
    log(
        `${name}: ${files.length} PNGs + ${sheet} in ${total.toFixed(1)} s` +
            `${prepared.errors.length ? `, ${prepared.errors.length} error(s)` : ""}` +
            `${prepared.warnings.length ? `, ${prepared.warnings.length} warning(s)` : ""}`,
    );
    for (const e of prepared.errors) log(`  error: ${e}`);
    for (const w of prepared.warnings) log(`  warning: ${w}`);
}

/**
 * Runs a render; resolves with the exit code. Writes `report.json` whatever happens (unless
 * another run holds the output folder), and on SIGINT or SIGTERM closes the browser, removes its
 * cache and lets go of the lock before exiting.
 */
export async function runRender(
    args: RenderArgs,
    deps: RenderDeps = {
        openPage: (o) => openToolPage({ ...o, handleSignals: false }),
        // eslint-disable-next-line no-console -- the command's output
        log: (l) => console.log(l),
    },
): Promise<number> {
    const t0 = Date.now();
    const { log } = deps;
    // taken after the GPU check: a run that can't render never waits on, or holds, the folder
    let unlock: (() => void) | null = null;
    const report: Report = {
        pack: args.pack,
        renderer: null,
        args: { ...args },
        errors: [],
        modes: {},
    };
    let page: ToolPage | null = null;
    let code: number = EXIT.ok;
    let finished = false;
    const finish = async () => {
        if (finished) return;
        finished = true;
        report.exitCode = code;
        report.seconds = +((Date.now() - t0) / 1000).toFixed(1);
        if (page?.errors.length) report.pageErrors = page.errors;
        try {
            // stopped before the lock (no GPU, a signal): write the report only if the folder
            // is free, never over another run's
            if (!unlock) {
                const taken = lockOut(args.out);
                if (typeof taken !== "string") unlock = taken;
            }
            if (unlock)
                fs.writeFileSync(
                    path.join(args.out, "report.json"),
                    `${JSON.stringify(report, null, 2)}\n`,
                );
        } finally {
            await page?.close().catch(() => undefined);
            unlock?.();
        }
    };
    const onSignal = (signal: NodeJS.Signals) => {
        code = EXIT.interrupted;
        report.errors.push(`stopped by ${signal}`);
        log(`stopped by ${signal}; cleaning up`);
        void finish().then(() => (deps.exit ?? process.exit)(code));
    };
    const signals = deps.signals ?? process;
    signals.once("SIGINT", onSignal);
    signals.once("SIGTERM", onSignal);
    try {
        page = await deps.openPage({ gpu: true });
        const stop = await checkGpu(page, report, log);
        if (stop !== null) return (code = stop);
        const taken = lockOut(args.out);
        if (typeof taken === "string") {
            log(`refused: ${taken}`);
            // another run's folder: its report stays its own
            finished = true;
            await page.close().catch(() => undefined);
            return (code = EXIT.refused);
        }
        unlock = taken;
        const init = await page.render<{ seconds: number }>("init");
        report.setupSeconds = +init.seconds.toFixed(1);
        const packFile = await packFileOf(args, page, report, log);
        const loaded = await page.render<{
            name: string;
            formatVersion: number;
            modes: Mode[];
        }>("loadPack", fs.readFileSync(packFile).toString("base64"));
        report.name = loaded.name;
        report.formatVersion = loaded.formatVersion;
        for (const mode of pickModes(loaded.modes, args.modes))
            await renderMode(page, args, loaded.name, mode, report, log);
        const withErrors = Object.entries(report.modes).filter(
            ([, m]) => m.errors.length > 0,
        );
        if (withErrors.length) {
            log(
                `the pack has errors in ${withErrors.map(([n]) => n).join(", ")}: see report.json`,
            );
            return (code = EXIT.packErrors);
        }
        return code;
    } catch (error) {
        if (finished) return code;
        if (error instanceof PackSourceError) {
            report.errors.push(...error.problems);
            for (const p of error.problems) log(`refused: ${p}`);
            return (code = EXIT.refused);
        }
        report.errors.push((error as Error)?.message ?? String(error));
        log(`error: ${(error as Error)?.stack ?? String(error)}`);
        return (code = EXIT.failed);
    } finally {
        signals.off("SIGINT", onSignal);
        signals.off("SIGTERM", onSignal);
        await finish();
    }
}
