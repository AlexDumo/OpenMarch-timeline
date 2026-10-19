/**
 * Marching-band dot fills for rough.js (ADR 0006 D-1).
 *
 * Excalidraw copies `element.fillStyle` into rough.js options unchanged, and the patched rough.js
 * (`patches/roughjs@4.6.4.patch`) asks `globalThis.__openmarchRoughFiller` for a filler before
 * its own lookup. Fill styles starting with `om-` are ours, so they serialize, undo, paste and
 * export like any built-in fill. Stock Excalidraw draws them as hachure.
 *
 * The fill style string carries its parameters: `om-<kind>:<param>:<size>`.
 * - `om-dots:22.5:m` a square grid, 22.5 scene units apart, medium dots
 * - `om-staggered:22.5:m` offset rows (hex packing)
 * - `om-even:24:m` 24 dots spread evenly over the shape
 *
 * Dots use the element's background color. Output is deterministic.
 */

export type Point = [number, number];

export const OM_FILL_KINDS = ["dots", "staggered", "even"] as const;
export type OmFillKind = (typeof OM_FILL_KINDS)[number];
export type DotSize = "s" | "m" | "l";

export interface OmFill {
    kind: OmFillKind;
    /** Scene units between dots (dots, staggered); undefined means "from the stroke width" */
    spacing?: number;
    /** The number of dots (even) */
    count?: number;
    size: DotSize;
}

/** The default number of dots for an even fill */
export const DEFAULT_EVEN_COUNT = 24;

export function parseOmFill(
    fillStyle: string | undefined | null,
): OmFill | null {
    if (!fillStyle || !fillStyle.startsWith("om-")) return null;
    const [name, param, size] = fillStyle.slice(3).split(":");
    if (!(OM_FILL_KINDS as readonly string[]).includes(name ?? "")) return null;
    const kind = name as OmFillKind;
    const value = param ? Number(param) : undefined;
    const valid = value !== undefined && Number.isFinite(value) && value > 0;
    const dotSize: DotSize = size === "s" || size === "l" ? size : "m";
    if (kind === "even")
        return {
            kind,
            count: valid ? Math.round(value) : DEFAULT_EVEN_COUNT,
            size: dotSize,
        };
    return { kind, spacing: valid ? value : undefined, size: dotSize };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function formatOmFill(fill: OmFill): string {
    const param =
        fill.kind === "even"
            ? String(Math.max(1, Math.round(fill.count ?? DEFAULT_EVEN_COUNT)))
            : fill.spacing !== undefined
              ? String(round3(fill.spacing))
              : "";
    return `om-${fill.kind}:${param}:${fill.size}`;
}

/** A dot's radius in scene units: a share of the spacing, bounded so dots stay visible */
export function dotRadius(spacing: number, size: DotSize = "m"): number {
    const share = size === "s" ? 0.12 : size === "l" ? 0.3 : 0.2;
    const max = size === "s" ? 4 : size === "l" ? 9 : 6;
    return Math.max(1.2, Math.min(spacing * share, max));
}

interface Bounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

function boundsOf(polys: Point[][]): Bounds {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of polys)
        for (const [x, y] of p) {
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
        }
    return { minX, minY, maxX, maxY };
}

/** Inside intervals of the polygons on the horizontal line y (even-odd rule) */
export function rowIntervals(polys: Point[][], y: number): [number, number][] {
    const xs: number[] = [];
    for (const poly of polys) {
        for (let i = 0; i < poly.length; i++) {
            const [x1, y1] = poly[i]!;
            const [x2, y2] = poly[(i + 1) % poly.length]!;
            if (y1 === y2) continue;
            if (y >= Math.min(y1, y2) && y < Math.max(y1, y2))
                xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
        }
    }
    xs.sort((a, b) => a - b);
    const out: [number, number][] = [];
    for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i]!, xs[i + 1]!]);
    return out;
}

/**
 * Centers for a dot or staggered fill: rows `spacing` apart (staggered rows are closer, for hex
 * packing), columns centered in the shape. A dot is kept only when it fits whole inside the
 * outline.
 */
export function gridDotCenters(
    polys: Point[][],
    kind: "dots" | "staggered",
    spacing: number,
    size: DotSize = "m",
): Point[] {
    if (!(spacing > 0) || polys.length === 0) return [];
    const { minX, minY, maxX, maxY } = boundsOf(polys);
    const r = dotRadius(spacing, size);
    const h = maxY - minY;
    const w = maxX - minX;
    if (!(h >= 2 * r) || !(w >= 2 * r)) return [];
    const rowGap =
        kind === "staggered" ? (spacing * Math.sqrt(3)) / 2 : spacing;
    const rows = Math.floor((h - 2 * r) / rowGap + 1e-9);
    const y0 = minY + (h - rows * rowGap) / 2;
    const cols = Math.floor((w - 2 * r) / spacing + 1e-9);
    const inside = (ivs: [number, number][], x: number) =>
        ivs.some(([a, b]) => x - r >= a - 1e-6 && x + r <= b + 1e-6);
    const pts: Point[] = [];
    for (let j = 0; j <= rows; j++) {
        const y = y0 + j * rowGap;
        const shift = kind === "staggered" && j % 2 === 1 ? spacing / 2 : 0;
        const x0 = minX + (w - cols * spacing) / 2 + shift;
        const above = rowIntervals(polys, y - r * 0.9);
        const below = rowIntervals(polys, y + r * 0.9);
        const here = rowIntervals(polys, y);
        for (let i = shift ? -1 : 0; i <= cols; i++) {
            const x = x0 + i * spacing;
            if (inside(here, x) && inside(above, x) && inside(below, x))
                pts.push([x, y]);
        }
    }
    return pts;
}

/**
 * Centers for an even fill of exactly `count` dots (when the shape has room): rows spread
 * evenly top to bottom, dots shared between rows by their length and spread evenly in each.
 */
export function evenDotCenters(polys: Point[][], count: number): Point[] {
    return evenLayout(polys, count).centers;
}

/** An even fill's dots and the spacing they average, in scene units */
export function evenLayout(
    polys: Point[][],
    count: number,
): { centers: Point[]; spacing: number } {
    const none = { centers: [], spacing: 0 };
    const n = Math.max(0, Math.round(count));
    if (n === 0 || polys.length === 0) return none;
    const { minY, maxY, minX, maxX } = boundsOf(polys);
    const h = maxY - minY;
    const w = maxX - minX;
    if (!(h > 0) || !(w > 0)) return none;
    // The area estimate sets the spacing, which sets the number of rows
    let area = 0;
    const probes = 64;
    for (let k = 0; k < probes; k++) {
        const y = minY + ((k + 0.5) * h) / probes;
        for (const [a, b] of rowIntervals(polys, y))
            area += ((b - a) * h) / probes;
    }
    const spacing = Math.sqrt(Math.max(area, 1e-9) / n);
    const rows = Math.max(1, Math.min(n, Math.round(h / spacing)));
    const segments: { y: number; a: number; b: number }[] = [];
    for (let j = 0; j < rows; j++) {
        const y = minY + ((j + 0.5) * h) / rows;
        for (const [a, b] of rowIntervals(polys, y)) segments.push({ y, a, b });
    }
    const total = segments.reduce((sum, s) => sum + (s.b - s.a), 0);
    if (!(total > 0)) return none;
    // Largest remainder: every segment gets its share, the remainders go to the longest
    const shares = segments.map((s) => (n * (s.b - s.a)) / total);
    const counts = shares.map(Math.floor);
    let left = n - counts.reduce((a, b) => a + b, 0);
    const order = shares
        .map((share, i) => ({ i, rem: share - Math.floor(share) }))
        .sort((p, q) => q.rem - p.rem || p.i - q.i);
    for (const { i } of order) {
        if (left <= 0) break;
        counts[i]! += 1;
        left--;
    }
    const pts: Point[] = [];
    segments.forEach((s, i) => {
        const k = counts[i]!;
        for (let d = 0; d < k; d++)
            pts.push([s.a + ((d + 0.5) * (s.b - s.a)) / k, s.y]);
    });
    return { centers: pts, spacing };
}

/** The dot spacing a fill uses, given rough's `hachureGap` (stroke width × 4) */
export function fillSpacing(
    fill: OmFill,
    hachureGap: number,
    step: number,
): number {
    if (fill.spacing !== undefined) return fill.spacing;
    // thin, bold, extra bold = 1, 2, 4 steps
    return Math.max(step, (hachureGap / 4) * step);
}

/** Every dot center of a fill on these polygons */
export function omDotCenters(
    polys: Point[][],
    fill: OmFill,
    hachureGap = 8,
    step = 11.25,
): { centers: Point[]; radius: number } {
    if (fill.kind === "even") {
        const { centers, spacing } = evenLayout(
            polys,
            fill.count ?? DEFAULT_EVEN_COUNT,
        );
        return {
            centers,
            radius: dotRadius(spacing > 0 ? spacing : step * 2, fill.size),
        };
    }
    const spacing = fillSpacing(fill, hachureGap, step);
    return {
        centers: gridDotCenters(polys, fill.kind, spacing, fill.size),
        radius: dotRadius(spacing, fill.size),
    };
}
