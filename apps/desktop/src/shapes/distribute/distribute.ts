import type { Distribution, FilesDistribution } from "./distribution";
import { NO_STAGGER, rankOffset, takesStagger } from "./distribution";
import { resolveLayout } from "./layouts";
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
 * the back rank (the left file when turned), along each from left (back) to right (front)
 */
export function distribute(input: DistributeInput): FrameSpot[] {
    if (input.n <= 0) return [];
    const { distribution } = input;
    if (distribution.mode === "outline") {
        // A region with corners (a box) gets its outline in #390; until then it fills as Files
        if (input.region.corners.length === 0)
            return roundOutlineSpots(input.n, input.across);
    }
    // Even spread arrives in #391; until then it fills as Files
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
