import type { SceneBounds } from "./exportPage";

/** The sidebar card's shape: thumbnails crop to this aspect ratio (width / height) */
export const THUMBNAIL_ASPECT = 16 / 9;
/** The smallest crop, as a share of the whole-field thumbnail's width */
export const THUMBNAIL_MIN_SHARE = 0.25;
/** The margin around the drawing, as a share of its larger side, and at least this many units */
export const THUMBNAIL_MARGIN_SHARE = 0.08;
export const THUMBNAIL_MARGIN_MIN = 16;

/**
 * What a thumbnail shows: the drawing with a small margin, at the card's aspect ratio, never
 * smaller than a quarter of the field's width (so one tiny stroke isn't blown up), and never
 * larger than the whole field with the drawing. An empty page shows the whole field (`full`).
 * Pure, on whole scene units.
 */
export function thumbnailBounds(
    drawing: SceneBounds | null,
    full: SceneBounds,
    aspect = THUMBNAIL_ASPECT,
): SceneBounds {
    if (!drawing) return full;
    const margin = Math.max(
        THUMBNAIL_MARGIN_MIN,
        THUMBNAIL_MARGIN_SHARE * Math.max(drawing.width, drawing.height),
    );
    let width = drawing.width + 2 * margin;
    let height = drawing.height + 2 * margin;
    width = Math.max(width, full.width * THUMBNAIL_MIN_SHARE);
    // Grow the short side to the aspect ratio, around the drawing's centre
    if (width / height < aspect) width = height * aspect;
    else height = width / aspect;
    if (width >= full.width && height >= full.height) return full;
    const cx = drawing.x + drawing.width / 2;
    const cy = drawing.y + drawing.height / 2;
    const x = Math.floor(cx - width / 2);
    const y = Math.floor(cy - height / 2);
    return {
        x,
        y,
        width: Math.ceil(cx + width / 2) - x,
        height: Math.ceil(cy + height / 2) - y,
    };
}
