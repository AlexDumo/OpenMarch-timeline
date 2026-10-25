import {
    BASELINE_BELOW_CENTER,
    fieldImagePlacement,
    fieldSvg,
    svgLine as line,
    svgNum as num,
    svgPaint as paint,
    svgText as text,
    type FieldProperties,
    type FieldSvgImage,
    type FieldSvgOptions,
    type FieldTheme,
    type RgbaColor,
} from "@openmarch/core";
import {
    resolveMarcherLook,
    type AppearanceComponentOptional,
} from "@/entity-components/appearance";

/**
 * Drill chart SVGs drawn straight from show data, with no canvas (field renderer migration,
 * #206). The layout is the 2D field's (`planField2d` and `fieldSvg` in `@openmarch/core`, the
 * marcher shapes and the pathways), and everything sits exactly on its coordinates:
 *
 * - Dots, pathways, midpoints and endpoints sit on their stored coordinates.
 * - Centered text is centered by the SVG renderer (`text-anchor`), so it doesn't depend on the
 *   font measured where the export ran. Yard numbers are centered on their yard line.
 * - The border is one closed outline around the field.
 *
 * The output is plain SVG 1.1 that `svg-to-pdfkit` (the PDF export) and browsers both draw.
 */

/** A field image to draw under the grid: its natural size (0 if unknown) and where to load it from. */
export type DrillChartFieldImage = FieldSvgImage;

export type DrillChartFieldOptions = FieldSvgOptions;

export { fieldImagePlacement, fieldSvg };

/** A dot on the chart: where it is and how it looks. */
export interface DrillChartDot {
    marcherId: number;
    label: string;
    x: number;
    y: number;
    /** Highest priority first (`resolveAppearanceFromStack`); empty for the theme's default */
    appearances: AppearanceComponentOptional[];
}

export interface DrillChartPath {
    previous?: { x: number; y: number };
    current: { x: number; y: number };
    next?: { x: number; y: number };
}

export const DOT_RADIUS = 5;
const PATHWAY_STROKE = 2;
const PATH_POINT_RADIUS = 3;
const MARCHER_LABEL_FONT_SIZE = 14;

/** One dot's shape, centered on its coordinate */
export function dotSvg(dot: DrillChartDot, theme: FieldTheme): string {
    const look = resolveMarcherLook(dot.appearances, theme);
    if (!look.visible) return "";
    const r = DOT_RADIUS;
    const colors = `${paint("fill", look.fill)} ${paint("stroke", look.outline)} stroke-width="1"`;
    // Drawn around the origin and moved into place: svg-to-pdfkit writes short numbers then, which
    // keeps a PDF of hundreds of dots about a third the size
    const attrs = `data-marcher-id="${dot.marcherId}" transform="translate(${num(dot.x)} ${num(dot.y)})"`;
    switch (look.shape) {
        case "square": {
            const side = r * Math.sqrt(Math.PI) * 1.2;
            return `<rect ${attrs} x="${num(-side / 2)}" y="${num(-side / 2)}" width="${num(side)}" height="${num(side)}" ${colors} />`;
        }
        case "triangle": {
            // Equilateral, slightly larger to keep its visual weight
            const halfWidth = r * 1.2;
            const halfHeight = (r * 1.2 * Math.sqrt(3)) / 2;
            const points = [
                [-halfWidth, halfHeight],
                [0, -halfHeight],
                [halfWidth, halfHeight],
            ]
                .map(([px, py]) => `${num(px!)},${num(py!)}`)
                .join(" ");
            return `<polygon ${attrs} points="${points}" ${colors} />`;
        }
        case "cross": {
            const s = r * 1.2;
            return `<g ${attrs}>${line(-s, -s, s, s, look.crossColor, 2)}${line(-s, s, s, -s, look.crossColor, 2)}</g>`;
        }
        default:
            return `<circle ${attrs} cx="0" cy="0" r="${num(r)}" ${colors} />`;
    }
}

/** A dot's drill number above it, or nothing when its label is hidden */
export function dotLabelSvg(dot: DrillChartDot, theme: FieldTheme): string {
    const look = resolveMarcherLook(dot.appearances, theme);
    if (!look.labelVisible) return "";
    return text({
        content: dot.label,
        x: dot.x,
        y:
            dot.y -
            DOT_RADIUS * 2.2 +
            BASELINE_BELOW_CENTER * MARCHER_LABEL_FONT_SIZE,
        fontSize: MARCHER_LABEL_FONT_SIZE,
        fontFamily: "courier new",
        color: theme.defaultMarcher.label,
        anchor: "middle",
        bold: true,
    });
}

/** A pathway with its midpoint and endpoint */
const pathVisualsSvg = (
    start: { x: number; y: number },
    end: { x: number; y: number },
    color: RgbaColor,
) => {
    const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    return [
        line(start.x, start.y, end.x, end.y, color, PATHWAY_STROKE),
        `<circle cx="${num(mid.x)}" cy="${num(mid.y)}" r="${PATH_POINT_RADIUS}" fill="rgb(255,255,255)" ${paint("stroke", color)} stroke-width="2" />`,
        `<circle cx="${num(end.x)}" cy="${num(end.y)}" r="${PATH_POINT_RADIUS}" ${paint("fill", color)} />`,
    ].join("\n");
};

/**
 * An individual chart's marks for one marcher: the paths from the previous position and to the
 * next, a box on the previous position and a circle on the next.
 */
export function pathSvg(path: DrillChartPath, theme: FieldTheme): string {
    const out: string[] = [];
    if (path.previous)
        out.push(
            pathVisualsSvg(path.previous, path.current, theme.previousPath),
        );
    if (path.next)
        out.push(pathVisualsSvg(path.current, path.next, theme.nextPath));
    if (path.previous)
        out.push(
            `<rect x="${num(path.previous.x - 10)}" y="${num(path.previous.y - 10)}" width="20" height="20" fill="none" stroke="rgb(0,0,255)" stroke-width="3" />`,
        );
    if (path.next)
        out.push(
            // hsl(281, 82%, 63%)
            `<circle cx="${num(path.next.x)}" cy="${num(path.next.y)}" r="10" fill="none" stroke="rgb(189,83,238)" stroke-width="3" />`,
        );
    return out.join("\n");
}

/**
 * A whole chart: the field, every label, every dot, then the focused marcher's path and its dot
 * on top. The viewBox has `margin` around the field for the checkpoint labels.
 */
export function drillChartSvg({
    fieldProperties,
    field,
    dots,
    focus,
    margin = 40,
}: {
    fieldProperties: FieldProperties;
    /** `fieldSvg` output, shared by every chart of an export */
    field: string;
    dots: DrillChartDot[];
    focus?: { dot: DrillChartDot; path: DrillChartPath };
    margin?: number;
}): string {
    const { theme } = fieldProperties;
    const width = fieldProperties.width + margin * 2;
    const height = fieldProperties.height + margin * 2;
    const parts = [
        `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>`,
        `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="${num(width)}" height="${num(height)}" viewBox="${num(-margin)} ${num(-margin)} ${num(width)} ${num(height)}">`,
        field,
        ...dots.map((dot) => dotLabelSvg(dot, theme)),
        ...dots.map((dot) => dotSvg(dot, theme)),
    ];
    if (focus) {
        parts.push(pathSvg(focus.path, theme), dotSvg(focus.dot, theme));
    }
    parts.push("</svg>");
    return parts.filter((part) => part !== "").join("\n");
}
