// cspell:ignore tris verts
/**
 * The flats lookup as the shader runs it (render/uniform-flats.js, ported in `flatsSampler.ts`): the real
 * tables read with half floats, linear filtering, S repeating round the body and T clamped, and the real
 * body meshes. Fork #1255, review of PR #1273.
 */
import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
    insidePolygon,
    type FlatsLayout,
    type FlatsRegions,
} from "@/view3d/core/marchers/uniformArtwork";
import { BODY_TYPES } from "@/view3d/core/marchers/looks";
import { FlatsSampler } from "./flatsSampler";

const assets = path.resolve(__dirname, "../../assets");
const dir = path.join(assets, "uniform-flats");
const layout = JSON.parse(
    fs.readFileSync(path.join(dir, "layout.json"), "utf8"),
) as FlatsLayout;
const regions = JSON.parse(
    fs.readFileSync(path.join(dir, "regions.json"), "utf8"),
) as FlatsRegions;
const lutBytes = (body: string) =>
    fs.readFileSync(path.join(dir, "lut", `${body}.bin`));
const sampler = (body: string, wrap: "repeat" | "clamp" = "repeat") =>
    new FlatsSampler(layout, lutBytes(body), body, wrap);

const SEGMENTS = ["torso", "hips", ...layout.limbs.map((l) => l.id)];
/** The region a segment draws from, without the panel. */
const regionOf = (seg: number) => {
    const id = SEGMENTS[seg];
    if (id === "torso" || id === "hips") return id;
    const side = id.slice(-1);
    return (
        (id.startsWith("thigh") || id.startsWith("shin") ? "leg-" : "sleeve-") +
        side
    );
};
const region = (panel: string, part: string) =>
    regions.regions.find((r) => r.panel === panel && r.part === part)!;
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

interface Body {
    verts: { p: [number, number, number]; part: number }[];
    pants: THREE.Triangle[];
}
const bodies = new Map<string, Body>();
beforeAll(async () => {
    for (const body of BODY_TYPES) {
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
        const verts: Body["verts"] = [];
        for (let i = 0; i < P.count; i++)
            verts.push({
                p: [P.getX(i), P.getY(i), P.getZ(i)],
                part: Math.round(part.getX(i)),
            });
        const I = g.index!;
        const pants: THREE.Triangle[] = [];
        for (let k = 0; k < I.count; k += 3) {
            const v = [I.getX(k), I.getX(k + 1), I.getX(k + 2)];
            if (Math.round(part.getX(v[0])) !== 3) continue;
            const [a, b2, c] = v.map(
                (i) => new THREE.Vector3(P.getX(i), P.getY(i), P.getZ(i)),
            );
            pants.push(new THREE.Triangle(a, b2, c));
        }
        bodies.set(body, { verts, pants });
    }
}, 60_000);

describe("the flats lookup round the back centre", () => {
    it("is continuous across psi = +-pi for the torso, the hips and every limb, on every body", () => {
        for (const body of BODY_TYPES) {
            const S = sampler(body);
            for (let s = 0; s < SEGMENTS.length; s++) {
                const g = layout.segments.find((x) => x.id === SEGMENTS[s])!;
                for (const f of [0.3, 0.5, 0.8]) {
                    const t = g.tStart + f * (g.tEnd - g.tStart);
                    // U on the back flat, stepping through the back centre in 0.1 deg steps
                    const step = (0.1 * Math.PI) / 180;
                    let prev = S.at(s, t, Math.PI - 20 * step)[1];
                    let maxJump = 0;
                    for (let k = -19; k <= 20; k++) {
                        const psi = Math.PI + k * step;
                        const u = S.at(
                            s,
                            t,
                            psi > Math.PI ? psi - 2 * Math.PI : psi,
                        )[1];
                        maxJump = Math.max(maxJump, Math.abs(u - prev));
                        prev = u;
                    }
                    // 0.1 deg round a 20 in back is about 0.02 in: no step anywhere near a column (2.8 deg)
                    expect(
                        maxJump,
                        `${body} ${SEGMENTS[s]} f=${f}`,
                    ).toBeLessThan(0.03);
                }
            }
        }
    });

    it("used to cut a slice out of the back with the table clamped at its ends", () => {
        // the regression the review found: ClampToEdge holds the last column's U within 1.4 deg of the centre
        const S = sampler("neutral-average", "clamp");
        const t = 0.3;
        const near = S.at(0, t, Math.PI - 0.001)[1];
        const far = S.at(0, t, -Math.PI + 0.001)[1];
        expect(Math.abs(near - far)).toBeGreaterThan(0.1);
        const R = sampler("neutral-average");
        expect(
            Math.abs(
                R.at(0, t, Math.PI - 0.001)[1] -
                    R.at(0, t, -Math.PI + 0.001)[1],
            ),
        ).toBeLessThan(0.01);
    });
});

describe("the flats lookup on the bodies' own vertices", () => {
    it("lands every jacket, sleeve and pants vertex in its own region on its own flat", () => {
        for (const body of BODY_TYPES) {
            const S = sampler(body);
            const { verts } = bodies.get(body)!;
            let n = 0;
            let inside = 0;
            let worst = 0;
            for (const { p, part } of verts) {
                if (part !== 1 && part !== 2 && part !== 3) continue;
                const s = S.sample(p, part as 1 | 2 | 3);
                if (!s.valid) continue;
                // the arm wedge the shader draws as sleeve (omFlatPart) is left out here
                if (part === 1 && Math.abs(p[0]) > 0.19 && p[1] < 1.4) continue;
                n++;
                const poly = region(s.panel, regionOf(s.seg)).polygon;
                if (insidePolygon(poly, s.q[0], s.q[1])) inside++;
                else
                    worst = Math.max(
                        worst,
                        distToOutline(poly, s.q[0], s.q[1]),
                    );
            }
            // the rest sit on a seam, well inside the 1.5 in bleed
            expect(
                inside / n,
                `${body}: ${inside} of ${n} inside`,
            ).toBeGreaterThan(0.97);
            expect(
                worst,
                `${body}: worst ${worst.toFixed(2)} in outside`,
            ).toBeLessThan(0.5);
        }
    });

    it("cuts only the neck: the collar ring is out, the yoke and shoulder tops are in", () => {
        for (const body of BODY_TYPES) {
            const S = sampler(body);
            const { verts } = bodies.get(body)!;
            const jacket = verts.filter((v) => v.part === 1);
            const collar = jacket.filter((v) => v.p[1] >= 1.465);
            expect(
                collar.every((v) => !S.sample(v.p, 1).valid),
                body,
            ).toBe(true);
            // the shoulder tops: jacket vertices between the neck and the arm, from 1.40 m up
            const yoke = jacket.filter(
                (v) =>
                    v.p[1] > 1.4 &&
                    v.p[1] < 1.465 &&
                    Math.abs(v.p[0]) > 0.09 &&
                    Math.abs(v.p[0]) < 0.17,
            );
            expect(yoke.length, body).toBeGreaterThan(4);
            expect(
                yoke.every((v) => S.sample(v.p, 1).valid),
                body,
            ).toBe(true);
        }
    });
});

describe("the hips into the thighs", () => {
    it("has no step on the outer side of the leg at the crotch line, front or back", () => {
        for (const body of BODY_TYPES) {
            const S = sampler(body);
            const { pants } = bodies.get(body)!;
            for (const side of [1, -1])
                for (const dz of [-0.03, -0.015, 0, 0.015, 0.03]) {
                    let prev: { panel: string; q: [number, number] } | null =
                        null;
                    // down the outer side, 2 mm at a time, from 3 cm above the crotch to 3 cm below
                    for (
                        let y = layout.tops.crotch + 0.03;
                        y >= layout.tops.crotch - 0.03;
                        y -= 0.002
                    ) {
                        const ray = new THREE.Ray(
                            new THREE.Vector3(side * 0.09, y, dz),
                            new THREE.Vector3(side, 0, 0),
                        );
                        const at = new THREE.Vector3();
                        let hit: THREE.Vector3 | null = null;
                        for (const t of pants) {
                            const h = ray.intersectTriangle(
                                t.a,
                                t.b,
                                t.c,
                                false,
                                at,
                            );
                            if (h && (!hit || Math.abs(h.x) < Math.abs(hit.x)))
                                hit = h.clone();
                        }
                        if (!hit) continue;
                        const s = S.sample([hit.x, hit.y, hit.z], 3);
                        if (prev && prev.panel === s.panel) {
                            // 2 mm down the body is about 0.08 in down the flat; across it, no jump
                            const dx = Math.abs(s.q[0] - prev.q[0]);
                            expect(
                                dx,
                                `${body} side ${side} dz ${dz} y ${y.toFixed(3)}`,
                            ).toBeLessThan(0.05);
                        }
                        prev = s;
                    }
                }
        }
    });
});
