import type {
    Distribution,
    FilesDistribution,
    OutlineDistribution,
} from "./distribution";
import { rankOffset } from "./distribution";
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
 * Outline clockwise from the back-left corner
 */
export function distribute(input: DistributeInput): FrameSpot[] {
    if (input.n <= 0) return [];
    const { distribution } = input;
    if (distribution.mode === "outline") return outlineOf(input, distribution);
    // Even spread (#391) arrives in its ticket; until then it fills as Files
    return filesSpots(
        distribution.mode === "files"
            ? distribution
            : {
                  mode: "files",
                  layout: {
                      family: "shortBack",
                      files: Math.ceil(Math.sqrt(input.n)),
                      byFile: false,
                  },
                  stagger: [0, 1],
              },
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
    if (n < OUTLINE_MIN) return outlineLine(n, across);
    const sides = regionSides(input.region, n, d, across, deep);
    return outlineSpots(n, sides, d.oddGap, across, deep);
}

/** A Files layout as lines of marchers: how wide a full line is, and how many stand in each */
export interface LayoutLines {
    /** Spots in a full line: the block's width in spots */
    readonly width: number;
    /** Marchers in each line, from the back (the left file when turned) */
    readonly lines: readonly number[];
}

/**
 * Short back: full lines of `files`, the back one short. One line holds them all when there are
 * fewer than `files`, centered in the block's width.
 */
export function layoutLines(
    layout: FilesDistribution["layout"],
    n: number,
): LayoutLines {
    const width = Math.max(1, Math.round(layout.files));
    const count = Math.max(1, n);
    const ranks = Math.ceil(count / width);
    const lines = Array.from({ length: ranks }, (_, i) =>
        i === 0 ? count - (ranks - 1) * width : width,
    );
    return { width, lines };
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
    const { width, lines } = layoutLines(d.layout, n);
    const byFile = d.layout.byFile;
    const along = byFile ? deep : across;
    const apart = byFile ? across : deep;
    const count = lines.length;
    const spots: FrameSpot[] = [];
    for (let line = 0; line < count; line++) {
        const inLine = lines[line]!;
        const lead = (width - inLine) / 2;
        // Rank r counts from the front, the stagger's own rank 0; turned, file 0 is the left one
        const offset = rankOffset(byFile ? line : count - 1 - line, d.stagger);
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
