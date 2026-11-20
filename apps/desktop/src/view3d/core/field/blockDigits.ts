/**
 * Block numerals for painted yard numbers: the heavy, square-shouldered
 * digits football fields are lettered with, 4 ft wide by 6 ft tall, with
 * narrow slot counters. Drawn from outlines rather than a font so they keep
 * the field's proportions whatever font the system has.
 *
 * Each digit is drawn on a 4 x 6 grid (feet, y down from the glyph's top)
 * with stems 1.3 wide and bars 1.25 tall, read off the reference photos'
 * numbers. Outlines run clockwise and counters counterclockwise on screen,
 * so one nonzero fill cuts the counters out.
 */

type Point = readonly [number, number];
type Ring = readonly Point[];

interface BlockGlyph {
    outer: Ring[];
    holes: Ring[];
}

export const BLOCK_GRID = { width: 4, height: 6 } as const;

const rect = (x0: number, y0: number, x1: number, y1: number): Ring => [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
];

const GLYPHS: Record<string, BlockGlyph> = {
    "0": { outer: [rect(0, 0, 4, 6)], holes: [rect(1.3, 1.25, 2.7, 4.75)] },
    "1": {
        outer: [
            [
                [0.85, 0],
                [3.1, 0],
                [3.1, 6],
                [1.8, 6],
                [1.8, 1.25],
                [0.85, 1.25],
            ],
        ],
        holes: [],
    },
    "2": {
        outer: [
            [
                [0, 0],
                [4, 0],
                [4, 3.6],
                [1.3, 3.6],
                [1.3, 4.75],
                [4, 4.75],
                [4, 6],
                [0, 6],
                [0, 2.4],
                [2.7, 2.4],
                [2.7, 1.25],
                [0, 1.25],
            ],
        ],
        holes: [],
    },
    "3": {
        outer: [
            [
                [0, 0],
                [4, 0],
                [4, 6],
                [0, 6],
                [0, 4.75],
                [2.7, 4.75],
                [2.7, 3.55],
                [0.9, 3.55],
                [0.9, 2.45],
                [2.7, 2.45],
                [2.7, 1.25],
                [0, 1.25],
            ],
        ],
        holes: [],
    },
    "4": {
        outer: [
            [
                [2, 0],
                [3.7, 0],
                [3.7, 3],
                [4, 3],
                [4, 4.2],
                [3.7, 4.2],
                [3.7, 6],
                [2.4, 6],
                [2.4, 4.2],
                [0, 4.2],
                [0, 3],
            ],
        ],
        holes: [
            [
                [2.4, 1.05],
                [2.4, 3],
                [1.1, 3],
            ],
        ],
    },
    "5": {
        outer: [
            [
                [0, 0],
                [4, 0],
                [4, 1.25],
                [1.3, 1.25],
                [1.3, 2.4],
                [4, 2.4],
                [4, 6],
                [0, 6],
                [0, 4.75],
                [2.7, 4.75],
                [2.7, 3.6],
                [0, 3.6],
            ],
        ],
        holes: [],
    },
    "6": {
        outer: [
            [
                [0, 0],
                [4, 0],
                [4, 1.25],
                [1.3, 1.25],
                [1.3, 2.4],
                [4, 2.4],
                [4, 6],
                [0, 6],
            ],
        ],
        holes: [rect(1.3, 3.6, 2.7, 4.75)],
    },
    "7": {
        outer: [
            [
                [0, 0],
                [4, 0],
                [4, 1.25],
                [2.9, 6],
                [1.5, 6],
                [2.55, 1.25],
                [0, 1.25],
            ],
        ],
        holes: [],
    },
    "8": {
        outer: [rect(0, 0, 4, 6)],
        holes: [rect(1.3, 1.25, 2.7, 2.45), rect(1.3, 3.55, 2.7, 4.75)],
    },
    "9": {
        outer: [
            [
                [0, 0],
                [4, 0],
                [4, 6],
                [0, 6],
                [0, 4.75],
                [2.7, 4.75],
                [2.7, 3.6],
                [0, 3.6],
            ],
        ],
        holes: [rect(1.3, 1.25, 2.7, 2.4)],
    },
};

/** Corner rounding, in grid feet: soft outer corners, as painted. */
const OUTER_RADIUS = 0.35;
const HOLE_RADIUS = 0.2;

/** Whether every character of `text` has a block numeral. */
export function hasBlockGlyphs(text: string): boolean {
    return text.length > 0 && [...text].every((c) => c in GLYPHS);
}

/** Twice the signed area of a ring; positive runs clockwise on screen. */
function area2(ring: Ring): number {
    let a = 0;
    ring.forEach(([x0, y0], i) => {
        const [x1, y1] = ring[(i + 1) % ring.length];
        a += x0 * y1 - x1 * y0;
    });
    return a;
}

/** Adds `ring` to the path with rounded corners, in the wanted direction. */
function addRing(
    g: CanvasRenderingContext2D,
    ring: Ring,
    clockwise: boolean,
    radius: number,
    k: number,
    ox: number,
    oy: number,
): void {
    const runsClockwise = area2(ring) > 0;
    const pts = runsClockwise === clockwise ? ring : [...ring].reverse();
    const n = pts.length;
    const at = ([x, y]: Point): Point => [ox + x * k, oy + y * k];
    const mid = (a: Point, b: Point): Point => [
        (a[0] + b[0]) / 2,
        (a[1] + b[1]) / 2,
    ];
    const start = at(mid(pts[n - 1], pts[0]));
    g.moveTo(start[0], start[1]);
    for (let i = 0; i < n; i++) {
        const p = pts[i];
        const q = pts[(i + 1) % n];
        const prev = pts[(i + n - 1) % n];
        // Never round more than half of either edge at the corner.
        const room = Math.min(
            Math.hypot(p[0] - prev[0], p[1] - prev[1]),
            Math.hypot(q[0] - p[0], q[1] - p[1]),
        );
        const r = Math.min(radius, room / 2) * k;
        const [cx, cy] = at(p);
        const [nx, ny] = at(mid(p, q));
        g.arcTo(cx, cy, nx, ny, r);
    }
    g.closePath();
}

/**
 * Paints `text` in block numerals, centered on the origin, each digit
 * `height` tall and two thirds as wide with `gap` between digits, glyph tops
 * toward -y. The caller sets the transform and fill style.
 */
export function paintBlockText(
    g: CanvasRenderingContext2D,
    text: string,
    height: number,
    gap: number,
): void {
    const k = height / BLOCK_GRID.height;
    const w = BLOCK_GRID.width * k;
    const chars = [...text];
    const total = chars.length * w + (chars.length - 1) * gap;
    g.beginPath();
    chars.forEach((c, i) => {
        const glyph = GLYPHS[c];
        const ox = -total / 2 + i * (w + gap);
        const oy = -height / 2;
        for (const ring of glyph.outer)
            addRing(g, ring, true, OUTER_RADIUS, k, ox, oy);
        for (const ring of glyph.holes)
            addRing(g, ring, false, HOLE_RADIUS, k, ox, oy);
    });
    g.fill("nonzero");
}
