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
            let d = Infinity;
            for (const p of points) {
                const dx = c.x - p.x;
                const dy = c.y - p.y;
                d = Math.min(d, dx * dx + dy * dy);
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
 * apart, each half the shortfall, held inside their margins (or only the least anyone keeps, when
 * `squeezed`), until none are (or the rounds run out). Generator 1 leaves a pair alone (`least`).
 */
function raiseFloor(
    w: Work,
    floor = FLOOR * median(nearestDistances(w.points)),
    squeezed = false,
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
        if (!close) return;
        for (let i = 0; i < n; i++) {
            const p = points[i]!;
            const keep = squeezed ? MARGIN_MIN : margins[i]!;
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

/** A fresh layout of `n` in work units, before scaling: the most even of the seed's tries */
function freshWork(region: Region, n: number, seed: number): Work {
    const tries = n > 1 && n <= SMALL_SPREAD ? SMALL_TRIES : 1;
    let best: Work | null = null;
    let bestScore = Infinity;
    for (let t = 0; t < tries; t++) {
        const own = seed * SMALL_TRIES + t;
        const w: Work = {
            region,
            seed: own,
            k: workScale(region, n),
            margins: marginsFor(own, n),
            points: [],
        };
        addByBestCandidate(w, n, seeded(own));
        pushApart(w, SPREAD_ROUNDS);
        raiseFloor(w);
        const score = tries > 1 ? unevenness(w.points) : 0;
        if (score < bestScore) {
            bestScore = score;
            best = w;
        }
    }
    return best!;
}

/**
 * How big a generator 2 spread of `n` is at an interval of 1: `region` times this. Only the
 * shape and count decide it, never the seed, so it needs no layout: the region holds the spots
 * {@link CLOSEST_OF_HEX} hex spacings apart.
 */
export function spreadSize(region: Region, n: number): number {
    const k = workScale(region, n);
    return k / (CLOSEST_OF_HEX * hexSpacing(region.area * k * k, n));
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
    if (from === n || from <= 1 || n <= 1) w = freshWork(region, n, seed);
    else {
        // Worked at the old layout's own scale, its closest pair still the interval: the edge
        // grows (or shrinks) with the count around the marchers where they stand
        const was = freshWork(region, from, seed);
        const closest = closestPair(was.points);
        w = {
            region,
            seed: was.seed,
            k: (was.k * workScale(region, n)) / workScale(region, from),
            // The same margins for the marchers that were there, new ones for new marchers
            margins: n > from ? marginsFor(was.seed, n) : was.margins,
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
            raiseFloor(w, closest, true);
    }
    // Generator 2: an interval is the spacing the shape and count give, whatever the seed
    const fixed = generator === 1 ? null : spreadSize(region, n) / w.k;
    if (n === 1) return { spots: [{ x: 0, y: 0 }], scale: w.k * (fixed ?? 1) };
    if (fixed !== null) {
        // Pairs closer than the interval step apart where there's room, inside their margins
        // first, then as near the edge as anyone stands
        raiseFloor(w, 1 / fixed, false, 2);
        if (closestPair(w.points) * fixed < 1 - 1e-6)
            raiseFloor(w, 1 / fixed, true, 2);
    }
    // Two marchers on one spot can't be scaled apart: lay it out afresh (never seen; a guard)
    if (!(closestPair(w.points) > 0)) w = freshWork(region, n, seed);
    const unit = fixed ?? 1 / closestPair(w.points);
    const spots = w.points
        .map((p) => ({ x: p.x * unit, y: p.y * unit }))
        // Back to front, then left to right, so slot numbers read like a page
        .sort((a, b) => a.y - b.y || a.x - b.x);
    return { spots, scale: w.k * unit };
}
