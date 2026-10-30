import type { XY } from "../types";
import { seeded } from "../geometry/naturalFill";
import type { Region } from "./region";

/*
 * Even spread (#391, spec #385): the same idea as `naturalFill` (`geometry/naturalFill.ts`), rebased on the interval and
 * on any closed `Region`. Seeded best candidate, then a push-apart relaxation, fitted to a frame
 * the shape and count size, no pair closer than one interval (generator 1 scaled each seed's
 * layout to its closest pair instead). Each marcher keeps its own seeded distance from the edge,
 * so no rows form along straight edges.
 *
 * Determinism: the layout loop uses only + − × ÷, `Math.sqrt`, `Math.min`/`max`/`abs`/`floor`
 * and mulberry32's integer arithmetic, which ECMAScript defines exactly. `Math.sin`, `hypot`,
 * `atan2` and the like are implementation-approximated, so they stay out. The region is read only
 * through `edgeDistance`, `area`, `perimeter` and `bounds`.
 */

/**
 * Which spread algorithm this is. Recipes store it, so a reopened shape is laid out by the
 * algorithm that placed it; change it whenever the spots for a seed would change.
 *
 * 1 (#391) put the closest pair exactly one interval apart, so the spread's size, and with it the
 * shape's frame, changed with the seed. 2 (#439) sizes the frame by the shape and count alone and
 * fits each seed's spots inside it, so Reshuffle never moves the frame; the interval is then the
 * closest any pair stands, for every seed.
 */
export const SPREAD_GENERATOR = 2;

/** The generators this app lays out: older ones stay, so placed spreads don't move on reopen */
export const SPREAD_GENERATORS: readonly number[] = [1, 2];

/**
 * Generator 2: one interval is this many hex spacings of the frame. Low enough that every seed's
 * closest pair reaches the interval (0.9 is a little too tight at 100), and as big a frame as
 * generator 1's on average (#439).
 */
const CLOSEST_OF_HEX = 0.88;
/** Generator 2, thin shapes: rows of spots this far apart front to back (hex rows) */
const ROW_PITCH = Math.sqrt(3) / 2;
/** …this far in from every side, in intervals */
const EDGE_ROOM = 0.2;
/** …and the frame this much bigger than rows need, since a scatter packs looser than rows */
const ROWS_SLACK = 1.1;
/** Generator 2's floor: the share of their own margin marchers keep, pass by pass, when jammed */
const SQUEEZES = [1, 0.6, 0.3, 0.1, 0];
/** …each pass first pushing apart everyone nearer than this share over the interval, for this many rounds */
const JAM_TARGET = 1.05;
const JAM_ROUNDS = 20;

/** Every marcher's distance from the edge lies in this band, in spacings (RESEARCH.md §5) */
const MARGIN_MIN = 0.15;
const MARGIN_SPAN = 0.7;
/** Best candidate: candidates per point already placed, and at most this many per point */
const CANDIDATES_PER_POINT = 10;
const MAX_CANDIDATES = 300;

/** Tries to find a random point inside before giving up and using the center */
const SAMPLE_TRIES = 64;
/** Push-apart rounds for a new layout, and for one relaxed from a previous count */
const SPREAD_ROUNDS = 40;
const COUNT_CHANGE_ROUNDS = 40;
/**
 * Up to this many marchers, a layout is the most even of a few tries (one seed's tries): a small
 * spread sometimes settles with one marcher squeezed or left out, which a larger one evens out
 */
const SMALL_SPREAD = 80;
const SMALL_TRIES = 4;
/**
 * After relaxing, pairs closer than this share of the median neighbor distance are parted until
 * they aren't, so the closest pair (the interval) is set by the median, which one marcher more or
 * less barely moves, rather than by one tight pair
 */
const FLOOR = 0.95;
const FLOOR_ROUNDS = 100;
/** How much of the overlap each of a pair moves away per round */
const PUSH = 0.25;

/**
 * An even spread at an interval of 1: the spots around the region's center, and how much the
 * region was scaled to hold them (its edge, the one the marchers keep their distance from).
 */
export interface SpreadLayout {
    readonly spots: readonly XY[];
    /** The spread's region is `region` times this, at an interval of 1 */
    readonly scale: number;
}

/** The spacing a hexagonal packing of `count` points over `area` would have */
const hexSpacing = (area: number, count: number) =>
    Math.sqrt((2 * area) / (Math.sqrt(3) * Math.max(count, 1)));

/**
 * The scale that makes `region` the working space for `n` points about 1 apart: big enough for
 * them plus the soft band along the edge (about half a spacing deep)
 */
function workScale(region: Region, n: number): number {
    // Region area A·k² should hold n hex cells (√3/2 each) plus the band, perimeter·k × ½
    const a = region.area;
    const p = region.perimeter;
    const cells = (n * Math.sqrt(3)) / 2;
    // A k² − ½ p k − cells = 0
    const b = 0.5 * p;
    return (b + Math.sqrt(b * b + 4 * a * cells)) / (2 * a);
}

/** The seeded edge distance of every marcher, by index: its own stream, so a count change keeps them */
function marginsFor(seed: number, n: number): number[] {
    const random = seeded(seed * 7919 + 1);
    return Array.from({ length: n }, () => MARGIN_MIN + MARGIN_SPAN * random());
}

interface Work {
    readonly region: Region;
    /** The seed its margins and points came from */
    readonly seed: number;
    /** Region units per work unit */
    readonly k: number;
    readonly margins: number[];
    readonly points: XY[];
    /**
     * Points that stand still (a spread with an edge's edge, #450): the moving ones keep their
     * distance from them as from each other. Absent: none.
     */
    readonly fixed?: readonly XY[];
}

/** How far a work point is inside the region's edge, in work units */
const depth = (w: Work, p: XY) =>
    w.region.edgeDistance({ x: p.x / w.k, y: p.y / w.k }) * w.k;

/** A random work point at least `margin` inside, or the center after too many tries */
function sample(w: Work, margin: number, random: () => number): XY {
    const b = w.region.bounds;
    for (let t = 0; t < SAMPLE_TRIES; t++) {
        const p = {
            x: (b.left + random() * (b.right - b.left)) * w.k,
            y: (b.top + random() * (b.bottom - b.top)) * w.k,
        };
        if (depth(w, p) >= margin) return p;
    }
    return { x: 0, y: 0 };
}

/** Mitchell's best candidate: each new point is the farthest of several random ones */
function addByBestCandidate(w: Work, until: number, random: () => number) {
    const { points, margins } = w;
    while (points.length < until) {
        const margin = margins[points.length]!;
        const tries = Math.min(
            CANDIDATES_PER_POINT * points.length + 1,
            MAX_CANDIDATES,
        );
        let best: XY | null = null;
        let bestD = -1;
        for (let t = 0; t < tries; t++) {
            const c = sample(w, margin, random);
            // Its nearest point, given up on once nearer than the best's: it can't win then
            let d = Infinity;
            for (const p of points) {
                const dx = c.x - p.x;
                const dy = c.y - p.y;
                d = Math.min(d, dx * dx + dy * dy);
                if (d <= bestD) break;
            }
            if (d > bestD && w.fixed)
                for (const p of w.fixed) {
                    const dx = c.x - p.x;
                    const dy = c.y - p.y;
                    d = Math.min(d, dx * dx + dy * dy);
                    if (d <= bestD) break;
                }
            if (d > bestD) {
                bestD = d;
                best = c;
            }
        }
        points.push(best ?? { x: 0, y: 0 });
    }
}

/** How many nearest neighbors say how crowded a point is */
const CROWD_NEIGHBORS = 3;

/**
 * The most crowded point taken out, until `until` are left: the one whose nearest few neighbors
 * stand closest on average (the later of a tie goes). Not simply the closest pair's, whose
 * removal would make the next closest pair the interval and shrink the whole spread.
 */
function removeMostCrowded(w: Work, until: number) {
    const { points, margins } = w;
    while (points.length > until) {
        let worst = 0;
        let worstD = Infinity;
        for (let i = 0; i < points.length; i++) {
            const near: number[] = [];
            for (let j = 0; j < points.length; j++) {
                if (i === j) continue;
                const dx = points[i]!.x - points[j]!.x;
                const dy = points[i]!.y - points[j]!.y;
                near.push(dx * dx + dy * dy);
            }
            near.sort((a, b) => a - b);
            let d = 0;
            for (let k = 0; k < Math.min(CROWD_NEIGHBORS, near.length); k++)
                d += Math.sqrt(near[k]!);
            if (d <= worstD) {
                worstD = d;
                worst = i;
            }
        }
        points.splice(worst, 1);
        margins.splice(worst, 1);
    }
}

/**
 * Push apart: neighbors nearer than `target` (the hex spacing when absent) push each other
 * off, each move held at least the marcher's own margin inside the edge (halved until it is)
 */
function pushApart(w: Work, rounds: number, target?: number) {
    const { points, margins } = w;
    const n = points.length;
    target ??= hexSpacing(w.region.area * w.k * w.k, n);
    const mx = new Float64Array(n);
    const my = new Float64Array(n);
    for (let round = 0; round < rounds; round++) {
        // Bold at first, gentler as it settles
        const push = PUSH * (1 - (0.6 * round) / rounds);
        mx.fill(0);
        my.fill(0);
        for (let i = 0; i < n; i++) {
            const a = points[i]!;
            for (let j = i + 1; j < n; j++) {
                const b = points[j]!;
                const dx = b.x - a.x;
                // Too far apart side to side to touch: skipped before the rest is worked out
                if (dx >= target || dx <= -target) continue;
                const dy = b.y - a.y;
                const dd = dx * dx + dy * dy;
                if (dd >= target * target) continue;
                if (dd === 0) {
                    // On top of each other: the later one steps off toward +x
                    mx[j]! += target * push;
                    continue;
                }
                const d = Math.sqrt(dd);
                const f = ((target - d) / d) * push;
                mx[i]! -= dx * f;
                my[i]! -= dy * f;
                mx[j]! += dx * f;
                my[j]! += dy * f;
            }
            // A point that stands still: the moving one takes the whole push
            if (w.fixed) pushedOff(a, w.fixed, target, 2 * push, mx, my, i);
        }
        for (let i = 0; i < n; i++) {
            const p = points[i]!;
            for (let h = 1; h > 0.01; h /= 2) {
                const q = { x: p.x + mx[i]! * h, y: p.y + my[i]! * h };
                if (depth(w, q) >= margins[i]!) {
                    points[i] = q;
                    break;
                }
            }
        }
    }
}

/**
 * Points nearer the edge than their margin (the region shrank around them) stepped inward, the
 * way the distance from the edge grows fastest, just far enough. Any region: no middle to aim for.
 */
function pullInside(w: Work) {
    const e = 1e-4;
    w.points.forEach((p, i) => {
        let q = p;
        for (let t = 0; t < 8; t++) {
            const short = w.margins[i]! - depth(w, q);
            if (short <= 0) break;
            const gx =
                depth(w, { x: q.x + e, y: q.y }) -
                depth(w, { x: q.x - e, y: q.y });
            const gy =
                depth(w, { x: q.x, y: q.y + e }) -
                depth(w, { x: q.x, y: q.y - e });
            const g = Math.sqrt(gx * gx + gy * gy);
            if (g === 0) break;
            q = { x: q.x + (gx / g) * short, y: q.y + (gy / g) * short };
        }
        w.points[i] = q;
    });
}

/** Each point's distance to its nearest neighbor */
function nearestDistances(points: readonly XY[]): number[] {
    return points.map((p, i) => {
        let best = Infinity;
        for (let j = 0; j < points.length; j++) {
            if (i === j) continue;
            const dx = p.x - points[j]!.x;
            const dy = p.y - points[j]!.y;
            best = Math.min(best, dx * dx + dy * dy);
        }
        return Math.sqrt(best);
    });
}

/** The middle value (the upper of the two middle ones) */
const median = (values: readonly number[]): number =>
    [...values].sort((a, b) => a - b)[values.length >> 1]!;

/**
 * Pairs nearer than `floor` (by default {@link FLOOR} of the median neighbor distance) step
 * apart, each half the shortfall, held inside their margins (or only `squeeze` inside the edge,
 * when given), until none are (or the rounds run out). Generator 1 leaves a pair alone (`least`).
 */
function raiseFloor(
    w: Work,
    floor = FLOOR * median(nearestDistances(w.points)),
    squeeze?: number,
    least = 3,
) {
    const { points, margins } = w;
    const n = points.length;
    if (n < least) return;
    const mx = new Float64Array(n);
    const my = new Float64Array(n);
    for (let round = 0; round < FLOOR_ROUNDS; round++) {
        mx.fill(0);
        my.fill(0);
        let close = false;
        for (let i = 0; i < n; i++)
            for (let j = i + 1; j < n; j++) {
                const dx = points[j]!.x - points[i]!.x;
                if (dx >= floor || dx <= -floor) continue;
                const dy = points[j]!.y - points[i]!.y;
                const dd = dx * dx + dy * dy;
                if (dd >= floor * floor || dd === 0) continue;
                close = true;
                const d = Math.sqrt(dd);
                const f = (floor - d) / d / 2;
                mx[i]! -= dx * f;
                my[i]! -= dy * f;
                mx[j]! += dx * f;
                my[j]! += dy * f;
            }
        // Points that stand still: the moving one steps the whole shortfall away
        if (w.fixed)
            for (let i = 0; i < n; i++)
                if (pushedOff(points[i]!, w.fixed, floor, 1, mx, my, i))
                    close = true;
        if (!close) return;
        for (let i = 0; i < n; i++) {
            const p = points[i]!;
            const keep =
                squeeze === undefined
                    ? margins[i]!
                    : Math.min(squeeze, margins[i]!);
            for (let h = 1; h > 0.01; h /= 2) {
                const q = { x: p.x + mx[i]! * h, y: p.y + my[i]! * h };
                if (depth(w, q) >= keep) {
                    points[i] = q;
                    break;
                }
            }
        }
    }
}

/**
 * `a` (moving point `i`) pushed off each still point nearer than `target`, by `push` of the
 * shortfall, into `mx`, `my`; whether any was that near
 */
function pushedOff(
    a: XY,
    still: readonly XY[],
    target: number,
    push: number,
    mx: Float64Array,
    my: Float64Array,
    i: number,
): boolean {
    let near = false;
    for (const b of still) {
        const dx = a.x - b.x;
        if (dx >= target || dx <= -target) continue;
        const dy = a.y - b.y;
        const dd = dx * dx + dy * dy;
        if (dd >= target * target || dd === 0) continue;
        near = true;
        const d = Math.sqrt(dd);
        const f = ((target - d) / d) * push;
        mx[i]! += dx * f;
        my[i]! += dy * f;
    }
    return near;
}

/** The closest distance between any two of `w`'s points, the still ones counted too */
function closestOf(w: Work): number {
    let best = closestPair(w.points);
    for (const a of w.points)
        for (const b of w.fixed ?? []) {
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            best = Math.min(best, Math.sqrt(dx * dx + dy * dy));
        }
    return best;
}

/** The closest distance between any two points */
function closestPair(points: readonly XY[]): number {
    let best = Infinity;
    for (let i = 0; i < points.length; i++)
        for (let j = i + 1; j < points.length; j++) {
            const dx = points[i]!.x - points[j]!.x;
            const dy = points[i]!.y - points[j]!.y;
            best = Math.min(best, dx * dx + dy * dy);
        }
    return Math.sqrt(best);
}

/** How uneven the nearest-neighbor distances are: their spread over their mean */
function unevenness(points: readonly XY[]): number {
    const nearest = nearestDistances(points);
    const mean = nearest.reduce((a, b) => a + b, 0) / nearest.length;
    const variance =
        nearest.reduce((a, d) => a + (d - mean) * (d - mean), 0) /
        nearest.length;
    return Math.sqrt(variance) / mean;
}

/**
 * Generator 2's margins: none deeper than a thin shape holds. A marcher's margin is at most the
 * shape's half short side less {@link MARGIN_MIN}, or half of it, so a strip of one file still has
 * a middle to stand in. Wide shapes keep their margins as they are.
 */
function capMargins(region: Region, k: number, margins: number[]): number[] {
    const { left, top, right, bottom } = region.bounds;
    const shortHalf = (Math.min(right - left, bottom - top) / 2) * k;
    const cap = Math.max(shortHalf - MARGIN_MIN, shortHalf / 2);
    return margins.map((m) => Math.min(m, cap));
}

/**
 * Generator 2's floor: pairs closer than `interval` (work units) step apart. When they're jammed,
 * the crowd around them makes room first, everyone held a shrinking share of their own distance
 * from the edge ({@link SQUEEZES}), so a pair can part near the edge (#439: edge marchers sit on or
 * near it) without a row forming along it
 */
function floorAt(w: Work, interval: number) {
    // A hair over, so pairs settle on the interval rather than just under it
    const floor = interval * (1 + 1e-4);
    raiseFloor(w, floor, undefined, 2);
    for (const share of SQUEEZES) {
        if (closestOf(w) >= interval) return;
        const squeezed: Work = {
            ...w,
            margins: w.margins.map((m) => m * share),
        };
        pushApart(squeezed, JAM_ROUNDS, floor * JAM_TARGET);
        raiseFloor(squeezed, floor, undefined, 2);
    }
}

/** The work scale of a spread: generator 2 grows it with a thin shape's frame ({@link spreadSize}) */
function workScaleOf(region: Region, n: number, generator: number): number {
    const k = workScale(region, n);
    return generator === 1
        ? k
        : (k * spreadSize(region, n)) / hexSize(region, n);
}

/** A fresh layout of `n` in work units, before scaling: the most even of the seed's tries */
function freshWork(
    region: Region,
    n: number,
    seed: number,
    generator: number,
): Work {
    const tries = n > 1 && n <= SMALL_SPREAD ? SMALL_TRIES : 1;
    const k = workScaleOf(region, n, generator);
    let best: Work | null = null;
    let bestScore = Infinity;
    for (let t = 0; t < tries; t++) {
        const own = seed * SMALL_TRIES + t;
        const margins = marginsFor(own, n);
        const w: Work = {
            region,
            seed: own,
            k,
            margins: generator === 1 ? margins : capMargins(region, k, margins),
            points: [],
        };
        addByBestCandidate(w, n, seeded(own));
        pushApart(w, SPREAD_ROUNDS);
        raiseFloor(w);
        if (generator !== 1 && n > 1) floorAt(w, intervalIn(region, n, k));
        const score = tries > 1 ? unevenness(w.points) : 0;
        if (score < bestScore) {
            bestScore = score;
            best = w;
        }
    }
    return best!;
}

/** Generator 2: one interval in work units, at work scale `k` */
const intervalIn = (region: Region, n: number, k: number) =>
    k / spreadSize(region, n);

/** Generator 2's size from the area alone: {@link CLOSEST_OF_HEX} hex spacings to the interval */
function hexSize(region: Region, n: number): number {
    const k = workScale(region, n);
    return k / (CLOSEST_OF_HEX * hexSpacing(region.area * k * k, n));
}

/** Rows {@link ROW_PITCH} apart across `deep`, every other one half an interval along: spots in a `wide` × `deep` space */
function rowsHold(wide: number, deep: number): number {
    if (wide < 0 || deep < 0) return 0;
    const rows = Math.floor(deep / ROW_PITCH) + 1;
    const full = Math.floor(wide) + 1;
    const shifted = wide >= 0.5 ? Math.floor(wide - 0.5) + 1 : 0;
    return Math.ceil(rows / 2) * full + Math.floor(rows / 2) * shifted;
}

/**
 * The least size at which `region`'s bounds hold `n` spots one interval apart in rows (either
 * way), {@link EDGE_ROOM} in from every side. Seed-free: it only reads the bounds. It matters
 * for a long, thin shape, where the area says the marchers fit but its width doesn't.
 */
function rowsSize(region: Region, n: number): number {
    const { left, top, right, bottom } = region.bounds;
    const a = right - left;
    const b = bottom - top;
    const holds = (size: number) => {
        const x = a * size - 2 * EDGE_ROOM;
        const y = b * size - 2 * EDGE_ROOM;
        return Math.max(rowsHold(x, y), rowsHold(y, x)) >= n;
    };
    // One line along the long side always holds them
    let hi = (n - 1 + 2 * EDGE_ROOM) / Math.max(a, b);
    let lo = 0;
    for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (holds(mid)) hi = mid;
        else lo = mid;
    }
    return hi;
}

/**
 * How big a generator 2 spread of `n` is at an interval of 1: `region` times this. Only the
 * shape and count decide it, never the seed, so it needs no layout: the region holds the spots
 * {@link CLOSEST_OF_HEX} hex spacings apart, and a long, thin one at least enough for rows of them
 * one interval apart, with room to scatter ({@link ROWS_SLACK}).
 */
export function spreadSize(region: Region, n: number): number {
    return Math.max(hexSize(region, n), rowsSize(region, n) * ROWS_SLACK);
}

/**
 * `n` spots spread evenly over `region`'s shape at an interval of 1. The region's size doesn't
 * matter, only its shape: the spread's own size follows the count. Generator 1 puts the closest
 * pair exactly 1 apart, so its size follows the seed too; generator 2's size follows only the
 * shape and count, every seed filling the same edge with no pair closer than 1.
 *
 * @param seed which layout (a whole number; the same one gives the same spots)
 * @param from the count `seed` was laid out for, when it differs from `n`: the spots relax from
 *   that layout, new ones placed by best candidate and extra ones taken from the most crowded
 *   spots, so a count change nudges the spread instead of reshuffling it
 * @param generator which algorithm ({@link SPREAD_GENERATORS}), the one the spread was placed with
 */
export function evenSpread(
    region: Region,
    n: number,
    seed: number,
    from: number = n,
    generator: number = SPREAD_GENERATOR,
): SpreadLayout {
    if (n <= 0 || !(region.area > 0)) return { spots: [], scale: 0 };
    let w: Work;
    if (from === n || from <= 1 || n <= 1)
        w = freshWork(region, n, seed, generator);
    else {
        // Worked at the old layout's own scale, its closest pair still the interval: the edge
        // grows (or shrinks) with the count around the marchers where they stand
        const was = freshWork(region, from, seed, generator);
        const closest = closestPair(was.points);
        const k =
            generator === 1
                ? (was.k * workScale(region, n)) / workScale(region, from)
                : workScaleOf(region, n, generator);
        // The same margins for the marchers that were there, new ones for new marchers
        const margins = n > from ? marginsFor(was.seed, n) : was.margins;
        w = {
            region,
            seed: was.seed,
            k,
            margins: generator === 1 ? margins : capMargins(region, k, margins),
            points: was.points,
        };
        // Those the edge moved past step back inside it
        if (n < from) pullInside(w);
        // The spacing the layout had: only what is closer than that moves, so the spread
        // relaxes around the change instead of everyone shuffling
        const spacing = median(nearestDistances(w.points));
        if (n > from) addByBestCandidate(w, n, seeded(was.seed * 31 + from));
        else removeMostCrowded(w, n);
        pushApart(w, COUNT_CHANGE_ROUNDS, spacing);
        // Then no pair closer than the interval was, so the spread keeps its scale
        raiseFloor(w, closest);
        // No room near the change (a small spread packed against its edges): part the tight
        // pair even if that takes a marcher nearer the edge than its own distance
        if (closestPair(w.points) < closest * (1 - 1e-6))
            raiseFloor(w, closest, MARGIN_MIN);
    }
    // Generator 2: an interval is the spacing the shape and count give, whatever the seed
    const fixed = generator === 1 ? null : spreadSize(region, n) / w.k;
    if (n === 1) return { spots: [{ x: 0, y: 0 }], scale: w.k * (fixed ?? 1) };
    if (fixed !== null) floorAt(w, 1 / fixed);
    // Two marchers on one spot can't be scaled apart: lay it out afresh (never seen; a guard)
    if (!(closestPair(w.points) > 0)) w = freshWork(region, n, seed, generator);
    const unit = fixed ?? 1 / closestPair(w.points);
    const spots = w.points
        .map((p) => ({ x: p.x * unit, y: p.y * unit }))
        // Back to front, then left to right, so slot numbers read like a page
        .sort((a, b) => a.y - b.y || a.x - b.x);
    return { spots, scale: w.k * unit };
}

/** A spread around still points: each moving one at least this far in from the edge, in intervals */
const AROUND_MARGIN_MIN = 0.3;
const AROUND_MARGIN_SPAN = 0.4;

/**
 * `m` spots spread evenly over `region` (in intervals, as big as it is) around `fixed` spots that
 * stand still, no pair closer than an interval where there's room (#450: a spread with an edge,
 * its edge the still spots). Seeded best candidate and push-apart as for a spread, the still
 * spots counted as neighbors, so the spread runs right up to them with no band between; each
 * moving spot keeps its own small seeded distance from the edge. The same spots for the same
 * region, still spots, count and seed.
 */
export function spreadAround(
    region: Region,
    fixed: readonly XY[],
    m: number,
    seed: number,
): XY[] {
    if (m <= 0) return [];
    const random = seeded(seed * 7919 + 1);
    const w: Work = {
        region,
        seed,
        k: 1,
        margins: Array.from(
            { length: m },
            () => AROUND_MARGIN_MIN + AROUND_MARGIN_SPAN * random(),
        ),
        points: [],
        fixed,
    };
    addByBestCandidate(w, m, seeded(seed));
    pushApart(w, SPREAD_ROUNDS, hexSpacing(region.area, m + fixed.length));
    floorAt(w, 1);
    // Back to front, then left to right, so slot numbers read like a page
    return w.points.sort((a, b) => a.y - b.y || a.x - b.x);
}

/**
 * `start` (spots at least an interval from each other and from `fixed`) eased apart over
 * `region` for up to `rounds` rounds, a round kept only while no pair comes closer than an
 * interval: the floor holds whatever happens (#450's fallback). Spots may go to the edge itself.
 */
export function settleAround(
    region: Region,
    fixed: readonly XY[],
    start: readonly XY[],
    rounds: number,
): XY[] {
    const w: Work = {
        region,
        seed: 0,
        k: 1,
        margins: start.map(() => 0),
        points: start.map((p) => ({ ...p })),
        fixed,
    };
    const target = hexSpacing(region.area, start.length + fixed.length);
    for (let round = 0; round < rounds; round++) {
        const before = w.points.map((p) => ({ ...p }));
        pushApart(w, 1, target);
        if (closestOf(w) < 1) {
            w.points.splice(0, w.points.length, ...before);
            break;
        }
    }
    // Back to front, then left to right, so slot numbers read like a page
    return w.points.sort((a, b) => a.y - b.y || a.x - b.x);
}
