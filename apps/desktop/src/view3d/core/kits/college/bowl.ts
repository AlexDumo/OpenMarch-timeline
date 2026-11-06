/**
 * The college stadium's plan and cross-section (meters). Pure math, no three.js
 * objects, so it is easy to test.
 *
 * The seating is one continuous horseshoe: a rounded rectangle around the
 * field that is open at the -x end (the scoreboard end). Every seat row is the
 * same curve pushed outward, so the whole bowl is described by
 *
 * - a plan path (`sampleBowlPath`): stations along the wall curve, each with
 *   an outward normal, and
 * - a cross-section (`profileAt`): a staircase of (offset, height) nodes that
 *   is swept along the path. Its shape changes smoothly with `suiteWeight`, so
 *   the home straight grows a suite level and a wider rim without any seams.
 */

/** What a stretch of the profile is made of (picks the material). */
export type SegKind =
    | "wall"
    | "concrete"
    | "seat"
    | "glass"
    | "fascia"
    | "facade";

export interface ProfileNode {
    /** Meters outward from the wall curve. */
    off: number;
    /** Height above the ground. */
    h: number;
    /** What the segment from this node to the next is made of. */
    seg: SegKind;
}

export const WALL_H = 1.4;
export const LOWER = { rows: 22, depth: 0.82, rise: 0.42, h0: 1.8, off0: 0.5 };
export const UPPER = { rows: 18, depth: 0.8, rise: 0.55 };
/** Share of a tread's depth that is bare concrete in front of the seat. */
export const SEAT_START = 0.4;
/** Concourse walkway between the tiers. */
export const CONCOURSE = 3;
/** Extra height the suite level adds on the home straight. */
export const SUITE_H = 8;
/** The ribbon-board fascia under the upper deck. */
export const FASCIA_H = 2.2;
/** The rim walkway behind the last row, and the extra the press box needs. */
export const RIM_BASE = 2;
export const RIM_HOME = 7;

export interface SeatRef {
    tier: 0 | 1;
    row: number;
    /** Node index where the seat segment starts. */
    node: number;
    /** Depth of the whole tread, for `SeatRow.depth`. */
    depth: number;
}

export interface Profile {
    nodes: ProfileNode[];
    /** Where each row's seat segment starts (the segment runs to node + 1). */
    seats: SeatRef[];
    /** Height of the concourse floor (top of the lower bowl). */
    concourseH: number;
    /** Offset of the plane the suite glass and fascia sit on. */
    frontOff: number;
    /** Offset of the last upper row's back edge, and the top height there. */
    rimOff: number;
    rimH: number;
    /** Height of the fascia's top edge. */
    upperBase: number;
}

/**
 * The cross-section at a station. `w` is the suite weight (0 at the ends and
 * the away side, 1 on the home straight).
 */
export function profileAt(w: number): Profile {
    const nodes: ProfileNode[] = [];
    const seats: SeatRef[] = [];
    const push = (off: number, h: number, seg: SegKind) =>
        nodes.push({ off, h, seg });

    push(0, 0, "wall");
    push(0, WALL_H, "concrete");
    let h = WALL_H;
    // Lower bowl. Each row: a riser up, bare tread, then the seat.
    for (let i = 0; i < LOWER.rows; i++) {
        const front = LOWER.off0 + i * LOWER.depth;
        const top = LOWER.h0 + i * LOWER.rise;
        // `h` is where the previous row ended; the node there already exists
        // for i > 0 as the previous seat's end, so only i = 0 pushes a ledge.
        if (i === 0) push(front, h, "concrete");
        push(front, top, "concrete");
        push(front + LOWER.depth * SEAT_START, top, "seat");
        seats.push({
            tier: 0,
            row: i,
            node: nodes.length - 1,
            depth: LOWER.depth,
        });
        push(front + LOWER.depth, top, "concrete");
        h = top;
    }
    const concourseH = h;
    const lowerEnd = LOWER.off0 + LOWER.rows * LOWER.depth;
    const frontOff = lowerEnd + CONCOURSE;
    // The last node is (lowerEnd, concourseH) with seg "concrete": the landing.
    push(frontOff, concourseH, "glass");
    const suiteTop = concourseH + SUITE_H * w;
    push(frontOff, suiteTop, "fascia");
    const upperBase = suiteTop + FASCIA_H;
    push(frontOff, upperBase, "concrete");
    for (let j = 0; j < UPPER.rows; j++) {
        const front = frontOff + j * UPPER.depth;
        const top = upperBase + (j + 1) * UPPER.rise;
        // Row 0 rises from the fascia top; later rows rise from the previous
        // row's back edge, which is already the last node (same offset).
        push(front, top, "concrete");
        push(front + UPPER.depth * SEAT_START, top, "seat");
        seats.push({
            tier: 1,
            row: j,
            node: nodes.length - 1,
            depth: UPPER.depth,
        });
        push(front + UPPER.depth, top, "concrete");
    }
    const rimH = upperBase + UPPER.rows * UPPER.rise;
    const upperEnd = frontOff + UPPER.rows * UPPER.depth;
    const rimOff = upperEnd + RIM_BASE + RIM_HOME * w;
    push(rimOff, rimH, "facade");
    push(rimOff, 0, "facade");
    return { nodes, seats, concourseH, frontOff, rimOff, rimH, upperBase };
}

/** Hermite smoothstep. */
export function smoothstep(a: number, b: number, x: number): number {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
}

export interface Station {
    /** Point on the wall curve, in world meters. */
    x: number;
    z: number;
    /** Outward unit normal. */
    nx: number;
    nz: number;
    /** Suite weight, 0..1. */
    w: number;
    side: "home" | "away" | "end";
}

export interface BowlPlan {
    /** Field center. */
    cx: number;
    cz: number;
    /** Half sizes of the wall rectangle (x, z) and its corner radius. */
    halfX: number;
    halfZ: number;
    radius: number;
    /** The open end: the straights stop this far from the center on -x. */
    openX: number;
}

/** The plan for a field footprint. */
export function bowlPlanFor(fp: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
}): BowlPlan {
    const cx = (fp.minX + fp.maxX) / 2;
    const cz = (fp.minZ + fp.maxZ) / 2;
    const halfW = (fp.maxX - fp.minX) / 2;
    const halfD = (fp.maxZ - fp.minZ) / 2;
    // 10 m behind each end line, 11 m behind each sideline (team areas).
    const halfX = halfW + 10;
    const halfZ = halfD + 11;
    return {
        cx,
        cz,
        halfX,
        halfZ,
        radius: Math.min(22, halfZ - 2),
        openX: halfW + 12,
    };
}

function classify(nz: number): Station["side"] {
    return nz > 0.6 ? "home" : nz < -0.6 ? "away" : "end";
}

/**
 * Stations along the horseshoe, from the open end of the home straight, round
 * the +x end, to the open end of the away straight. `step` is the straight
 * spacing in meters; arcs use `arcSegments` per quarter turn.
 */
export function sampleBowlPath(
    plan: BowlPlan,
    step: number,
    arcSegments: number,
): Station[] {
    const { cx, cz, halfX, halfZ, radius: r, openX } = plan;
    const out: Station[] = [];
    const add = (x: number, z: number, nx: number, nz: number) => {
        out.push({
            x,
            z,
            nx,
            nz,
            w: smoothstep(0.55, 0.98, nz),
            side: classify(nz),
        });
    };
    const straight = (
        x0: number,
        z0: number,
        x1: number,
        z1: number,
        nx: number,
        nz: number,
        includeEnd: boolean,
    ) => {
        const len = Math.hypot(x1 - x0, z1 - z0);
        const n = Math.max(1, Math.ceil(len / step));
        for (let i = 0; i < (includeEnd ? n + 1 : n); i++) {
            const t = i / n;
            add(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, nx, nz);
        }
    };
    const arc = (
        ccx: number,
        ccz: number,
        a0: number,
        a1: number,
        includeEnd: boolean,
    ) => {
        for (let i = 0; i < (includeEnd ? arcSegments + 1 : arcSegments); i++) {
            const a = a0 + ((a1 - a0) * i) / arcSegments;
            add(
                ccx + r * Math.cos(a),
                ccz + r * Math.sin(a),
                Math.cos(a),
                Math.sin(a),
            );
        }
    };
    const xs = cx + halfX - r;
    const zs = halfZ - r;
    // home straight (+z side), heading +x
    straight(cx - openX, cz + halfZ, xs, cz + halfZ, 0, 1, false);
    arc(xs, cz + zs, Math.PI / 2, 0, false);
    // the +x end, heading -z
    straight(cx + halfX, cz + zs, cx + halfX, cz - zs, 1, 0, false);
    arc(xs, cz - zs, 0, -Math.PI / 2, false);
    // away straight (-z side), heading -x
    straight(xs, cz - halfZ, cx - openX, cz - halfZ, 0, -1, true);
    return out;
}

/** Outward direction of travel at a station (the tangent). */
export function tangentOf(s: Station): [number, number] {
    return [s.nz, -s.nx];
}
