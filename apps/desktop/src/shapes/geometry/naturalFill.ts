import type { Region } from "../distribute/region";
import type { XY } from "../types";

/**
 * An even, natural spread of marchers over a closed outline (owner decisions, 2026-10-11): some
 * on the edge so the silhouette reads, the rest inside, evenly spaced with no ranks or files and
 * purposely irregular.
 *
 * How: the edge gets marchers evenly along it (as many as keep its spacing near the inside's,
 * unless a count is given); the inside starts from a seeded scatter and is relaxed by letting
 * close neighbors push apart. The scatter is laid out in the outline's own unit space, so the same
 * seed gives the same layout scaled and moved with the outline: small edits nudge marchers rather
 * than reshuffle them, and a new layout is a new seed.
 */

/** A closed outline the spread fills */
export interface FillOutline {
    readonly area: number;
    readonly perimeter: number;
    /** The point a fraction `t` (0 to 1) of the way round the edge */
    pointAt(t: number): XY;
    /** A point of the unit shape (both coordinates in -1..1, inside the unit shape) mapped in */
    fromUnit(u: XY): XY;
    /** Whether a unit-space point is inside the unit shape */
    unitContains(u: XY): boolean;
    /** `p` moved inside the outline, at least `margin` from its edge */
    keepInside(p: XY, margin: number): XY;
}

export function circleOutline(center: XY, r: number): FillOutline {
    return {
        area: Math.PI * r * r,
        perimeter: 2 * Math.PI * r,
        // From the front (+y), clockwise on the canvas
        pointAt: (t) => {
            const a = Math.PI / 2 + t * 2 * Math.PI;
            return {
                x: center.x + r * Math.cos(a),
                y: center.y + r * Math.sin(a),
            };
        },
        fromUnit: (u) => ({ x: center.x + u.x * r, y: center.y + u.y * r }),
        unitContains: (u) => u.x * u.x + u.y * u.y <= 1,
        keepInside: (p, margin) => {
            const dx = p.x - center.x;
            const dy = p.y - center.y;
            const d = Math.hypot(dx, dy);
            const max = Math.max(0, r - margin);
            if (d <= max || d === 0) return p;
            return {
                x: center.x + (dx / d) * max,
                y: center.y + (dy / d) * max,
            };
        },
    };
}

/** A box of `width` by `height` about `center`, turned by `rotation` radians */
export function boxOutline(
    center: XY,
    width: number,
    height: number,
    rotation: number,
): FillOutline {
    const hw = width / 2;
    const hh = height / 2;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const toField = (lx: number, ly: number): XY => ({
        x: center.x + lx * cos - ly * sin,
        y: center.y + lx * sin + ly * cos,
    });
    const toLocal = (p: XY) => {
        const dx = p.x - center.x;
        const dy = p.y - center.y;
        return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos };
    };
    const perimeter = 2 * (width + height);
    return {
        area: width * height,
        perimeter,
        // From the front-left corner, along the front first
        pointAt: (t) => {
            let s = (((t % 1) + 1) % 1) * perimeter;
            if (s <= width) return toField(-hw + s, hh);
            s -= width;
            if (s <= height) return toField(hw, hh - s);
            s -= height;
            if (s <= width) return toField(hw - s, -hh);
            s -= width;
            return toField(-hw, -hh + s);
        },
        fromUnit: (u) => toField(u.x * hw, u.y * hh),
        unitContains: (u) => Math.abs(u.x) <= 1 && Math.abs(u.y) <= 1,
        keepInside: (p, margin) => {
            const l = toLocal(p);
            const mx = Math.max(0, hw - margin);
            const my = Math.max(0, hh - margin);
            return toField(
                Math.max(-mx, Math.min(mx, l.x)),
                Math.max(-my, Math.min(my, l.y)),
            );
        },
    };
}

/** The spacing a hexagonal packing of `count` points over `area` would have */
const packedSpacing = (area: number, count: number) =>
    Math.sqrt((2 * area) / (Math.sqrt(3) * Math.max(count, 1)));

/** How many marchers stand on the edge when not set: about the inside's spacing apart */
export function autoEdgeCount(outline: FillOutline, n: number): number {
    if (n <= 0) return 0;
    const spacing = packedSpacing(outline.area, n);
    if (!(spacing > 0)) return n;
    const k = Math.round(outline.perimeter / spacing);
    // At least a quarter inside, so a small band still fills (sims, draw round 1: eight marchers
    // all went to the rim, a ring, not a filled circle)
    const most = n >= 4 ? n - Math.ceil(n / 4) : n;
    return Math.max(Math.min(3, most), Math.min(most, k));
}

/**
 * A small seeded random generator (mulberry32), so a layout repeats. Integer arithmetic and one
 * division, so every engine gives the same numbers.
 */
export function seeded(seed: number): () => number {
    let a = (Math.floor(seed) * 0x9e3779b1) >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const RELAX_ROUNDS = 40;
/** Neighbors nearer than this many spacings push apart */
const REACH = 1.5;

/**
 * `n` spots: the edge's first, in order round it, then the inside's.
 *
 * @param edge marchers on the edge; undefined for the automatic count
 * @param seed which layout (any whole number; the same one repeats)
 */
export function naturalFill(
    outline: FillOutline,
    n: number,
    edge: number | undefined,
    seed: number,
): XY[] {
    if (n <= 0 || !(outline.area > 0)) return [];
    const onEdge = Math.max(0, Math.min(n, edge ?? autoEdgeCount(outline, n)));
    const random = seeded(seed);
    // The edge: evenly round it, from a point the seed turns a little, so layouts differ
    const phase = random();
    const spots: XY[] = Array.from({ length: onEdge }, (_, i) =>
        outline.pointAt((i + phase) / onEdge),
    );
    const inside = n - onEdge;
    if (inside === 0) return spots;

    // The inside: a seeded scatter in the unit shape, then relaxed apart
    const spacing = packedSpacing(outline.area, inside + onEdge / 2);
    const points: XY[] = [];
    for (
        let guard = 0;
        points.length < inside && guard < inside * 200;
        guard++
    ) {
        const u = { x: random() * 2 - 1, y: random() * 2 - 1 };
        // Not right against the edge, where the edge marchers stand
        if (outline.unitContains({ x: u.x / 0.85, y: u.y / 0.85 }))
            points.push(outline.keepInside(outline.fromUnit(u), spacing / 2));
    }
    while (points.length < inside)
        points.push(outline.fromUnit({ x: 0, y: 0 }));

    const reach = REACH * spacing;
    for (let round = 0; round < RELAX_ROUNDS; round++) {
        const step = 0.3 * (1 - round / RELAX_ROUNDS) + 0.05;
        const moves = points.map((p, i) => {
            let fx = 0;
            let fy = 0;
            const push = (q: XY) => {
                const dx = p.x - q.x;
                const dy = p.y - q.y;
                const d = Math.hypot(dx, dy);
                if (d >= reach) return;
                if (d < 1e-9) {
                    // Exactly on top of each other: part in a seeded direction
                    const a = random() * 2 * Math.PI;
                    fx += Math.cos(a) * reach;
                    fy += Math.sin(a) * reach;
                    return;
                }
                const strength = (reach - d) / d;
                fx += dx * strength;
                fy += dy * strength;
            };
            points.forEach((q, j) => j !== i && push(q));
            spots.forEach(push);
            return { x: p.x + fx * step, y: p.y + fy * step };
        });
        for (let i = 0; i < points.length; i++)
            points[i] = outline.keepInside(moves[i]!, spacing / 2);
    }
    return [...spots, ...points];
}

/** The typical distance from a spot to its nearest neighbor, for a "≈ X steps apart" readout */
export function typicalNeighborDistance(spots: readonly XY[]): number {
    if (spots.length < 2) return 0;
    const nearest = spots.map((p, i) => {
        let best = Infinity;
        spots.forEach((q, j) => {
            if (i !== j)
                best = Math.min(best, Math.hypot(p.x - q.x, p.y - q.y));
        });
        return best;
    });
    nearest.sort((a, b) => a - b);
    return nearest[Math.floor(nearest.length / 2)]!;
}

/*
 * Even spread (#391, spec #385): the same idea as `naturalFill` above, rebased on the interval and
 * on any closed `Region`. Seeded best candidate, then a push-apart relaxation, scaled so the
 * closest pair is exactly one interval. Each marcher keeps its own seeded distance from the edge,
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
 */
export const SPREAD_GENERATOR = 1;

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
 * `squeezed`), until none are (or the rounds run out)
 */
function raiseFloor(
    w: Work,
    floor = FLOOR * median(nearestDistances(w.points)),
    squeezed = false,
) {
    const { points, margins } = w;
    const n = points.length;
    if (n < 3) return;
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
 * `n` spots spread evenly over `region`'s shape, one interval (1) apart at the closest pair.
 * The region's size doesn't matter, only its shape: the spread's own size follows the count.
 *
 * @param seed which layout (a whole number; the same one gives the same spots)
 * @param from the count `seed` was laid out for, when it differs from `n`: the spots relax from
 *   that layout, new ones placed by best candidate and extra ones taken from the most crowded
 *   spots, so a count change nudges the spread instead of reshuffling it
 */
export function evenSpread(
    region: Region,
    n: number,
    seed: number,
    from: number = n,
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
    if (n === 1) return { spots: [{ x: 0, y: 0 }], scale: w.k };
    // Two marchers on one spot can't be scaled apart: lay it out afresh (never seen; a guard)
    if (!(closestPair(w.points) > 0)) w = freshWork(region, n, seed);
    const unit = 1 / closestPair(w.points);
    const spots = w.points
        .map((p) => ({ x: p.x * unit, y: p.y * unit }))
        // Back to front, then left to right, so slot numbers read like a page
        .sort((a, b) => a.y - b.y || a.x - b.x);
    return { spots, scale: w.k * unit };
}
