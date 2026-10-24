/**
 * The Sketchpad's IPC contract (ADR 0006 D-4). The Sketchpad window and the editor's sidebar reach
 * the sketch tables only through these fixed `sketch:*` channels. Main checks the sender of every
 * call and validates every payload with the schemas here; nothing else in the show is reachable
 * from the window.
 *
 * Plain TypeScript and zod only: the preloads import the types, main imports the schemas. Nothing
 * here may import `@openmarch/sketchpad`'s code (it loads Excalidraw), only its types.
 */
import * as z from "zod";
import type {
    FieldPropertiesJson,
    SketchDoc,
    SketchTemplate,
} from "@openmarch/sketchpad";

/** Renderer → main, `invoke` */
export const SKETCH_CHANNELS = {
    /** Editor and window: the show's sketches, newest first in the sidebar's order */
    list: "sketch:list",
    /** Window: one sketch */
    load: "sketch:load",
    /** Window: stores a sketch and its render (idempotent, the last write wins) */
    save: "sketch:save",
    /** Editor and window: deletes a sketch, returning what `restore` needs to bring it back */
    remove: "sketch:remove",
    /** Editor: brings back a sketch `remove` deleted (the Undo toast) */
    restore: "sketch:restore",
    /** Editor: renames a sketch */
    rename: "sketch:rename",
    /** Editor: copies a sketch right below the original */
    duplicate: "sketch:duplicate",
    /** Window: an image by its sha256 */
    getFile: "sketch:get-file",
    /** Window: stores an image, returning its sha256 */
    putFile: "sketch:put-file",
    /** Editor and window: the templates in this show and in the Library */
    templates: "sketch:templates",
    /** Window: one template */
    templateLoad: "sketch:template-load",
    /** Window: saves a template to this show or to the Library */
    templateSave: "sketch:template-save",
    /** Editor and window: deletes a template, returning what `templateRestore` takes (Undo) */
    templateRemove: "sketch:template-remove",
    /** Editor: brings back a template `templateRemove` deleted */
    templateRestore: "sketch:template-restore",
    /** Editor: renames a template */
    templateRename: "sketch:template-rename",
    /** Editor: copies a template in the same place, as "<name> copy" */
    templateDuplicate: "sketch:template-duplicate",
    /** Editor: copies a template from this show to the Library, or back */
    templateCopy: "sketch:template-copy",
    /** Window: the show's current field, for new sketches */
    field: "sketch:field",
    /** Editor: opens the Sketchpad window, or focuses it, and asks it to open something */
    open: "sketch:open",
} as const;

/** Main → editor: a sketch or template changed; the payload is its id, or null for any */
export const SKETCH_CHANGED_CHANNEL = "sketch:changed";
/** Main → window: what the editor asked the window to open (`SketchOpenRequest`) */
export const SKETCH_OPEN_REQUEST_CHANNEL = "sketch:open-request";
/** Main → window: save every open sketch now, then answer on `sketch:flushed` with the token */
export const SKETCH_FLUSH_REQUEST_CHANNEL = "sketch:flush-request";
/** Window → main: the flush with this token finished */
export const SKETCH_FLUSHED_CHANNEL = "sketch:flushed";
/** Main → window: the editor renamed or deleted a sketch that may be open in a tab */
export const SKETCH_EXTERNAL_CHANGE_CHANNEL = "sketch:external-change";

/** How long main waits for the window's last save before closing it (ADR 0006 D-4) */
export const SKETCH_FLUSH_TIMEOUT_MS = 2000;

export const SKETCH_NAME_MAX = 200;
/** The largest sketch main stores, as JSON */
export const SKETCH_DOC_MAX_BYTES = 64 * 1024 * 1024;
/** The largest image in a sketch */
export const SKETCH_FILE_MAX_BYTES = 32 * 1024 * 1024;
export const SKETCH_THUMBNAIL_MAX_BYTES = 4 * 1024 * 1024;
export const SKETCH_SVG_MAX_CHARS = 32 * 1024 * 1024;
const SKETCH_PAGES_MAX = 500;

export type TemplateDestinationId = "show" | "library";

/* ----------------------------- schemas ----------------------------- */

export const sketchIdSchema = z.uuid();
const pageIdSchema = z
    .string()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9_:-]+$/);
export const sketchNameSchema = z.string().trim().min(1).max(SKETCH_NAME_MAX);
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const bytesSchema = (max: number) =>
    z
        .custom<Uint8Array>((v) => v instanceof Uint8Array, "Expected bytes")
        .refine((b) => b.byteLength <= max, `At most ${max} bytes`);

/** Excalidraw elements stay as they are (ADR 0006 D-3): only their id and type are checked */
const elementSchema = z.looseObject({
    id: z.string().min(1).max(200),
    type: z.string().min(1).max(50),
});
const pageSchema = z.object({
    id: pageIdSchema,
    name: z.string().max(SKETCH_NAME_MAX),
    elements: z.array(elementSchema),
});
const fieldStyleSchema = z.looseObject({
    preset: z.string().max(50),
});
const fieldPropertiesSchema = z.looseObject({
    xCheckpoints: z.array(z.unknown()),
    yCheckpoints: z.array(z.unknown()),
});

export const sketchDocSchema = z.object({
    id: sketchIdSchema,
    name: z.string().max(SKETCH_NAME_MAX),
    field: z.object({
        fieldProperties: fieldPropertiesSchema,
        style: fieldStyleSchema,
    }),
    pages: z.array(pageSchema).min(1).max(SKETCH_PAGES_MAX),
    schemaVersion: z.literal(1),
});

export const sketchTemplateSchema = z.object({
    id: sketchIdSchema,
    name: sketchNameSchema,
    style: fieldStyleSchema,
    pages: z.array(pageSchema).min(1).max(SKETCH_PAGES_MAX),
    schemaVersion: z.literal(1),
});

const boundsSchema = z
    .object({
        x: z.number().finite(),
        y: z.number().finite(),
        width: z.number().finite().nonnegative(),
        height: z.number().finite().nonnegative(),
    })
    .nullable();

export const sketchSaveSchema = z.object({
    doc: sketchDocSchema,
    render: z.object({
        pages: z
            .array(
                z.object({
                    pageId: pageIdSchema,
                    svg: z.string().max(SKETCH_SVG_MAX_CHARS),
                    bounds: boundsSchema,
                }),
            )
            .max(SKETCH_PAGES_MAX),
        thumbnail: bytesSchema(SKETCH_THUMBNAIL_MAX_BYTES).nullable(),
    }),
});

export const sketchRenameSchema = z.object({
    id: sketchIdSchema,
    name: sketchNameSchema,
});

/** Only the image types a sketch may hold (`isImageDataUrl` in the package) */
const imageMimeSchema = z.enum([
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/svg+xml",
    "image/avif",
    "image/bmp",
]);

export const sketchPutFileSchema = z.object({
    mime: imageMimeSchema,
    data: bytesSchema(SKETCH_FILE_MAX_BYTES).refine(
        (b) => b.byteLength > 0,
        "An image can't be empty",
    ),
});

export const sketchFileIdSchema = sha256Schema;

export const templateDestinationSchema = z.enum(["show", "library"]);

export const templateRefSchema = z.object({
    id: sketchIdSchema,
    destination: templateDestinationSchema,
});

export const templateSaveSchema = z.object({
    template: sketchTemplateSchema,
    destination: templateDestinationSchema,
    /** A small PNG for the sidebar; left out keeps the stored one */
    thumbnail: bytesSchema(SKETCH_THUMBNAIL_MAX_BYTES).nullable().optional(),
});

export const templateRenameSchema = templateRefSchema.extend({
    name: sketchNameSchema,
});

export const templateCopySchema = z
    .object({
        id: sketchIdSchema,
        from: templateDestinationSchema,
        to: templateDestinationSchema,
    })
    .refine((c) => c.from !== c.to, "Copy to the other place");

/** A deleted sketch as `remove` returns it, and `restore` takes it back */
export const removedSketchSchema = z.object({
    sketch: z.object({
        id: sketchIdSchema,
        kind: z.enum(["sketch", "template"]),
        name: z.string().max(SKETCH_NAME_MAX),
        field_json: z.string().max(SKETCH_DOC_MAX_BYTES),
        doc_json: z.string().max(SKETCH_DOC_MAX_BYTES),
        render_json: z.string().max(SKETCH_DOC_MAX_BYTES).nullable(),
        thumbnail: bytesSchema(SKETCH_THUMBNAIL_MAX_BYTES).nullable(),
        sort_index: z.number().finite(),
        created_at: z.string().max(40),
        updated_at: z.string().max(40),
    }),
    pins: z.array(
        z.object({
            id: z.number().int(),
            sketch_id: sketchIdSchema,
            page_id: pageIdSchema,
            beat_id: z.number().int().nullable(),
            opacity: z.number().gt(0).lte(1),
            position: z.enum(["below", "above"]),
        }),
    ),
});

/** A Library template file as `templateRemove` returns it (`SketchTemplateEntrySchema`'s shape) */
const libraryTemplateEntrySchema = z.object({
    schemaVersion: z.literal(1),
    id: sketchIdSchema,
    name: sketchNameSchema,
    createdAt: z.string().min(1).max(40),
    updatedAt: z.string().min(1).max(40),
    data: sketchTemplateSchema,
    files: z.record(
        z.string().regex(/^[0-9a-f]{64}$/),
        z.object({
            mime: z.string().min(1).max(50),
            base64: z.string().max(SKETCH_DOC_MAX_BYTES),
        }),
    ),
    thumbnail: z
        .string()
        .max(SKETCH_THUMBNAIL_MAX_BYTES * 2)
        .optional(),
});

/** A deleted template, for Undo: the show's row, or the Library's file */
export const removedTemplateSchema = z.discriminatedUnion("destination", [
    z.object({ destination: z.literal("show"), removed: removedSketchSchema }),
    z.object({
        destination: z.literal("library"),
        entry: libraryTemplateEntrySchema,
    }),
]);

/** What the editor asks the window to open */
export const sketchOpenRequestSchema = z.union([
    /** Only open or focus the window (it opens the latest sketch when it starts) */
    z.object({ kind: z.literal("window") }),
    z.object({ kind: z.literal("sketch"), id: sketchIdSchema }),
    z.object({ kind: z.literal("new"), blank: z.boolean().optional() }),
    z.object({ kind: z.literal("template"), template: templateRefSchema }),
    /** Opens a template in a tab to edit it */
    z.object({ kind: z.literal("edit-template"), template: templateRefSchema }),
]);

/* ------------------------------ types ------------------------------ */

export type RemovedSketch = z.infer<typeof removedSketchSchema>;
export type SketchOpenRequest = z.infer<typeof sketchOpenRequestSchema>;
export type TemplateRef = z.infer<typeof templateRefSchema>;
export type RemovedTemplate = z.infer<typeof removedTemplateSchema>;

/** A sketch as the sidebar lists it */
export interface SketchListItem {
    id: string;
    name: string;
    /** Milliseconds since the epoch */
    updatedAt: number;
    /** A small PNG, or null before the first render */
    thumbnail: Uint8Array | null;
}

export interface SketchTemplateListItem {
    id: string;
    name: string;
    destination: TemplateDestinationId;
    /** Milliseconds since the epoch */
    updatedAt: number;
    /** A small PNG, or null for a template saved without one */
    thumbnail: Uint8Array | null;
}

/** What `sketch:save` takes: the package's render, with the thumbnail as bytes */
export interface SketchSavePayload {
    doc: SketchDoc;
    render: {
        pages: { pageId: string; svg: string; bounds: unknown }[];
        thumbnail: Uint8Array | null;
    };
}

export interface SketchFilePayload {
    mime: string;
    data: Uint8Array;
}

export interface SketchExternalChange {
    id: string;
    change: "renamed" | "removed";
    name?: string;
}

export type { FieldPropertiesJson, SketchDoc, SketchTemplate };
