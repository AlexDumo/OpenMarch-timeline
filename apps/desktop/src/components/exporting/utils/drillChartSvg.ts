import {
    FieldProperties,
    type Checkpoint,
    type FieldTheme,
    type RgbaColor,
} from "@openmarch/core";
import {
    resolveMarcherLook,
    type AppearanceComponentOptional,
} from "@/entity-components/appearance";

/**
 * Drill chart SVGs drawn straight from show data, with no canvas (field renderer migration,
 * #206). The layout is the 2D field's (`OpenMarchCanvas.createFieldGrid`, `CanvasMarcher` and
 * the pathway objects), except that everything sits exactly on its coordinates:
 *
 * - Dots, pathways, midpoints and endpoints sit on their stored coordinates. Fabric drew them,
 *   and the field's lines, half a grid line down and right.
 * - Centered text is centered by the SVG renderer (`text-anchor`), so it doesn't depend on the
 *   font measured where the export ran. Yard numbers are centered on their yard line.
 * - The border is one closed outline around the field.
 *
 * The output is plain SVG 1.1 that `svg-to-pdfkit` (the PDF export) and browsers both draw.
 */

/** A field image to draw under the grid: its natural size (0 if unknown) and where to load it from. */
export interface DrillChartFieldImage {
    href: string;
    width: number;
    height: number;
}

export interface DrillChartFieldOptions {
    gridLines: boolean;
    halfLines: boolean;
    /** Drawn when the field properties show the field image */
    image?: DrillChartFieldImage;
}

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
const GRID_STROKE = FieldProperties.GRID_STROKE_WIDTH;
const PATHWAY_STROKE = 2;
const PATH_POINT_RADIUS = 3;
/** Fabric's text box is 1.13 font sizes tall, with the baseline 0.778 of the way down */
const TEXT_BOX = 1.13;
const BASELINE_FROM_TOP = TEXT_BOX * (1 - 0.222);
const BASELINE_BELOW_CENTER = BASELINE_FROM_TOP - TEXT_BOX / 2;
const LABEL_FONT_SIZE = 20;
const MARCHER_LABEL_FONT_SIZE = 14;
/** Yard numbers: Fabric `charSpacing` 160, in thousandths of an em */
const YARD_NUMBER_SPACING = 0.16;
const HASH_WIDTH = 20;

const num = (n: number) => String(Math.round(n * 1000) / 1000);

const escapeXml = (text: string) =>
    text
        // Control characters XML forbids would make the SVG invalid
        // eslint-disable-next-line no-control-regex
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

/** `rgb()` plus an opacity attribute, as SVG 1.1 and `svg-to-pdfkit` expect */
const paint = (kind: "fill" | "stroke", color: RgbaColor) =>
    `${kind}="rgb(${color.r},${color.g},${color.b})"` +
    (color.a < 1 ? ` ${kind}-opacity="${num(color.a)}"` : "");

const line = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: RgbaColor,
    width: number,
    extra = "",
) =>
    `<line x1="${num(x1)}" y1="${num(y1)}" x2="${num(x2)}" y2="${num(y2)}" ${paint("stroke", color)} stroke-width="${num(width)}"${extra} />`;

const text = ({
    content,
    x,
    y,
    fontSize,
    fontFamily,
    color,
    anchor,
    bold = false,
    extra = "",
}: {
    content: string;
    x: number;
    /** Baseline */
    y: number;
    fontSize: number;
    fontFamily: string;
    color: RgbaColor;
    anchor: "start" | "middle" | "end";
    bold?: boolean;
    extra?: string;
}) =>
    `<text x="${num(x)}" y="${num(y)}" font-family="${fontFamily}" font-size="${num(fontSize)}" font-weight="${bold ? "bold" : "normal"}" text-anchor="${anchor}" ${paint("fill", color)}${extra} xml:space="preserve">${escapeXml(content)}</text>`;

/** Where the y grid starts (as in `createFieldGrid`) */
const gridStartY = (fieldProperties: FieldProperties): number => {
    const { yCheckpoints, centerFrontPoint, pixelsPerStep } = fieldProperties;
    if (yCheckpoints.length === 0) return centerFrontPoint.yPixels;
    const sorted = [...yCheckpoints].sort(
        (a, b) => b.stepsFromCenterFront - a.stepsFromCenterFront,
    );
    const firstVisible = yCheckpoints.reduce(
        (prev, curr) =>
            curr.visible &&
            curr.stepsFromCenterFront > prev.stepsFromCenterFront
                ? curr
                : prev,
        sorted[sorted.length - 1]!,
    );
    const start =
        firstVisible.stepsFromCenterFront !== 0 &&
        firstVisible.stepsFromCenterFront % 1 !== 0
            ? firstVisible
            : sorted[0]!;
    return (
        centerFrontPoint.yPixels + start.stepsFromCenterFront * pixelsPerStep
    );
};

const checkpointX = (fp: FieldProperties, c: Checkpoint) =>
    fp.centerFrontPoint.xPixels + c.stepsFromCenterFront * fp.pixelsPerStep;
const checkpointY = (fp: FieldProperties, c: Checkpoint) =>
    fp.centerFrontPoint.yPixels + c.stepsFromCenterFront * fp.pixelsPerStep;

/** Lines every `interval` px from `from`, both ways, on the field: `from` itself in [0, `end`) */
const linesFrom = (from: number, interval: number, end: number): number[] => {
    const out: number[] = [];
    for (let i = from; i < end; i += interval) if (i >= 0) out.push(i);
    for (let i = from - interval; i > 0; i -= interval) out.push(i);
    return out;
};

/** Where a field image goes, fit or fill (`OpenMarchCanvas.refreshBackgroundImageValues`) */
export const fieldImagePlacement = (
    fieldProperties: Pick<
        FieldProperties,
        "width" | "height" | "imageFillOrFit"
    >,
    image: Pick<DrillChartFieldImage, "width" | "height">,
) => {
    const { width, height } = fieldProperties;
    const fieldWider = image.width / image.height <= width / height;
    // "fill" covers the field; anything else fits inside it
    const byHeight =
        fieldProperties.imageFillOrFit === "fill" ? !fieldWider : fieldWider;
    const scale = byHeight ? height / image.height : width / image.width;
    return {
        x: (width - image.width * scale) / 2,
        y: (height - image.height * scale) / 2,
        width: image.width * scale,
        height: image.height * scale,
    };
};

// eslint-disable-next-line max-lines-per-function
export function fieldSvg(
    fieldProperties: FieldProperties,
    { gridLines, halfLines, image }: DrillChartFieldOptions,
): string {
    const fp = fieldProperties;
    const { width, height, pixelsPerStep, centerFrontPoint, theme } = fp;
    const out: string[] = [];

    out.push(
        `<rect x="0" y="0" width="${num(width)}" height="${num(height)}" ${paint("fill", theme.background)} />`,
    );

    if (fp.showFieldImage && image) {
        // An image whose size is unknown (it didn't decode) is stretched over the field
        const at =
            image.width > 0 && image.height > 0
                ? fieldImagePlacement(fp, image)
                : { x: 0, y: 0, width, height };
        out.push(
            `<image x="${num(at.x)}" y="${num(at.y)}" width="${num(at.width)}" height="${num(at.height)}" preserveAspectRatio="none" opacity="${num(fp.backgroundImageOpacity)}" xlink:href="${escapeXml(image.href)}" />`,
        );
    }

    const startY = gridStartY(fp);
    // Fabric's y loops start on the start line and only go back
    const backFrom = (from: number, interval: number) => {
        const out: number[] = [];
        for (let i = from; i > 0; i -= interval) out.push(i);
        return out;
    };

    if (gridLines) {
        for (const x of linesFrom(
            centerFrontPoint.xPixels,
            pixelsPerStep,
            width,
        ))
            out.push(line(x, 0, x, height, theme.tertiaryStroke, GRID_STROKE));
        for (const y of backFrom(startY, pixelsPerStep))
            out.push(line(0, y, width, y, theme.tertiaryStroke, GRID_STROKE));
    }

    if (halfLines) {
        if (fp.halfLineXInterval) {
            const interval = pixelsPerStep * fp.halfLineXInterval;
            for (const x of linesFrom(
                centerFrontPoint.xPixels,
                interval,
                width,
            ))
                out.push(
                    line(x, 0, x, height, theme.secondaryStroke, GRID_STROKE),
                );
        }
        if (fp.halfLineYInterval) {
            const interval = pixelsPerStep * fp.halfLineYInterval;
            for (const y of backFrom(startY - interval, interval))
                out.push(
                    line(0, y, width, y, theme.secondaryStroke, GRID_STROKE),
                );
        }
    }

    // Yard lines and hashes
    for (const xCheckpoint of fp.xCheckpoints) {
        if (!xCheckpoint.visible) continue;
        const x = checkpointX(fp, xCheckpoint);
        out.push(line(x, 0, x, height, theme.primaryStroke, GRID_STROKE));
        if (!fp.useHashes) continue;
        for (const yCheckpoint of fp.yCheckpoints) {
            if (!yCheckpoint.visible) continue;
            const y = checkpointY(fp, yCheckpoint);
            // As wide as Fabric's (the hash width plus the yard line), clipped to the field
            const half = (HASH_WIDTH + GRID_STROKE) / 2;
            out.push(
                yCheckpoint.useAsReference
                    ? line(
                          Math.max(x - half, 0),
                          y,
                          Math.min(x + half, width),
                          y,
                          theme.primaryStroke,
                          GRID_STROKE * 3,
                      )
                    : line(
                          Math.max(x - half, 0),
                          y,
                          Math.min(x + half, width),
                          y,
                          theme.secondaryStroke,
                          GRID_STROKE * 2,
                      ),
            );
        }
    }
    if (!fp.useHashes)
        for (const yCheckpoint of fp.yCheckpoints) {
            if (!yCheckpoint.visible) continue;
            const y = checkpointY(fp, yCheckpoint);
            out.push(line(0, y, width, y, theme.primaryStroke, GRID_STROKE));
        }

    // Checkpoint labels outside the field
    const label = (
        content: string,
        x: number,
        baseline: number,
        anchor: "start" | "middle" | "end",
    ) =>
        text({
            content,
            x,
            y: baseline,
            fontSize: LABEL_FONT_SIZE,
            fontFamily: "mono",
            color: theme.externalLabel,
            anchor,
        });
    const labelBaselineBelowTop = BASELINE_FROM_TOP * LABEL_FONT_SIZE;
    for (const xCheckpoint of fp.xCheckpoints) {
        if (!xCheckpoint.visible) continue;
        const x = checkpointX(fp, xCheckpoint);
        if (fp.bottomLabelsVisible)
            out.push(
                label(
                    xCheckpoint.terseName,
                    x,
                    centerFrontPoint.yPixels + 5 + labelBaselineBelowTop,
                    "middle",
                ),
            );
        if (fp.topLabelsVisible)
            out.push(
                label(
                    xCheckpoint.terseName,
                    x,
                    -25 + labelBaselineBelowTop,
                    "middle",
                ),
            );
    }
    const sidePadding = 10;
    for (const yCheckpoint of fp.yCheckpoints) {
        if (!yCheckpoint.visible) continue;
        const baseline =
            checkpointY(fp, yCheckpoint) +
            BASELINE_BELOW_CENTER * LABEL_FONT_SIZE;
        if (fp.leftLabelsVisible)
            out.push(
                label(yCheckpoint.terseName, -sidePadding, baseline, "end"),
            );
        if (fp.rightLabelsVisible)
            out.push(
                label(
                    yCheckpoint.terseName,
                    width + sidePadding,
                    baseline,
                    "start",
                ),
            );
    }

    out.push(...yardNumbersSvg(fp));

    // Border: three grid lines wide, just outside the field's edge
    const borderWidth = GRID_STROKE * 3;
    const inset = (borderWidth - GRID_STROKE) / 2;
    out.push(
        `<rect x="${num(-inset)}" y="${num(-inset)}" width="${num(width + 2 * inset)}" height="${num(height + 2 * inset)}" fill="none" ${paint("stroke", theme.primaryStroke)} stroke-width="${num(borderWidth)}" />`,
    );

    return out.join("\n");
}

/** Yard numbers on the field, centered on their yard line; the away side's upside down */
function yardNumbersSvg(fp: FieldProperties): string[] {
    const { homeStepsFromFrontToInside, homeStepsFromFrontToOutside } =
        fp.yardNumberCoordinates;
    if (
        homeStepsFromFrontToInside === undefined ||
        homeStepsFromFrontToOutside === undefined
    )
        return [];
    const { pixelsPerStep, centerFrontPoint, theme } = fp;
    const fontSize =
        (homeStepsFromFrontToInside - homeStepsFromFrontToOutside) *
        pixelsPerStep;
    const spacing = YARD_NUMBER_SPACING * fontSize;
    const away = fp.yardNumberCoordinates.awayStepsFromFrontToOutside;
    const out: string[] = [];
    const number = (content: string, x: number, top: number, flip: boolean) => {
        const centerY = top + (TEXT_BOX * fontSize) / 2;
        // letter-spacing also follows the last character, so shift by half of it to center
        const svg = text({
            content,
            x: x + spacing / 2,
            y: centerY + BASELINE_BELOW_CENTER * fontSize,
            fontSize,
            fontFamily: "Times New Roman",
            color: theme.fieldLabel,
            anchor: "middle",
            extra: ` letter-spacing="${num(spacing)}"`,
        });
        return flip
            ? `<g transform="matrix(-1 0 0 -1 ${num(2 * x)} ${num(2 * centerY)})">${svg}</g>`
            : svg;
    };
    for (const xCheckpoint of fp.xCheckpoints) {
        if (!xCheckpoint.fieldLabel) continue;
        const x = checkpointX(fp, xCheckpoint);
        out.push(
            number(
                xCheckpoint.fieldLabel,
                x,
                centerFrontPoint.yPixels -
                    homeStepsFromFrontToInside * pixelsPerStep,
                false,
            ),
        );
        if (away !== undefined)
            out.push(
                number(
                    xCheckpoint.fieldLabel,
                    x,
                    centerFrontPoint.yPixels - away * pixelsPerStep,
                    true,
                ),
            );
    }
    return out;
}

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

/** A pathway with its midpoint and endpoint (`OpenMarchCanvas.renderTemporaryPathVisuals`) */
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
