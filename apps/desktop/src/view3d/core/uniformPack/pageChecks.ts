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
 * The painted-logo check (fork #1258) looks for a shape that stands alone on the fabric, like a
 * crest or a number would, since painted art widens with each body's girth and a round crest goes
 * oval on fuller bodies. See {@link paintedLogoIn}.
 *
 * Pure: pixels in, notes out.
 */
import { REGION_FILL, WRAP_BAND_FILL } from "./templateColors";

/** A note about an imported page, worded where it's shown */
export type PageNote = "empty" | "opaque" | "template" | "paintedLogo";

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
    // only on a layer that paints the fabric: an overlay (a sash, an open front) is mostly
    // clear, and anything on it would stand alone on the clear "fabric"
    if (
        !notes.includes("template") &&
        garment > 0 &&
        painted / garment >= FABRIC_SHARE &&
        paintedLogoIn(pixels, width, dpi, regions)
    )
        notes.push("paintedLogo");
    return notes;
}

/** The painted-logo check runs only on a layer that paints at least this share of the garment */
const FABRIC_SHARE = 0.5;
/** The painted-logo check's grid, inches */
const LOGO_CELL_IN = 0.5;
/** A shape this size, inches, on both sides, could be a logo; smaller is a button, larger is fabric */
const LOGO_MIN_IN = 2.5;
const LOGO_MAX_IN = 16;
/** Longer side over shorter: wider than this is a stripe or a band */
const LOGO_MAX_ASPECT = 2.5;
/** Its cells as a share of its bounding box: below this it's a thin outline or scattered marks */
const LOGO_MIN_FILL = 0.2;
/** How far a color is from the fabric's to count as something on it (sum of channel differences) */
const LOGO_COLOR_DISTANCE = 72;

/**
 * True when some garment region holds a shape that looks like a logo painted into the fabric: a
 * patch of color unlike the region's main color, 2.5 to 16 in on each side, no more than 2.5×
 * longer than wide, that touches neither the region's edge nor its top or bottom. Stripes, bands
 * and sashes cross a region, so they touch its edges; buttons and piping are too small or too
 * thin.
 *
 * It is cheap: one sample per half inch (the pixel at each cell's centre), the region's main
 * color is the commonest of those (4 bits a channel, or "clear"), and the shapes are 4-connected
 * groups of cells. A false note is harmless: it only suggests making the shape an item.
 */
export function paintedLogoIn(
    pixels: Uint8Array | Uint8ClampedArray,
    width: number,
    dpi: number,
    regions: PageRegions,
): boolean {
    const height = Math.floor(pixels.length / 4 / width);
    for (const region of regions.regions) {
        if (region.panel !== "front" && region.panel !== "back") continue;
        const panel = regions.panels[region.panel];
        if (!panel) continue;
        const xs = region.polygon.map((p) => p[0]);
        const ys = region.polygon.map((p) => p[1]);
        const bx = Math.min(...xs);
        const by = Math.min(...ys);
        const cols = Math.ceil((Math.max(...xs) - bx) / LOGO_CELL_IN);
        const rows = Math.ceil((Math.max(...ys) - by) / LOGO_CELL_IN);
        if (cols < 3 || rows < 3) continue;
        // each cell: -1 outside the region, else its sampled color's bin (0 for clear)
        const bins = new Int32Array(cols * rows).fill(-1);
        const rgb = new Int32Array(cols * rows);
        const counts = new Map<number, number>();
        for (let r = 0; r < rows; r++)
            for (let c = 0; c < cols; c++) {
                const x = bx + (c + 0.5) * LOGO_CELL_IN;
                const y = by + (r + 0.5) * LOGO_CELL_IN;
                if (!insideOutline(region.polygon, x, y)) continue;
                const px = Math.floor((panel.x + x) * dpi);
                const py = Math.floor((panel.y + y) * dpi);
                if (px < 0 || py < 0 || px >= width || py >= height) continue;
                const o = (py * width + px) * 4;
                const clear = pixels[o + 3] < 128;
                const bin = clear
                    ? 0
                    : 1 +
                      ((pixels[o] >> 4) << 8) +
                      ((pixels[o + 1] >> 4) << 4) +
                      (pixels[o + 2] >> 4);
                bins[r * cols + c] = bin;
                rgb[r * cols + c] = clear
                    ? -1
                    : (pixels[o] << 16) | (pixels[o + 1] << 8) | pixels[o + 2];
                counts.set(bin, (counts.get(bin) ?? 0) + 1);
            }
        let fabric = 0;
        let most = -1;
        for (const [bin, n] of counts)
            if (n > most) {
                most = n;
                fabric = bin;
            }
        // the fabric's color: the first sampled cell in its bin
        const fabricRgb = rgb[bins.indexOf(fabric)];
        const off = (i: number) => {
            if (bins[i] < 0 || bins[i] === fabric) return false;
            const a = rgb[i];
            if (a < 0 || fabricRgb < 0) return true;
            const d =
                Math.abs(((a >> 16) & 255) - ((fabricRgb >> 16) & 255)) +
                Math.abs(((a >> 8) & 255) - ((fabricRgb >> 8) & 255)) +
                Math.abs((a & 255) - (fabricRgb & 255));
            return d > LOGO_COLOR_DISTANCE;
        };
        const seen = new Uint8Array(cols * rows);
        for (let start = 0; start < cols * rows; start++) {
            if (seen[start] || !off(start)) continue;
            // one 4-connected shape
            const stack = [start];
            seen[start] = 1;
            let n = 0;
            let c0 = cols;
            let c1 = -1;
            let r0 = rows;
            let r1 = -1;
            let edge = false;
            while (stack.length) {
                const i = stack.pop()!;
                n++;
                const r = Math.floor(i / cols);
                const c = i % cols;
                c0 = Math.min(c0, c);
                c1 = Math.max(c1, c);
                r0 = Math.min(r0, r);
                r1 = Math.max(r1, r);
                for (const [dr, dc] of [
                    [1, 0],
                    [-1, 0],
                    [0, 1],
                    [0, -1],
                ]) {
                    const rr = r + dr;
                    const cc = c + dc;
                    if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) {
                        edge = true;
                        continue;
                    }
                    const j = rr * cols + cc;
                    if (bins[j] < 0) {
                        edge = true;
                        continue;
                    }
                    if (!seen[j] && off(j)) {
                        seen[j] = 1;
                        stack.push(j);
                    }
                }
            }
            if (edge) continue;
            const w = (c1 - c0 + 1) * LOGO_CELL_IN;
            const h = (r1 - r0 + 1) * LOGO_CELL_IN;
            if (Math.min(w, h) < LOGO_MIN_IN || Math.max(w, h) > LOGO_MAX_IN)
                continue;
            if (Math.max(w, h) / Math.min(w, h) > LOGO_MAX_ASPECT) continue;
            if (n / ((c1 - c0 + 1) * (r1 - r0 + 1)) < LOGO_MIN_FILL) continue;
            return true;
        }
    }
    return false;
}

/** Even-odd point in polygon */
function insideOutline(
    poly: readonly (readonly [number, number])[],
    x: number,
    y: number,
): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i];
        const [xj, yj] = poly[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
            inside = !inside;
    }
    return inside;
}
