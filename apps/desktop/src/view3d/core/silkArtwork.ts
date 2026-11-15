/**
 * Imported silk Artwork (fork #973): what an import must be, and where the
 * painted silk lies in the image. A painter starts from the shape's
 * template (`artworkTemplates`), whose page is the trim plus a ⅛ in bleed
 * on every side, and may hand back the whole page or only the trim; the
 * image's proportions say which.
 *
 * Plain TypeScript and zod only: this module lives under `view3d/core/`, so
 * it must not import React, React Three Fiber, drei, Electron or the
 * database.
 */
import * as z from "zod";
import type { TemplateSurface } from "./artworkTemplates/surfaces";
import { FIXED_BLEED } from "./artworkTemplates/surfaces";

/** The largest PNG a show takes: a 66 in fly at 300 DPI is well under it. */
export const SILK_ARTWORK_MAX_BYTES = 32 * 1024 * 1024;

/** The longest edge a silk texture gets; larger images are drawn smaller. */
export const SILK_ARTWORK_MAX_PX = 4096;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Whether bytes start like a PNG file. */
export function isPng(data: Uint8Array): boolean {
    return PNG_SIGNATURE.every((b, i) => data[i] === b);
}

/** An Artwork import, as the 3D window sends it to the editor. */
export const silkArtworkImportSchema = z.object({
    name: z.string().min(1).max(200),
    data: z
        .instanceof(Uint8Array)
        .refine((d) => d.length <= SILK_ARTWORK_MAX_BYTES, "PNG too large")
        .refine(isPng, "Not a PNG file"),
    width: z.number().int().positive().max(65535),
    height: z.number().int().positive().max(65535),
});

export type SilkArtworkImport = z.infer<typeof silkArtworkImportSchema>;

/** The trim's rectangle in the image, in fractions of its width and height. */
export interface ArtworkRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

const WHOLE: ArtworkRect = { x: 0, y: 0, width: 1, height: 1 };

/** How far an image's proportions may stray from a page's and still be one (0.3%). */
const PAGE_ASPECT_TOLERANCE = 0.003;

/**
 * Where a silk's trim lies in an image `width` × `height`: inside the
 * bleed when the image has the template page's proportions, else the
 * whole image (painted to the trim, or to any size: it is stretched).
 */
export function silkArtworkTrimRect(
    width: number,
    height: number,
    surface: TemplateSurface,
): ArtworkRect {
    const bleed = (FIXED_BLEED[surface.process] ?? { m: 0 }).m;
    const trimW = surface.width.m;
    const trimH = surface.height.m;
    if (!(bleed > 0) || !(width > 0 && height > 0)) return WHOLE;
    const pageW = trimW + 2 * bleed;
    const pageH = trimH + 2 * bleed;
    const aspect = width / height;
    const offPage = Math.abs(Math.log(aspect / (pageW / pageH)));
    const offTrim = Math.abs(Math.log(aspect / (trimW / trimH)));
    // the page's proportions, to within the pixels' rounding, and nearer
    // them than the trim's: the bleed is in it
    if (!(offPage < PAGE_ASPECT_TOLERANCE && offPage < offTrim)) return WHOLE;
    return {
        x: bleed / pageW,
        y: bleed / pageH,
        width: trimW / pageW,
        height: trimH / pageH,
    };
}
