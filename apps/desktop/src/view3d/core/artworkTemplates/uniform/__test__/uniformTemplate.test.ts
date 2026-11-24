// @vitest-environment node
// cspell:words ihdr idat iend inseam underarm paintable
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { pngChunk } from "../../png";
import {
    FLATS_PARTS,
    FLATS_LAYOUT,
    flatsRegions,
    loadUniformFlatsSource,
    seamTable,
    insidePolygon,
    type DrawNode,
    uniformTemplate,
    uniformTemplateFile,
    uniformTemplatePdf,
    uniformTemplatePng,
    uniformTemplateSvg,
    type UniformCanvas,
    type UniformCanvasContext,
} from "..";

/** The outlines generated from the body models (assets/uniform-flats/regions.json). */
const SOURCE = await loadUniformFlatsSource();

/** A 1 × 1 PNG, standing in for what a real canvas encodes. */
function tinyPng(): Uint8Array {
    const ihdr = new Uint8Array(13);
    new DataView(ihdr.buffer).setUint32(0, 1);
    new DataView(ihdr.buffer).setUint32(4, 1);
    ihdr.set([8, 2, 0, 0, 0], 8);
    const parts = [
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk("IHDR", ihdr),
        pngChunk("IDAT", deflateSync(new Uint8Array([0, 255, 255, 255]))),
        pngChunk("IEND", new Uint8Array(0)),
    ];
    const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let at = 0;
    for (const p of parts) {
        out.set(p, at);
        at += p.length;
    }
    return out;
}

/** A canvas that records its size and the calls made on it. */
function recordingCanvas() {
    const made: { width: number; height: number }[] = [];
    const texts: string[] = [];
    const ctx = new Proxy(
        {},
        {
            get: (_target, key) =>
                key === "fillText"
                    ? (value: string) => texts.push(value)
                    : () => undefined,
            set: () => true,
        },
    ) as UniformCanvasContext;
    const makeCanvas = (width: number, height: number): UniformCanvas => {
        made.push({ width, height });
        return { getContext: () => ctx, encodePng: async () => tinyPng() };
    };
    return { made, texts, makeCanvas };
}

function chunkTypes(png: Uint8Array): string[] {
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    const types: string[] = [];
    for (let at = 8; at + 8 <= png.length; ) {
        const length = view.getUint32(at);
        types.push(String.fromCharCode(...png.subarray(at + 4, at + 8)));
        at += 12 + length;
    }
    return types;
}

interface RegionsJson {
    page: { w: number; h: number };
    pagePx: { w: number; h: number };
    dpi: number;
    panels: Record<string, { x: number; y: number; w: number; h: number }>;
    regions: {
        id: string;
        panel: string;
        part: string;
        polygon: [number, number][];
        edges: {
            side: "left" | "right";
            name: string;
            meets: { region: string; side: "left" | "right" };
        }[];
        seams: { y: number; left: number; right: number }[];
    }[];
    guides: { id: string; y: number }[];
}

async function regionsJson(): Promise<RegionsJson> {
    const file = await uniformTemplateFile("json", () => {
        throw new Error("no canvas for JSON");
    });
    return JSON.parse(file.data as string) as RegionsJson;
}

const REGION_IDS = [
    ...["front", "back"].flatMap((panel) =>
        FLATS_PARTS.map((part) => `${panel}-${part}`),
    ),
    "cape",
];

describe("uniform template sizes", () => {
    const { drawing } = uniformTemplate(SOURCE);

    it("is a 105 × 88 in page at 32 px per inch", () => {
        expect(drawing.width).toBe(105);
        expect(drawing.height).toBe(88);
        expect(drawing.dpi).toBe(32);
    });

    it("paints the PNG at 3360 × 2816 px and stores 32 px per inch", async () => {
        const { made, texts, makeCanvas } = recordingCanvas();
        const png = await uniformTemplatePng(drawing, makeCanvas);
        expect(made).toEqual([{ width: 3360, height: 2816 }]);
        // the PNG carries its labels
        expect(texts).toContain("outside");
        expect(texts).toContain("inseam");
        expect(texts).toContain("underarm");
        expect(texts).toContain("Pants, belt to crotch");
        expect(chunkTypes(png)).toEqual(["IHDR", "pHYs", "IDAT", "IEND"]);
        const at = chunkTypes(png).indexOf("pHYs");
        // signature (8) + IHDR (12 + 13), then the pHYs chunk's length and type
        expect(at).toBe(1);
        const view = new DataView(png.buffer, png.byteOffset);
        const phys = 8 + 25 + 8;
        // 32 px/in is 1259.84 px/m, stored whole
        expect(view.getUint32(phys)).toBe(1260);
        expect(view.getUint32(phys + 4)).toBe(1260);
        expect(png[phys + 8]).toBe(1);
    });

    it("writes the SVG at size with its view box in inches", () => {
        const svg = uniformTemplateSvg(drawing);
        expect(svg).toContain(
            '<svg xmlns="http://www.w3.org/2000/svg" width="105in" height="88in" viewBox="0 0 105 88"',
        );
    });

    it("writes the PDF at size", () => {
        const pdf = new TextDecoder().decode(uniformTemplatePdf(drawing));
        expect(pdf.startsWith("%PDF-1.4")).toBe(true);
        expect(pdf).toContain("/MediaBox [0 0 7560 6336]");
    });

    it("names each hem for what it is", async () => {
        const json = (await regionsJson()) as RegionsJson & {
            landmarks: Record<string, unknown>;
        };
        expect(json.guides.map((g) => g.id)).toEqual([
            "collar",
            "chest",
            "jacketHem",
            "crotch",
            "knee",
            "elbow",
        ]);
        expect(json.guides.find((g) => g.id === "jacketHem")!.y).toBe(38.31);
        expect(json.landmarks.legHem).toBe(74.04);
        expect(json.landmarks.sleeveCuff).toBe(41.32);
        expect(Object.keys(json.landmarks)).not.toContain("hem");
        expect(Object.keys(json.landmarks)).not.toContain("cuff");
    });

    it("gives the same sizes in uniform-regions.json", async () => {
        const json = await regionsJson();
        expect(json.page).toEqual({ w: 105, h: 88 });
        expect(json.pagePx).toEqual({ w: 3360, h: 2816 });
        expect(json.dpi).toBe(32);
        expect(json.panels.front).toMatchObject({ x: 4, y: 6, w: 34, h: 78 });
        expect(json.panels.back).toMatchObject({ x: 42, y: 6, w: 34, h: 78 });
        expect(json.panels.cape).toMatchObject({
            x: 80,
            y: 10,
            w: 20.7,
            h: 17.9,
        });
    });
});

describe("uniform template regions", () => {
    it("has every region id in the JSON, once", async () => {
        const json = await regionsJson();
        expect(json.regions.map((r) => r.id).sort()).toEqual(
            [...REGION_IDS].sort(),
        );
    });

    it("has every region id on a shape in the SVG's regions group, outside the guides", () => {
        const svg = uniformTemplateSvg(uniformTemplate(SOURCE).drawing);
        const regions = svg.slice(
            svg.indexOf('<g id="regions">'),
            svg.indexOf('<g id="guides">'),
        );
        for (const id of REGION_IDS)
            expect(regions).toMatch(
                new RegExp(`<polygon id="${id}" class="region"`),
            );
        expect(svg.match(/class="region"/g)).toHaveLength(REGION_IDS.length);
    });

    it("keeps the neck out of every region, and paints the yoke round it", () => {
        const { model } = uniformTemplate(SOURCE);
        const neck: [number, number] = [
            FLATS_LAYOUT.centreX,
            SOURCE.guides.collar - 0.5,
        ];
        for (const r of model.regions.filter((r) => r.panel !== "cape"))
            expect(insidePolygon(r.polygon, neck), r.id).toBe(false);
        for (const panel of ["front", "back"] as const) {
            const torso = model.regions.find((r) => r.id === `${panel}-torso`)!;
            // The torso's top runs up round the neck and over the shoulders
            expect(torso.bbox.y).toBeLessThan(SOURCE.guides.collar - 2);
        }
    });

    it("ignores shapes that aren't paintable parts", () => {
        const model = flatsRegions({
            ...SOURCE,
            regions: [
                ...SOURCE.regions,
                {
                    panel: "front",
                    part: "collar",
                    polygon: [
                        [15, 10],
                        [19, 10],
                        [19, 19],
                    ],
                },
            ],
        });
        expect(model.regions.map((r) => r.id)).not.toContain("front-collar");
    });

    it("agrees with the generator's seam rows, measured from the outlines", () => {
        let compared = 0;
        for (const r of SOURCE.regions) {
            expect(r.seams, `${r.panel}-${r.part}`).toBeDefined();
            const mine = new Map(
                seamTable(r.polygon).map((row) => [row.y, row]),
            );
            for (const row of r.seams!) {
                const m = mine.get(row.y);
                expect(m, `${r.panel}-${r.part} at ${row.y}`).toBeDefined();
                // within 0.05 in: the elbow rows differ by that much at most
                expect(Math.abs(m!.left - row.left)).toBeLessThanOrEqual(0.051);
                expect(Math.abs(m!.right - row.right)).toBeLessThanOrEqual(
                    0.051,
                );
                compared++;
            }
        }
        expect(compared).toBeGreaterThan(1000);
    });

    it("never overlaps two regions on a panel; neighbours only share a line", () => {
        const { model } = uniformTemplate(SOURCE);
        for (const panel of ["front", "back"] as const) {
            const mine = model.regions.filter((r) => r.panel === panel);
            // Points every 0.1 in, off any whole-hundredth line a cut lies on
            for (let y = 0.005; y < 78; y += 0.1)
                for (let x = 0.005; x < 34; x += 0.1) {
                    const hits = mine.filter((r) =>
                        insidePolygon(r.polygon, [x, y]),
                    );
                    expect(
                        hits.length,
                        `${panel} (${x.toFixed(3)}, ${y.toFixed(3)}): ${hits.map((r) => r.id).join(", ")}`,
                    ).toBeLessThan(2);
                }
        }
    });

    it("draws the chest centre mark on its landmark", () => {
        const { drawing } = uniformTemplate(SOURCE);
        const [x, y] = SOURCE.landmarks.chestCentre;
        const front = (drawing.root[2].children as DrawNode[]).find(
            (n) => n.kind === "group" && n.id === "guides-front",
        );
        const shapes =
            front?.kind === "group"
                ? front.children.filter((n) => n.kind === "shape")
                : [];
        const vertical = shapes.find(
            (n) =>
                n.kind === "shape" &&
                n.points.length === 2 &&
                n.points[0][0] === x &&
                n.points[1][0] === x &&
                n.points[0][1] < y &&
                n.points[1][1] > y &&
                n.points[1][1] - n.points[0][1] < 1,
        );
        expect(vertical).toBeDefined();
    });

    it("names a limb's outside and its underarm or inseam, swapped between the panels", async () => {
        const json = await regionsJson();
        const names = (id: string) =>
            Object.fromEntries(
                json.regions
                    .find((r) => r.id === id)!
                    .edges.map((e) => [e.side, e.name]),
            );
        // The front panel has the performer's right on the left
        expect(names("front-sleeve-R")).toEqual({
            left: "outside",
            right: "underarm",
        });
        expect(names("back-sleeve-R")).toEqual({
            left: "underarm",
            right: "outside",
        });
        expect(names("front-leg-L")).toEqual({
            left: "inseam",
            right: "outside",
        });
        expect(names("back-leg-L")).toEqual({
            left: "outside",
            right: "inseam",
        });
    });
});

/**
 * From here on only `uniform-regions.json` is used, as an agent would: a
 * stripe drawn at a seam tick on the front and on the back must meet itself
 * at both side seams.
 */
describe("a stripe at a seam tick, from uniform-regions.json only", () => {
    type Region = RegionsJson["regions"][number];

    const inside = (polygon: [number, number][], x: number, y: number) => {
        let hit = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const [xa, ya] = polygon[j];
            const [xb, yb] = polygon[i];
            if (
                (ya <= y ? yb > y : yb <= y) &&
                x < xa + ((y - ya) / (yb - ya)) * (xb - xa)
            )
                hit = !hit;
        }
        return hit;
    };

    /** The stripe across a region at a tick: from one seam to the other. */
    const stripe = (region: Region, y: number) => {
        const row = region.seams.find((s) => s.y === y);
        if (!row) throw new Error(`${region.id} has no seam row at ${y}`);
        return {
            left: [row.left, y] as const,
            right: [row.right, y] as const,
        };
    };

    it("meets itself at both seams of every part, on every whole-inch tick", async () => {
        const json = await regionsJson();
        const byId = new Map(json.regions.map((r) => [r.id, r]));
        let checked = 0;
        for (const part of FLATS_PARTS) {
            const front = byId.get(`front-${part}`)!;
            const back = byId.get(`back-${part}`)!;
            const ticks = front.seams
                .map((s) => s.y)
                .filter((y) => Number.isInteger(y))
                .filter((y) => back.seams.some((s) => s.y === y));
            expect(ticks.length).toBeGreaterThan(2);
            for (const y of ticks) {
                const drawn = {
                    [front.id]: stripe(front, y),
                    [back.id]: stripe(back, y),
                };
                for (const edge of front.edges) {
                    const other = byId.get(edge.meets.region)!;
                    const otherEdge = other.edges.find(
                        (e) => e.side === edge.meets.side,
                    )!;
                    // The seam joins the same body edge, and the other edge joins back
                    expect(otherEdge.name).toBe(edge.name);
                    expect(otherEdge.meets).toEqual({
                        region: front.id,
                        side: edge.side,
                    });
                    // Both ends sit on their outline at the same height
                    const a = drawn[front.id][edge.side];
                    const b = drawn[other.id][edge.meets.side];
                    expect(a[1]).toBe(b[1]);
                    for (const [region, [x, py], side] of [
                        [front, a, edge.side],
                        [other, b, edge.meets.side],
                    ] as const) {
                        const inward = side === "left" ? 1 : -1;
                        expect(
                            inside(region.polygon, x + inward * 0.05, py),
                        ).toBe(true);
                        expect(
                            inside(region.polygon, x - inward * 0.05, py),
                        ).toBe(false);
                    }
                    checked++;
                }
            }
        }
        expect(checked).toBeGreaterThan(200);
    });

    it("lets a sash cross the side seams: the front's ends are the back's starts", async () => {
        const json = await regionsJson();
        const front = json.regions.find((r) => r.id === "front-torso")!;
        // Down the front from the performer's right shoulder to their left hip
        const start = stripe(front, 24).left;
        const end = stripe(front, 36).right;
        const toBack = (edgeSide: "left" | "right", y: number) => {
            const edge = front.edges.find((e) => e.side === edgeSide)!;
            const back = json.regions.find((r) => r.id === edge.meets.region)!;
            return { name: edge.name, point: stripe(back, y)[edge.meets.side] };
        };
        // The front's right edge is the performer's left side; on the back it is the left edge
        expect(toBack("right", 36)).toMatchObject({ name: "left side" });
        expect(toBack("left", 24)).toMatchObject({ name: "right side" });
        expect(toBack("right", end[1]).point[1]).toBe(36);
        expect(toBack("left", start[1]).point[1]).toBe(24);
    });

    it("lists both seams every 0.25 in", async () => {
        const json = await regionsJson();
        for (const r of json.regions.filter((r) => r.panel !== "cape")) {
            for (let i = 1; i < r.seams.length; i++)
                expect(r.seams[i].y - r.seams[i - 1].y).toBeCloseTo(0.25, 6);
            for (const s of r.seams) expect(s.left).toBeLessThan(s.right);
        }
    });
});
