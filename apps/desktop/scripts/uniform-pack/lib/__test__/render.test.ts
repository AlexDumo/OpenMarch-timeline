// cspell:words omasset
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_VIEWS, UsageError, parseRenderArgs } from "../args";
import {
    GPU_FLAGS,
    gpuProblem,
    sweepStaleCaches,
    type ToolPage,
} from "../browser";
import { EXIT, LOCK, lockOut, runRender } from "../render";

describe("parseRenderArgs", () => {
    it("takes a pack and an output folder, relative to the caller", () => {
        const a = parseRenderArgs(["pack.omasset", "out"], "/work");
        expect(a).toEqual({
            pack: "/work/pack.omasset",
            out: "/work/out",
            modes: null,
            views: DEFAULT_VIEWS,
            dpi: 32,
            saveAtlas: false,
            stands: true,
        });
    });

    it("reads every option", () => {
        const a = parseRenderArgs(
            [
                "/p",
                "/o",
                "--modes",
                "plain,sash-out",
                "--views",
                "front,right",
                "--dpi",
                "16",
                "--save-atlas",
                "--no-stands",
            ],
            "/",
        );
        expect(a).toMatchObject({
            modes: ["plain", "sash-out"],
            views: ["front", "right"],
            dpi: 16,
            saveAtlas: true,
            stands: false,
        });
    });

    it.each([
        [["only-one"], "give a pack and an output folder"],
        [["a", "b", "c"], "give a pack and an output folder"],
        [["a", "b", "--views", "top"], "unknown view top"],
        [["a", "b", "--dpi", "64"], "--dpi is 16"],
        [["a", "b", "--modes"], "--modes needs a comma-separated list"],
        [["a", "b", "--fast"], "unknown option --fast"],
        [["/pack", "/pack/out"], "must not be inside the pack folder"],
    ])("refuses %j", (argv, message) => {
        expect(() => parseRenderArgs(argv, "/")).toThrow(UsageError);
        expect(() => parseRenderArgs(argv, "/")).toThrow(message);
    });

    it("lets the output sit next to a pack file", () => {
        expect(parseRenderArgs(["/p/x.omasset", "/p/out"], "/").out).toBe(
            "/p/out",
        );
    });
});

describe("gpuProblem", () => {
    it("takes a GPU", () => {
        expect(
            gpuProblem(
                "ANGLE (NVIDIA, Vulkan 1.4.351 (NVIDIA NVIDIA GeForce RTX 3060 Ti (0x00002489)), NVIDIA)",
            ),
        ).toBeNull();
        expect(gpuProblem("ANGLE (Intel, Mesa Intel(R) UHD 620)")).toBeNull();
    });

    it.each([
        "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)",
        "llvmpipe (LLVM 15.0.7, 256 bits)",
        "",
        "WebKit WebGL",
    ])("refuses %j", (renderer) => {
        expect(gpuProblem(renderer)).not.toBeNull();
    });

    it("asks Chromium for ANGLE on Vulkan", () => {
        expect(GPU_FLAGS).toEqual(
            expect.arrayContaining([
                "--use-gl=angle",
                "--use-angle=vulkan",
                "--enable-features=Vulkan",
            ]),
        );
    });
});

describe("runRender", () => {
    let out: string;
    beforeEach(() => {
        out = fs.mkdtempSync(path.join(os.tmpdir(), "uniform-render-"));
    });
    afterEach(() => fs.rmSync(out, { recursive: true, force: true }));

    const NVIDIA =
        "ANGLE (NVIDIA, Vulkan 1.4.351 (NVIDIA NVIDIA GeForce RTX 3060 Ti (0x00002489)), NVIDIA)";

    /** A stand-in for the tool page: `answers` by function name, every call recorded */
    const fakePage = (
        answers: Record<string, (...a: unknown[]) => unknown>,
    ) => {
        const calls: string[] = [];
        const page: ToolPage = {
            errors: [],
            rasterLayer: vi.fn(),
            rasterItem: vi.fn(),
            image: vi.fn(),
            appImport: vi.fn(),
            render: (async (fn: string, ...a: unknown[]) => {
                calls.push(fn);
                const answer = answers[fn];
                if (!answer) throw new Error(`${fn} called`);
                return answer(...a);
            }) as ToolPage["render"],
            close: vi.fn(async () => undefined),
        };
        return { page, calls };
    };

    const args = (o: string, pack = "/nowhere/pack.omasset") => ({
        pack,
        out: o,
        modes: null,
        views: DEFAULT_VIEWS,
        dpi: 32 as const,
        saveAtlas: false,
        stands: true,
    });

    const run = (
        page: ToolPage,
        o: string,
        extra: Partial<Parameters<typeof runRender>[1]> = {},
        pack?: string,
    ) => {
        const log: string[] = [];
        const opened: boolean[] = [];
        const code = runRender(args(o, pack), {
            openPage: async ({ gpu }) => {
                opened.push(gpu);
                return page;
            },
            log: (l) => log.push(l),
            ...extra,
        });
        return { code, log, opened };
    };

    const reportOf = (o: string) =>
        JSON.parse(fs.readFileSync(path.join(o, "report.json"), "utf8"));

    it("checks the GPU before loading anything, and refuses software", async () => {
        const { page, calls } = fakePage({
            gpu: () => ({
                renderer:
                    "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)",
            }),
        });
        const r = run(page, out);
        expect(await r.code).toBe(EXIT.noGpu);
        expect(r.opened).toEqual([true]);
        // nothing loaded, baked or drawn
        expect(calls).toEqual(["gpu"]);
        expect(page.close).toHaveBeenCalled();
        expect(fs.readdirSync(out)).toEqual(["report.json"]);
        expect(reportOf(out).exitCode).toBe(EXIT.noGpu);
        expect(reportOf(out).errors[0]).toMatch(
            /drawing in software .*no CPU fallback/,
        );
        expect(r.log.at(-1)).toMatch(/^refused: /);
    });

    it("refuses with exit 3 when no WebGL context can be made", async () => {
        const { page, calls } = fakePage({
            gpu: () => ({ error: "Error creating WebGL context." }),
        });
        const r = run(page, out);
        expect(await r.code).toBe(EXIT.noGpu);
        expect(calls).toEqual(["gpu"]);
        expect(reportOf(out).errors[0]).toBe(
            "no WebGL context could be made (Error creating WebGL context.); refusing to render without the GPU (no CPU fallback)",
        );
    });

    it("sets up only after the GPU passes", async () => {
        const { page, calls } = fakePage({
            gpu: () => ({ renderer: NVIDIA }),
            init: () => ({ seconds: 1 }),
        });
        // the pack doesn't exist: the run stops right after setup
        const r = run(page, out);
        expect(await r.code).toBe(EXIT.failed);
        expect(calls).toEqual(["gpu", "init"]);
        expect(reportOf(out).renderer).toBe(NVIDIA);
    });

    describe("with a pack", () => {
        let pack: string;
        beforeEach(() => {
            pack = path.join(out, "..", `${path.basename(out)}.omasset`);
            fs.writeFileSync(pack, "PK");
        });
        afterEach(() => fs.rmSync(pack, { force: true }));

        const answers = (prepared: Record<string, unknown>) => ({
            gpu: () => ({ renderer: NVIDIA }),
            init: () => ({ seconds: 1 }),
            loadPack: () => ({
                name: "Test",
                formatVersion: 2,
                modes: [{ id: null, name: "default" }],
            }),
            prepareMode: () => ({
                errors: [],
                warnings: [],
                layers: ["base"],
                items: [],
                atlasMB: 1,
                composeSeconds: 0.1,
                stride: null,
                ...prepared,
            }),
            shotStand: () => "",
            shotStride: () => "",
            shotStands: () => "",
            contactSheet: () => "",
        });

        it("renders, and exits 0 on a clean pack", async () => {
            const { page } = fakePage(answers({}));
            const r = run(page, out, {}, pack);
            expect(await r.code).toBe(EXIT.ok);
            expect(reportOf(out).modes.default.files).toHaveLength(32);
        });

        it("exits non-zero when a mode has errors", async () => {
            const { page } = fakePage(
                answers({
                    errors: ['layer "base": the template is left visible'],
                }),
            );
            const r = run(page, out, {}, pack);
            expect(await r.code).toBe(EXIT.packErrors);
            expect(reportOf(out).modes.default.errors).toHaveLength(1);
        });

        it("exits non-zero when a mode fails to render", async () => {
            const { page } = fakePage({
                ...answers({}),
                shotStand: () => {
                    throw new Error("context lost");
                },
            });
            const r = run(page, out, {}, pack);
            expect(await r.code).toBe(EXIT.failed);
            expect(reportOf(out).errors).toEqual(["context lost"]);
        });

        it("cleans up and lets go of the lock on SIGTERM", async () => {
            let release!: () => void;
            const { page } = fakePage({
                ...answers({}),
                init: () =>
                    new Promise((resolve) => {
                        release = () => resolve({ seconds: 1 });
                    }),
            });
            const signals = new EventEmitter();
            const exits: number[] = [];
            const r = run(
                page,
                out,
                { signals, exit: (c) => exits.push(c) },
                pack,
            );
            await vi.waitFor(() => expect(release).toBeDefined());
            signals.emit("SIGTERM", "SIGTERM");
            await vi.waitFor(() => expect(exits).toEqual([EXIT.interrupted]));
            expect(page.close).toHaveBeenCalled();
            expect(fs.existsSync(path.join(out, LOCK))).toBe(false);
            expect(reportOf(out).errors).toEqual(["stopped by SIGTERM"]);
            release();
            expect(await r.code).toBe(EXIT.interrupted);
        });
    });

    it("refuses an output folder another live run holds", async () => {
        fs.mkdirSync(path.join(out, LOCK));
        fs.writeFileSync(path.join(out, LOCK, "pid"), String(process.pid));
        const openPage = vi.fn();
        const log: string[] = [];
        const code = await runRender(args(out), {
            openPage,
            log: (l) => log.push(l),
        });
        expect(code).toBe(EXIT.refused);
        expect(openPage).not.toHaveBeenCalled();
        expect(log[0]).toMatch(/another render .* is writing to/);
    });

    it("takes over a lock a finished run left, and lets go of it", async () => {
        fs.mkdirSync(path.join(out, LOCK));
        // a pid no process has
        fs.writeFileSync(path.join(out, LOCK, "pid"), "999999999");
        const { page } = fakePage({ gpu: () => ({ renderer: "llvmpipe" }) });
        expect(await run(page, out).code).toBe(EXIT.noGpu);
        expect(fs.existsSync(path.join(out, LOCK))).toBe(false);
    });

    it("lets one of two runs take a lock", () => {
        const first = lockOut(out);
        const second = lockOut(out);
        expect(typeof first).toBe("function");
        expect(second).toMatch(/another render/);
        (first as () => void)();
        const third = lockOut(out);
        expect(typeof third).toBe("function");
        (third as () => void)();
    });
});

describe("sweepStaleCaches", () => {
    it("removes the caches of runs that are gone, and keeps live ones", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "uniform-sweep-"));
        try {
            fs.mkdirSync(path.join(root, "uniform-tool-999999999-abc"));
            fs.mkdirSync(path.join(root, `uniform-tool-${process.pid}-abc`));
            fs.mkdirSync(path.join(root, "something-else"));
            expect(sweepStaleCaches(root)).toEqual([
                "uniform-tool-999999999-abc",
            ]);
            expect(fs.readdirSync(root).sort()).toEqual([
                "something-else",
                `uniform-tool-${process.pid}-abc`,
            ]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
