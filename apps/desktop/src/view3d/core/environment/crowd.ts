import {
    BufferGeometry,
    Color,
    Float32BufferAttribute,
    InstancedMesh,
    Matrix4,
    MeshLambertMaterial,
    Quaternion,
    Vector3,
    type Vector3Tuple,
} from "three";
import type { SeatRow, VenueParams } from "../types";
import { createRng } from "./random";

/**
 * One seated person's bounding size (design.md section 5): a tapered torso and
 * a head (`personGeometry`), with a little height jitter.
 */
export const PERSON_WIDTH = 0.43;
export const PERSON_HEIGHT = 0.8;
export const PERSON_DEPTH = 0.3;
/** Extra height up to this many meters, per person. */
export const PERSON_HEIGHT_JITTER = 0.1;
/** Distance between neighbors along a row. */
export const PERSON_SPACING = 0.64;
/** Default people between aisles. */
export const DEFAULT_AISLE_EVERY = 18;

/** Shirt colors (hex numbers) per seat-row side. */
export type CrowdPalette = Record<SeatRow["side"], number[]>;

export interface CrowdOptions {
    /** Fraction of seats filled, 0 to 1. Default 0.6. */
    density?: number;
    /** Default `defaultCrowdPalette()` with the default team colors. */
    palette?: CrowdPalette;
    /** People between aisles along a row. Default 18. */
    aisleEvery?: number;
    /** People-wide gap at each aisle. Default 2. */
    aisleWidth?: number;
    /** "low" halves the density. Default "high". */
    quality?: "low" | "high";
    /** Seed for the deterministic layout. Default 7. */
    seed?: number;
}

export interface Crowd {
    /** One `InstancedMesh` for everyone, in the same frame as the seat rows. */
    mesh: InstancedMesh;
    /** Number of people placed (before any `clearAround`). */
    count: number;
    /**
     * Hides everyone within `radius` meters of `point` (same frame as the
     * seat rows) and shows everyone else, so the latest call wins. Call it
     * when the camera sits in a seat. Returns how many people are hidden.
     */
    clearAround(point: Vector3Tuple, radius: number): number;
    /** Shows everyone again. */
    reset(): void;
    /** Number of people currently shown. */
    visibleCount(): number;
    dispose(): void;
}

const hex = (css: string, fallback: number): number => {
    const m = /^#([0-9a-f]{6})$/i.exec(css.trim());
    return m ? parseInt(m[1], 16) : fallback;
};

/**
 * Default shirt colors from the demo: home and away rows lean toward their
 * team color, neutral rows use only the mixed palette.
 */
export function defaultCrowdPalette(
    params?: Pick<VenueParams, "homeColor" | "awayColor">,
): CrowdPalette {
    const home = hex(params?.homeColor ?? "", 0x6442ff);
    const away = hex(params?.awayColor ?? "", 0xc23b3b);
    const mix = [0xffffff, 0x22252c, 0x3b5b92, 0xb04a3a, 0xd9c48a, 0x5a6e4e];
    return {
        home: [home, home, ...mix],
        away: [away, away, ...mix],
        neutral: mix,
    };
}

/** Points along a polyline at even spacing; closed rows include the closing segment. */
function sampleRow(
    points: Vector3Tuple[],
    closed: boolean,
    spacing: number,
): { position: Vector3; tangent: Vector3 }[] {
    const out: { position: Vector3; tangent: Vector3 }[] = [];
    const n = points.length;
    if (n < 2) return out;
    const segCount = closed ? n : n - 1;
    let carry = 0;
    for (let s = 0; s < segCount; s++) {
        const a = new Vector3(...points[s]);
        const b = new Vector3(...points[(s + 1) % n]);
        const seg = b.clone().sub(a);
        const len = seg.length();
        if (len < 1e-9) continue;
        const tangent = seg.clone().divideScalar(len);
        let d = carry;
        while (d < len) {
            out.push({
                position: a.clone().addScaledVector(tangent, d),
                tangent,
            });
            d += spacing;
        }
        carry = d - len;
    }
    return out;
}

/**
 * A box with its bottom face left out (nobody sees it): five faces, ten
 * triangles. `bottom` and `top` are [width, depth] at each end, centered on
 * `z`. `part(face, isTop)` gives each vertex's [shirt, hair] weights.
 */
function openBox(
    out: { pos: number[]; part: number[]; index: number[] },
    y0: number,
    y1: number,
    bottom: [number, number],
    top: [number, number],
    z: number,
    part: (
        face: "front" | "back" | "side" | "top",
        isTop: boolean,
    ) => [number, number],
    capTop = true,
): void {
    const corner = (w: number, d: number, y: number, sx: number, sz: number) =>
        [(sx * w) / 2, y, z + (sz * d) / 2] as const;
    const quad = (
        face: "front" | "back" | "side" | "top",
        a: readonly number[],
        b: readonly number[],
        c: readonly number[],
        d: readonly number[],
        tops: [boolean, boolean, boolean, boolean],
    ) => {
        const base = out.pos.length / 3;
        [a, b, c, d].forEach((p, i) => {
            out.pos.push(p[0], p[1], p[2]);
            out.part.push(...part(face, tops[i]));
        });
        out.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    const B = (sx: number, sz: number) =>
        corner(bottom[0], bottom[1], y0, sx, sz);
    const T = (sx: number, sz: number) => corner(top[0], top[1], y1, sx, sz);
    // Counter-clockwise seen from outside. Front is +Z.
    quad("front", B(-1, 1), B(1, 1), T(1, 1), T(-1, 1), [
        false,
        false,
        true,
        true,
    ]);
    quad("back", B(1, -1), B(-1, -1), T(-1, -1), T(1, -1), [
        false,
        false,
        true,
        true,
    ]);
    quad("side", B(1, 1), B(1, -1), T(1, -1), T(1, 1), [
        false,
        false,
        true,
        true,
    ]);
    quad("side", B(-1, -1), B(-1, 1), T(-1, 1), T(-1, -1), [
        false,
        false,
        true,
        true,
    ]);
    if (!capTop) return;
    quad("top", T(-1, 1), T(1, 1), T(1, -1), T(-1, -1), [
        true,
        true,
        true,
        true,
    ]);
}

/**
 * One seated person standing on the origin (the seat) and facing +Z: a torso
 * that narrows to the waist and a head with hair on top and at the back.
 * "high" (28 triangles) slopes the shoulders in to the neck; "low" (20) is a
 * plain tapered torso. `aPart` holds [shirt, hair] weights per vertex: the shirt
 * takes the instance color; the rest is skin or hair, picked per person in
 * the shader.
 */
export function personGeometry(
    detail: "low" | "high" = "high",
): BufferGeometry {
    const out = {
        pos: [] as number[],
        part: [] as number[],
        index: [] as number[],
    };
    const shirt = (): [number, number] => [1, 0];
    if (detail === "high") {
        // Waist to chest, then chest sloping in to the shoulders' top.
        openBox(
            out,
            0,
            0.44,
            [0.34, 0.25],
            [PERSON_WIDTH, PERSON_DEPTH * 0.78],
            -0.02,
            shirt,
            false,
        );
        openBox(
            out,
            0.44,
            0.57,
            [PERSON_WIDTH, PERSON_DEPTH * 0.78],
            [0.3, 0.17],
            -0.02,
            shirt,
        );
    } else {
        openBox(
            out,
            0,
            0.56,
            [0.36, 0.26],
            [PERSON_WIDTH, PERSON_DEPTH * 0.75],
            -0.02,
            shirt,
        );
    }
    // Head: chin to crown; face skin, hairline on top of the face.
    openBox(
        out,
        0.6,
        PERSON_HEIGHT,
        [0.16, 0.19],
        [0.17, 0.2],
        0.0,
        (face, isTop) => {
            if (face === "top" || face === "back") return [0, 1];
            if (face === "side") return [0, isTop ? 0.9 : 0.15];
            return [0, isTop ? 0.55 : 0];
        },
    );
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(out.pos, 3));
    g.setAttribute("aPart", new Float32BufferAttribute(out.part, 2));
    g.setIndex(out.index);
    g.computeVertexNormals();
    return g;
}

/** sRGB hex to a GLSL vec3 literal in linear space. */
const glslColor = (hex: number): string => {
    const c = new Color().setHex(hex);
    return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
};
const SKIN = [0xf1c6a5, 0xe0ac86, 0xc68a62, 0x9c6644, 0x6e4a33, 0x4a3122];
const HAIR = [0x1d1612, 0x2e2018, 0x4a3324, 0x7a5a38, 0xb89a68, 0x8d8a86];

/**
 * Lambert (cheap under the venues' many lights) with the shirt from the
 * instance color (muted and shaded per person) and skin and hair picked from
 * a hash of the person's seat.
 * One in eight wears a cap in their shirt color.
 */
function crowdMaterial(): MeshLambertMaterial {
    const material = new MeshLambertMaterial({ color: 0xffffff });
    material.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader
            .replace(
                "#include <common>",
                `#include <common>
attribute vec2 aPart;
const vec3 OM_SKIN[${SKIN.length}] = vec3[](${SKIN.map(glslColor).join(", ")});
const vec3 OM_HAIR[${HAIR.length}] = vec3[](${HAIR.map(glslColor).join(", ")});
float omCrowdHash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}`,
            )
            .replace(
                "#include <color_vertex>",
                `vColor = vec4(1.0);
#ifdef USE_INSTANCING_COLOR
    vec3 omShirt = instanceColor.rgb;
#else
    vec3 omShirt = vec3(1.0);
#endif
    vec2 omSeat = vec2(instanceMatrix[3][0], instanceMatrix[3][2]) * 3.7 + instanceMatrix[3][1];
    float omA = omCrowdHash(omSeat);
    float omB = omCrowdHash(omSeat + 17.0);
    // Mute shirts a little and vary their shade, so the stands sit behind
    // the field (fidelity.md section 6).
    omShirt = mix(vec3(dot(omShirt, vec3(0.2126, 0.7152, 0.0722))), omShirt, 0.82);
    omShirt *= 0.74 + 0.26 * omCrowdHash(omSeat + 5.0);
    vec3 omSkin = OM_SKIN[int(omA * ${SKIN.length}.0) % ${SKIN.length}];
    vec3 omHair = omB < 0.125 ? omShirt * 0.8 : OM_HAIR[int(omB * ${HAIR.length * 4}.0) % ${HAIR.length}];
    vColor.rgb = mix(mix(omSkin, omShirt, aPart.x), omHair, aPart.y);`,
            );
    };
    // One program for every crowd, whatever the closures capture.
    material.customProgramCacheKey = () => "om-crowd-v1";
    return material;
}

/**
 * Whether people on each row face along the row's left-hand normal (+1) or
 * its right-hand one (-1): toward the next row down, which is toward the
 * field. A ring faces its middle.
 */
function rowFacings(seatRows: SeatRow[]): number[] {
    const info = seatRows.map((row) => {
        let x = 0;
        let y = 0;
        let z = 0;
        row.points.forEach((p) => {
            x += p[0];
            y += p[1];
            z += p[2];
        });
        const n = Math.max(1, row.points.length);
        return { x: x / n, y: y / n, z: z / n };
    });
    return seatRows.map((row, r) => {
        const me = info[r];
        let target: { x: number; z: number; sign: number } | null = null;
        if (row.closed) {
            target = { x: me.x, z: me.z, sign: 1 };
        } else {
            // The nearest row below this one; else away from the nearest above.
            let best = Infinity;
            info.forEach((o, k) => {
                if (k === r || Math.abs(o.y - me.y) < 0.05) return;
                const d2 =
                    (o.x - me.x) ** 2 + (o.z - me.z) ** 2 + (o.y - me.y) ** 2;
                const below = o.y < me.y;
                const score = d2 + (below ? 0 : 1e6);
                if (score < best) {
                    best = score;
                    target = { x: o.x, z: o.z, sign: below ? 1 : -1 };
                }
            });
        }
        if (!target) return 1;
        const t = target as { x: number; z: number; sign: number };
        let sum = 0;
        const pts = row.points;
        const segs = row.closed ? pts.length : pts.length - 1;
        for (let s = 0; s < segs; s++) {
            const a = pts[s];
            const b = pts[(s + 1) % pts.length];
            const tx = b[0] - a[0];
            const tz = b[2] - a[2];
            const mx = (a[0] + b[0]) / 2;
            const mz = (a[2] + b[2]) / 2;
            // Left-hand normal of the tangent, as the person's +Z maps to.
            sum += (-tz * (t.x - mx) + tx * (t.z - mz)) * t.sign;
        }
        return sum < 0 ? -1 : 1;
    });
}

/**
 * Builds the whole crowd as one `InstancedMesh` (one draw call). People sit
 * on each seat row's polyline (whose points are at seat height), spaced 0.64
 * m apart, facing down the stand, with an aisle every 18 people and a random
 * subset skipped to reach `density`. Shirt colors come from the row's `side`;
 * each instance's matrix translation is its seat point.
 */
export function buildCrowd(
    seatRows: SeatRow[],
    options: CrowdOptions = {},
): Crowd {
    const quality = options.quality ?? "high";
    const density =
        Math.min(1, Math.max(0, options.density ?? 0.6)) *
        (quality === "low" ? 0.5 : 1);
    const palette = options.palette ?? defaultCrowdPalette();
    const aisleEvery = Math.max(1, options.aisleEvery ?? DEFAULT_AISLE_EVERY);
    const aisleWidth = Math.max(0, options.aisleWidth ?? 2);
    const rnd = createRng(options.seed ?? 7);

    interface Placed {
        x: number;
        y: number;
        z: number;
        yaw: number;
        height: number;
        color: number;
    }
    const placed: Placed[] = [];
    const facings = rowFacings(seatRows);
    seatRows.forEach((row, r) => {
        const colors = palette[row.side].length
            ? palette[row.side]
            : palette.neutral;
        const samples = sampleRow(row.points, row.closed, PERSON_SPACING);
        samples.forEach(({ position, tangent }, j) => {
            if (j % (aisleEvery + aisleWidth) >= aisleEvery) return;
            if (rnd() >= density) return;
            placed.push({
                x: position.x,
                y: position.y,
                z: position.z,
                yaw:
                    Math.atan2(-tangent.z, tangent.x) +
                    (facings[r] < 0 ? Math.PI : 0) +
                    (rnd() - 0.5) * 0.35,
                height: 1 + (rnd() * PERSON_HEIGHT_JITTER) / PERSON_HEIGHT,
                color: colors[Math.floor(rnd() * colors.length)],
            });
        });
    });

    const geometry = personGeometry(quality);
    const material = crowdMaterial();
    const mesh = new InstancedMesh(
        geometry,
        material,
        Math.max(1, placed.length),
    );
    mesh.name = "crowd";
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData.crowd = true;

    const m = new Matrix4();
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    const color = new Color();
    placed.forEach((p, i) => {
        q.setFromAxisAngle(up, p.yaw);
        const k = 0.94 + (p.height - 1) * 0.5;
        m.compose(new Vector3(p.x, p.y, p.z), q, new Vector3(k, p.height, k));
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, color.setHex(p.color));
    });
    mesh.count = placed.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    const base = new Float32Array(mesh.instanceMatrix.array); // copy
    let hidden = 0;
    const apply = (point: Vector3Tuple | null, radius: number): number => {
        const arr = mesh.instanceMatrix.array as Float32Array;
        const r2 = radius * radius;
        hidden = 0;
        for (let k = 0; k < placed.length; k++) {
            const i = k * 16;
            let near = false;
            if (point) {
                const dx = base[i + 12] - point[0];
                const dy = base[i + 13] - point[1];
                const dz = base[i + 14] - point[2];
                near = dx * dx + dy * dy + dz * dz < r2;
            }
            if (near) hidden++;
            for (let e = 0; e < 16; e++) {
                arr[i + e] = near && e !== 15 ? 0 : base[i + e];
            }
        }
        mesh.instanceMatrix.needsUpdate = true;
        return hidden;
    };

    return {
        mesh,
        count: placed.length,
        clearAround: (point, radius) => apply(point, radius),
        reset: () => void apply(null, 0),
        visibleCount: () => placed.length - hidden,
        dispose() {
            geometry.dispose();
            material.dispose();
            mesh.dispose();
        },
    };
}
