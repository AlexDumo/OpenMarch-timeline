/**
 * Go round an outline, pathways step 10 (spec Appendix L.11, R-13‴, procedures AP-T13 to AP-T15):
 * the selected marchers stand on a closed outline (a circle or a box outline) at the start flag;
 * each follows the one ahead round it, the same distance, and where they stop at the end flag
 * becomes the next page's spots, in one undo step.
 *
 * - `fitOutline`: the closed outline the marchers stand on, as the circle or box it is, stored
 *   clockwise on the field from its top (DO-2).
 * - `planGoRound`: the way round, each member's end round it and its spot, how many times round
 *   (DO-3 to DO-6). Pure: the drawing and the write both use it, on the resolver's own geometry
 *   (`makeLoop`, `loopPoint`), so the drawing is where the marchers will be.
 * - `goRoundInTransaction`: the write (AP-T13), replacing the line's own move round the same
 *   outline over the window when there is one ("again").
 * - `reverseAroundInTransaction`: Reverse on a stored move round an outline (AP-T14): the other
 *   way round, the same distance.
 */
import { and, eq, gt, inArray, lt } from "drizzle-orm";
import {
    arcPoint,
    aroundEnds,
    aroundPoint,
    createResolver,
    EPS_GEOM,
    loopPoint,
    loopSnap,
    makeLoop,
    MAX_LAPS,
    nearestOnLoop,
    type AroundEnds,
    type RouteGeometry,
    type RoutePath,
    type XY,
} from "@openmarch/core";
import { schema } from "@/global/database/db";
import { readTimelineTables } from "@/timeline/timelineRows";
import { text, type TimelineText } from "@/timeline/timelineText";
import { fitCircle } from "@/shapes/geometry/fit";
import type { DbConnection, DbTransaction } from "./types";
import { transactionWithHistory } from "./history";
import { refuse, TimelineWriteError } from "./timelineErrors";
import { firstLanedRow, markOutlineModelInTransaction } from "./timelineLanes";
import { marcherName } from "./timelineRoutes";
import { moveMarchersInRangeInTransaction } from "./timelineMoves";
import { readPageGrid } from "./timelinePageGrid";
import { addPageFlagInTransaction } from "./pageFlags";
import { writeRouteGeometryInTransaction } from "./timelineRouteGeometry";
import {
    followTrailInTransaction,
    readTrails,
    removeTrailInTransaction,
    trailRefusal,
    type FollowTrailResult,
    type MoveTrail,
} from "./timelineTrails";
import {
    trailDragRefusal,
    windowMoveOf,
    type TrailWindow,
} from "./timelineTrailDrag";

/** The refusals' texts of step 10, translated where they are shown. */
export const goRoundRefusal = {
    /** AP-T13: the marchers don't stand on a circle or a box outline */
    notOutline: () => text.t("timeline.refusals.trail.notOutline"),
    /** AP-T13: a distance of nothing */
    noDistance: () => text.t("timeline.refusals.trail.noDistance"),
    /** AP-T13: more times round than a move may go */
    tooFar: (laps: number) =>
        text.t("timeline.refusals.trail.tooFar", { laps }),
    /** AP-T14: Reverse on a move round an outline that nobody starts */
    reverseNobody: () => text.t("timeline.refusals.trail.reverseNobody"),
};

// ---------------------------------------------------------------------------
// Pure: the outline
// ---------------------------------------------------------------------------

/** A closed outline the marchers stand on (DO-2), stored clockwise on the field */
export interface Outline {
    kind: "circle" | "box";
    /** A closed route (R-13‴): from its top (a circle) or its top corner (a box), clockwise */
    geometry: RouteGeometry;
    /** The outline as walked once round, clockwise */
    loop: RoutePath;
    /** The farthest any marcher stands from it */
    residual: number;
    /**
     * Whether the marchers stand all the way round it; false for a line standing on part of a
     * circle (an arc), which can go round the rest of it too (DO-2)
     */
    full: boolean;
}

const median = (xs: readonly number[]): number => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)] ?? 0;
};

/** Each start's distance to its nearest other start */
const nearestGaps = (starts: readonly XY[]): number[] =>
    starts.map((p, i) =>
        Math.min(
            ...starts.map((q, j) =>
                i === j ? Infinity : Math.hypot(p[0] - q[0], p[1] - q[1]),
            ),
        ),
    );

/** A quarter circle's bulge (R-14″, sagitta over chord): tan(π/8) / 2 */
export const QUARTER_BULGE = Math.tan(Math.PI / 8) / 2;

/** The circle about `center` of radius `r` as a closed route: four quarter arcs from its top, clockwise */
export function circleOutline(center: XY, r: number): RouteGeometry {
    const at = (a: number): XY => [
        center[0] + r * Math.cos(a),
        center[1] + r * Math.sin(a),
    ];
    const top = at(-Math.PI / 2);
    const right = at(0);
    // The bulge's sign that bows the arc out, away from the centre
    const mid = arcPoint(top, right, QUARTER_BULGE, 0.5);
    const k =
        Math.hypot(mid[0] - center[0], mid[1] - center[1]) > r * 0.99
            ? QUARTER_BULGE
            : -QUARTER_BULGE;
    return {
        v: 1,
        closed: true,
        from: top,
        to: top,
        points: [
            { id: "p1", at: right, bulge: k },
            { id: "p2", at: at(Math.PI / 2), bulge: k },
            { id: "p3", at: at(Math.PI), bulge: k },
        ],
        toBulge: k,
    };
}

/** A box through `corners` (any order round it) as a closed route: from its top corner, clockwise */
export function boxOutline(corners: readonly XY[]): RouteGeometry {
    // Clockwise on the field (y down) is a positive shoelace sum
    let area = 0;
    corners.forEach((p, i) => {
        const q = corners[(i + 1) % corners.length]!;
        area += p[0] * q[1] - q[0] * p[1];
    });
    const round = area < 0 ? [...corners].reverse() : [...corners];
    let first = 0;
    round.forEach((p, i) => {
        const f = round[first]!;
        if (
            p[1] < f[1] - 1e-9 ||
            (Math.abs(p[1] - f[1]) <= 1e-9 && p[0] < f[0])
        )
            first = i;
    });
    const from = round[first]!;
    const rest = [1, 2, 3].map((k) => round[(first + k) % 4]!);
    return {
        v: 1,
        closed: true,
        from,
        to: from,
        points: rest.map((at, i) => ({ id: `p${i + 1}`, at })),
    };
}

/**
 * A closed outline turned round (AP-T14): the same points walked the other way. The point that
 * was arrived at by leg `j + 1` now leaves by it, so each bulge moves one point along and flips.
 */
export function reverseOutline(geometry: RouteGeometry): RouteGeometry {
    const n = geometry.points.length;
    // b[j] is the bulge of the leg arriving at vertex j (vertex 0 is `from`, its leg the closing one)
    const bulgeInto = (j: number): number | undefined =>
        j === 0 ? geometry.toBulge : geometry.points[j - 1]!.bulge;
    // Walked back, vertex j (j = n … 1) is arrived at by the leg that left it, j + 1's, turned round
    const points = Array.from({ length: n }, (_, i) => {
        const j = n - i;
        const p = geometry.points[j - 1]!;
        const k = bulgeInto((j + 1) % (n + 1));
        return { id: p.id, at: p.at, ...(k ? { bulge: -k } : {}) };
    });
    const closing = bulgeInto(1);
    return {
        v: 1,
        closed: true,
        from: geometry.from,
        to: geometry.to,
        points,
        ...(closing ? { toBulge: -closing } : {}),
    };
}

/** The convex hull of `pts`, counterclockwise in maths terms (monotone chain) */
function hull(pts: readonly XY[]): XY[] {
    const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (p.length < 3) return p;
    const cross = (o: XY, a: XY, b: XY) =>
        (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower: XY[] = [];
    for (const q of p) {
        while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, q) <= 0)
            lower.pop();
        lower.push(q);
    }
    const upper: XY[] = [];
    for (const q of [...p].reverse()) {
        while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, q) <= 0)
            upper.pop();
        upper.push(q);
    }
    return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** The smallest box round `pts`, square to one of its hull's edges (rotating calipers), as its four corners */
function smallestBox(pts: readonly XY[]): XY[] | null {
    const h = hull(pts);
    if (h.length < 3) return null;
    let best: { area: number; corners: XY[] } | null = null;
    for (let i = 0; i < h.length; i++) {
        const a = h[i]!;
        const b = h[(i + 1) % h.length]!;
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (!(len > EPS_GEOM)) continue;
        const ux = (b[0] - a[0]) / len;
        const uy = (b[1] - a[1]) / len;
        let lo = Infinity;
        let hi = -Infinity;
        let lo2 = Infinity;
        let hi2 = -Infinity;
        for (const p of pts) {
            const s = p[0] * ux + p[1] * uy;
            const t = -p[0] * uy + p[1] * ux;
            lo = Math.min(lo, s);
            hi = Math.max(hi, s);
            lo2 = Math.min(lo2, t);
            hi2 = Math.max(hi2, t);
        }
        const area = (hi - lo) * (hi2 - lo2);
        if (!best || area < best.area - 1e-9) {
            const at = (s: number, t: number): XY => [
                s * ux - t * uy,
                s * uy + t * ux,
            ];
            best = {
                area,
                corners: [at(lo, lo2), at(hi, lo2), at(hi, hi2), at(lo, hi2)],
            };
        }
    }
    return best?.corners ?? null;
}

/**
 * Whether the starts go all the way round `loop`, a closed outline: no stretch between neighbors
 * round it is more than 2.5 times the usual one, so an arc, three sides of a box or two ranks far
 * apart are not outlines
 */
function allRound(loop: RoutePath, starts: readonly XY[]): boolean {
    const d = starts.map((p) => nearestOnLoop(loop, p)).sort((a, b) => a - b);
    const gaps = d.map((x, i) =>
        i + 1 < d.length ? d[i + 1]! - x : d[0]! + loop.L - x,
    );
    return Math.max(...gaps) <= 2.5 * median(gaps);
}

/**
 * How far a marcher may stand from the outline it's fitted to (DO-2): a quarter of the usual
 * spacing, and never more than half a step, so an oval, a hexagon or an octagon isn't taken for
 * a circle
 */
export const fitTolerance = (usual: number, step: number): number =>
    Math.min(usual / 4, step / 2);

/**
 * The box outline round `starts` (`fitOutline`'s second candidate): the smallest box square to a
 * hull edge, every start within `tol` of its sides, two or more on each side, all the way round.
 * `cornered` says whether a start stands on one of its corners. Null when it doesn't fit.
 */
function boxCandidate(
    starts: readonly XY[],
    tol: number,
): (Outline & { cornered: boolean }) | null {
    const corners = smallestBox(starts);
    if (!corners) return null;
    const sides = corners.map((a, i) => [a, corners[(i + 1) % 4]!] as const);
    const toSide = (p: XY, [a, b]: readonly [XY, XY]) => {
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const l2 = dx * dx + dy * dy;
        const f =
            l2 > 0
                ? Math.max(
                      0,
                      Math.min(
                          1,
                          ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2,
                      ),
                  )
                : 0;
        return Math.hypot(a[0] + dx * f - p[0], a[1] + dy * f - p[1]);
    };
    const near = starts.map((p) => sides.map((s) => toSide(p, s)));
    const residual = Math.max(...near.map((ds) => Math.min(...ds)));
    const onEach = sides.every(
        (_, k) => near.filter((ds) => ds[k]! <= tol).length >= 2,
    );
    const wide = sides.every(
        ([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]) > tol,
    );
    if (!(residual <= tol && onEach && wide)) return null;
    const geometry = boxOutline(corners);
    const loop = makeLoop(geometry);
    if (!loop || !allRound(loop, starts)) return null;
    const cornered = corners.some((k) =>
        starts.some((p) => Math.hypot(p[0] - k[0], p[1] - k[1]) <= tol),
    );
    return { kind: "box", geometry, loop, residual, cornered, full: true };
}

/** Whether every start lies within `tol` of one straight line (their principal axis) */
function onALine(starts: readonly XY[], tol: number): boolean {
    const n = starts.length;
    const cx = starts.reduce((a, p) => a + p[0], 0) / n;
    const cy = starts.reduce((a, p) => a + p[1], 0) / n;
    let sxx = 0;
    let sxy = 0;
    let syy = 0;
    for (const [x, y] of starts) {
        sxx += (x - cx) ** 2;
        sxy += (x - cx) * (y - cy);
        syy += (y - cy) ** 2;
    }
    const a = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    return starts.every(
        ([x, y]) => Math.abs(-(x - cx) * uy + (y - cy) * ux) <= tol,
    );
}

/**
 * The closed outline a line can go round (DO-2): {@link fitOutline}'s, or else the circle a line
 * of three or more stands on part of (an arc, not a straight line), every one within the fit's
 * tolerance of it; `full` says which. Null when there's neither.
 */
export function outlineOf(starts: readonly XY[], step: number): Outline | null {
    const whole = fitOutline(starts, step);
    if (whole || starts.length < 3) return whole;
    const usual = median(nearestGaps(starts));
    if (!(usual > EPS_GEOM)) return null;
    const tol = fitTolerance(usual, step);
    if (onALine(starts, tol)) return null;
    const circle = circleCandidate(starts, usual, tol);
    return circle ? { ...circle, full: false } : null;
}

/** The circle through `starts` (the Arc kind's fit), every one within `tol` of it; null otherwise */
function circleCandidate(
    starts: readonly XY[],
    usual: number,
    tol: number,
): Outline | null {
    const circle = fitCircle(starts.map(([x, y]) => ({ x, y })));
    if (!circle || !(circle.r > usual / 2)) return null;
    const c: XY = [circle.center.x, circle.center.y];
    const residual = Math.max(
        ...starts.map((p) =>
            Math.abs(Math.hypot(p[0] - c[0], p[1] - c[1]) - circle.r),
        ),
    );
    if (residual > tol) return null;
    const geometry = circleOutline(c, circle.r);
    const loop = makeLoop(geometry);
    return loop
        ? { kind: "circle", geometry, loop, residual, full: true }
        : null;
}

/**
 * The closed outline the marchers stand on at the start flag (DO-2), fitted as the shape tools
 * draw it: a **circle** (the Arc kind's circle fit) or a **box outline** (the smallest box round
 * them, square to one of their hull's edges, at least two on each side, corners counting for
 * both). Four marchers or more, every one within {@link fitTolerance} of it, all the way round
 * (`allRound`). When both fit, the circle, unless the box is clearly closer (by more than a
 * quarter of the tolerance) or a marcher stands on one of its corners: eight round a circle also
 * stand on a square's sides, and four on a square's corners walk its sides. Null when neither fits.
 */
export function fitOutline(
    starts: readonly XY[],
    step: number,
): Outline | null {
    if (starts.length < 4) return null;
    const usual = median(nearestGaps(starts));
    if (!(usual > EPS_GEOM)) return null;
    const tol = fitTolerance(usual, step);
    const found = circleCandidate(starts, usual, tol);
    const circle = found && allRound(found.loop, starts) ? found : null;
    const box = boxCandidate(starts, tol);
    const tie = tol / 4;
    if (
        box &&
        (!circle ||
            box.residual < circle.residual - tie ||
            (box.cornered && box.residual <= circle.residual + tie))
    ) {
        const { cornered: _cornered, ...outline } = box;
        return outline;
    }
    return circle;
}

// ---------------------------------------------------------------------------
// Pure: the plan (DO-3 to DO-6)
// ---------------------------------------------------------------------------

/** How far the line goes round (DO-4): a number of the outline's spots, or of steps */
export type RoundUnit = "spots" | "steps";

export interface GoRoundOptions {
    /** Walk the outline against the way it is stored (counterclockwise on the field) */
    reversed: boolean;
    /** Who leads (an index into the starts); the member with most room ahead when absent */
    leader?: number | null;
    amount: number;
    unit: RoundUnit;
    /** One step, in field units */
    step: number;
}

/** What going round does (AP-T13), worked out before anything is written */
export interface GoRoundPlan {
    /** The outline in walking order (the stored one, or turned round) */
    geometry: RouteGeometry;
    loop: RoutePath;
    /** The members as indexes into the starts, in walking order: the tail first, the leader last */
    line: number[];
    /** Each member's start, by line */
    starts: XY[];
    /** Each member's start round the outline, by line */
    startDist: number[];
    /** Each member's end round it, by line */
    ends: number[];
    /** The spots written, `loop(ends)`, by line */
    spots: XY[];
    /** Whole times round (R-13‴ `laps`) */
    laps: number;
    /** How far each goes round the outline, by line */
    distances: number[];
    /** How many times round (spots over the spot count, or steps over once round) */
    turns: number;
    /** The outline's spots, distances round it in walking order: the marchers' places and the gaps' */
    ring: number[];
    /** Each member's spot in `ring`, by line */
    memberSpot: number[];
    /** The usual gap between spots (the median), for N's default and changing the unit */
    spacing: number;
    /** The most spots or steps a move may go (no more than 100 times round, as Finish allows) */
    maxAmount: number;
    /** How many members stand off the outline (more than a twentieth of a step) and step onto it first */
    offOutline: number;
    /** R-13‴'s walk for each member, as the resolver will have it (for ▶ Preview and Big steps) */
    walk: AroundEnds;
}

/** The outline walked the way chosen */
export const walkingOutline = (outline: Outline, reversed: boolean) => {
    if (!reversed) return { geometry: outline.geometry, loop: outline.loop };
    const geometry = reverseOutline(outline.geometry);
    return { geometry, loop: makeLoop(geometry)! };
};

/**
 * The line round `loop` (indexes into `starts`), in walking order: sorted by where each stands
 * round it, then turned so `leader` is last; without one, the member with the most room ahead of
 * it leads (the first of those round from the outline's start, on a tie)
 */
export function lineRound(
    loop: RoutePath,
    starts: readonly XY[],
    leader?: number | null,
): number[] {
    const d = starts.map((p) => nearestOnLoop(loop, p));
    const sorted = starts
        .map((_, i) => i)
        .sort((a, b) => d[a]! - d[b]! || a - b);
    const m = sorted.length;
    let lead = leader == null ? -1 : sorted.indexOf(leader);
    if (lead < 0) {
        let room = -Infinity;
        sorted.forEach((i, k) => {
            const next = sorted[(k + 1) % m]!;
            const gap =
                k + 1 < m ? d[next]! - d[i]! : d[next]! + loop.L - d[i]!;
            if (gap > room + 1e-9) {
                room = gap;
                lead = k;
            }
        });
    }
    return [...sorted.slice(lead + 1), ...sorted.slice(0, lead + 1)];
}

/**
 * The outline's spots (DO-4), counted along it: every marcher's place, and a place in each gap
 * for every marcher missing there. A gap holds `round(gap / longer neighbor gap) − 1` missing
 * places, spread evenly in it, so uneven spacing (a box with long sides 2 apart and short ones 1
 * apart) has no false gaps. Distances round `L`, ascending; `memberSpot[i]` is `d[i]`'s place.
 */
export function outlineSpots(
    d: readonly number[],
    L: number,
): { ring: number[]; memberSpot: number[] } {
    const order = d.map((_, i) => i).sort((a, b) => d[a]! - d[b]! || a - b);
    const m = order.length;
    const gaps = order.map((i, k) => {
        const next = order[(k + 1) % m]!;
        return k + 1 < m ? d[next]! - d[i]! : d[next]! + L - d[i]!;
    });
    const ring: number[] = [];
    const memberSpot = d.map(() => 0);
    order.forEach((i, k) => {
        memberSpot[i] = ring.length;
        ring.push(d[i]!);
        const ref = Math.max(gaps[(k + m - 1) % m]!, gaps[(k + 1) % m]!);
        const missing =
            m > 2 && ref > EPS_GEOM
                ? Math.max(0, Math.round(gaps[k]! / ref) - 1)
                : 0;
        for (let h = 1; h <= missing; h++) {
            const x = d[i]! + (gaps[k]! * h) / (missing + 1);
            ring.push(x >= L ? x - L : x);
        }
    });
    // a place in the last gap that passed the seam belongs at the start
    const sorted = ring.map((x, j) => ({ x, j })).sort((a, b) => a.x - b.x);
    const at = new Map(sorted.map((e, k) => [e.j, k]));
    return {
        ring: sorted.map((e) => e.x),
        memberSpot: memberSpot.map((j) => at.get(j)!),
    };
}

/**
 * AP-T13's plan for marchers at `starts` on `outline`, walked the way chosen. **By spots** each
 * member moves on N of the outline's places (`outlineSpots`), so a line on its spots ends on spots
 * whatever the spacing, and nobody passes anyone. **By steps** each goes the same N steps round.
 * The spots are where they stop and `laps` the whole times round, as R-13‴ reads them back.
 */
export function planGoRound(
    starts: readonly XY[],
    outline: Outline,
    options: GoRoundOptions,
): GoRoundPlan {
    const { geometry, loop } = walkingOutline(outline, options.reversed);
    const L = loop.L;
    const snap = loopSnap(L);
    const line = lineRound(loop, starts, options.leader);
    const memberStarts = line.map((i) => starts[i]!);
    const startDist = memberStarts.map((p) => nearestOnLoop(loop, p));
    const { ring, memberSpot } = outlineSpots(startDist, L);
    const S = ring.length;
    const gaps = ring.map((x, k) =>
        k + 1 < S ? ring[k + 1]! - x : ring[0]! + L - x,
    );
    const spacing = median(gaps);
    const amount = Math.max(0, Math.round(options.amount));
    let laps: number;
    let ends: number[];
    if (options.unit === "spots") {
        laps = Math.floor(amount / S);
        ends = startDist.map((s, q) => {
            let a = ring[(memberSpot[q]! + amount) % S]! - s;
            if (a < 0) a += L;
            if (a > L - snap) a = 0;
            return s + a + laps * L;
        });
    } else {
        const D = amount * options.step;
        laps = Math.floor((D + snap) / L);
        ends = startDist.map((s) => s + D);
    }
    const spots = ends.map((e) => loopPoint(loop, e));
    const walk = aroundEnds(loop, memberStarts, spots, laps);
    const distances = walk.endDist.map(
        (e, q) =>
            walk.inStraight[q]! + e - walk.startDist[q]! + walk.straight[q]!,
    );
    return {
        geometry,
        loop,
        line,
        starts: memberStarts,
        startDist,
        ends,
        spots,
        laps,
        distances,
        turns:
            options.unit === "spots" ? amount / S : (amount * options.step) / L,
        ring,
        memberSpot,
        spacing,
        maxAmount:
            options.unit === "spots"
                ? (MAX_LAPS + 1) * S - 1
                : Math.max(
                      1,
                      Math.floor(((MAX_LAPS + 1) * L - snap) / options.step),
                  ),
        offOutline: walk.inStraight.filter((x) => x > options.step / 20).length,
        walk,
    };
}

/**
 * The spots a normal step a count reaches over `counts` (DO-4's default), at least one: each
 * marcher then takes about one step a count
 */
export function defaultSpots(
    spacing: number,
    counts: number,
    step: number,
): number {
    if (!(spacing > EPS_GEOM)) return 1;
    return Math.max(1, Math.round((counts * step) / spacing));
}

/**
 * Where each member of `plan` is at progress `p` of the move (0 to 1): R-13‴ itself (straight onto
 * the outline when it stands off it, round it, straight to its spot), as the resolver will have
 * the written move. For ▶ Preview.
 */
export function goRoundPreview(plan: GoRoundPlan, p: number): XY[] {
    const { walk, loop } = plan;
    return plan.starts.map((o, q) =>
        p <= 0
            ? o
            : p >= 1
              ? plan.spots[q]!
              : aroundPoint(
                    loop,
                    o,
                    walk.enter[q]!,
                    walk.inStraight[q]!,
                    walk.startDist[q]!,
                    walk.endDist[q]!,
                    walk.turn[q]!,
                    walk.straight[q]!,
                    plan.spots[q]!,
                    p,
                ),
    );
}

// ---------------------------------------------------------------------------
// AP-T13: go round
// ---------------------------------------------------------------------------

export interface GoRoundInput {
    /** The edit window `[start flag, end flag)` */
    window: TrailWindow;
    /** The selected marchers (four or more, on an outline) */
    marcherIds: readonly number[];
    /** Who leads; the member with most room ahead when null */
    leaderId: number | null;
    reversed: boolean;
    amount: number;
    unit: RoundUnit;
    /** One step, in field units */
    step: number;
}

export interface GoRoundResult extends FollowTrailResult {
    /** The page added at the end flag (the window was past the last page), or null */
    addedPage: { startBeat: number; endBeat: number } | null;
    /** Whether the line's own move round the same outline over the window was replaced ("again") */
    replaced: boolean;
}

/**
 * The line's move round an outline over exactly `window` (every one of `ids` in it and nobody
 * else), which going round again replaces; or null
 */
export async function aroundTrailOver(
    db: DbConnection | DbTransaction,
    window: TrailWindow,
    ids: readonly number[],
): Promise<MoveTrail | null> {
    const chosen = new Set(ids);
    const trails = await readTrails(db);
    return (
        trails.find(
            (t) =>
                t.around &&
                t.start === window.start &&
                t.end === window.end &&
                t.marcherIds.length === chosen.size &&
                t.marcherIds.every((m) => chosen.has(m)),
        ) ?? null
    );
}

/** AP-T13's reads and refusals, with nothing written. */
async function planInTransaction(
    tx: DbTransaction,
    input: GoRoundInput,
): Promise<{ ids: number[]; plan: GoRoundPlan; again: MoveTrail | null }> {
    const { window } = input;
    const ids = [...new Set(input.marcherIds)].sort((a, b) => a - b);
    if (ids.length < 2) refuse(trailRefusal.tooFew());
    if (!(window.end > window.start) || window.start < 0)
        refuse(trailDragRefusal.noWindow());
    const resolver = createResolver((await readTimelineTables(tx)).snapshot);
    const starts = ids.map((m): XY => {
        const [x, y] = resolver.positionAt(m, window.start);
        return [x, y];
    });
    const outline = outlineOf(starts, input.step);
    if (!outline) refuse(goRoundRefusal.notOutline());
    const leader = input.leaderId === null ? null : ids.indexOf(input.leaderId);
    const plan = planGoRound(starts, outline, {
        reversed: input.reversed,
        leader: leader !== null && leader >= 0 ? leader : null,
        amount: input.amount,
        unit: input.unit,
        step: input.step,
    });
    if (!(input.amount >= 1) || !plan.distances.some((d) => d >= EPS_GEOM))
        refuse(goRoundRefusal.noDistance());
    if (plan.laps > MAX_LAPS) refuse(goRoundRefusal.tooFar(MAX_LAPS));
    const again = await aroundTrailOver(tx, window, ids);
    // AP-T1's refusals on the moves the members have in the window now (AP-T8's peel); their own
    // move round this outline is replaced instead
    const T = schema.timeline_transitions;
    const A = schema.timeline_assignments;
    const rows = await tx
        .select({ assignment: A, transition: T })
        .from(A)
        .innerJoin(T, eq(T.id, A.transition_id))
        .where(
            and(
                inArray(A.marcher_id, ids),
                lt(A.start_beat, window.end),
                gt(A.end_beat, window.start),
            ),
        )
        .all();
    for (const r of rows)
        if (
            r.transition.path_style === "follow_the_leader" &&
            r.transition.id !== again?.transitionId
        )
            refuse(
                trailRefusal.alreadyFollows(
                    await marcherName(tx, r.assignment.marcher_id),
                ),
            );
    const laned = await firstLanedRow(
        tx,
        rows.map((r) => r.assignment),
    );
    if (laned)
        refuse(trailRefusal.hasPath(await marcherName(tx, laned.marcher_id)));
    return { ids, plan, again };
}

/**
 * Why going round would be refused for `marcherIds` in `window`, asked before the Follow tool
 * shows it, or null. Writes nothing.
 */
export async function goRoundRefusalFor(
    tx: DbTransaction,
    window: TrailWindow,
    marcherIds: readonly number[],
    /** One step, in field units: the fit's tolerance is at most half of it */
    step: number,
): Promise<TimelineText | null> {
    try {
        await planInTransaction(tx, {
            window,
            marcherIds,
            leaderId: null,
            reversed: false,
            amount: 1,
            unit: "spots",
            step,
        });
        return null;
    } catch (error) {
        if (error instanceof TimelineWriteError && error.text)
            return error.text;
        throw error;
    }
}

/**
 * AP-T13, inside one write-wrapper transaction. Refusals first (fewer than two marchers, no
 * window, not on a circle or box outline, no distance, too many times round, AP-T1's for the
 * moves the members have in the window). Their own move round an outline over exactly the window
 * goes first ("again", AP-T4 then this). Then a page is added at the end flag when the window is
 * past the last page; the members' spots in the window are written (replacing any they had,
 * DL-2) by the canvas's range writer; and AP-T1 peels them into one new follow-the-leader
 * transition in that move, in walking order (the leader last), with the outline in walking order
 * as its closed trail route, the spots as its placed destinations and `path_params` `{waypoints:
 * [], ends: "around", laps?}`. Writes file version 17.
 */
export async function goRoundInTransaction(
    tx: DbTransaction,
    input: GoRoundInput,
): Promise<GoRoundResult> {
    const { window } = input;
    const { ids, plan, again } = await planInTransaction(tx, input);
    if (again) await removeTrailInTransaction({ tx, routeId: again.routeId });
    let addedPage: GoRoundResult["addedPage"] = null;
    const grid = await readPageGrid(tx);
    const lastEnd = grid.pages.at(-1)?.end ?? 0;
    if (window.end > lastEnd) {
        const added = await addPageFlagInTransaction({ tx, beat: window.end });
        addedPage = { startBeat: added.startBeat, endBeat: added.endBeat };
    }
    const line = plan.line.map((i) => ids[i]!);
    // A whole time round ends where it started: the range writer would take such a marcher out
    // of the window's move (holds decision 16), so it is written a hair off, and the follow move
    // gets the exact spot
    const resolver = createResolver((await readTimelineTables(tx)).snapshot);
    await moveMarchersInRangeInTransaction({
        tx,
        range: window,
        moves: line.map((marcherId, q) => {
            const [x, y] = plan.spots[q]!;
            const [sx, sy] = resolver.positionAt(marcherId, window.start);
            const home = Math.hypot(x - sx, y - sy) < 1e-6;
            return { marcherId, x: home ? x + 0.01 : x, y };
        }),
        keepUnchanged: true,
    });
    const move = await windowMoveOf(tx, window, line);
    if (move === null)
        refuse(
            trailDragRefusal.notOneMove(await marcherName(tx, line.at(-1)!)),
        );
    const followed = await followTrailInTransaction({
        tx,
        timelineId: move,
        marcherIds: line,
        points: [],
        line,
        around: { geometry: plan.geometry, laps: plan.laps, spots: plan.spots },
    });
    await markOutlineModelInTransaction(tx);
    return { ...followed, addedPage, replaced: again !== null };
}

/** AP-T13 as one undoable edit. */
export async function goRound(
    args: { db: DbConnection } & GoRoundInput,
): Promise<GoRoundResult> {
    const { db, ...input } = args;
    return await transactionWithHistory(db, "goRound", (tx) =>
        goRoundInTransaction(tx, input),
    );
}

// ---------------------------------------------------------------------------
// AP-T14: Reverse on a move round an outline
// ---------------------------------------------------------------------------

/**
 * AP-T14's spots on the outline turned round (`loop`): a founder's as far the other way from where
 * it stands (`originOf`); a slot nobody founds from its own spot, turned back by twice the usual
 * distance (the founders' median, once round at most), so no two slots end on one point.
 */
function turnedSpots(
    loop: RoutePath,
    entry: { members: number[]; startDist: number[]; endDist: number[] },
    slotOf: ReadonlyMap<number, number>,
    spots: readonly { slot_index: number; x: number; y: number }[],
    originOf: (marcher: number) => XY,
): Map<number, XY> {
    const out = new Map<number, XY>();
    const went: number[] = [];
    for (const [q, m] of entry.members.entries()) {
        const slot = slotOf.get(m);
        if (slot === undefined) continue;
        const a = entry.endDist[q]! - entry.startDist[q]!;
        went.push(a - Math.floor(a / loop.L) * loop.L);
        out.set(slot, loopPoint(loop, nearestOnLoop(loop, originOf(m)) + a));
    }
    const usual = median(went);
    for (const d of spots)
        if (!out.has(d.slot_index))
            out.set(
                d.slot_index,
                loopPoint(loop, nearestOnLoop(loop, [d.x, d.y]) + 2 * usual),
            );
    return out;
}

/**
 * AP-T14: a move round an outline goes the other way round, each member the same distance as it
 * went (its spot is then on the outline: one off it is put back on). The outline is turned round,
 * `reverse` toggled (the old tail leads, R-12′), the laps kept and every slot's spot rewritten, in
 * one undo step. Called by Reverse (AP-T3) for such a move.
 */
export async function reverseAroundInTransaction(
    tx: DbTransaction,
    transitionId: number,
): Promise<{ leaderId: number | null; reverse: boolean }> {
    const T = schema.timeline_transitions;
    const D = schema.timeline_slot_destinations;
    const R = schema.timeline_routes;
    const transition = await tx
        .select()
        .from(T)
        .where(eq(T.id, transitionId))
        .get();
    if (!transition || transition.route_id === null)
        refuse(trailRefusal.noTrail());
    const route = await tx
        .select()
        .from(R)
        .where(eq(R.id, transition.route_id))
        .get();
    if (!route) refuse(trailRefusal.noTrail());
    const params = JSON.parse(transition.path_params ?? "{}") as {
        reverse?: boolean;
        laps?: number;
    };
    const geometry = JSON.parse(route.geometry) as RouteGeometry;
    const back = reverseOutline(geometry);
    const loop = makeLoop(back);
    const resolver = createResolver((await readTimelineTables(tx)).snapshot);
    const entry = resolver.ftlEntry(transitionId);
    const reverse = params.reverse !== true;
    // Every slot's new spot (AP-T14): a founder's as far round the other way from where it stands;
    // a slot nobody founds (a joiner's, a vacant one) as far the other way from its spot's start,
    // its spot turned back by twice the usual distance, so no two end on one point
    const spots = await tx
        .select()
        .from(D)
        .where(eq(D.transition_id, transitionId))
        .all();
    const founders = await tx
        .select({
            marcher: schema.timeline_assignments.marcher_id,
            slot: schema.timeline_assignments.slot_index,
        })
        .from(schema.timeline_assignments)
        .where(eq(schema.timeline_assignments.transition_id, transitionId))
        .all();
    const slotOf = new Map(founders.map((f) => [f.marcher, f.slot]));
    if (entry.members.length === 0) refuse(goRoundRefusal.reverseNobody());
    const newSpot = loop
        ? turnedSpots(loop, entry, slotOf, spots, (m) => {
              const o = resolver.explain(m, transition.start_beat).origin;
              return [o[0], o[1]];
          })
        : new Map<number, XY>();
    for (const [slot, [x, y]] of newSpot)
        await tx
            .update(D)
            .set({ x, y })
            .where(
                and(eq(D.transition_id, transitionId), eq(D.slot_index, slot)),
            );
    await writeRouteGeometryInTransaction(tx, transition.route_id, back);
    await tx
        .update(T)
        .set({
            path_params: JSON.stringify({
                waypoints: [],
                ends: "around",
                ...(params.laps ? { laps: params.laps } : {}),
                ...(reverse ? { reverse: true } : {}),
            }),
        })
        .where(eq(T.id, transitionId));
    const after = createResolver((await readTimelineTables(tx)).snapshot);
    return {
        leaderId: after.ftlEntry(transitionId).members.at(-1) ?? null,
        reverse,
    };
}
