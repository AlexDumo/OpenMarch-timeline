/**
 * The quiet notes the app gives a uniform pack (docs/3d/uniform-artwork.md, "Preview and
 * warnings" and "Placing items"), as sentences for the builder's refusals and the render
 * command's `report.json`. Pure: the page notes come from the app's `pageNotes`, the item checks
 * from the app's own sizing (`itemSize`, `tileLayout`, `regionUnder`).
 */
import {
    ITEM_MAX_IN,
    itemSize,
    regionUnder,
    type FlatsRegions,
} from "@/view3d/core/marchers/uniformArtwork";
import {
    ITEM_MIN_TILE_IN,
    type UniformPackItem,
} from "@/view3d/core/uniformPack/format";
import type { PageNote } from "@/view3d/core/uniformPack/pageChecks";

/** Under this, inches, an item's thinner side draws nothing visible: a pixel at 32 px/in */
export const ITEM_MIN_VISIBLE_IN = 1 / 32;

export interface Checked {
    /** Wrong for certain: the builder refuses */
    errors: string[];
    /** Worth a look: reported, not refused */
    warnings: string[];
}

const inches = (v: number) =>
    v >= 1 ? `${+v.toFixed(2)} in` : `${+v.toFixed(4)} in`;

/** A layer's page notes as sentences; `base` is true for a mode's (or the pack's) first layer */
export function layerNotes(
    layerId: string,
    notes: readonly (PageNote | "scaled" | "svgViewBox" | "palette")[],
    base: boolean,
): Checked {
    const out: Checked = { errors: [], warnings: [] };
    const at = `layer "${layerId}"`;
    for (const note of notes)
        switch (note) {
            case "template":
                out.errors.push(
                    `${at}: the template is left visible (its pale region fill covers over 5% of the garment area). Draw on a transparent page and leave the template out.`,
                );
                break;
            case "empty":
                (base ? out.errors : out.warnings).push(
                    `${at}: paints almost nothing inside the garment regions (under 0.5% of their area)${base ? "; a base layer should cover the garment" : ""}.`,
                );
                break;
            case "opaque":
                out.warnings.push(
                    `${at}: has no transparent pixels. Leave everything outside the regions clear, so the palette shows on the parts art can't reach.`,
                );
                break;
            case "paintedLogo":
                out.warnings.push(
                    `${at}: a shape standing alone on the fabric looks like a logo or number painted in. Painted art widens on fuller bodies; make it an item instead.`,
                );
                break;
            case "scaled":
            case "svgViewBox":
                out.errors.push(
                    `${at}: isn't the template's size, so the app would scale it to fit.`,
                );
                break;
            case "palette":
                break;
        }
    return out;
}

/**
 * Each item's problems: not drawn (a side over 120 in, a tile under 1 in), too thin to see, or
 * centred outside every region. `aspects` is each item image's width over height, by pack file.
 */
export function itemChecks(
    items: readonly UniformPackItem[],
    aspects: Readonly<Record<string, number>>,
    regions: FlatsRegions,
): Checked {
    const out: Checked = { errors: [], warnings: [] };
    for (const item of items) {
        const at = `item "${item.id}"`;
        const aspect = aspects[item.file];
        if (!(aspect > 0)) {
            out.errors.push(`${at}: its image ${item.file} has no size`);
            continue;
        }
        const tile = item.grade === "tile";
        const box = itemSize(item, aspect);
        const w = item.width ?? (item.height ?? 0) * aspect;
        const h = item.height ?? (item.width ?? 0) / aspect;
        const shape = `its image is ${aspect >= 1 ? `${+aspect.toFixed(3)} times wider than tall` : `${+(1 / aspect).toFixed(3)} times taller than wide`}`;
        if (!box) {
            if (tile && Math.min(w, h) < ITEM_MIN_TILE_IN)
                out.errors.push(
                    `${at}: one tile would be ${inches(w)} × ${inches(h)}, under the 1 in least, so the print isn't drawn (${shape}). Give the tile's width or height so both sides are at least 1 in.`,
                );
            else
                out.errors.push(
                    `${at}: would be ${inches(w)} × ${inches(h)}, over the ${ITEM_MAX_IN} in most on a side, so it isn't drawn (${shape}). Size it by its other side, or crop the image to its art.`,
                );
            continue;
        }
        const thin = Math.min(box.w, box.h);
        if (!tile && thin < ITEM_MIN_VISIBLE_IN)
            out.errors.push(
                `${at}: is ${inches(thin)} ${box.w < box.h ? "wide" : "tall"}, under a pixel at 32 px/in, so it can't be seen (${shape}). Make it at least ${inches(ITEM_MIN_VISIBLE_IN)} on its thinner side; for a thin line use grade "line" and size it by its length.`,
            );
        if (!tile && !regionUnder(regions, item.panel, item.at[0], item.at[1]))
            out.warnings.push(
                `${at}: its centre (${item.at[0]}, ${item.at[1]}) on the ${item.panel} panel is outside every region, so only the parts of it over a region show. "at" is in panel inches, as in uniform-regions.json.`,
            );
    }
    return out;
}
