/**
 * The uniform flats template's regions (docs/3d/uniform-artwork.md, "Flats
 * template" and "regions.json"): the garment outlines on the front and back
 * panels, in panel inches, and everything derived from them for the template
 * and for agents.
 *
 * Every guide on the template is drawn from these outlines, never from fixed
 * shapes, so a new set of outlines (fork #1255 makes them from the body
 * models) changes the whole template.
 *
 * Plain TypeScript only: this module lives under `view3d/core/`, so it must
 * not import React, React Three Fiber, drei, Electron or the database.
 */
// cspell:words inseam underarm paintable Hodgman

/** `[x, y]` in inches, x right and y down. */
export type Point = readonly [number, number];

export type FlatsPanelId = "front" | "back" | "cape";

/** The paintable parts on the front and back panels. */
export const FLATS_PARTS = [
    "torso",
    "sleeve-L",
    "sleeve-R",
    "hips",
    "leg-L",
    "leg-R",
] as const;
export type FlatsPart = (typeof FLATS_PARTS)[number];

export interface PanelRect {
    /** Page inches from the page's top-left. */
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
}

/**
 * The template's page layout, fixed by the design: the page, its DPI, the
 * panels and the front and back panels' centre line. Outlines are drawn to
 * fit it, so a source holds only outlines, guide heights and landmarks.
 */
export const FLATS_LAYOUT: {
    /** The body type the outlines are sized from. */
    readonly body: string;
    readonly page: { readonly w: number; readonly h: number };
    readonly dpi: number;
    readonly panels: Readonly<Record<FlatsPanelId, PanelRect>>;
    /** The centre line of the front and back panels, panel inches. */
    readonly centreX: number;
} = {
    body: "neutral-average",
    page: { w: 105, h: 88 },
    dpi: 32,
    panels: {
        front: { x: 4, y: 6, w: 34, h: 78 },
        back: { x: 42, y: 6, w: 34, h: 78 },
        cape: { x: 80, y: 10, w: 20.7, h: 17.9 },
    },
    centreX: 17,
};

/** Guide heights, panel inches from the panel's top. */
export interface FlatsGuides {
    readonly collar: number;
    readonly chest: number;
    /** The jacket's hem, which is also the belt line. */
    readonly jacketHem: number;
    readonly crotch: number;
    readonly knee: number;
    readonly elbow: number;
}

/**
 * The outlines and measurements a template is drawn from: the whole input.
 * Today this comes from the design study's fixture (`harnessFixture.ts`);
 * #1255 generates it from the body models.
 */
export interface FlatsRegionsSource {
    /**
     * Outlines in panel inches, each the side seam. One per paintable part
     * per panel is needed; shapes for any other part are ignored.
     */
    readonly regions: readonly {
        readonly panel: "front" | "back";
        readonly part: string;
        readonly polygon: readonly Point[];
        /**
         * Both side seams' x every `SEAM_STEP` inches, as the outlines'
         * generator measured them; computed from the outline when absent.
         */
        readonly seams?: readonly SeamRow[];
    }[];
    readonly guides: FlatsGuides;
    readonly landmarks: {
        /** On the front panel. */
        readonly chestCentre: Point;
        /** On the back panel. */
        readonly backNumberCentre: Point;
    };
    /**
     * The grey figure for orientation (head and neck, hat, shoes, hands), on
     * the front panel; the back panel shows its mirror image about the centre
     * line. Not paintable.
     */
    readonly figure?: {
        readonly shapes: readonly (readonly Point[])[];
        readonly hands: readonly {
            readonly cx: number;
            readonly cy: number;
            readonly rx: number;
            readonly ry: number;
        }[];
    };
}

/** How far the wrap band reaches in from each side seam, as a share of the half-width. */
export const WRAP_BAND_SHARE = 0.15;
/** Rows of the seam table, inches apart. */
export const SEAM_STEP = 0.25;
/** The safe area's inset past the wrap band, and from a region's top and bottom, inches. */
export const SAFE_INSET = { side: 0.25, end: 1 } as const;

export const PART_LABELS: Readonly<Record<FlatsPart | "cape", string>> = {
    torso: "Jacket body",
    "sleeve-L": "Left sleeve",
    "sleeve-R": "Right sleeve",
    hips: "Pants, belt to crotch",
    "leg-L": "Left pant leg",
    "leg-R": "Right pant leg",
    cape: "Cape, seen from behind (optional)",
};

export type EdgeSide = "left" | "right";

/**
 * What an edge is on the body: a limb's outside, underarm or inseam, or the
 * performer's right or left side of the torso and hips.
 */
export type EdgeName =
    | "outside"
    | "underarm"
    | "inseam"
    | "right side"
    | "left side";

export interface RegionEdge {
    readonly side: EdgeSide;
    readonly name: EdgeName;
    /** The edge on the other panel that this seam joins. */
    readonly meets: { readonly region: string; readonly side: EdgeSide };
}

/** One row of the seam table: the side seams' x at a height. */
export interface SeamRow {
    readonly y: number;
    readonly left: number;
    readonly right: number;
}

export interface FlatsRegion {
    /** `front-torso`, `back-sleeve-L`, … or `cape`. */
    readonly id: string;
    readonly panel: FlatsPanelId;
    readonly part: FlatsPart | "cape";
    readonly label: string;
    readonly polygon: readonly Point[];
    readonly bbox: PanelRect;
    /** Empty for the cape. */
    readonly edges: readonly RegionEdge[];
    /** Every `SEAM_STEP` inches inside the region; empty for the cape. */
    readonly seams: readonly SeamRow[];
}

export interface FlatsRegions {
    readonly source: FlatsRegionsSource;
    readonly regions: readonly FlatsRegion[];
}

export const round2 = (v: number) => Math.round(v * 100) / 100;

export function bboxOf(polygon: readonly Point[]): PanelRect {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [x, y] of polygon) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Where a polygon's outline crosses the height `y`, as its leftmost and
 * rightmost crossings, or undefined if the height misses it. The outlines are
 * one span wide at every height, so these are the two side seams.
 */
export function spanAt(
    polygon: readonly Point[],
    y: number,
): { left: number; right: number } | undefined {
    let left = Infinity;
    let right = -Infinity;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [xa, ya] = polygon[j];
        const [xb, yb] = polygon[i];
        if (ya <= y ? yb > y : yb <= y) {
            const x = xa + ((y - ya) / (yb - ya)) * (xb - xa);
            left = Math.min(left, x);
            right = Math.max(right, x);
        }
    }
    return left <= right ? { left, right } : undefined;
}

/** Whether a point is inside a polygon (even-odd). */
export function insidePolygon(polygon: readonly Point[], p: Point): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [xa, ya] = polygon[j];
        const [xb, yb] = polygon[i];
        if (
            (ya <= p[1] ? yb > p[1] : yb <= p[1]) &&
            p[0] < xa + ((p[1] - ya) / (yb - ya)) * (xb - xa)
        )
            inside = !inside;
    }
    return inside;
}

/** The seam table: both side seams every `SEAM_STEP` inches, strictly inside the region. */
export function seamTable(polygon: readonly Point[]): SeamRow[] {
    const { y, h } = bboxOf(polygon);
    const rows: SeamRow[] = [];
    // A whole number of steps, so every region's rows share heights
    const first = Math.floor(y / SEAM_STEP + 1e-9) * SEAM_STEP + SEAM_STEP;
    for (let at = first; at < y + h - 1e-6; at += SEAM_STEP) {
        const row = Number(at.toFixed(4));
        const span = spanAt(polygon, row);
        if (span)
            rows.push({
                y: row,
                left: round2(span.left),
                right: round2(span.right),
            });
    }
    return rows;
}

/** The side seam's x on an edge at a height, from the seam table, interpolated. */
export function seamAt(
    seams: readonly SeamRow[],
    side: EdgeSide,
    y: number,
): number | undefined {
    for (let i = 0; i + 1 < seams.length; i++) {
        const a = seams[i];
        const b = seams[i + 1];
        if (y >= a.y && y <= b.y) {
            const f = b.y === a.y ? 0 : (y - a.y) / (b.y - a.y);
            return a[side] + f * (b[side] - a[side]);
        }
    }
    const last = seams[seams.length - 1];
    return last && Math.abs(last.y - y) < 1e-9 ? last[side] : undefined;
}

/** The inner edge of the wrap band on one side of a seam row. */
export function wrapLine(row: SeamRow, side: EdgeSide): number {
    const reach = ((row.right - row.left) / 2) * WRAP_BAND_SHARE;
    return side === "left" ? row.left + reach : row.right - reach;
}

/**
 * Which of a region's edges is which. A limb's outside is the edge farther
 * from the centre line; its other edge is the underarm or inseam. On the
 * front panel the performer's right is on the left, and on the back panel it
 * is on the right.
 */
export function edgesOf(
    panel: "front" | "back",
    part: FlatsPart,
    centreX: number,
    bbox: PanelRect,
): RegionEdge[] {
    const other = panel === "front" ? "back" : "front";
    const meets = (side: EdgeSide) => ({
        region: `${other}-${part}`,
        // a seam joins the front's left edge to the back's right edge
        side: (side === "left" ? "right" : "left") as EdgeSide,
    });
    let names: [EdgeName, EdgeName];
    if (part === "torso" || part === "hips") {
        names =
            panel === "front"
                ? ["right side", "left side"]
                : ["left side", "right side"];
    } else {
        const inner = part.startsWith("sleeve") ? "underarm" : "inseam";
        const outerIsLeft = bbox.x + bbox.w / 2 < centreX;
        names = outerIsLeft ? ["outside", inner] : [inner, "outside"];
    }
    return [
        { side: "left", name: names[0], meets: meets("left") },
        { side: "right", name: names[1], meets: meets("right") },
    ];
}

const ORDER: readonly FlatsPart[] = FLATS_PARTS;

/** One step of Sutherland–Hodgman: the part of a polygon on the kept side of the height `y`. */
function cutAt(
    polygon: readonly Point[],
    y: number,
    keep: (py: number) => boolean,
): Point[] {
    const out: Point[] = [];
    for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i];
        const b = polygon[(i + 1) % polygon.length];
        const aIn = keep(a[1]);
        if (aIn) out.push(a);
        if (aIn !== keep(b[1])) {
            const f = (y - a[1]) / (b[1] - a[1]);
            out.push([round2(a[0] + f * (b[0] - a[0])), y]);
        }
    }
    return out;
}

/** The part of a polygon at or below the height `y` (y grows downward). */
export const cutAbove = (polygon: readonly Point[], y: number) =>
    cutAt(polygon, y, (py) => py >= y);

/** The part of a polygon at or above the height `y`. */
export const cutBelow = (polygon: readonly Point[], y: number) =>
    cutAt(polygon, y, (py) => py <= y);

/**
 * A part's outline trimmed so it never overlaps its neighbours: the torso
 * ends at the jacket hem line, the hips run from there to the crotch line,
 * and the legs start at the crotch line. Neighbours may share a line. For
 * outlines that already stop there, this changes nothing.
 */
function withoutOverlap(
    part: FlatsPart,
    polygon: readonly Point[],
    g: FlatsGuides,
): readonly Point[] {
    const top = Math.min(...polygon.map(([, y]) => y));
    const bottom = Math.max(...polygon.map(([, y]) => y));
    let out = polygon;
    if (part === "torso" && bottom > g.jacketHem)
        out = cutBelow(out, g.jacketHem);
    if (part === "hips") {
        if (top < g.jacketHem) out = cutAbove(out, g.jacketHem);
        if (bottom > g.crotch) out = cutBelow(out, g.crotch);
    }
    if (part.startsWith("leg-") && top < g.crotch)
        out = cutAbove(out, g.crotch);
    return out;
}

/** The template's regions, with seams, edges and boxes, from a source. */
export function flatsRegions(source: FlatsRegionsSource): FlatsRegions {
    const regions: FlatsRegion[] = [];
    for (const panel of ["front", "back"] as const)
        for (const part of ORDER) {
            const found = source.regions.find(
                (r) => r.panel === panel && r.part === part,
            );
            if (!found)
                throw new Error(`Uniform regions: no ${panel}-${part} outline`);
            const polygon = withoutOverlap(part, found.polygon, source.guides);
            const bbox = bboxOf(polygon);
            // The generator's seam rows, inside the (possibly trimmed) outline
            const seams = found.seams
                ? found.seams.filter(
                      (row) =>
                          row.y > bbox.y + 1e-6 &&
                          row.y < bbox.y + bbox.h - 1e-6,
                  )
                : seamTable(polygon);
            regions.push({
                id: `${panel}-${part}`,
                panel,
                part,
                label: PART_LABELS[part],
                polygon,
                bbox,
                edges: edgesOf(panel, part, FLATS_LAYOUT.centreX, bbox),
                seams,
            });
        }
    const cape = FLATS_LAYOUT.panels.cape;
    const capeOutline: Point[] = [
        [0, 0],
        [cape.w, 0],
        [cape.w, cape.h],
        [0, cape.h],
    ];
    regions.push({
        id: "cape",
        panel: "cape",
        part: "cape",
        label: PART_LABELS.cape,
        polygon: capeOutline,
        bbox: bboxOf(capeOutline),
        edges: [],
        seams: [],
    });
    return { source, regions };
}

/** A limb's centre line on a panel: the middle of its seams, averaged. */
export function centreLineX(region: FlatsRegion): number {
    const mids = region.seams.map((r) => (r.left + r.right) / 2);
    return mids.reduce((s, x) => s + x, 0) / Math.max(1, mids.length);
}

/** The bottom of a region: a sleeve's cuff or a leg's hem (`sleeveCuff`, `legHem`). */
export const bottomOf = (region: FlatsRegion) => region.bbox.y + region.bbox.h;

const VIEWS: Readonly<Record<FlatsPanelId, string>> = {
    front: "As you face the performer: their right is on your left.",
    back: "As you stand behind the performer: their left is on your left.",
    cape: "The cape seen from behind: their left is on your left.",
};

/** File names, for the downloads and for cross-references inside the files. */
export const UNIFORM_TEMPLATE_FILES = {
    png: "uniform-template.png",
    svg: "uniform-template.svg",
    pdf: "uniform-template.pdf",
    json: "uniform-regions.json",
} as const;

/**
 * `uniform-regions.json`: everything an agent needs, in numbers. Polygons
 * are in panel inches, so they work as clip paths in a panel-sized drawing
 * with no offsets.
 */
export function regionsJson(model: FlatsRegions): object {
    const s = model.source;
    const L = FLATS_LAYOUT;
    const find = (id: string) => model.regions.find((r) => r.id === id)!;
    const limb = (part: FlatsPart) => ({
        front: round2(centreLineX(find(`front-${part}`))),
        back: round2(centreLineX(find(`back-${part}`))),
    });
    return {
        format: "openmarch-uniform-flats",
        version: 1,
        units: "in",
        body: L.body,
        page: L.page,
        dpi: L.dpi,
        pagePx: { w: L.page.w * L.dpi, h: L.page.h * L.dpi },
        files: UNIFORM_TEMPLATE_FILES,
        coordinates:
            "Panel inches: x right and y down from the panel's top-left corner. Add the panel's x and y to get page inches.",
        panels: Object.fromEntries(
            (["front", "back", "cape"] as const).map((id) => [
                id,
                { ...L.panels[id], view: VIEWS[id] },
            ]),
        ),
        centreX: L.centreX,
        wrapBand: {
            share: WRAP_BAND_SHARE,
            about: `The outer ${WRAP_BAND_SHARE * 100}% of each half-width, measured in from each side seam, wraps round the side of the body and is squeezed there.`,
        },
        seams: {
            step: SEAM_STEP,
            about: "Each region's seams list both side seams' x at every step of height. Edges are named for the body. A seam joins the front panel's left edge to the back panel's right edge at the same height, so a stripe drawn at height y on both panels meets itself at both sides.",
        },
        regions: model.regions.map((r) => ({
            id: r.id,
            panel: r.panel,
            part: r.part,
            label: r.label,
            bbox: {
                x: round2(r.bbox.x),
                y: round2(r.bbox.y),
                w: round2(r.bbox.w),
                h: round2(r.bbox.h),
            },
            edges: r.edges,
            polygon: r.polygon,
            seams: r.seams,
        })),
        guides: [
            { id: "collar", y: s.guides.collar, label: "collar" },
            { id: "chest", y: s.guides.chest, label: "chest" },
            {
                id: "jacketHem",
                y: s.guides.jacketHem,
                label: "jacket hem and belt",
            },
            { id: "crotch", y: s.guides.crotch, label: "crotch" },
            {
                id: "knee",
                y: s.guides.knee,
                label: "knee",
                parts: ["leg-L", "leg-R"],
            },
            {
                id: "elbow",
                y: s.guides.elbow,
                label: "elbow",
                parts: ["sleeve-L", "sleeve-R"],
            },
        ],
        landmarks: {
            chestCentre: {
                panel: "front",
                x: s.landmarks.chestCentre[0],
                y: s.landmarks.chestCentre[1],
            },
            backNumberCentre: {
                panel: "back",
                x: s.landmarks.backNumberCentre[0],
                y: s.landmarks.backNumberCentre[1],
            },
            centreLines: Object.fromEntries(
                (["sleeve-L", "sleeve-R", "leg-L", "leg-R"] as const).map(
                    (p) => [p, limb(p)],
                ),
            ),
            sleeveCuff: round2(bottomOf(find("front-sleeve-L"))),
            legHem: round2(bottomOf(find("front-leg-L"))),
        },
    };
}
