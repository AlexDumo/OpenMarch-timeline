/**
 * Messages to and from the uniform pack worker (`uniformPack.worker.ts`, fork #1257). Every
 * untrusted image and pack file a uniform touches is read there, off the main thread: a picked
 * PNG, a pack file being imported, the pack the editor is asked to store, and a show's pack when
 * the 3D View draws it. One job per worker; `runUniformPackJob` starts a fresh one and ends it.
 */
import type {
    UniformPackItem,
    UniformPackManifest,
} from "@/view3d/core/uniformPack/format";
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
    /**
     * A pack file's layers drawn in order onto one bitmap of the whole page, at this size, plus
     * each item file decoded (fork #1258), for the window to place and grade per body type
     */
    | { type: "flatten"; bytes: Uint8Array; width: number; height: number }
    /** A picked PNG for a placed item: decoded, trimmed to its art, capped in size, re-encoded */
    | { type: "item"; bytes: Uint8Array }
    /** An item already drawn (an SVG): trimmed, capped and encoded like a PNG's */
    | {
          type: "itemPixels";
          width: number;
          height: number;
          pixels: Uint8ClampedArray;
      }
    /**
     * A pack file rewritten with `items`: its layers kept, its item files kept where still named,
     * and `files` (new item PNGs, from an `item` job) added
     */
    | {
          type: "withItems";
          bytes: Uint8Array;
          items: UniformPackItem[];
          files: Record<string, Uint8Array>;
      };

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
    | {
          type: "pack";
          manifest: UniformPackManifest;
          notes: PageNote[];
          /** Each item image's size, from its PNG header, by file (fork #1258) */
          itemSizes: Record<string, { width: number; height: number }>;
      }
    | {
          type: "flattened";
          bitmap: ImageBitmap;
          items: UniformPackItem[];
          itemBitmaps: { file: string; bitmap: ImageBitmap }[];
      }
    | {
          type: "itemImage";
          /** The stored image: trimmed to its art, at most `UNIFORM_ITEM_STORED_PX` a side */
          png: Uint8Array;
          bitmap: ImageBitmap;
          width: number;
          height: number;
      }
    | { type: "packFile"; bytes: Uint8Array }
    | { type: "refused"; code: UniformPackRefusal; message: string };
