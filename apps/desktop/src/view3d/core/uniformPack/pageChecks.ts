// cspell:words scanline
/**
 * Quiet notes about an imported flats page (docs/3d/uniform-artwork.md, "Preview and warnings"):
 * nothing painted on the uniform, a page with no transparency, and the template layer left
 * visible in the export. Read from the page's pixels at the template's size.
 *
 * The template check is the study prototype's: the share of the garment area that is exactly the
 * template's pale region fill (or its wrap band), opaque. Above 5%, the template layer was almost
 * certainly exported with the art.
 *
 * Pure: pixels in, notes out.
 */
import { REGION_FILL, WRAP_BAND_FILL } from "./templateColors";

/** A note about an imported page, worded where it's shown */
export type PageNote = "empty" | "opaque" | "template";

/** The front and back panels' regions, as `regions.json` gives them (panel inches) */
export interface PageRegions {
    panels: Record<string, { x: number; y: number; w: number; h: number }>;
    regions: {
        panel: string;
        polygon: readonly (readonly [number, number])[];
    }[];
}

/** Pixels sampled one in this many, across and down */
const STEP = 4;
/** Below this share of the garment area painted, the page is called empty */
const EMPTY_SHARE = 0.005;
/** Above this share of the garment area in the template's fill, the template was left visible */
const TEMPLATE_SHARE = 0.05;

const near = (r: number, g: number, b: number, rgb: number, tolerance = 4) =>
    Math.abs(r - ((rgb >> 16) & 0xff)) < tolerance &&
    Math.abs(g - ((rgb >> 8) & 0xff)) < tolerance &&
    Math.abs(b - (rgb & 0xff)) < tolerance;

/**
 * For each sampled row, the page-pixel x spans inside any garment region (front and back panels
 * only), by even-odd scanline fill.
 */
function garmentSpans(
    regions: PageRegions,
    dpi: number,
    width: number,
    height: number,
): Map<number, [number, number][]> {
    const rows = new Map<number, [number, number][]>();
    for (let y = 0; y < height; y += STEP) {
        const yIn = (y + 0.5) / dpi;
        const spans: [number, number][] = [];
        for (const region of regions.regions) {
            if (region.panel !== "front" && region.panel !== "back") continue;
            const panel = regions.panels[region.panel];
            if (!panel) continue;
            const py = yIn - panel.y;
            const xs: number[] = [];
            const poly = region.polygon;
            for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
                const [xi, yi] = poly[i];
                const [xj, yj] = poly[j];
                const aboveI = yi > py;
                const aboveJ = yj > py;
                if (aboveI !== aboveJ)
                    xs.push(((xj - xi) * (py - yi)) / (yj - yi) + xi);
            }
            xs.sort((a, b) => a - b);
            for (let k = 0; k + 1 < xs.length; k += 2) {
                const x0 = Math.max(0, Math.ceil((panel.x + xs[k]) * dpi));
                const x1 = Math.min(
                    width,
                    Math.floor((panel.x + xs[k + 1]) * dpi),
                );
                if (x1 > x0) spans.push([x0, x1]);
            }
        }
        if (spans.length) rows.set(y, spans);
    }
    return rows;
}

/**
 * The notes for a page's RGBA pixels (not premultiplied), `width` × `height` at `dpi` pixels per
 * inch, against the template's `regions`.
 */
export function pageNotes(
    pixels: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
    dpi: number,
    regions: PageRegions,
): PageNote[] {
    const notes: PageNote[] = [];
    // anything transparent at all, anywhere on the page
    let transparent = false;
    for (let i = 3; i < pixels.length; i += 4 * 7)
        if (pixels[i] < 250) {
            transparent = true;
            break;
        }
    if (!transparent) notes.push("opaque");

    let garment = 0;
    let painted = 0;
    let tint = 0;
    for (const [y, spans] of garmentSpans(regions, dpi, width, height))
        for (const [x0, x1] of spans)
            for (let x = x0 - (x0 % STEP); x < x1; x += STEP) {
                if (x < x0) continue;
                garment++;
                const o = (y * width + x) * 4;
                const a = pixels[o + 3];
                if (a > 8) painted++;
                if (
                    a > 250 &&
                    (near(
                        pixels[o],
                        pixels[o + 1],
                        pixels[o + 2],
                        REGION_FILL,
                    ) ||
                        near(
                            pixels[o],
                            pixels[o + 1],
                            pixels[o + 2],
                            WRAP_BAND_FILL,
                        ))
                )
                    tint++;
            }
    if (garment > 0 && painted / garment < EMPTY_SHARE) notes.push("empty");
    if (garment > 0 && tint / garment > TEMPLATE_SHARE) notes.push("template");
    return notes;
}
