/**
 * The show's own flags (fork #985, #1008): a flag is a show asset of kind `flag`, with a name, a
 * built-in silk shape and its Artwork (the painted PNG). A show may have as many as it likes.
 *
 * A flag is a piece of equipment (ADR 0015 D-3, amended 2026-11-25): Equipment cues hand it to
 * performers by its asset reference (`library:<id>@<version hash>`, ADR 0004), so changing silks is
 * an equipment change, as it is on the floor (a performer picks up another pole). Compile knows each
 * flag as an Equipment value of the Guard family that counts as holding a flag (`flagCueValues`).
 *
 * Parts: `artwork`, the PNG as imported (at most `SILK_ARTWORK_MAX_PX` on its longest edge), and
 * `thumbnail`, a small picture of the flag (`flagPicture.ts`) that the Assets view, the equipment
 * menus and the 2D field's icons show. The sidecar holds the shape and the Artwork's size.
 *
 * Pure: no React, no database.
 */
import { z } from "zod";
import { ALL_CARRIES, type CueValue } from "@openmarch/core";
import type { ShowAsset } from "@/db-functions/showAssets";
import { showAssetRefValue } from "./ref";
import { silkShapeOf, type SilkShapeId } from "@/view3d/core/sizes/silkShapes";

export const FLAG_ASSET_KIND = "flag";

/**
 * The silk shapes a new flag can have, for now (owner, 2026-11-25): the 6 ft flag's plain
 * rectangle only, until guard designers say what they need. With one shape the form shows no
 * choice. A flag stored with another shape still reads and draws as that shape.
 */
export const FLAG_SHAPES: readonly SilkShapeId[] = ["rectangle"];
/** The part that holds the Artwork's PNG */
export const FLAG_ARTWORK_PART = "artwork";
/** The part that holds the flag's small picture (PNG) */
export const FLAG_THUMBNAIL_PART = "thumbnail";

/** What a flag's sidecar holds. A shape this build doesn't know reads as the default. */
export const flagSidecarSchema = z.object({
    shape: z.string().max(64),
    /** The Artwork's size in pixels */
    width: z.number().int().positive(),
    height: z.number().int().positive(),
});

/** One of the show's flags, as the editor and the 3D View read it. */
export interface ShowFlag {
    /** The Equipment value that hands it out: `library:<id>@<version hash>` */
    readonly value: string;
    readonly id: string;
    readonly name: string;
    readonly shape: SilkShapeId;
    /** The Artwork's blob hash and size */
    readonly artwork: string;
    readonly width: number;
    readonly height: number;
    /** The picture's blob hash; undefined for a flag stored without one */
    readonly thumbnail: string | undefined;
}

/** A stored asset as a flag, or null when it isn't one this build can read. */
export function flagOfAsset(asset: ShowAsset): ShowFlag | null {
    if (asset.kind !== FLAG_ASSET_KIND) return null;
    const artwork = asset.parts[FLAG_ARTWORK_PART];
    const sidecar = flagSidecarSchema.safeParse(asset.sidecar);
    if (!artwork || !sidecar.success) return null;
    return {
        value: showAssetRefValue(asset),
        id: asset.id,
        name: asset.name,
        shape: silkShapeOf(sidecar.data.shape),
        artwork,
        width: sidecar.data.width,
        height: sidecar.data.height,
        thumbnail: asset.parts[FLAG_THUMBNAIL_PART],
    };
}

/** The show's flags, in the store's order (oldest first). */
export function showFlags(
    assets: readonly ShowAsset[] | null | undefined,
): ShowFlag[] {
    const out: ShowFlag[] = [];
    for (const asset of assets ?? []) {
        const flag = flagOfAsset(asset);
        if (flag) out.push(flag);
    }
    return out;
}

/** A flag as an Equipment value: in the Guard family, holding it counts as holding a flag. */
export function flagCueValue(flag: Pick<ShowFlag, "value" | "name">): CueValue {
    return {
        id: flag.value,
        type: "equipment",
        name: flag.name,
        label: flag.name,
        fits: ALL_CARRIES,
        holds: "flag",
        family: "guard",
    };
}

/** The values the show's flags add to the cue library, for compile (`CompileInput.values`). */
export const flagCueValues = (flags: readonly ShowFlag[]): CueValue[] =>
    flags.map(flagCueValue);

/**
 * A file's name without its extension, as a new flag's name: "Ballad silk.png" → "Ballad silk".
 * Empty for a file with no name of its own, for the designer to name.
 */
export function flagNameOfFile(fileName: string): string {
    const base = fileName.replace(/\.[^./\\]+$/, "").trim();
    return base.slice(0, 200);
}
