/**
 * Test bytes for uniform packs: a PNG's signature and header (the pack never decodes a layer,
 * only reads its size) and a manifest dressed in the sample's palette.
 */
import { SAMPLE_FLATS } from "@/view3d/core/marchers/uniformArtwork";
import { singleLayerManifest } from "../format";

/** A PNG header saying `width` × `height`, then `tag` so two of them differ */
export function fakePng(width = 3360, height = 2816, tag = 0): Uint8Array {
    const out = new Uint8Array(33);
    out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    out.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
    const view = new DataView(out.buffer);
    view.setUint32(16, width);
    view.setUint32(20, height);
    out[32] = tag;
    return out;
}

export const sampleManifest = (name = "Home uniform") =>
    singleLayerManifest({
        name,
        look: SAMPLE_FLATS.look,
        credits: { author: "A. Designer", license: "CC-BY-4.0" },
    });
