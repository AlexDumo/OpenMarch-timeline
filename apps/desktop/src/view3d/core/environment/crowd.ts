import {
    BoxGeometry,
    BufferAttribute,
    BufferGeometry,
    Color,
    CylinderGeometry,
    Euler,
    InstancedBufferAttribute,
    InstancedMesh,
    Matrix4,
    MeshStandardMaterial,
    Quaternion,
    SphereGeometry,
    Vector3,
    type Vector3Tuple,
} from "three";
import type { SeatRow, VenueParams } from "../types";
import { createRng } from "./random";

/** One person: sized like this, with a little height jitter (design.md section 5). */
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
    /**
     * Figure detail: 2 is a seated person with head, torso, arms and legs
     * (about 170 triangles), 1 drops the arms (about 70), 0 is a block
     * figure (about 30). Default: chosen from the head count, so a 30,000
     * seat dome stays light.
     */
    detail?: 0 | 1 | 2;
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

/** Which body part a vertex belongs to; the vertex shader colors each one. */
const PART_SHIRT = 0;
const PART_SKIN = 1;
const PART_HAIR = 2;
const PART_PANTS = 3;

interface FigurePart {
    geometry: BufferGeometry;
    matrix: Matrix4;
    part: number;
    /** Sets hair on a head: the crown and the back, by the unscaled normal. */
    head?: boolean;
}

const box = (
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    part: number,
    rx = 0,
): FigurePart => ({
    geometry: new BoxGeometry(w, h, d),
    matrix: new Matrix4().compose(
        new Vector3(x, y, z),
        new Quaternion().setFromEuler(new Euler(rx, 0, 0)),
        new Vector3(1, 1, 1),
    ),
    part,
});

/**
 * One seated person, facing +Z, origin where they sit, about 0.87 m tall.
 * Merged into one geometry with a `color` attribute (shirt white; the shader
 * tints it per instance) and an `aPart` attribute. Detail 0 to 2: see
 * `CrowdOptions.detail`.
 */
export function buildFigureGeometry(detail: 0 | 1 | 2): BufferGeometry {
    const parts: FigurePart[] = [];
    const scaleM = (sx: number, sy: number, sz: number, y: number, z = 0) =>
        new Matrix4().compose(
            new Vector3(0, y, z),
            new Quaternion(),
            new Vector3(sx, sy, sz),
        );
    if (detail === 0) {
        parts.push(box(0.36, 0.44, 0.22, 0, 0.36, 0, PART_SHIRT));
        parts.push(box(0.3, 0.13, 0.42, 0, 0.065, 0.2, PART_PANTS));
        parts.push({
            geometry: new SphereGeometry(0.105, 4, 2),
            matrix: scaleM(0.9, 1.1, 1, 0.74),
            part: PART_SKIN,
            head: true,
        });
    } else if (detail === 1) {
        parts.push({
            geometry: new CylinderGeometry(0.19, 0.16, 0.44, 6),
            matrix: scaleM(1, 1, 0.64, 0.36),
            part: PART_SHIRT,
        });
        parts.push(box(0.3, 0.13, 0.42, 0, 0.065, 0.2, PART_PANTS));
        parts.push(box(0.28, 0.38, 0.11, 0, -0.14, 0.42, PART_PANTS));
        parts.push({
            geometry: new SphereGeometry(0.105, 6, 3),
            matrix: scaleM(0.9, 1.1, 1, 0.75),
            part: PART_SKIN,
            head: true,
        });
    } else {
        parts.push({
            geometry: new CylinderGeometry(0.185, 0.155, 0.44, 8),
            matrix: scaleM(1, 1, 0.62, 0.36),
            part: PART_SHIRT,
        });
        parts.push(box(0.3, 0.13, 0.42, 0, 0.065, 0.2, PART_PANTS));
        parts.push(box(0.12, 0.38, 0.11, -0.08, -0.14, 0.42, PART_PANTS));
        parts.push(box(0.12, 0.38, 0.11, 0.08, -0.14, 0.42, PART_PANTS));
        // Arms hang from the shoulders and angle forward to the lap.
        for (const side of [-1, 1])
            parts.push(
                box(
                    0.075,
                    0.34,
                    0.085,
                    side * 0.225,
                    0.4,
                    0.085,
                    PART_SHIRT,
                    -0.5,
                ),
            );
        parts.push({
            geometry: new SphereGeometry(0.108, 8, 6),
            matrix: scaleM(0.88, 1.08, 0.98, 0.76),
            part: PART_SKIN,
            head: true,
        });
    }

    const pos: number[] = [];
    const nor: number[] = [];
    const col: number[] = [];
    const part: number[] = [];
    const skin = new Color(0xb98462); // the shader scales it per person
    const white = new Color(0xffffff);
    const n = new Vector3();
    for (const p of parts) {
        const g = p.geometry.toNonIndexed();
        const rawNormals = g.getAttribute("normal");
        // Head: decide hair from the unscaled sphere normals.
        const hair: boolean[] = [];
        if (p.head) {
            for (let i = 0; i < rawNormals.count; i++) {
                n.fromBufferAttribute(rawNormals, i);
                hair.push(n.y > 0.2 || (n.z < -0.15 && n.y > -0.55));
            }
        }
        g.applyMatrix4(p.matrix);
        const gp = g.getAttribute("position");
        const gn = g.getAttribute("normal");
        for (let i = 0; i < gp.count; i++) {
            pos.push(gp.getX(i), gp.getY(i), gp.getZ(i));
            nor.push(gn.getX(i), gn.getY(i), gn.getZ(i));
            const kind = p.head && hair[i] ? PART_HAIR : p.part;
            const c = kind === PART_SKIN ? skin : white;
            col.push(c.r, c.g, c.b);
            part.push(kind);
        }
        g.dispose();
        p.geometry.dispose();
    }
    const out = new BufferGeometry();
    out.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
    out.setAttribute("normal", new BufferAttribute(new Float32Array(nor), 3));
    out.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
    out.setAttribute("aPart", new BufferAttribute(new Float32Array(part), 1));
    out.computeBoundingSphere();
    return out;
}

/** Picks figure detail from the head count so big domes stay light. */
export function autoDetail(count: number, quality: "low" | "high"): 0 | 1 | 2 {
    const d = count <= 3500 ? 2 : count <= 12000 ? 1 : 0;
    return quality === "low" ? (Math.min(d, 1) as 0 | 1) : d;
}

/**
 * The crowd's material: shirts take the instance color, skin, hair and pants
 * come from per-person values (`aVar`), all in the vertex shader.
 */
function crowdMaterial(): MeshStandardMaterial {
    const material = new MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.85,
        vertexColors: true,
    });
    material.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader
            .replace(
                "#include <common>",
                "#include <common>\nattribute float aPart;\nattribute vec3 aVar;",
            )
            .replace(
                "#include <color_vertex>",
                `#include <color_vertex>
{
    vec3 b = color.rgb;
    vec3 c = b;
    if (aPart < 0.5) {
        c = b * instanceColor * (0.82 + 0.3 * fract(aVar.y * 7.3 + aVar.z * 3.1));
    } else if (aPart < 1.5) {
        c = b * mix(vec3(1.3, 1.22, 1.15), vec3(0.42, 0.3, 0.25), aVar.x);
    } else if (aPart < 2.5) {
        float t = aVar.y;
        c = t < 0.4 ? vec3(0.012, 0.01, 0.009)
          : t < 0.7 ? vec3(0.03, 0.018, 0.01)
          : t < 0.88 ? vec3(0.09, 0.05, 0.02)
          : t < 0.96 ? vec3(0.35, 0.22, 0.08)
          : vec3(0.42);
    } else {
        float t = aVar.z;
        c = t < 0.45 ? vec3(0.02, 0.04, 0.12)
          : t < 0.75 ? vec3(0.012)
          : t < 0.9 ? vec3(0.2, 0.15, 0.07)
          : vec3(0.08);
    }
    vColor.rgb = c;
}`,
            );
    };
    return material;
}

/**
 * Builds the whole crowd as one `InstancedMesh` (one draw call). People sit
 * on each seat row's polyline (whose points are at seat height), spaced 0.64
 * m apart, with an aisle every 18 people and a random subset skipped to
 * reach `density`. Shirt colors come from the row's `side`; skin tone, hair
 * and trousers vary per person; everyone faces the middle of the venue.
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

    // Everyone looks toward the middle of all the rows (the field).
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const row of seatRows)
        for (const [x, , z] of row.points) {
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minZ = Math.min(minZ, z);
            maxZ = Math.max(maxZ, z);
        }
    const midX = (minX + maxX) / 2;
    const midZ = (minZ + maxZ) / 2;

    interface Placed {
        x: number;
        y: number;
        z: number;
        yaw: number;
        height: number;
        width: number;
        color: number;
    }
    const placed: Placed[] = [];
    for (const row of seatRows) {
        const colors = palette[row.side].length
            ? palette[row.side]
            : palette.neutral;
        const samples = sampleRow(row.points, row.closed, PERSON_SPACING);
        samples.forEach(({ position, tangent }, j) => {
            if (j % (aisleEvery + aisleWidth) >= aisleEvery) return;
            if (rnd() >= density) return;
            // Face along the row's normal that points toward the middle.
            let fx = -tangent.z;
            let fz = tangent.x;
            if (fx * (midX - position.x) + fz * (midZ - position.z) < 0) {
                fx = -fx;
                fz = -fz;
            }
            placed.push({
                x: position.x,
                y: position.y,
                z: position.z,
                yaw: Math.atan2(fx, fz) + (rnd() - 0.5) * 0.5,
                height: 0.93 + rnd() * 0.14,
                width: 0.92 + rnd() * 0.16,
                color: colors[Math.floor(rnd() * colors.length)],
            });
        });
    }

    const detail = options.detail ?? autoDetail(placed.length, quality);
    const geometry = buildFigureGeometry(detail);
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
    mesh.userData.detail = detail;

    const vary = new Float32Array(Math.max(1, placed.length) * 3);
    const m = new Matrix4();
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    const color = new Color();
    const pos = new Vector3();
    const scale = new Vector3();
    placed.forEach((p, i) => {
        q.setFromAxisAngle(up, p.yaw);
        pos.set(p.x, p.y, p.z);
        scale.set(p.width, p.height, p.width);
        m.compose(pos, q, scale);
        mesh.setMatrixAt(i, m);
        // Shirt: exactly the palette color (the shader varies its brightness).
        mesh.setColorAt(i, color.setHex(p.color));
        vary[i * 3] = rnd();
        vary[i * 3 + 1] = rnd();
        vary[i * 3 + 2] = rnd();
    });
    if (!mesh.instanceColor) mesh.setColorAt(0, color.setHex(0xffffff));
    geometry.setAttribute("aVar", new InstancedBufferAttribute(vary, 3));
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
