/**
 * Lays out the uniform flats template (docs/3d/uniform-artwork.md, "Flats
 * template" and "Guides") as a format-free drawing in page inches, which the
 * SVG, PDF and canvas writers render. Every guide is derived from the region
 * outlines in `regions.ts`; nothing here knows a body's shape.
 *
 * The drawing has three top-level groups, painted in order:
 *
 * - `background`: the white page
 * - `regions`: one shape per region, with the region's id, in panel inches
 *   inside a group per panel
 * - `guides`: everything else, guidance only
 *
 * Plain TypeScript only: this module lives under `view3d/core/`, so it must
 * not import React, React Three Fiber, drei, Electron or the database.
 */
// cspell:words inseam underarm paintable
import {
    SAFE_INSET,
    WRAP_BAND_SHARE,
    bottomOf,
    spanAt,
    wrapLine,
    type EdgeSide,
    type FlatsRegion,
    type FlatsRegions,
    type Point,
    type SeamRow,
} from "./regions";

export interface ShapeNode {
    readonly kind: "shape";
    readonly id?: string;
    /** Extra SVG attributes, such as `class` and `data-*`. */
    readonly attrs?: Readonly<Record<string, string>>;
    readonly points: readonly Point[];
    readonly closed: boolean;
    readonly fill?: string;
    readonly stroke?: string;
    /** Stroke width, inches. */
    readonly width?: number;
    /** Dash and gap length, inches; solid when absent. */
    readonly dash?: number;
}

export interface TextNode {
    readonly kind: "text";
    /** The anchor point on the baseline, inches. */
    readonly x: number;
    readonly y: number;
    /** Font size, inches. */
    readonly size: number;
    readonly text: string;
    readonly color: string;
    readonly anchor: "start" | "middle" | "end";
    /** Degrees clockwise on the page (SVG's sense); -90 reads bottom to top. */
    readonly rotate?: number;
    readonly bold?: boolean;
}

export interface GroupNode {
    readonly kind: "group";
    readonly id?: string;
    /** Moves the children, inches. */
    readonly dx?: number;
    readonly dy?: number;
    readonly children: readonly DrawNode[];
}

export type DrawNode = ShapeNode | TextNode | GroupNode;

export interface UniformTemplateDrawing {
    /** The page, inches. */
    readonly width: number;
    readonly height: number;
    readonly dpi: number;
    readonly title: string;
    readonly description: string;
    readonly root: readonly GroupNode[];
}

export const COLORS = {
    page: "#ffffff",
    region: "#e8f0fe",
    band: "#c3d6f6",
    outline: "#1a73e8",
    seam: "#d93025",
    seamText: "#b3261e",
    safe: "#1a73e8",
    guide: "#7a8899",
    guideText: "#4f5b6b",
    regionText: "#7f9cc6",
    context: "#cfd4db",
    frame: "#c4ccd6",
    text: "#222222",
    secondary: "#444444",
} as const;

export const FONT_FAMILY = "Helvetica, Arial, sans-serif";

const SIZE = {
    pageTitle: 1.0,
    body: 0.5,
    panelTitle: 0.75,
    regionName: 0.6,
    label: 0.36,
    tickNumber: 0.3,
} as const;

const r3 = (v: number) => Math.round(v * 1000) / 1000;

function rect(x: number, y: number, w: number, h: number): Point[] {
    return [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
    ];
}

function ellipse(cx: number, cy: number, rx: number, ry: number): Point[] {
    const points: Point[] = [];
    for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        points.push([r3(cx + rx * Math.cos(a)), r3(cy + ry * Math.sin(a))]);
    }
    return points;
}

function text(
    x: number,
    y: number,
    size: number,
    value: string,
    color: string,
    anchor: TextNode["anchor"] = "start",
    extra: { rotate?: number; bold?: boolean } = {},
): TextNode {
    return {
        kind: "text",
        x: r3(x),
        y: r3(y),
        size,
        text: value,
        color,
        anchor,
        ...extra,
    };
}

function line(
    points: readonly Point[],
    stroke: string,
    width: number,
    dash?: number,
): ShapeNode {
    return {
        kind: "shape",
        points,
        closed: false,
        stroke,
        width,
        ...(dash ? { dash } : {}),
    };
}

/** A small triangle pointing left or right, its tip at `(x, y)`. */
function arrow(x: number, y: number, side: EdgeSide, size: number): ShapeNode {
    const d = side === "left" ? 1 : -1;
    return {
        kind: "shape",
        points: [
            [r3(x), r3(y)],
            [r3(x + d * size), r3(y - size * 0.5)],
            [r3(x + d * size), r3(y + size * 0.5)],
        ],
        closed: true,
        fill: COLORS.seamText,
    };
}

/** Rows of a region's outline every `step` inches, from just inside its top to just inside its bottom. */
function sampleSpans(
    region: FlatsRegion,
    step = 0.1,
): { y: number; left: number; right: number }[] {
    const top = region.bbox.y + 0.005;
    const bottom = bottomOf(region) - 0.005;
    const rows: SeamRow[] = [];
    const count = Math.max(1, Math.ceil((bottom - top) / step));
    for (let i = 0; i <= count; i++) {
        const y = top + ((bottom - top) * i) / count;
        const span = spanAt(region.polygon, y);
        if (span)
            rows.push({ y: r3(y), left: r3(span.left), right: r3(span.right) });
    }
    return rows;
}

function wrapBand(rows: readonly SeamRow[], side: EdgeSide): ShapeNode {
    const edge = rows.map((r): Point => [r[side], r.y]);
    const inner = rows.map((r): Point => [r3(wrapLine(r, side)), r.y]);
    return {
        kind: "shape",
        points: [...edge, ...inner.reverse()],
        closed: true,
        fill: COLORS.band,
    };
}

/** The dashed safe area: inside the wrap band and clear of the region's top and bottom. */
function safeArea(
    region: FlatsRegion,
    rows: readonly SeamRow[],
): ShapeNode | undefined {
    const top = region.bbox.y + SAFE_INSET.end;
    const bottom = bottomOf(region) - SAFE_INSET.end;
    const inside = rows.filter((r) => r.y >= top && r.y <= bottom);
    if (inside.length < 2) return undefined;
    const left = inside.map(
        (r): Point => [r3(wrapLine(r, "left") + SAFE_INSET.side), r.y],
    );
    const right = inside.map(
        (r): Point => [r3(wrapLine(r, "right") - SAFE_INSET.side), r.y],
    );
    if (left.some(([x], i) => x >= right[i][0])) return undefined;
    return {
        kind: "shape",
        points: [...left, ...right.reverse()],
        closed: true,
        stroke: COLORS.safe,
        width: 0.04,
        dash: 0.25,
    };
}

/** Seam ticks every inch of height on both edges, numbered every 2 in by their height. */
function seamTicks(region: FlatsRegion): DrawNode[] {
    const nodes: DrawNode[] = [];
    const first = Math.ceil(region.bbox.y + 0.3);
    const last = Math.floor(bottomOf(region) - 0.3);
    for (let y = first; y <= last; y++) {
        const span = spanAt(region.polygon, y);
        if (!span) continue;
        const major = y % 2 === 0;
        const reach = major ? 0.28 : 0.16;
        for (const side of ["left", "right"] as const) {
            const x = span[side];
            nodes.push(
                line(
                    [
                        [r3(x - reach), y],
                        [r3(x + reach), y],
                    ],
                    COLORS.seam,
                    major ? 0.05 : 0.035,
                ),
            );
            if (major) {
                const inward = side === "left" ? 1 : -1;
                nodes.push(
                    text(
                        x + inward * 0.34,
                        y + SIZE.tickNumber * 0.36,
                        SIZE.tickNumber,
                        String(y),
                        COLORS.seamText,
                        side === "left" ? "start" : "end",
                    ),
                );
            }
        }
    }
    return nodes;
}

const EDGE_TEXT = {
    outside: "outside",
    underarm: "underarm",
    inseam: "inseam",
    "right side": "their right side",
    "left side": "their left side",
} as const;

/**
 * Both edges' names at a height, with an arrow pointing at each edge, just
 * past the wrap band. The height is an odd inch, between two numbered ticks.
 */
function edgeLabels(region: FlatsRegion, at: number): DrawNode[] {
    const y = Math.round((at - 1) / 2) * 2 + 1;
    const span = spanAt(region.polygon, y);
    if (!span) return [];
    const row = { y, ...span };
    const nodes: DrawNode[] = [];
    for (const edge of region.edges) {
        const inward = edge.side === "left" ? 1 : -1;
        const tip = wrapLine(row, edge.side) + inward * 0.12;
        const baseline = y + SIZE.label * 0.36;
        nodes.push(arrow(tip, y, edge.side, 0.26));
        nodes.push(
            text(
                tip + inward * 0.36,
                baseline,
                SIZE.label,
                EDGE_TEXT[edge.name],
                COLORS.seamText,
                edge.side === "left" ? "start" : "end",
            ),
        );
    }
    return nodes;
}

/** A dashed guide across a region at a height, with its label above the line. */
function guideAcross(
    region: FlatsRegion,
    y: number,
    label: string,
    labelAt: "left" | "centre" = "left",
    below = false,
): DrawNode[] {
    const span = spanAt(region.polygon, y);
    if (!span) return [];
    const row = { y, ...span };
    const ly = below ? y + SIZE.label * 1.25 : y - 0.12;
    return [
        line(
            [
                [r3(span.left), y],
                [r3(span.right), y],
            ],
            COLORS.guide,
            0.04,
            0.3,
        ),
        labelAt === "left"
            ? text(
                  wrapLine(row, "left") + 0.15,
                  ly,
                  SIZE.label,
                  label,
                  COLORS.guideText,
              )
            : text(
                  (span.left + span.right) / 2,
                  ly,
                  SIZE.label,
                  label,
                  COLORS.guideText,
                  "middle",
              ),
    ];
}

/** A small cross marking a landmark, with its name beside it. */
function landmark(x: number, y: number, label: string): DrawNode[] {
    const s = 0.35;
    return [
        line(
            [
                [x - s, y],
                [x + s, y],
            ],
            COLORS.guideText,
            0.04,
        ),
        line(
            [
                [x, y - s],
                [x, y + s],
            ],
            COLORS.guideText,
            0.04,
        ),
        text(x + 0.5, y - 0.12, SIZE.label, label, COLORS.guideText),
    ];
}

/** Head, neck, hands and shoes in grey, for orientation: not paintable. */
function contextFigure(
    regions: readonly FlatsRegion[],
    centreX: number,
): ShapeNode[] {
    const torso = regions.find((r) => r.part === "torso")!;
    const neckW = torso.bbox.w * 0.27;
    const neckH = 4.5;
    const neckTop = torso.bbox.y - neckH;
    const headRx = torso.bbox.w * 0.19;
    const headRy = 4.8;
    const grey = (points: Point[]): ShapeNode => ({
        kind: "shape",
        points,
        closed: true,
        fill: COLORS.context,
    });
    const shapes = [
        grey(
            rect(r3(centreX - neckW / 2), r3(neckTop), r3(neckW), neckH + 0.02),
        ),
        grey(ellipse(centreX, neckTop - headRy + 0.6, headRx, headRy)),
    ];
    for (const r of regions) {
        const rows = r.seams;
        const lastRow = rows[rows.length - 1];
        if (!lastRow) continue;
        const cx = (lastRow.left + lastRow.right) / 2;
        const w = lastRow.right - lastRow.left;
        const bottom = bottomOf(r);
        if (r.part.startsWith("sleeve"))
            shapes.push(grey(ellipse(cx, bottom + 3.2, w * 0.42, 3.2)));
        if (r.part.startsWith("leg"))
            shapes.push(grey(ellipse(cx, bottom + 1.5, w * 0.6, 1.5)));
    }
    return shapes;
}

/** Inch ticks down a panel's left edge, numbered every 6 in. */
function ruler(h: number): DrawNode[] {
    const nodes: DrawNode[] = [];
    for (let y = 1; y < h; y++)
        nodes.push(
            line(
                [
                    [0, y],
                    [y % 6 ? 0.3 : 0.7, y],
                ],
                COLORS.guide,
                0.03,
            ),
        );
    for (let y = 6; y < h; y += 6)
        nodes.push(
            text(0.85, y + 0.15, SIZE.tickNumber, String(y), COLORS.guide),
        );
    return nodes;
}

const PANEL_TITLES = {
    front: "FRONT, as you face the performer",
    back: "BACK, as you stand behind them",
} as const;

function panelGuides(model: FlatsRegions, panel: "front" | "back"): GroupNode {
    const s = model.source;
    const P = s.panels[panel];
    const mine = model.regions.filter((r) => r.panel === panel);
    const part = (p: string) => mine.find((r) => r.part === p)!;
    const torso = part("torso");
    const hips = part("hips");
    const nodes: DrawNode[] = [
        {
            kind: "shape",
            points: rect(0, 0, P.w, P.h),
            closed: true,
            stroke: COLORS.frame,
            width: 0.05,
        },
        ...ruler(P.h),
        text(
            0.4,
            1.1,
            SIZE.panelTitle,
            PANEL_TITLES[panel],
            COLORS.outline,
            "start",
            {
                bold: true,
            },
        ),
        ...contextFigure(mine, s.centreX),
    ];

    const spans = new Map(mine.map((r) => [r.id, sampleSpans(r)]));
    // The wrap band under everything else
    for (const r of mine)
        for (const side of ["left", "right"] as const)
            nodes.push(wrapBand(spans.get(r.id)!, side));

    // Centre line
    nodes.push(
        line(
            [
                [s.centreX, r3(torso.bbox.y - 5)],
                [s.centreX, r3(bottomOf(hips))],
            ],
            COLORS.guide,
            0.04,
            0.4,
        ),
        text(
            s.centreX + 0.2,
            torso.bbox.y - 4.4,
            SIZE.label,
            panel === "front" ? "centre front" : "centre back",
            COLORS.guideText,
        ),
    );

    // Guide lines
    nodes.push(
        ...guideAcross(torso, s.guides.collar + 0.02, "collar", "centre", true),
        ...guideAcross(torso, s.guides.chest, "chest"),
        ...guideAcross(
            hips,
            s.guides.hem + 0.02,
            "jacket hem and belt",
            "left",
            true,
        ),
        ...guideAcross(hips, s.guides.crotch - 0.02, "crotch"),
    );
    for (const side of ["L", "R"]) {
        nodes.push(
            ...guideAcross(part(`sleeve-${side}`), s.guides.elbow, "elbow"),
        );
        nodes.push(...guideAcross(part(`leg-${side}`), s.guides.knee, "knee"));
    }

    // Landmarks
    if (panel === "front")
        nodes.push(
            ...landmark(
                s.landmarks.chestCentre[0],
                s.landmarks.chestCentre[1] + 1.5,
                "chest centre",
            ),
        );
    else
        nodes.push(
            ...landmark(
                s.landmarks.backNumberCentre[0],
                s.landmarks.backNumberCentre[1],
                "back number centre",
            ),
        );

    // Safe areas
    for (const r of mine) {
        const safe = safeArea(r, spans.get(r.id)!);
        if (safe) nodes.push(safe);
    }

    // Outlines: the whole outline thin, the side seams red on top
    for (const r of mine) {
        nodes.push({
            kind: "shape",
            points: r.polygon,
            closed: true,
            stroke: COLORS.outline,
            width: 0.05,
        });
        const rows = spans.get(r.id)!;
        for (const side of ["left", "right"] as const)
            nodes.push(
                line(
                    rows.map((row): Point => [row[side], row.y]),
                    COLORS.seam,
                    0.08,
                ),
            );
        nodes.push(...seamTicks(r));
    }

    // Region names
    const mid = (r: FlatsRegion, a: number, b: number) => {
        const y = (a + b) / 2;
        const span = spanAt(r.polygon, y);
        return {
            x: span ? (span.left + span.right) / 2 : r.bbox.x + r.bbox.w / 2,
            y,
        };
    };
    {
        const at = mid(torso, s.guides.chest + 3, s.guides.hem);
        nodes.push(
            text(
                at.x,
                at.y,
                SIZE.regionName,
                torso.label,
                COLORS.regionText,
                "middle",
            ),
        );
        const h = mid(hips, s.guides.hem, s.guides.crotch);
        nodes.push(
            text(
                h.x,
                h.y + SIZE.regionName * 0.3,
                SIZE.regionName,
                hips.label,
                COLORS.regionText,
                "middle",
            ),
        );
    }
    for (const side of ["L", "R"]) {
        const sleeve = part(`sleeve-${side}`);
        const a = mid(sleeve, s.guides.elbow + 1, bottomOf(sleeve) - 1);
        nodes.push(
            text(
                a.x + SIZE.regionName * 0.35,
                a.y,
                SIZE.regionName,
                sleeve.label,
                COLORS.regionText,
                "middle",
                { rotate: -90 },
            ),
        );
        const leg = part(`leg-${side}`);
        const l = mid(leg, s.guides.knee + 1, bottomOf(leg) - 1);
        nodes.push(
            text(
                l.x + SIZE.regionName * 0.35,
                l.y,
                SIZE.regionName,
                leg.label,
                COLORS.regionText,
                "middle",
                { rotate: -90 },
            ),
        );
    }

    // Edge names: on the torso once, on every limb twice
    nodes.push(...edgeLabels(torso, s.guides.chest + 3));
    for (const side of ["L", "R"]) {
        const sleeve = part(`sleeve-${side}`);
        nodes.push(...edgeLabels(sleeve, sleeve.bbox.y + 3.5));
        nodes.push(...edgeLabels(sleeve, s.guides.elbow + 4));
        const leg = part(`leg-${side}`);
        nodes.push(...edgeLabels(leg, leg.bbox.y + 4));
        nodes.push(...edgeLabels(leg, s.guides.knee + 4));
    }

    // Which side is which, at the panel's foot
    const [onLeft, onRight] =
        panel === "front"
            ? ["performer's right", "performer's left"]
            : ["performer's left", "performer's right"];
    const footY = P.h - 0.6;
    nodes.push(
        arrow(0.5, footY, "left", 0.4),
        text(1.05, footY + 0.18, SIZE.body, onLeft, COLORS.secondary),
        arrow(P.w - 0.5, footY, "right", 0.4),
        text(
            P.w - 1.05,
            footY + 0.18,
            SIZE.body,
            onRight,
            COLORS.secondary,
            "end",
        ),
    );

    return {
        kind: "group",
        id: `guides-${panel}`,
        dx: P.x,
        dy: P.y,
        children: nodes,
    };
}

function capeGuides(model: FlatsRegions): GroupNode {
    const P = model.source.panels.cape;
    return {
        kind: "group",
        id: "guides-cape",
        dx: P.x,
        dy: P.y,
        children: [
            {
                kind: "shape",
                points: rect(0, 0, P.w, P.h),
                closed: true,
                stroke: COLORS.outline,
                width: 0.05,
            },
            line(
                [
                    [P.w / 2, 0],
                    [P.w / 2, P.h],
                ],
                COLORS.guide,
                0.04,
                0.4,
            ),
            text(
                0,
                -0.6,
                SIZE.panelTitle,
                "CAPE, seen from behind (optional)",
                COLORS.outline,
                "start",
                { bold: true },
            ),
            text(
                P.w / 2,
                0.8,
                SIZE.label,
                "top edge: the shoulders",
                COLORS.guideText,
                "middle",
            ),
            text(
                P.w / 2 + 0.2,
                P.h - 0.5,
                SIZE.label,
                "centre back",
                COLORS.guideText,
            ),
        ],
    };
}

/** Wraps text to lines of at most `max` characters. */
export function wrapText(value: string, max: number): string[] {
    const lines: string[] = [];
    let current = "";
    for (const word of value.split(" ")) {
        if (current && current.length + 1 + word.length > max) {
            lines.push(current);
            current = word;
        } else current = current ? `${current} ${word}` : word;
    }
    if (current) lines.push(current);
    return lines;
}

const HOW_TO = [
    "Paint on a new layer above this one. Leave this template as the bottom layer and hide it before you export.",
    "Paint the jacket, sleeves and pants inside the blue shapes. Draw sleeves and legs hanging straight down.",
    "The red outlines are the side seams, where the front meets the back. The darker strip inside each outline wraps round the side of the body and is squeezed there.",
    "Keep logos, numbers and text inside the dashed lines, so they aren't squeezed.",
    "The numbers on the seams are heights in inches. A stripe at the same number on the front and the back meets itself at the side.",
    "Left and right swap between the panels. Each sleeve and leg is labeled with its outside and its underarm or inseam.",
    "Head, neck, hands and shoes are grey: they take the uniform's colors, not artwork.",
    "Leave everything you don't paint transparent, so the uniform's colors show. Export a PNG at the template's full size.",
];

function legend(
    model: FlatsRegions,
    x: number,
    y: number,
    width: number,
): GroupNode {
    const nodes: DrawNode[] = [];
    let at = y;
    nodes.push(
        text(
            x,
            at,
            SIZE.panelTitle,
            "How to use this template",
            COLORS.text,
            "start",
            { bold: true },
        ),
    );
    at += 1.2;
    const max = Math.floor(width / (SIZE.body * 0.52));
    HOW_TO.forEach((item, i) => {
        const lines = wrapText(item, max - 4);
        lines.forEach((l, j) => {
            if (j === 0)
                nodes.push(text(x, at, SIZE.body, `${i + 1}.`, COLORS.text));
            nodes.push(text(x + 0.8, at, SIZE.body, l, COLORS.secondary));
            at += SIZE.body * 1.45;
        });
        at += SIZE.body * 0.5;
    });

    // Key
    at += 0.6;
    nodes.push(
        text(x, at, SIZE.panelTitle, "Key", COLORS.text, "start", {
            bold: true,
        }),
    );
    at += 1.0;
    const swatch = (
        fill: string | undefined,
        stroke: string | undefined,
        label: string,
        dash?: number,
    ) => {
        nodes.push({
            kind: "shape",
            points: rect(x, at - 0.5, 1.6, 0.7),
            closed: true,
            ...(fill ? { fill } : {}),
            ...(stroke ? { stroke, width: dash ? 0.04 : 0.08 } : {}),
            ...(dash ? { dash } : {}),
        });
        nodes.push(text(x + 2.1, at, SIZE.body, label, COLORS.secondary));
        at += 1.1;
    };
    swatch(COLORS.region, COLORS.outline, "Paint here");
    swatch(
        COLORS.band,
        undefined,
        `Wraps round the side (the outer ${WRAP_BAND_SHARE * 100}%)`,
    );
    swatch(undefined, COLORS.seam, "Side seam, where the front meets the back");
    swatch(
        undefined,
        COLORS.safe,
        "Safe area for logos, numbers and text",
        0.25,
    );
    swatch(
        COLORS.context,
        undefined,
        "Not paintable: the uniform's colors only",
    );

    // 10 in scale bar
    at += 0.8;
    for (let i = 0; i < 10; i++)
        nodes.push({
            kind: "shape",
            points: rect(x + i, at - 0.5, 1, 0.5),
            closed: true,
            fill: i % 2 ? COLORS.page : COLORS.text,
            stroke: COLORS.text,
            width: 0.03,
        });
    nodes.push(text(x + 10.4, at - 0.08, SIZE.body, "10 in", COLORS.text));
    at += 1.4;
    for (const l of wrapText(
        `Sizes are real inches on the ${model.source.body} body. Other body types stretch round their girth; lengths stay the same.`,
        max,
    )) {
        nodes.push(text(x, at, SIZE.body, l, COLORS.secondary));
        at += SIZE.body * 1.45;
    }
    return { kind: "group", id: "legend", children: nodes };
}

export function uniformTemplateDrawing(
    model: FlatsRegions,
): UniformTemplateDrawing {
    const s = model.source;
    const { w, h } = s.page;
    const px = `${w * s.dpi} x ${h * s.dpi} px`;

    const regionGroups: GroupNode[] = (["front", "back", "cape"] as const).map(
        (panel) => ({
            kind: "group",
            id: `regions-${panel}`,
            dx: s.panels[panel].x,
            dy: s.panels[panel].y,
            children: model.regions
                .filter((r) => r.panel === panel)
                .map(
                    (r): ShapeNode => ({
                        kind: "shape",
                        id: r.id,
                        attrs: {
                            class: "region",
                            "data-panel": r.panel,
                            "data-part": r.part,
                        },
                        points: r.polygon,
                        closed: true,
                        fill: COLORS.region,
                    }),
                ),
        }),
    );

    const cape = s.panels.cape;
    const legendX = cape.x;
    const legendY = cape.y + cape.h + 3;
    const header: DrawNode[] = [
        text(
            s.panels.front.x,
            2.3,
            SIZE.pageTitle,
            "OpenMarch uniform template",
            COLORS.text,
            "start",
            { bold: true },
        ),
        text(
            s.panels.front.x,
            3.6,
            SIZE.body,
            `${w} x ${h} in, ${px} at ${s.dpi} px per inch. Sized for the ${s.body} body. Template: CC0 1.0 (public domain).`,
            COLORS.secondary,
        ),
        text(
            s.panels.front.x,
            4.5,
            SIZE.body,
            "Front: as you face the performer, their right is on your left. Back: as you stand behind them, their left is on your left.",
            COLORS.secondary,
        ),
    ];

    return {
        width: w,
        height: h,
        dpi: s.dpi,
        title: "OpenMarch uniform template",
        description: `Uniform flats template in inches (${w} x ${h} in; the PNG is ${px}). Paint inside the shapes in g#regions; their ids are front-torso, front-sleeve-L, front-sleeve-R, front-hips, front-leg-L, front-leg-R, the same with back-, and cape. Their points are panel inches inside a group moved to each panel. Everything in g#guides is guidance only. uniform-regions.json has the outlines, the side seam table, guide heights and landmarks.`,
        root: [
            {
                kind: "group",
                id: "background",
                children: [
                    {
                        kind: "shape",
                        points: rect(0, 0, w, h),
                        closed: true,
                        fill: COLORS.page,
                    },
                ],
            },
            { kind: "group", id: "regions", children: regionGroups },
            {
                kind: "group",
                id: "guides",
                children: [
                    ...header,
                    panelGuides(model, "front"),
                    panelGuides(model, "back"),
                    capeGuides(model),
                    legend(model, legendX, legendY, w - legendX - 1.5),
                ],
            },
        ],
    };
}
