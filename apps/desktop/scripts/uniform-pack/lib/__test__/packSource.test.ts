// cspell:words omasset
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import regionsJson from "@/view3d/assets/uniform-flats/regions.json";
import type { FlatsRegions } from "@/view3d/core/marchers/uniformArtwork";
import { buildFolder } from "../build";
import { itemChecks, layerNotes } from "../packChecks";
import {
    PackSourceError,
    layerFileProblem,
    pageSvgFromPanels,
    parsePackSource,
    planPack,
    type PanelRects,
} from "../packSource";

const regions = regionsJson as unknown as FlatsRegions & { panels: PanelRects };
const example = path.resolve(__dirname, "../../example");
const exampleSource = () =>
    JSON.parse(fs.readFileSync(path.join(example, "uniform.json"), "utf8"));

/** A PNG's signature and header only: what the pack writer and reader check */
function fakePng(width: number, height: number, tag = 0): Uint8Array {
    const b = new Uint8Array(33);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const v = new DataView(b.buffer);
    v.setUint32(8, 13);
    b.set([0x49, 0x48, 0x44, 0x52], 12);
    v.setUint32(16, width);
    v.setUint32(20, height);
    b[24] = 8;
    b[25] = 6;
    b[32] = tag;
    return b;
}

/** Every problem a refusal lists */
function problemsOf(fn: () => unknown): string[] {
    try {
        fn();
    } catch (error) {
        if (error instanceof PackSourceError) return error.problems;
        throw error;
    }
    throw new Error("expected a refusal");
}

const all = () => true;

describe("the example", () => {
    it("is the app's built-in sample art, unchanged", () => {
        const sample = path.resolve(
            __dirname,
            "../../../../src/view3d/assets/uniform-flats/sample",
        );
        for (const file of [
            "front.svg",
            "back.svg",
            "crest.svg",
            "number.svg",
            "LICENSE",
        ])
            expect(
                fs.readFileSync(path.join(example, file), "utf8"),
                `${file}: copy it again from ${sample}`,
            ).toBe(fs.readFileSync(path.join(sample, file), "utf8"));
    });
});

describe("uniform.json", () => {
    it("parses the example", () => {
        const source = parsePackSource(exampleSource());
        expect(source.layers[0].front).toBe("front.svg");
    });

    it("names an unknown key and where it is", () => {
        const json = exampleSource();
        json.layers[0].fronts = "x.svg";
        json.tint = "#ffffff";
        const problems = problemsOf(() => parsePackSource(json));
        expect(problems).toContain(
            'uniform.json layers[0]: unknown key "fronts"',
        );
        expect(problems).toContain('uniform.json: unknown key "tint"');
    });

    it("says a palette role is missing and a color isn't hex", () => {
        const json = exampleSource();
        delete json.palette.visor;
        json.palette.primary = "navy";
        const problems = problemsOf(() => parsePackSource(json));
        expect(problems).toContain("uniform.json palette.visor: missing");
        expect(problems).toContain(
            'uniform.json palette.primary: must be "#rrggbb"',
        );
    });

    it("refuses art that isn't SVG or PNG", () => {
        const json = exampleSource();
        json.items[0].file = "crest.jpg";
        expect(problemsOf(() => parsePackSource(json))).toContain(
            "uniform.json items[0].file: must be an .svg or .png file",
        );
    });
});

describe("planPack", () => {
    it("names each missing file, and a layer with both a page and panels", () => {
        const source = parsePackSource({
            ...exampleSource(),
            layers: [
                { id: "base", page: "page.svg", front: "front.svg" },
                { id: "sash" },
            ],
        });
        const problems = problemsOf(() =>
            planPack(source, (f) => f !== "page.svg"),
        );
        expect(problems).toEqual([
            'layer "base" (layers[0]): give "page" or panels ("front", "back", "cape"), not both',
            'layer "base" (layers[0]): page.svg isn\'t in the pack folder',
            'layer "sash" (layers[1]): needs "page" (the whole 105 × 88 in page) or at least one of "front", "back", "cape"',
        ]);
    });

    it("points the app schema's refusals at the source's own item", () => {
        const json = exampleSource();
        delete json.items[0].width;
        json.items[1].grade = "tile";
        const problems = problemsOf(() => planPack(parsePackSource(json), all));
        expect(problems).toContain(
            `item "crest" (items[0]): an item needs a size (the app's pack schema)`,
        );
        expect(problems).toContain(
            `item "number" (items[1]): a tile needs regions (the app's pack schema)`,
        );
    });

    it("shares one image between items that use one file", () => {
        const json = exampleSource();
        json.items.push({ ...json.items[0], id: "crest-back", panel: "back" });
        const plan = planPack(parsePackSource(json), all);
        expect(plan.manifest.items!.map((i) => i.file)).toEqual([
            "items/crest.png",
            "items/number.png",
            "items/crest.png",
        ]);
        expect(plan.rasters.filter((r) => r.kind === "item")).toHaveLength(2);
    });

    it("writes modes as format 3, with their palette in lowercase", () => {
        const json = exampleSource();
        json.modes = [
            {
                id: "plain",
                name: "Plain",
                layers: ["base"],
                items: ["crest"],
            },
            {
                id: "white",
                name: "White",
                layers: ["base"],
                palette: { primary: "#EEEEEE" },
            },
        ];
        const { manifest } = planPack(parsePackSource(json), all);
        expect(manifest.formatVersion).toBe(3);
        const modes = manifest.modes!;
        expect(modes.map((m) => m.items)).toEqual([["crest"], []]);
        expect(modes[1].palette).toEqual({ primary: "#eeeeee" });
    });

    it("names a mode's missing layer", () => {
        const json = exampleSource();
        json.modes = [{ id: "plain", name: "Plain", layers: ["sash"] }];
        const problems = problemsOf(() => planPack(parsePackSource(json), all));
        expect(problems).toContain(
            "uniform.json: mode plain names a layer the pack doesn't have (the app's pack schema)",
        );
    });

    it("writes the lowest version that holds the pack", () => {
        const json = exampleSource();
        expect(
            planPack(parsePackSource(json), all).manifest.formatVersion,
        ).toBe(2);
        delete json.items;
        expect(
            planPack(parsePackSource(json), all).manifest.formatVersion,
        ).toBe(1);
    });
});

describe("layer files", () => {
    const svg = (box: string) =>
        new TextEncoder().encode(
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}"></svg>`,
        );

    it("takes a page or panel in inches and refuses anything else", () => {
        expect(
            layerFileProblem(
                "l",
                "p.svg",
                svg("0 0 105 88"),
                "page",
                regions.panels,
            ),
        ).toBeNull();
        expect(
            layerFileProblem(
                "l",
                "f.svg",
                svg("0 0 34 78"),
                "front",
                regions.panels,
            ),
        ).toBeNull();
        expect(
            layerFileProblem(
                "l",
                "f.svg",
                svg("0 0 340 780"),
                "front",
                regions.panels,
            ),
        ).toBe(
            `l: f.svg's viewBox is "0 0 340 780"; the front panel is viewBox="0 0 34 78" (inches, panel coordinates as in uniform-regions.json)`,
        );
        expect(
            layerFileProblem(
                "l",
                "p.png",
                fakePng(3000, 2816),
                "page",
                regions.panels,
            ),
        ).toBe(
            "l: p.png is 3000 × 2816 px; the page is 3360 × 2816 px (105 × 88 in at 32 px/in)",
        );
        expect(
            layerFileProblem(
                "l",
                "b.png",
                fakePng(1088, 2496),
                "back",
                regions.panels,
            ),
        ).toBeNull();
    });

    it("places each panel where the template has it", () => {
        const page = pageSvgFromPanels(
            {
                front: { file: "f.svg", bytes: svg("0 0 34 78") },
                back: { file: "b.png", bytes: fakePng(1088, 2496) },
            },
            regions.panels,
        );
        expect(page).toMatch(/viewBox="0 0 105 88"/);
        expect(page).toMatch(
            /<image x="4" y="6" width="34" height="78" preserveAspectRatio="none" href="data:image\/svg\+xml;base64,/,
        );
        expect(page).toMatch(
            /<image x="42" y="6" width="34" height="78" [^>]*href="data:image\/png;base64,/,
        );
    });
});

describe("item checks", () => {
    const item = {
        id: "crest",
        file: "items/crest.png",
        panel: "front" as const,
        at: [17, 25.32] as [number, number],
    };

    it("says how thin an item is and how to fix it", () => {
        const { errors } = itemChecks(
            [{ ...item, width: 0.004 }],
            { "items/crest.png": 0.1 },
            regions,
        );
        expect(errors[0]).toMatch(
            /^item "crest": is 0\.004 in wide, under a pixel at 32 px\/in/,
        );
    });

    it("says an item over 120 in isn't drawn", () => {
        const { errors } = itemChecks(
            [{ ...item, width: 100 }],
            { "items/crest.png": 0.5 },
            regions,
        );
        expect(errors[0]).toMatch(
            /^item "crest": would be 100 in × 200 in, over the 120 in most/,
        );
    });

    it("warns about an item centred outside every region", () => {
        const { errors, warnings } = itemChecks(
            [{ ...item, at: [1, 1], width: 4 }],
            { "items/crest.png": 1 },
            regions,
        );
        expect(errors).toEqual([]);
        expect(warnings[0]).toMatch(/outside every region/);
    });

    it("refuses a template left in, and an empty base layer", () => {
        const n = layerNotes("base", ["template", "empty"], true);
        expect(n.errors).toHaveLength(2);
        expect(layerNotes("sash", ["empty"], false).warnings).toHaveLength(1);
    });
});

describe("buildFolder", () => {
    const page = {
        rasterLayer: async () => ({
            png: Buffer.from(fakePng(3360, 2816, 1)).toString("base64"),
            notes: ["palette"],
        }),
        rasterItem: async (name: string) => ({
            png: Buffer.from(fakePng(100, 100, name.length)).toString("base64"),
            width: 100,
            height: 100,
        }),
    };

    it("builds the example into the app's pack", async () => {
        const built = await buildFolder(example, page);
        expect(built.manifest.name).toBe("OpenMarch sample");
        expect(built.manifest.items!.map((i) => i.id)).toEqual([
            "crest",
            "number",
        ]);
        expect(built.warnings).toEqual([]);
    });

    it("refuses a file outside the pack folder", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uniform-src-"));
        try {
            const json = exampleSource();
            json.layers[0].front = "../front.svg";
            fs.writeFileSync(
                path.join(dir, "uniform.json"),
                JSON.stringify(json),
            );
            fs.writeFileSync(
                path.join(path.dirname(dir), "front.svg"),
                "<svg/>",
            );
            await expect(buildFolder(dir, page)).rejects.toThrow(
                /front\.svg isn't in the pack folder/,
            );
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
            fs.rmSync(path.join(path.dirname(dir), "front.svg"), {
                force: true,
            });
        }
    });

    it("refuses a file that links out of the pack folder", async () => {
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), "uniform-out-"));
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uniform-src-"));
        try {
            fs.writeFileSync(
                path.join(outside, "secret.svg"),
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 34 78"/>',
            );
            fs.symlinkSync(
                path.join(outside, "secret.svg"),
                path.join(dir, "front.svg"),
            );
            const json = exampleSource();
            json.layers = [{ id: "base", front: "front.svg" }];
            delete json.items;
            fs.writeFileSync(
                path.join(dir, "uniform.json"),
                JSON.stringify(json),
            );
            const rasterLayer = vi.fn();
            await expect(
                buildFolder(dir, { ...page, rasterLayer }),
            ).rejects.toThrow(
                "front.svg: must be a path inside the pack folder",
            );
            expect(rasterLayer).not.toHaveBeenCalled();
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
            fs.rmSync(outside, { recursive: true, force: true });
        }
    });

    it("refuses an empty base layer and an invisible item, together", async () => {
        const quiet = {
            rasterLayer: async () => ({
                png: Buffer.from(fakePng(3360, 2816)).toString("base64"),
                notes: ["empty"],
            }),
            rasterItem: async () => ({
                png: Buffer.from(fakePng(1, 1000)).toString("base64"),
                width: 1,
                height: 1000,
            }),
        };
        const error = await buildFolder(example, quiet).catch((e) => e);
        expect(error).toBeInstanceOf(PackSourceError);
        const problems = (error as PackSourceError).problems;
        expect(problems.some((p) => p.startsWith('layer "base": paints'))).toBe(
            true,
        );
        // the number is 8 in tall, so 0.008 in wide
        expect(problems).toContainEqual(
            expect.stringMatching(/^item "number": is 0\.008 in wide/),
        );
    });
});
