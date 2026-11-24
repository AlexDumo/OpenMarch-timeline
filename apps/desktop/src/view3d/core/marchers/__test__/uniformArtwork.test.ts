// cspell:ignore paintable tris
/**
 * The uniform flats' tables and math (docs/3d/uniform-artwork.md, fork
 * #1255): the generated tables grade every body to the median's outlines, a
 * band closes round a limb, stripe counts hold on every body, and a placed
 * logo keeps its size on the median body and its aspect on all seven.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
    BACK_NUMBER_CENTRE_Y,
    CHEST_CENTRE_Y,
    FLATS_CENTRE_X,
    bleedPlan,
    flatsAtlasLayout,
    gradeAt,
    insidePolygon,
    itemDraw,
    uniformArtworkOf,
    flatsArtworkOf,
    SAMPLE_FLATS,
    type FlatsLayout,
    type FlatsRegions,
} from "../uniformArtwork";
import { BODY_TYPES, bodyKey, sectionUniform } from "../looks";

const assets = path.resolve(__dirname, "../../../assets");
const flatsDir = path.join(assets, "uniform-flats");
const layout = JSON.parse(
    fs.readFileSync(path.join(flatsDir, "layout.json"), "utf8"),
) as FlatsLayout;
const regions = JSON.parse(
    fs.readFileSync(path.join(flatsDir, "regions.json"), "utf8"),
) as FlatsRegions & {
    regions: { id: string; seams?: { rows: number[][] } }[];
    landmarks: Record<string, { x: number; y: number }>;
};
const IN = 0.0254;
const N_A = layout.angles;

/** A body's table, decoded: texel (row, column) as [R, G, B, A]. */
function table(body: string) {
    const b = fs.readFileSync(path.join(flatsDir, "lut", `${body}.bin`));
    const h = new Uint16Array(b.buffer, b.byteOffset, b.byteLength / 2);
    return (row: number, col: number) => {
        const o = (row * N_A + col) * 4;
        return [0, 1, 2, 3].map((c) => THREE.DataUtils.fromHalfFloat(h[o + c]));
    };
}
const seg = (id: string) => layout.segments.find((s) => s.id === id)!;
/** The table row nearest t (m) along segment `id`. */
const rowAt = (id: string, t: number) => {
    const s = seg(id);
    const f = Math.min(1, Math.max(0, (t - s.tStart) / (s.tEnd - s.tStart)));
    return s.rowStart + Math.round(f * (s.rows - 1));
};
const psiOf = (i: number) => -Math.PI + ((i + 0.5) * 2 * Math.PI) / N_A;
const front = (i: number) => Math.abs(psiOf(i)) <= Math.PI / 2;

/** Distance from (x, y) to a polygon's outline. */
function distToOutline(poly: [number, number][], x: number, y: number) {
    let d = Infinity;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [ax, ay] = poly[j];
        const [bx, by] = poly[i];
        const dx = bx - ax;
        const dy = by - ay;
        const l = dx * dx + dy * dy;
        const t = l
            ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l))
            : 0;
        d = Math.min(d, Math.hypot(x - ax - dx * t, y - ay - dy * t));
    }
    return d;
}
const region = (id: string) => regions.regions.find((r) => r.id === id)!;

describe("uniform flats tables", () => {
    it("has a table for every body type, of the layout's size", () => {
        expect(layout.bodies).toEqual([...BODY_TYPES]);
        for (const b of BODY_TYPES) {
            const size = fs.statSync(
                path.join(flatsDir, "lut", `${b}.bin`),
            ).size;
            expect(size).toBe(layout.rows * N_A * 4 * 2);
        }
    });

    it("keeps its landmarks where the sample uniform places its items", () => {
        expect(regions.centreX).toBe(FLATS_CENTRE_X);
        expect(regions.landmarks.chestCentre.y).toBe(CHEST_CENTRE_Y);
        expect(regions.landmarks.backNumberCentre.y).toBe(BACK_NUMBER_CENTRE_Y);
    });

    it("leaves the neck out of every region and keeps the hips", () => {
        const ids = regions.regions.map((r) => r.id);
        expect(ids).toContain("front-hips");
        expect(ids).toContain("back-hips");
        expect(ids.some((id) => id.includes("collar"))).toBe(false);
        // nothing paintable above the collar line at the centre front (the neck)
        const collar = (
            regions as unknown as { guides: { id: string; y: number }[] }
        ).guides.find((g) => g.id === "collar")!.y;
        for (const r of regions.regions)
            if (r.panel !== "cape")
                expect(
                    insidePolygon(r.polygon, FLATS_CENTRE_X, collar - 0.5),
                ).toBe(false);
    });

    it("grades every body so its side seams land on the median's outlines", () => {
        const median = table("neutral-average");
        // the columns either side of each seam (psi = -90 and +90 deg)
        const seamCols = [31, 32, 95, 96];
        for (const body of BODY_TYPES) {
            const lut = table(body);
            for (const s of layout.segments)
                for (let k = 2; k < s.rows - 2; k += 5) {
                    const row = s.rowStart + k;
                    for (const c of seamCols) {
                        const ch = front(c) ? 0 : 1;
                        expect(
                            Math.abs(lut(row, c)[ch] - median(row, c)[ch]),
                        ).toBeLessThan(0.35);
                    }
                }
        }
    });

    it("keeps stripe counts equal on all seven bodies, front and back, down every segment", () => {
        // vertical stripes 1 in apart on each flat, counted across each half at five rows per segment
        // (the torso's from below the neck)
        for (const s of layout.segments)
            for (const f of s.id === "torso"
                ? [0.3, 0.45, 0.6, 0.75, 0.9]
                : [0.1, 0.3, 0.5, 0.7, 0.9]) {
                const row = s.rowStart + Math.round(f * (s.rows - 1));
                for (const half of ["front", "back"] as const) {
                    const counts = BODY_TYPES.map((body) => {
                        const lut = table(body);
                        let lo = Infinity;
                        let hi = -Infinity;
                        for (let i = 0; i < N_A; i++)
                            if (front(i) === (half === "front")) {
                                const u = lut(row, i)[half === "front" ? 0 : 1];
                                lo = Math.min(lo, u);
                                hi = Math.max(hi, u);
                            }
                        return Math.floor(hi + 0.5) - Math.ceil(lo + 0.5) + 1;
                    });
                    expect(
                        new Set(counts).size,
                        `${s.id} ${half} f=${f}: ${counts.join(", ")}`,
                    ).toBe(1);
                }
            }
    });

    it("closes a band drawn across a sleeve or a leg on both flats all the way round", () => {
        const cases = [
            { seg: "forearm-L", region: "sleeve-L" },
            { seg: "forearm-R", region: "sleeve-R" },
            { seg: "upper-arm-L", region: "sleeve-L" },
            { seg: "shin-L", region: "leg-L" },
            { seg: "thigh-R", region: "leg-R" },
        ];
        for (const body of BODY_TYPES) {
            const lut = table(body);
            for (const c of cases) {
                const s = seg(c.seg);
                for (const f of [0.25, 0.5, 0.75]) {
                    const t = s.tStart + f * (s.tEnd - s.tStart);
                    const row = rowAt(c.seg, t);
                    const y = s.y0 + t / IN;
                    for (let i = 0; i < N_A; i++) {
                        const isFront = front(i);
                        const v = lut(row, i);
                        const x = layout.centreX + (isFront ? v[0] : -v[1]);
                        const r = region(
                            `${isFront ? "front" : "back"}-${c.region}`,
                        );
                        // inside the region, or on its outline (the side seam)
                        const ok =
                            insidePolygon(r.polygon, x, y) ||
                            distToOutline(r.polygon, x, y) < 0.2;
                        expect(
                            ok,
                            `${body} ${c.seg} f=${f} column ${i}: (${x}, ${y})`,
                        ).toBe(true);
                    }
                }
            }
        }
    });
});

describe("a placed logo", () => {
    /** Rest-pose jacket triangles of a body. */
    async function jacket(body: string) {
        const b = fs.readFileSync(
            path.join(assets, "om-pose/bodies", `${body}.glb`),
        );
        const ab = new ArrayBuffer(b.byteLength);
        new Uint8Array(ab).set(b);
        const gltf = await new GLTFLoader().parseAsync(ab, "");
        let mesh: THREE.SkinnedMesh | null = null;
        gltf.scene.traverse((o) => {
            if (!mesh && (o as THREE.SkinnedMesh).isSkinnedMesh)
                mesh = o as THREE.SkinnedMesh;
        });
        const g = mesh!.geometry;
        const P = g.getAttribute("position");
        const part = g.getAttribute("_part");
        const I = g.index!;
        const tris: THREE.Triangle[] = [];
        for (let k = 0; k < I.count; k += 3) {
            const v = [I.getX(k), I.getX(k + 1), I.getX(k + 2)];
            if (Math.round(part.getX(v[0])) !== 1) continue;
            tris.push(
                new THREE.Triangle(
                    ...(v.map(
                        (i) =>
                            new THREE.Vector3(P.getX(i), P.getY(i), P.getZ(i)),
                    ) as [THREE.Vector3, THREE.Vector3, THREE.Vector3]),
                ),
            );
        }
        return tris;
    }
    /** Where a ray from `o` along psi round the spine first meets the jacket. */
    function hit(tris: THREE.Triangle[], o: THREE.Vector3, psi: number) {
        const ray = new THREE.Ray(
            o,
            new THREE.Vector3(Math.sin(psi), 0, Math.cos(psi)),
        );
        const at = new THREE.Vector3();
        let best: THREE.Vector3 | null = null;
        for (const t of tris) {
            const p = ray.intersectTriangle(t.a, t.b, t.c, false, at);
            if (p && (!best || p.distanceTo(o) < best.distanceTo(o)))
                best = p.clone();
        }
        return best!;
    }

    it("measures 10 in on the median body and keeps its aspect within 1% on every body", async () => {
        const width = 10;
        const y = layout.panels.front.y; // unused, documents panel inches
        void y;
        const chestY = CHEST_CENTRE_Y;
        const torso = seg("torso");
        const t = (chestY - torso.y0) * IN;
        const row = rowAt("torso", t);
        const worldY = layout.tops.torso - t;
        for (const body of BODY_TYPES) {
            const lut = table(body);
            const tris = await jacket(body);
            const zc = lut(row, N_A / 2)[2];
            // the columns where the logo's edges land: U = -5 and +5 in
            const psiAt = (u: number) => {
                for (let i = 0; i < N_A - 1; i++) {
                    if (!front(i) || !front(i + 1)) continue;
                    const a = lut(row, i)[0];
                    const b = lut(row, i + 1)[0];
                    if ((a - u) * (b - u) <= 0)
                        return (
                            psiOf(i) +
                            ((u - a) / (b - a)) * (psiOf(i + 1) - psiOf(i))
                        );
                }
                throw new Error(`U ${u} not on ${body}'s front`);
            };
            const p0 = psiAt(-width / 2);
            const p1 = psiAt(width / 2);
            const o = new THREE.Vector3(0, worldY, zc);
            // across the logo on the body: the hybrid's own measure, 0.6 x projected + 0.4 x arc
            let arc = 0;
            let prev = hit(tris, o, p0);
            const first = prev;
            for (let k = 1; k <= 40; k++) {
                const p = hit(tris, o, p0 + ((p1 - p0) * k) / 40);
                arc += p.distanceTo(prev);
                prev = p;
            }
            const projected = Math.abs(prev.x - first.x);
            const measured = (0.6 * projected + 0.4 * arc) / IN;
            const { k } = gradeAt(
                layout,
                regions,
                body,
                "front",
                FLATS_CENTRE_X,
                chestY,
            );
            const d = itemDraw(
                { file: "logo.svg", at: [FLATS_CENTRE_X, chestY], width },
                1,
                k,
            );
            // the atlas draws it k times taller; the table widens it k times on the body
            const tall = d.h * d.sy;
            if (body === "neutral-average") {
                expect(k).toBeCloseTo(1, 2);
                expect(measured).toBeGreaterThan(width - 0.3);
                expect(measured).toBeLessThan(width + 0.3);
            }
            expect(
                measured / tall,
                `${body}: ${measured.toFixed(2)} wide, ${tall.toFixed(2)} tall`,
            ).toBeGreaterThan(0.99);
            expect(measured / tall).toBeLessThan(1.01);
        }
    }, 60_000);
});

describe("uniform flats math", () => {
    it("draws items by their grade", () => {
        const item = { file: "a.svg", at: [17, 25] as const, width: 6 };
        expect(itemDraw(item, 2, 1.2)).toEqual({ w: 6, h: 3, sx: 1, sy: 1.2 });
        expect(itemDraw({ ...item, grade: "fixed" }, 2, 1.25)).toEqual({
            w: 6,
            h: 3,
            sx: 0.8,
            sy: 1,
        });
        expect(itemDraw({ ...item, grade: "stretch" }, 2, 1.25)).toEqual({
            w: 6,
            h: 3,
            sx: 1,
            sy: 1,
        });
    });

    it("lays the panels side by side, cropped to the regions plus the bleed", () => {
        const r = flatsAtlasLayout(regions, false);
        expect(r.w).toBe(2 * regions.panels.front.w);
        expect(r.cape).toBeNull();
        expect(r.front[1]).toBe(-r.yTop);
        for (const reg of regions.regions)
            if (reg.panel !== "cape")
                for (const [, yy] of reg.polygon) {
                    expect(yy - r.yTop).toBeGreaterThan(1.5);
                    expect(yy - r.yTop).toBeLessThan(r.h - 1.5);
                }
        expect(flatsAtlasLayout(regions, true).cape).toEqual([
            2 * regions.panels.front.w,
            0,
        ]);
    });

    it("bleeds outward from inside each region's rim", () => {
        // a 4 x 4 region in a 10 x 10 page
        const W = 10;
        const mask = new Uint8Array(W * W);
        for (let y = 3; y < 7; y++)
            for (let x = 3; x < 7; x++) mask[y * W + x] = 1;
        const { dst, from } = bleedPlan(mask, W, W, 2, 1);
        const source = new Map<number, number>();
        dst.forEach((d, k) => source.set(d, from[k]));
        // the rim takes the inner 2 x 2's colors; the inner 2 x 2 keeps its own
        expect(source.has(4 * W + 4)).toBe(false);
        expect([4 * W + 4, 4 * W + 5, 5 * W + 4, 5 * W + 5]).toContain(
            source.get(3 * W + 3),
        );
        // two pixels out is filled, five out isn't
        expect(source.has(1 * W + 4)).toBe(true);
        expect(source.has(0 * W + 0)).toBe(false);
    });

    it("fills the rim where two regions touch from each one's own inside, straight in", () => {
        // regions 1 (x < 5) and 2 (x >= 5) side by side, 10 x 10
        const W = 10;
        const mask = new Uint8Array(W * W);
        for (let y = 0; y < W; y++)
            for (let x = 0; x < W; x++) mask[y * W + x] = x < 5 ? 1 : 2;
        const { dst, from } = bleedPlan(mask, W, W, 2, 2);
        const source = new Map<number, number>();
        dst.forEach((d, k) => source.set(d, from[k]));
        for (const y of [3, 4, 5, 6]) {
            // the last two columns of region 1 take column 2, the first two of region 2 take column 7
            for (const x of [3, 4])
                expect(source.get(y * W + x)).toBe(y * W + 2);
            for (const x of [5, 6])
                expect(source.get(y * W + x)).toBe(y * W + 7);
        }
    });

    it("reads only built-in flats ids", () => {
        expect(uniformArtworkOf("sample")).toBe("sample");
        expect(uniformArtworkOf("later-pack")).toBeNull();
        expect(uniformArtworkOf(undefined)).toBeNull();
    });

    it("reads a show's imported uniform and falls back to the preset for anything else", () => {
        const pack = `library:3f2b1c9e-0000-4000-8000-000000000001@${"a".repeat(64)}`;
        expect(flatsArtworkOf("sample")).toBe("sample");
        expect(flatsArtworkOf(pack)).toBe(pack);
        // a number an earlier preview wrote, an unknown id, a malformed reference
        expect(flatsArtworkOf(7)).toBeNull();
        expect(flatsArtworkOf("later-pack")).toBeNull();
        expect(flatsArtworkOf("library:abc@not-a-hash")).toBeNull();
        expect(flatsArtworkOf(undefined)).toBeNull();
    });
});

describe("a look with flats", () => {
    it("dresses the band in the flats uniform and leaves the guard and plain looks alone", () => {
        const band = sectionUniform(
            "Trumpet",
            "up",
            undefined,
            undefined,
            undefined,
            "westPoint",
            "sash",
            {},
            { key: "sample", look: SAMPLE_FLATS.look },
        );
        expect(band.options.artwork).toBe("sample");
        const guard = sectionUniform(
            "Color Guard",
            "up",
            undefined,
            undefined,
            undefined,
            "westPoint",
            "sash",
            {},
            { key: "sample", look: SAMPLE_FLATS.look },
        );
        expect(guard.options.artwork).toBeUndefined();
        // a look without flats has no artwork key, so its body key (and material) is as before
        const plain = sectionUniform(
            "Trumpet",
            "up",
            undefined,
            undefined,
            undefined,
            "westPoint",
            "sash",
            {},
        );
        expect("artwork" in plain.options).toBe(false);
        expect(bodyKey(plain)).not.toContain("artwork");
        expect(bodyKey(band)).toContain("sample");
    });
});
