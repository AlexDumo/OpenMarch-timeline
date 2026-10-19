// Custom rough.js fillers for marching-band "dot" fills. Wired in by the vite
// plugin in vite.config.ts (equivalent to a one-line `pnpm patch roughjs`).
//
// Fill names live in element.fillStyle, so they serialize, copy/paste, undo and
// export like any built-in fill:
//   om-dots            square grid
//   om-dots-staggered  offset rows (hex packing)
//   om-dots-even       rows and dots spread evenly between the edges of each row
// Optional spacing in scene units: "om-dots:24". Default spacing follows the
// stroke width picker (thin/bold/extra bold = 1/2/4 steps).

type Point = [number, number];
interface Op {
  op: "move" | "bcurveTo" | "lineTo";
  data: number[];
}
interface OpSet {
  type: "path" | "fillPath" | "fillSketch";
  ops: Op[];
}
interface RoughOptions {
  fillStyle?: string;
  hachureGap: number;
  strokeWidth: number;
}
interface Filler {
  fillPolygons(polygonList: Point[][], o: RoughOptions): OpSet;
}

export const OM_FILLS = ["om-dots", "om-dots-staggered", "om-dots-even"] as const;
export type OmFill = (typeof OM_FILLS)[number];

const STEP = 12;

export function parseOmFill(fillStyle: string | undefined) {
  if (!fillStyle || !fillStyle.startsWith("om-dots")) return null;
  const [kind, spacing] = fillStyle.split(":");
  if (!(OM_FILLS as readonly string[]).includes(kind)) return null;
  return { kind: kind as OmFill, spacing: spacing ? Number(spacing) : undefined };
}

function circleOps(cx: number, cy: number, r: number): Op[] {
  const k = 0.5522847498 * r;
  return [
    { op: "move", data: [cx + r, cy] },
    { op: "bcurveTo", data: [cx + r, cy + k, cx + k, cy + r, cx, cy + r] },
    { op: "bcurveTo", data: [cx - k, cy + r, cx - r, cy + k, cx - r, cy] },
    { op: "bcurveTo", data: [cx - r, cy - k, cx - k, cy - r, cx, cy - r] },
    { op: "bcurveTo", data: [cx + k, cy - r, cx + r, cy - k, cx + r, cy] },
  ];
}

/** Inside intervals of the polygons on the horizontal line y (even-odd rule). */
function rowIntervals(polys: Point[][], y: number): [number, number][] {
  const xs: number[] = [];
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      if (y1 === y2) continue;
      if ((y >= Math.min(y1, y2)) && (y < Math.max(y1, y2))) {
        xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
      }
    }
  }
  xs.sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]]);
  return out;
}

export function dotCenters(polys: Point[][], kind: OmFill, spacing: number): Point[] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of polys) for (const [x, y] of p) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const r = dotRadius(spacing);
  const pts: Point[] = [];
  const h = maxY - minY;
  if (kind === "om-dots-even") {
    const rows = Math.max(1, Math.round(h / spacing));
    for (let j = 0; j < rows; j++) {
      const y = minY + ((j + 0.5) * h) / rows;
      for (const [a, b] of rowIntervals(polys, y)) {
        const n = Math.max(1, Math.round((b - a) / spacing));
        for (let i = 0; i < n; i++) pts.push([a + ((i + 0.5) * (b - a)) / n, y]);
      }
    }
    return pts;
  }
  const rowGap = kind === "om-dots-staggered" ? (spacing * Math.sqrt(3)) / 2 : spacing;
  // keep whole dots inside the outline: rows inset by r, and a dot must be inside at y-r, y, y+r
  const rows = Math.max(0, Math.floor((h - 2 * r) / rowGap));
  const y0 = minY + (h - rows * rowGap) / 2; // center the rows vertically
  const inside = (ivs: [number, number][], x: number) => ivs.some(([a, b]) => x - r >= a - 1e-6 && x + r <= b + 1e-6);
  for (let j = 0; j <= rows; j++) {
    const y = y0 + j * rowGap;
    const shift = kind === "om-dots-staggered" && j % 2 === 1 ? spacing / 2 : 0;
    const above = rowIntervals(polys, y - r * 0.9);
    const below = rowIntervals(polys, y + r * 0.9);
    for (const [a, b] of rowIntervals(polys, y)) {
      // center the columns in the shape's width so the pattern is symmetric
      const cols = Math.floor((maxX - minX - 2 * r) / spacing);
      const x0 = minX + (maxX - minX - cols * spacing) / 2 + shift;
      const kStart = Math.ceil((a + r - x0) / spacing - 1e-6);
      for (let x = x0 + kStart * spacing; x <= b - r + 1e-6; x += spacing) {
        if (inside(above, x) && inside(below, x)) pts.push([x, y]);
      }
    }
  }
  return pts;
}

export const dotRadius = (spacing: number) => Math.max(1.5, Math.min(spacing * 0.2, 6));

class DotGridFiller implements Filler {
  fillPolygons(polygonList: Point[][], o: RoughOptions): OpSet {
    const parsed = parseOmFill(o.fillStyle)!;
    // Excalidraw sets hachureGap = strokeWidth * 4 -> thin/bold/extra = 1/2/4 steps
    const spacing = parsed.spacing ?? Math.max(STEP, (o.hachureGap / 4) * STEP);
    const r = dotRadius(spacing);
    const ops: Op[] = [];
    for (const [x, y] of dotCenters(polygonList, parsed.kind, spacing)) ops.push(...circleOps(x, y, r));
    // fillPath = solid fill with o.fill (the element's background color), in canvas and SVG
    return { type: "fillPath", ops };
  }
}

const filler = new DotGridFiller();
export function getOmFiller(o: RoughOptions, _helper: unknown): Filler | null {
  return parseOmFill(o.fillStyle) ? filler : null;
}
