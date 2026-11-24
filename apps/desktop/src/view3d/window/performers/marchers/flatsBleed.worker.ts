/**
 * Bleeds a composed uniform flats atlas off the main thread (`flatsAtlas.ts`): copies every region's edge
 * pixels outward (`bleedPlan`, worked out once per layout and kept), then hands back a premultiplied
 * ImageBitmap ready to upload, so the window never holds the atlas's pixels or a canvas.
 */
import { bleedPlan } from "@/view3d/core/marchers/uniformArtwork";

export interface FlatsBleedRequest {
    id: number;
    /** Identifies the plan: layout, atlas size and resolution. */
    key: string;
    W: number;
    H: number;
    /** How far to bleed, pixels. */
    steps: number;
    /** Each pixel's region from 1, 0 outside (`bleedPlan`); only needed the first time a key is seen. */
    mask: Uint8Array | null;
    /** The composed atlas, RGBA, not premultiplied (as `getImageData` gives it). */
    pixels: ArrayBuffer;
}

export type FlatsBleedResponse =
    | { id: number; bitmap: ImageBitmap }
    | { id: number; error: string; needsMask?: boolean };

const plans = new Map<string, { dst: Int32Array; from: Int32Array }>();

onmessage = async (event: MessageEvent<FlatsBleedRequest>) => {
    const { id, key, W, H, steps, mask, pixels } = event.data;
    try {
        let plan = plans.get(key);
        if (!plan) {
            if (!mask) {
                postMessage({
                    id,
                    error: "no plan",
                    needsMask: true,
                } satisfies FlatsBleedResponse);
                return;
            }
            plan = bleedPlan(mask, W, H, steps);
            plans.set(key, plan);
        }
        const px = new Uint32Array(pixels);
        for (let k = 0; k < plan.dst.length; k++)
            px[plan.dst[k]] = px[plan.from[k]];
        const bitmap = await createImageBitmap(
            new ImageData(new Uint8ClampedArray(pixels), W, H),
            {
                premultiplyAlpha: "premultiply",
                colorSpaceConversion: "none",
            },
        );
        postMessage({ id, bitmap } satisfies FlatsBleedResponse, {
            transfer: [bitmap],
        });
    } catch (error) {
        postMessage({
            id,
            error: String(error),
        } satisfies FlatsBleedResponse);
    }
};
