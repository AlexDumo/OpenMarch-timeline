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
import type { Region } from "./region";

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
        return spreadLayout(input.region, input.n, distribution).spots.map(
            (s, k) => ({
                x: s.x * input.across,
                y: s.y * input.across,
                // One layout's spots: a new seed is a new layout, so who goes where is worked out
                // again rather than kept by spot number
                row: distribution.seed,
                col: k,
            }),
        );
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

/** The spread for `n` spots over `region`'s shape at an interval of 1, worked out once */
function spreadLayout(
    region: Region,
    n: number,
    d: SpreadDistribution,
): SpreadLayout {
    const from = d.count ?? n;
    const key = `${d.generator} ${region.key} ${n} ${d.seed} ${from}`;
    const known = spreads.get(key);
    if (known) {
        // Most recently used last, so the oldest goes first
        spreads.delete(key);
        spreads.set(key, known);
        return known;
    }
    const layout = evenSpread(region, n, d.seed, from, d.generator);
    spreads.set(key, layout);
    if (spreads.size > SPREADS_KEPT)
        spreads.delete(spreads.keys().next().value!);
    return layout;
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
    return spreadSize(region, Math.max(1, n)) * interval;
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
