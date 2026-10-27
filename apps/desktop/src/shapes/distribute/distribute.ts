import type { XY } from "../types";
import { evenSpread, spreadSize, type SpreadLayout } from "./spread";
import type {
    Distribution,
    FilesDistribution,
    OutlineDistribution,
    SpreadDistribution,
} from "./distribution";
import {
    filesDistribution,
    NO_STAGGER,
    rankOffset,
    takesStagger,
} from "./distribution";
import { resolveLayout } from "./layouts";
import {
    nearestSides,
    OUTLINE_MIN,
    outlineLine,
    outlineSpots,
    type OutlineSides,
} from "./outline";
import { circleRegion, rectRegion, type Region } from "./region";

/**
 * The host's distributor (spec #385): the spots for a closed shape, given its region, the spot
 * count and how it is filled. A closed kind only describes its region and maps the spots from its
 * frame to the field (turn, flip, center); it never lays out spots itself. Everything is pure.
 */

/** A spot in the kind's frame, before turn and flip, with its row and column in the lattice */
export interface FrameSpot {
    readonly x: number;
    readonly y: number;
    readonly row: number;
    readonly col: number;
}

export interface DistributeInput {
    readonly region: Region;
    /** How many spots, holes included */
    readonly n: number;
    readonly distribution: Distribution;
    /** The kind's interval side to side and front to back, in field units */
    readonly across: number;
    readonly deep: number;
    /** Mid-gesture: a spread may be its last layout stretched to `region` ({@link spreadLayout}) */
    readonly draft?: boolean;
}

/**
 * The spots, in a fixed order that recipes store slot numbers by: Files goes line by line from
 * the back rank (the left file when turned), along each from left (back) to right (front);
 * Outline clockwise from the back-left corner; Spread from the back, left to right. A spread's
 * spots are no closer than `across`, filling `region`'s shape at the size {@link spreadScale}
 * gives (its own size doesn't count), the same for every seed.
 */
export function distribute(input: DistributeInput): FrameSpot[] {
    if (input.n <= 0) return [];
    const { distribution } = input;
    if (distribution.mode === "outline") return outlineOf(input, distribution);
    if (distribution.mode === "spread")
        return spreadLayout(
            input.region,
            input.n,
            distribution,
            input.draft,
        ).spots.map((s, k) => ({
            x: s.x * input.across,
            y: s.y * input.across,
            // One layout's spots: a new seed is a new layout, so who goes where is worked out
            // again rather than kept by spot number
            row: distribution.seed,
            col: k,
        }));
    return filesSpots(
        distribution.mode === "files"
            ? distribution
            : filesDistribution(Math.ceil(Math.sqrt(input.n))),
        input.n,
        input.across,
        input.deep,
    );
}

/**
 * The sides an outline of `n` (4 or more) takes in `region`: whole intervals, with the region's
 * proportions as near as they allow. A kind sizes its region from these sides, so they come back
 * the same.
 */
export function regionSides(
    region: Region,
    n: number,
    d: OutlineDistribution,
    across: number,
    deep: number,
): OutlineSides {
    const { left, top, right, bottom } = region.bounds;
    const aspect = (right - left) / across / ((bottom - top) / deep);
    return nearestSides(n, aspect, d.oddGap.side);
}

/** Outline: around the region's edge at the intervals, a spot on every corner (`outline.ts`) */
function outlineOf(
    input: DistributeInput,
    d: OutlineDistribution,
): FrameSpot[] {
    const { n, across, deep } = input;
    // A region with no corners (a circle) has its own: neighbors a chord apart
    if (input.region.corners.length === 0) return roundOutlineSpots(n, across);
    if (n < OUTLINE_MIN) return outlineLine(n, across);
    const sides = regionSides(input.region, n, d, across, deep);
    return outlineSpots(n, sides, d.oddGap, across, deep);
}

/** Spread layouts recently worked out: a shape asks for its spots, frame and outline in turn */
const spreads = new Map<string, SpreadLayout>();
const SPREADS_KEPT = 24;
/**
 * The last layout asked for (worked out, or known already) for each spread: generator, count,
 * seed and the kind of region (a box's rectangle, a circle), whatever its size and proportions.
 * The shape a handle drags asks for its own layout at the press, so a draft stretches that one.
 */
const lastOf = new Map<string, { region: Region; layout: SpreadLayout }>();

/**
 * The spread for `n` spots over `region`'s shape at an interval of 1, worked out once. With
 * `draft` (mid-gesture, #439), a region not worked out yet takes the spread's last layout
 * stretched to its frame instead, so a handle drag doesn't lay out again on every move: only what
 * the drag shows comes from it, never what's saved, and generator 1 (whose size is the layout's)
 * always lays out.
 */
function spreadLayout(
    region: Region,
    n: number,
    d: SpreadDistribution,
    draft = false,
): SpreadLayout {
    const from = d.count ?? n;
    const edged = withEdge(region, d);
    const family = `${d.generator} ${n} ${d.seed} ${from} ${edged ? "edge " : ""}${region.key.split(" ")[0]}`;
    const key = `${family} ${region.key}`;
    const known = spreads.get(key);
    if (known) {
        // Most recently used last, so the oldest goes first
        spreads.delete(key);
        spreads.set(key, known);
        remember(family, region, known);
        return known;
    }
    const last = lastOf.get(family);
    if (draft && last && d.generator !== 1)
        return stretched(last.layout, last.region, region, n, d);
    const layout = edged
        ? edgeSpread(region, n, d.seed, d.generator)
        : evenSpread(region, n, d.seed, from, d.generator);
    spreads.set(key, layout);
    if (spreads.size > SPREADS_KEPT)
        spreads.delete(spreads.keys().next().value!);
    remember(family, region, layout);
    return layout;
}

function remember(family: string, region: Region, layout: SpreadLayout) {
    lastOf.delete(family);
    lastOf.set(family, { region, layout });
    if (lastOf.size > SPREADS_KEPT) lastOf.delete(lastOf.keys().next().value!);
}

/** `layout` (over `was`) stretched side to side and front to back onto `region`'s frame */
function stretched(
    layout: SpreadLayout,
    was: Region,
    region: Region,
    n: number,
    d: SpreadDistribution,
): SpreadLayout {
    const scale = sizeOf(region, n, d);
    const a = was.bounds;
    const b = region.bounds;
    const sx =
        ((b.right - b.left) * scale) / ((a.right - a.left) * layout.scale);
    const sy =
        ((b.bottom - b.top) * scale) / ((a.bottom - a.top) * layout.scale);
    const ax = ((a.left + a.right) / 2) * layout.scale;
    const ay = ((a.top + a.bottom) / 2) * layout.scale;
    const bx = ((b.left + b.right) / 2) * scale;
    const by = ((b.top + b.bottom) / 2) * scale;
    return {
        spots: layout.spots.map((s) => ({
            x: bx + (s.x - ax) * sx,
            y: by + (s.y - ay) * sy,
        })),
        scale,
    };
}

/**
 * How big a Spread of `n` spots `interval` apart is: `region`'s shape times this. A spread's size
 * follows its count and interval, never the region's own size or (from generator 2) its seed, so
 * a kind sizes its frame by it.
 */
export function spreadScale(
    region: Region,
    n: number,
    d: SpreadDistribution,
    interval: number,
): number {
    // Generator 1 is as big as its seed's layout; later ones as their shape and count (#439),
    // so the frame doesn't wait for a layout (a handle drag asks at every file count)
    if (d.generator === 1)
        return spreadLayout(region, Math.max(1, n), d).scale * interval;
    if (!(region.area > 0)) return 0;
    return sizeOf(region, Math.max(1, n), d) * interval;
}

/** A generator 2 spread's size at an interval of 1, with its edge or without */
const sizeOf = (region: Region, n: number, d: SpreadDistribution) =>
    withEdge(region, d) ? edgeSize(region, n) : spreadSize(region, n);

/**
 * Whether `d` spreads with an edge over `region` (#450): a box's rectangle or a circle, which
 * have an edge to follow so far; generator 1 never had one
 */
const withEdge = (region: Region, d: SpreadDistribution) =>
    d.edge === true && d.generator !== 1 && edgeKind(region) !== null;

/** Whether a spread over `region` can have an edge (#450): a box's rectangle or a circle, so far */
export const takesEdge = (region: Region): boolean => edgeKind(region) !== null;

const edgeKind = (region: Region): "rect" | "circle" | null => {
    const kind = region.key.split(" ")[0];
    return kind === "rect" || kind === "circle" ? kind : null;
};

/** How far the inside spread keeps from the edge, in intervals */
const EDGE_INSET = 1;

/**
 * The edge's sides at size `scale` (intervals per region unit), each as a start, a direction and a
 * length, clockwise from the back-left corner; a circle is its rim, one side with no corners
 */
function edgeSides(region: Region, scale: number) {
    const w = region.bounds.right * scale;
    const h = region.bounds.bottom * scale;
    return { w, h };
}

/**
 * How many spots the edge holds at size `scale`, each one interval or more from the next: whole
 * intervals along each side of a box (a spot on every corner), or round a circle by the chord
 */
function edgeHolds(region: Region, scale: number): number {
    const { w, h } = edgeSides(region, scale);
    if (edgeKind(region) === "circle") return rimHolds(w);
    return (
        2 *
        (Math.max(1, Math.floor(2 * w + 1e-9)) +
            Math.max(1, Math.floor(2 * h + 1e-9)))
    );
}

/** Spots one interval or more apart round a circle of radius `r`, by the chord */
const rimHolds = (r: number) =>
    r < 0.5
        ? 1
        : Math.max(1, Math.floor(Math.PI / Math.asin(1 / (2 * r)) + 1e-9));

/** The inside of the edge at size `scale`, in intervals: the region inset by {@link EDGE_INSET} */
function insideOf(region: Region, scale: number): Region | null {
    const { w, h } = edgeSides(region, scale);
    if (w - EDGE_INSET <= 0 || h - EDGE_INSET <= 0) return null;
    return edgeKind(region) === "circle"
        ? circleRegion(w - EDGE_INSET)
        : rectRegion(w - EDGE_INSET, h - EDGE_INSET);
}

/** Edge sizes worked out, by region and count */
const edgeSizes = new Map<string, number>();

/**
 * How big a spread of `n` with an edge is at an interval of 1 (#450): the least size, in steps of
 * a hundredth from the plain spread's, at which its sides are an interval long or more, the edge
 * holds its spots one interval apart and the rest fit inside it, {@link EDGE_INSET} in, no closer
 * than the interval. Seed-free, like a plain spread's.
 */
export function edgeSize(region: Region, n: number): number {
    const key = `${region.key} ${n}`;
    const known = edgeSizes.get(key);
    if (known !== undefined) return known;
    let scale = spreadSize(region, n) * 0.8;
    for (let i = 0; i < 1000; i++, scale *= 1.01) {
        // Opposite sides an interval apart or more, or their spots would stand closer
        const { w, h } = edgeSides(region, scale);
        if (2 * Math.min(w, h) < 1) continue;
        const rest = n - edgeHolds(region, scale);
        if (rest <= 0) break;
        const inside = insideOf(region, scale);
        if (inside && spreadSize(inside, rest) <= 1) break;
    }
    edgeSizes.set(key, scale);
    if (edgeSizes.size > 200) edgeSizes.delete(edgeSizes.keys().next().value!);
    return scale;
}

/**
 * The split of `n` with an edge over `region`: how many stand on the edge and how many inside
 * (none inside when there are too few to show both)
 */
export function edgeSplit(
    region: Region,
    n: number,
): { readonly edge: number; readonly inside: number } {
    const edge = Math.min(n, edgeHolds(region, edgeSize(region, n)));
    return { edge, inside: n - edge };
}

/**
 * A spread with an edge (#450): spots evenly along the edge, as many as it holds one interval
 * apart (all of them, when there are too few for an inside), then the rest in an even spread
 * inside it, {@link EDGE_INSET} in, stretched to fill the inside. The edge doesn't depend on the
 * seed, so Reshuffle reshuffles the inside only.
 */
function edgeSpread(
    region: Region,
    n: number,
    seed: number,
    generator: number,
): SpreadLayout {
    const scale = edgeSize(region, n);
    const { edge, inside } = edgeSplit(region, n);
    const spots = edgeSpots(region, scale, edge);
    const within = insideOf(region, scale);
    if (inside > 0 && within) {
        const layout = evenSpread(within, inside, seed, inside, generator);
        // Its spots at an interval of 1 over the inside at `layout.scale`, onto the inside itself
        const grow = layout.scale > 0 ? 1 / layout.scale : 1;
        for (const s of layout.spots)
            spots.push({ x: s.x * grow, y: s.y * grow });
    }
    return { spots, scale };
}

/**
 * `count` spots along the edge at size `scale`, each one interval or more from the next. A box's
 * go round clockwise from its back-left corner, each side with its share (no more than it holds),
 * every side starting on its corner; a circle's go round from the front, evenly.
 */
function edgeSpots(region: Region, scale: number, count: number): XY[] {
    const { w, h } = edgeSides(region, scale);
    if (edgeKind(region) === "circle") {
        if (count === 1) return [{ x: 0, y: 0 }];
        return Array.from({ length: count }, (_, k) => {
            const a = (2 * Math.PI * k) / count;
            return { x: -w * Math.sin(a), y: w * Math.cos(a) };
        });
    }
    const lengths = [2 * w, 2 * h, 2 * w, 2 * h];
    const holds = lengths.map((l) => Math.max(1, Math.floor(l + 1e-9)));
    const per = shareOut(count, lengths, holds);
    const corners = [
        { x: -w, y: -h, dx: 1, dy: 0 },
        { x: w, y: -h, dx: 0, dy: 1 },
        { x: w, y: h, dx: -1, dy: 0 },
        { x: -w, y: h, dx: 0, dy: -1 },
    ];
    const spots: XY[] = [];
    corners.forEach((c, side) => {
        const along = lengths[side]! / per[side]!;
        for (let i = 0; i < per[side]!; i++)
            spots.push({
                x: c.x + c.dx * along * i,
                y: c.y + c.dy * along * i,
            });
    });
    return spots;
}

/**
 * `count` shared out over sides by their `lengths`, largest remainder first, no side more than it
 * `holds` nor fewer than none (all of them when the count fills every side)
 */
function shareOut(
    count: number,
    lengths: readonly number[],
    holds: readonly number[],
): number[] {
    const total = lengths.reduce((a, b) => a + b, 0);
    const per = lengths.map((l, i) =>
        Math.min(holds[i]!, Math.floor((count * l) / total)),
    );
    let left = count - per.reduce((a, b) => a + b, 0);
    // The rest, one at a time, to the side furthest under its share that has room
    while (left > 0) {
        let best = -1;
        let want = -Infinity;
        per.forEach((p, i) => {
            if (p >= holds[i]!) return;
            const short = (count * lengths[i]!) / total - p;
            if (short > want + 1e-12) {
                want = short;
                best = i;
            }
        });
        if (best < 0) break;
        per[best]!++;
        left--;
    }
    return per;
}

/** A Files layout as lines of marchers: how wide a full line is, and how many stand in each */
export interface LayoutLines {
    /** Spots in a full line: the block's width in spots */
    readonly width: number;
    /** Marchers in each line, from the back (the left file when turned) */
    readonly lines: readonly number[];
}

/**
 * A layout's lines for `n` (#387): the version it names, or, when the count has changed, its
 * family's nearest version, or Short back (`layouts.ts`, `resolveLayout`). Short back is full
 * lines of `files`, the back one short; one line holds them all when there are fewer than
 * `files`, centered in the block's width.
 */
export function layoutLines(
    layout: FilesDistribution["layout"],
    n: number,
): LayoutLines {
    const { lines } = resolveLayout(layout, n);
    return { width: Math.max(...lines), lines };
}

/**
 * Files: each line centered at the interval along it (a line with an odd gap to the full width
 * sits half an interval in, between the files), the lines an interval apart and centered, each
 * offset by the stagger. Ranks run side to side; turned (`byFile`), the lines are files.
 */
function filesSpots(
    d: FilesDistribution,
    n: number,
    across: number,
    deep: number,
): FrameSpot[] {
    const { layout, lines } = resolveLayout(d.layout, n);
    const width = Math.max(...lines);
    const byFile = layout.byFile;
    const stagger = takesStagger(layout.family) ? d.stagger : NO_STAGGER;
    const along = byFile ? deep : across;
    const apart = byFile ? across : deep;
    const count = lines.length;
    const spots: FrameSpot[] = [];
    for (let line = 0; line < count; line++) {
        const inLine = lines[line]!;
        const lead = (width - inLine) / 2;
        // Rank r counts from the front, the stagger's own rank 0; turned, file 0 is the left one
        const offset = rankOffset(byFile ? line : count - 1 - line, stagger);
        const v = (line - (count - 1) / 2) * apart;
        for (let i = 0; i < inLine; i++) {
            const file = lead + i;
            // As the box always worked it out, so its spots are the same to the bit
            const u = (file - (width - 1) / 2 + offset) * along;
            spots.push(
                byFile
                    ? { x: v, y: u, row: Math.floor(file), col: line }
                    : { x: u, y: v, row: line, col: Math.floor(file) },
            );
        }
    }
    return spots;
}

/**
 * Outline around a region with no corners (a circle): `n` spots with neighbors `interval` apart
 * straight across (the chord), so the radius is i / (2 sin(π/n)). The first spot stands
 * front-center and the rest go round clockwise on the field (toward the audience's left first,
 * with the front at the bottom). One spot stands on the center.
 */
function roundOutlineSpots(n: number, interval: number): FrameSpot[] {
    if (n === 1) return [{ x: 0, y: 0, row: 0, col: 0 }];
    const r = interval / (2 * Math.sin(Math.PI / n));
    return Array.from({ length: n }, (_, k) => {
        // k/n of the way round from the front, so the first spot is exactly front-center
        const a = (2 * Math.PI * k) / n;
        return { x: -r * Math.sin(a), y: r * Math.cos(a), row: 0, col: k };
    });
}
