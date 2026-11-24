/**
 * Messages to and from the uniform pack worker (`uniformPack.worker.ts`, fork #1257). Every
 * untrusted image and pack file a uniform touches is read there, off the main thread: a picked
 * PNG, a pack file being imported, the pack the editor is asked to store, and a show's pack when
 * the 3D View draws it. One job per worker; `runUniformPackJob` starts a fresh one and ends it.
 */
import type { UniformPackManifest } from "@/view3d/core/uniformPack/format";
import type {
    PageNote,
    PageRegions,
} from "@/view3d/core/uniformPack/pageChecks";

/** How long one worker job may take */
export const UNIFORM_PACK_JOB_TIMEOUT_MS = 60_000;

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
    /**
     * A pack file: read and checked. With `regions`, its first layer is decoded too, for the
     * notes a picked page gets.
     */
    | { type: "pack"; bytes: Uint8Array; regions?: PageRegions }
    /** A pack file's layers drawn in order onto one bitmap of the whole page, at this size */
    | { type: "flatten"; bytes: Uint8Array; width: number; height: number };

/** Why the worker refused a job */
export type UniformPackRefusal =
    | "notPng"
    | "tooLarge"
    | "unreadable"
    | "notPack"
    | "newer"
    | "damaged";

export type UniformPackResponse =
    | {
          type: "page";
          /** The page at the template's size, as the pack stores it */
          png: Uint8Array;
          notes: PageNote[];
          /** The picked image's size when it wasn't the template's, so it was scaled */
          scaledFrom: { width: number; height: number } | null;
      }
    | { type: "pack"; manifest: UniformPackManifest; notes: PageNote[] }
    | { type: "bitmap"; bitmap: ImageBitmap }
    | { type: "refused"; code: UniformPackRefusal; message: string };
