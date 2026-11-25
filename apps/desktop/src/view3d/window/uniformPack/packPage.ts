/**
 * What the 3D View composes for a pack key (step 5 of fork #1257): which pack page to flatten in
 * the uniform pack worker, and which items to place over it. A key is `<pack or draft>#<mode>`
 * (`withMode`). A saved pack's page is its mode's, read from the pack itself; a draft's
 * (`itemDrafts.ts`) is the draft mode's layers, by file, with the PNGs of any overlay it added and
 * hasn't saved yet. Pure apart from reading the drawn drafts: no three.js, no workers.
 */
import {
    splitMode,
    type UniformPackValue,
} from "@/view3d/core/marchers/uniformArtwork";
import {
    drawnInMode,
    type UniformPackItem,
} from "@/view3d/core/uniformPack/format";
import { drawnDraft } from "./itemDrafts";

/**
 * Which layers a page draws: a pack's mode (its default when null), or, for a draft, the layer
 * files it names, with any new ones' PNGs
 */
export type PageLayers =
    | { mode: string | null }
    | { files: string[]; extra: Record<string, Uint8Array> };

export interface PackPagePlan {
    /** The pack or draft key, without the mode */
    pack: UniformPackValue;
    /** The drawn draft the key names, if it names one */
    draft: ReturnType<typeof drawnDraft>;
    /** What the worker flattens */
    which: PageLayers;
    /** The items to place: a draft's, in its mode; null means the ones the worker answers with */
    items: UniformPackItem[] | null;
}

export function packPagePlan(id: UniformPackValue): PackPagePlan {
    const { pack, mode } = splitMode(id);
    const draft = drawnDraft(pack);
    if (!draft) return { pack, draft, which: { mode }, items: null };
    const inMode = drawnInMode(draft.contents, mode);
    return {
        pack,
        draft,
        which: {
            files: inMode.layers.map((layer) => layer.file),
            extra: Object.fromEntries(
                inMode.layers.flatMap((layer) => {
                    const png = draft.layerImages[layer.file];
                    return png ? [[layer.file, png]] : [];
                }),
            ),
        },
        items: inMode.items,
    };
}

/** The flattened page's cache key: one page per (pack, dpi, layers drawn) */
export const packPageKey = (key: string, dpi: number, which: PageLayers) =>
    `${key}|${dpi}|${
        "files" in which ? which.files.join("+") : `#${which.mode ?? ""}`
    }`;
