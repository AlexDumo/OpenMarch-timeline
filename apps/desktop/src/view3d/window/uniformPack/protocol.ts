/**
 * Messages between the 3D View window and the uniform pack worker (`uniformPack.worker.ts`, fork
 * #1257). Every untrusted image a uniform import or a show's pack holds is decoded there, never
 * in the window: a picked PNG, and each stored layer before the renderer draws it. One job per
 * worker; `runUniformPackJob` starts a fresh one and ends it.
 */
import type {
    PageNote,
    PageRegions,
} from "@/view3d/core/uniformPack/pageChecks";

export type UniformPackRequest =
    /** A picked PNG page: checked, scaled to the template's size if it isn't, re-encoded */
    | { type: "png"; bytes: Uint8Array; regions: PageRegions }
    /** A page already drawn at the template's size (an SVG): checked and encoded */
    | {
          type: "pixels";
          width: number;
          height: number;
          pixels: Uint8ClampedArray;
          regions: PageRegions;
      }
    /** A stored layer, decoded to a bitmap of this size for the renderer */
    | { type: "decode"; png: Uint8Array; width: number; height: number };

/** Why the worker refused an image */
export type UniformPackRefusal = "notPng" | "tooLarge" | "unreadable";

export type UniformPackResponse =
    | {
          type: "page";
          /** The page at the template's size, as the pack stores it */
          png: Uint8Array;
          notes: PageNote[];
          /** The picked image's size when it wasn't the template's, so it was scaled */
          scaledFrom: { width: number; height: number } | null;
      }
    | { type: "bitmap"; bitmap: ImageBitmap }
    | { type: "refused"; code: UniformPackRefusal; message: string };
