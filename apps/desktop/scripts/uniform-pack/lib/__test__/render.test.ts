// cspell:words omasset
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_VIEWS, UsageError, parseRenderArgs } from "../args";
import { GPU_FLAGS, gpuProblem, type ToolPage } from "../browser";
import { EXIT, runRender } from "../render";

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

    const fakePage = (renderer: string) => {
        const calls: string[] = [];
        const page: ToolPage = {
            errors: [],
            rasterLayer: vi.fn(),
            rasterItem: vi.fn(),
            render: (async (fn: string) => {
                calls.push(fn);
                if (fn === "init") return { gpu: renderer, seconds: 0.1 };
                throw new Error(`${fn} called`);
            }) as ToolPage["render"],
            close: vi.fn(async () => undefined),
        };
        return { page, calls };
    };

    const args = (o: string) => ({
        pack: "/nowhere/pack.omasset",
        out: o,
        modes: null,
        views: DEFAULT_VIEWS,
        dpi: 32 as const,
        saveAtlas: false,
        stands: true,
    });

    it("refuses without a GPU, draws nothing and says why", async () => {
        const { page, calls } = fakePage(
            "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)",
        );
        const log: string[] = [];
        const opened: boolean[] = [];
        const code = await runRender(args(out), {
            openPage: async ({ gpu }) => {
                opened.push(gpu);
                return page;
            },
            log: (l) => log.push(l),
        });
        expect(code).toBe(EXIT.noGpu);
        expect(opened).toEqual([true]);
        // nothing past the GPU check ran
        expect(calls).toEqual(["init"]);
        expect(page.close).toHaveBeenCalled();
        expect(fs.readdirSync(out)).toEqual(["report.json"]);
        const report = JSON.parse(
            fs.readFileSync(path.join(out, "report.json"), "utf8"),
        );
        expect(report.exitCode).toBe(EXIT.noGpu);
        expect(report.errors[0]).toMatch(
            /drawing in software .*no CPU fallback/,
        );
        expect(log.at(-1)).toMatch(/^refused: /);
    });

    it("refuses an output folder another live run holds", async () => {
        fs.writeFileSync(
            path.join(out, ".uniform-render.lock"),
            String(process.pid),
        );
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

    it("takes over a lock a finished run left", async () => {
        // a pid no process has
        fs.writeFileSync(path.join(out, ".uniform-render.lock"), "999999999");
        const { page } = fakePage("llvmpipe");
        const code = await runRender(args(out), {
            openPage: async () => page,
            log: () => undefined,
        });
        expect(code).toBe(EXIT.noGpu);
        expect(fs.existsSync(path.join(out, ".uniform-render.lock"))).toBe(
            false,
        );
    });
});
