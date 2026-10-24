import type { FieldProperties } from "./FieldProperties";
import type { RgbaColor } from "./FieldTheme";
import {
    planField2d,
    textCenterY,
    type FieldPlanOptions,
    type FieldPlanText,
} from "./fieldPlan";

/**
 * The 2D field as SVG markup, drawn from `planField2d`: the drill chart exports, the field
 * preview and the Sketchpad all draw the field with this.
 *
 * The output is plain SVG 1.1 (no outer `<svg>`), in field units, that `svg-to-pdfkit`,
 * `svg2pdf.js` and browsers all draw.
 */

/** A number for SVG markup, to three decimals */
export const svgNum = (n: number) => String(Math.round(n * 1000) / 1000);

/** Escapes text for SVG markup, dropping control characters XML forbids */
export const escapeXml = (text: string) =>
    text
        // eslint-disable-next-line no-control-regex
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

/** A number clamped to a range; anything that isn't a finite number becomes `min` */
const clamp = (value: unknown, min: number, max: number) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
};

/**
 * `rgb()` plus an opacity attribute, as SVG 1.1 and `svg-to-pdfkit` expect. Colors come from
 * show and sketch files, so every channel is forced to a number before it reaches the markup.
 */
export const svgPaint = (kind: "fill" | "stroke", color: RgbaColor) => {
    const channel = (v: unknown) => Math.round(clamp(v, 0, 255));
    const alpha = clamp(color.a ?? 1, 0, 1);
    return (
        `${kind}="rgb(${channel(color.r)},${channel(color.g)},${channel(color.b)})"` +
        (alpha < 1 ? ` ${kind}-opacity="${svgNum(alpha)}"` : "")
    );
};

export const svgLine = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: RgbaColor,
    width: number,
    extra = "",
) =>
    `<line x1="${svgNum(x1)}" y1="${svgNum(y1)}" x2="${svgNum(x2)}" y2="${svgNum(y2)}" ${svgPaint("stroke", color)} stroke-width="${svgNum(width)}"${extra} />`;

export const svgText = ({
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
    `<text x="${svgNum(x)}" y="${svgNum(y)}" font-family="${escapeXml(fontFamily)}" font-size="${svgNum(fontSize)}" font-weight="${bold ? "bold" : "normal"}" text-anchor="${escapeXml(anchor)}" ${svgPaint("fill", color)}${extra} xml:space="preserve">${escapeXml(content)}</text>`;

/** A field image to draw under the grid: its natural size (0 if unknown) and where to load it from. */
export interface FieldSvgImage {
    href: string;
    width: number;
    height: number;
    /** The floor's physical size, centered on the field; null places it by fill or fit */
    size?: { widthM: number; heightM: number } | null;
}

export interface FieldSvgOptions extends Omit<FieldPlanOptions, "image"> {
    /** Drawn when the field properties show the field image */
    image?: FieldSvgImage;
    /** Leave out the checkpoint labels outside the field and the yard numbers */
    hideTexts?: { checkpointLabels?: boolean; yardNumbers?: boolean };
}

/** The field's markup in field units, with no outer `<svg>` */
export function fieldSvg(
    fieldProperties: FieldProperties,
    { gridLines, halfLines, image, hideTexts }: FieldSvgOptions,
): string {
    const plan = planField2d(fieldProperties, { gridLines, halfLines, image });
    const out: string[] = [];

    out.push(
        `<rect x="0" y="0" width="${svgNum(plan.width)}" height="${svgNum(plan.height)}" ${svgPaint("fill", plan.background)} />`,
    );
    if (plan.image && image) {
        const at = plan.image;
        out.push(
            `<image x="${svgNum(at.x)}" y="${svgNum(at.y)}" width="${svgNum(at.width)}" height="${svgNum(at.height)}" preserveAspectRatio="none" opacity="${svgNum(at.opacity)}" xlink:href="${escapeXml(image.href)}" />`,
        );
    }
    for (const l of plan.lines)
        out.push(svgLine(l.x1, l.y1, l.x2, l.y2, l.color, l.width));
    for (const t of plan.texts) {
        if (hideTexts?.checkpointLabels && t.role === "checkpointLabel")
            continue;
        if (hideTexts?.yardNumbers && t.role === "yardNumber") continue;
        out.push(fieldTextSvg(t));
    }

    const { border } = plan;
    out.push(
        `<rect x="${svgNum(border.x)}" y="${svgNum(border.y)}" width="${svgNum(border.width)}" height="${svgNum(border.height)}" fill="none" ${svgPaint("stroke", border.color)} stroke-width="${svgNum(border.strokeWidth)}" />`,
    );

    return out.join("\n");
}

/** A checkpoint label or yard number */
export function fieldTextSvg(t: FieldPlanText): string {
    const spacing = t.letterSpacing;
    const svg = svgText({
        content: t.text,
        // letter-spacing also follows the last character, so shift by half of it to center
        x: spacing && t.anchor === "middle" ? t.x + spacing / 2 : t.x,
        y: t.y,
        fontSize: t.fontSize,
        fontFamily: t.fontFamily,
        color: t.color,
        anchor: t.anchor,
        extra: spacing ? ` letter-spacing="${svgNum(spacing)}"` : "",
    });
    if (!t.flipped) return svg;
    const centerY = textCenterY(t);
    return `<g transform="matrix(-1 0 0 -1 ${svgNum(2 * t.x)} ${svgNum(2 * centerY)})">${svg}</g>`;
}
