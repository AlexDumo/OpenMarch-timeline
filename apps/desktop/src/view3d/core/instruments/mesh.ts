/**
 * Mesh primitives for the 3D View's instruments (docs/3d/instruments.md
 * §4): small flat-shaded pieces, built from numbers. A piece is a triangle
 * list with one uniform-shader part id. Pure: no three.js.
 *
 * Frames: whatever the caller uses; the instrument models use the
 * instrument frame (origin at the right-hand grip, +Z toward the bell,
 * +Y up with the valve caps).
 */

export type Vec3 = [number, number, number];
/** Column-major 4x4, as three.js stores it. */
export type Mat4 = number[];

export interface Piece {
    part: number;
    positions: number[];
    normals: number[];
    indices: number[];
}

/** Uniform shader part ids for instruments (instrumentPaint.ts paints them). */
export const PART_METAL = 16;
export const PART_CHROME = 18;
export const PART_BLACK = 22;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: Vec3): Vec3 => {
    const l = len(a) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
};
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** Appends a flat triangle (own vertices, face normal) to a piece. */
function face(p: Piece, a: Vec3, b: Vec3, c: Vec3): void {
    const n = norm(cross(sub(b, a), sub(c, a)));
    const first = p.positions.length / 3;
    for (const v of [a, b, c]) {
        p.positions.push(v[0], v[1], v[2]);
        p.normals.push(n[0], n[1], n[2]);
    }
    p.indices.push(first, first + 1, first + 2);
}

function quad(p: Piece, a: Vec3, b: Vec3, c: Vec3, d: Vec3): void {
    face(p, a, b, c);
    face(p, a, c, d);
}

/** A ring of `segments` points of `radius` around `center` in the plane of unit vectors `u`, `v`. */
function ring(
    center: Vec3,
    u: Vec3,
    v: Vec3,
    radius: number,
    segments: number,
): Vec3[] {
    const out: Vec3[] = [];
    for (let i = 0; i < segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        out.push(
            add(
                center,
                add(
                    scale(u, Math.cos(a) * radius),
                    scale(v, Math.sin(a) * radius),
                ),
            ),
        );
    }
    return out;
}

/** Joins two rings of equal length with outward-facing quads. */
function strip(p: Piece, r0: Vec3[], r1: Vec3[]): void {
    const n = r0.length;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        quad(p, r0[i], r1[i], r1[j], r0[j]);
    }
}

/** A fan closing a ring at `center`; `flip` winds it the other way. */
function cap(p: Piece, r: Vec3[], center: Vec3, flip: boolean): void {
    const n = r.length;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        if (flip) face(p, center, r[j], r[i]);
        else face(p, center, r[i], r[j]);
    }
}

/**
 * Revolves `profile` (radius, height) pairs about +Y. A zero radius at
 * either end becomes a point; otherwise that end is closed with a flat cap.
 */
export function lathe(
    profile: [number, number][],
    segments: number,
    part: number,
): Piece {
    const p: Piece = { part, positions: [], normals: [], indices: [] };
    const u: Vec3 = [1, 0, 0];
    const v: Vec3 = [0, 0, -1]; // u × v = +Y: outward winding
    const rings = profile.map(([r, y]) => ring([0, y, 0], u, v, r, segments));
    for (let k = 0; k + 1 < profile.length; k++) {
        const [ra, ya] = profile[k];
        const [rb, yb] = profile[k + 1];
        if (ra === 0 && rb === 0) continue;
        if (ra === 0) cap(p, rings[k + 1], [0, ya, 0], yb > ya);
        else if (rb === 0) cap(p, rings[k], [0, yb, 0], yb < ya);
        else strip(p, rings[k], rings[k + 1]);
    }
    const [r0, y0] = profile[0];
    const [rn, yn] = profile[profile.length - 1];
    if (r0 > 0) cap(p, rings[0], [0, y0, 0], yn > y0);
    if (rn > 0) cap(p, rings[rings.length - 1], [0, yn, 0], yn < y0);
    return p;
}

/**
 * Sweeps a circle of `radius` along `path` with parallel-transport frames,
 * so a bend doesn't twist the tube, and caps both ends.
 */
export function tube(
    path: Vec3[],
    radius: number,
    segments: number,
    part: number,
): Piece {
    const p: Piece = { part, positions: [], normals: [], indices: [] };
    if (path.length < 2) return p;
    // tangent at each point: average of the neighboring segment directions
    const tangents: Vec3[] = path.map((_, i) => {
        const prev = i > 0 ? norm(sub(path[i], path[i - 1])) : null;
        const next =
            i + 1 < path.length ? norm(sub(path[i + 1], path[i])) : null;
        return norm(prev && next ? add(prev, next) : (prev ?? next)!);
    });
    // first frame: any unit vector not parallel to the tangent
    let u = norm(
        cross(
            tangents[0],
            Math.abs(tangents[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0],
        ),
    );
    const rings: Vec3[][] = [];
    for (let i = 0; i < path.length; i++) {
        if (i > 0) {
            // transport u: remove its component along the new tangent
            u = norm(sub(u, scale(tangents[i], dot(u, tangents[i]))));
        }
        const v = cross(tangents[i], u);
        // widen the ring at a corner so the tube keeps its radius through the bend
        const widen =
            i > 0 && i + 1 < path.length
                ? 1 /
                  Math.max(
                      0.5,
                      dot(tangents[i], norm(sub(path[i + 1], path[i]))),
                  )
                : 1;
        rings.push(ring(path[i], u, v, radius * widen, segments));
    }
    for (let i = 0; i + 1 < rings.length; i++) strip(p, rings[i], rings[i + 1]);
    cap(p, rings[0], path[0], true);
    cap(p, rings[rings.length - 1], path[path.length - 1], false);
    return p;
}

export function cylinder(
    radius: number,
    from: Vec3,
    to: Vec3,
    segments: number,
    part: number,
): Piece {
    return tube([from, to], radius, segments, part);
}

export function transformPiece(p: Piece, m: Mat4): Piece {
    const out: Piece = {
        part: p.part,
        positions: [],
        normals: [],
        indices: [...p.indices],
    };
    for (let i = 0; i < p.positions.length; i += 3) {
        const [x, y, z] = [
            p.positions[i],
            p.positions[i + 1],
            p.positions[i + 2],
        ];
        out.positions.push(
            m[0] * x + m[4] * y + m[8] * z + m[12],
            m[1] * x + m[5] * y + m[9] * z + m[13],
            m[2] * x + m[6] * y + m[10] * z + m[14],
        );
        const [nx, ny, nz] = [p.normals[i], p.normals[i + 1], p.normals[i + 2]];
        const n = norm([
            m[0] * nx + m[4] * ny + m[8] * nz,
            m[1] * nx + m[5] * ny + m[9] * nz,
            m[2] * nx + m[6] * ny + m[10] * nz,
        ]);
        out.normals.push(n[0], n[1], n[2]);
    }
    return out;
}

export function translateY(p: Piece, dy: number): Piece {
    return transformPiece(p, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, dy, 0, 1]);
}

export function triangleCount(pieces: Piece[]): number {
    return pieces.reduce((n, p) => n + p.indices.length / 3, 0);
}

export function bounds(pieces: Piece[]): { min: Vec3; max: Vec3 } {
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const p of pieces)
        for (let i = 0; i < p.positions.length; i += 3)
            for (let k = 0; k < 3; k++) {
                min[k] = Math.min(min[k], p.positions[i + k]);
                max[k] = Math.max(max[k], p.positions[i + k]);
            }
    return { min, max };
}
