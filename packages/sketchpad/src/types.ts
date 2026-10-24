import type { FieldPropertyArgs } from "@openmarch/core";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

/**
 * The Sketchpad's data model (ADR 0006 D-2, D-3). Hosts store these; the package never touches a
 * database or a file system.
 */

/** A color, 0 to 255 per channel and 0 to 1 alpha, like core's `RgbaColor` */
export interface RgbaColor {
    r: number;
    g: number;
    b: number;
    a: number;
}

/** A `FieldProperties` as JSON, as the show stores it */
export type FieldPropertiesJson = FieldPropertyArgs;

/** A field theme preset. "show" is the show's own theme, copied when the sketch was made. */
export type FieldStylePreset = "show" | "paper" | "turf" | "dark";

/** Colors the Field panel can change, on top of the preset */
export interface FieldColors {
    background: RgbaColor;
    /** Yard lines and the border */
    lines: RgbaColor;
    /** Hashes and half lines */
    hashes: RgbaColor;
    /** The step grid */
    grid: RgbaColor;
    /** Yard numbers */
    numbers: RgbaColor;
    /** Checkpoint labels outside the field */
    labels: RgbaColor;
}

/** How the field looks under a sketch. A template carries this; never the field layout. */
export interface FieldStyle {
    preset: FieldStylePreset;
    /** Colors changed from the preset */
    colors: Partial<FieldColors>;
    /** The step grid */
    grid: boolean;
    /** Half lines (every 4 steps on a football field) */
    halfLines: boolean;
    yardNumbers: boolean;
    /** Checkpoint labels outside the field */
    labels: boolean;
    /** 0 to 1 */
    opacity: number;
}

/** The field a sketch is drawn on: copied from the show when the sketch is made, never migrated */
export interface FieldSnapshot {
    fieldProperties: FieldPropertiesJson;
    style: FieldStyle;
}

/** One page of a sketch: one Excalidraw scene, with deleted elements kept (owner decision Q6) */
export interface SketchPage {
    id: string;
    name: string;
    elements: ExcalidrawElement[];
}

export const SKETCH_SCHEMA_VERSION = 1 as const;

/**
 * A sketch. Scene coordinates are field pixels in the snapshot's frame with the origin at the
 * field's centre front point (on the 50 at the front sideline), so content lines up by yard line
 * on another layout. Images are referred to by `fileId`, the sha256 of the file in the store.
 */
export interface SketchDoc {
    id: string;
    name: string;
    field: FieldSnapshot;
    pages: SketchPage[];
    schemaVersion: typeof SKETCH_SCHEMA_VERSION;
}

/** A page's drawing as SVG, for overlays (ADR 0006 D-7) */
export interface SketchPageRender {
    pageId: string;
    /** The drawing only, without the field; its viewBox is `bounds` in scene units */
    svg: string;
    /** In scene units (field pixels from the centre front), or null for an empty page */
    bounds: { x: number; y: number; width: number; height: number } | null;
}

/** What the package renders on every save */
export interface SketchRender {
    pages: SketchPageRender[];
    /** A small PNG of the first page on its field, for sidebars */
    thumbnail: Blob | null;
}

export interface SketchSummary {
    id: string;
    name: string;
    /** Milliseconds since the epoch */
    updatedAt: number;
}

/** Where a template can be saved, such as "This show" or "My Library" */
export interface TemplateDestination {
    id: "show" | "library" | (string & {});
    label: string;
}

/** A template keeps every page and the field style, never the field layout (ADR 0006 D-6) */
export interface SketchTemplate {
    id: string;
    name: string;
    style: FieldStyle;
    pages: SketchPage[];
    schemaVersion: typeof SKETCH_SCHEMA_VERSION;
}

export interface TemplateSummary {
    id: string;
    name: string;
    destination: TemplateDestination["id"];
}

export interface TemplateStore {
    /** The choices "Save as template" offers. The web build has only "show". */
    destinations: TemplateDestination[];
    list(): Promise<TemplateSummary[]>;
    load(id: string): Promise<SketchTemplate>;
    /** Saves a new template; `render.thumbnail` is a small PNG for the host's lists */
    save(
        template: SketchTemplate,
        destination: TemplateDestination["id"],
        render?: TemplateRender,
    ): Promise<void>;
    /**
     * Saves a template edited in a tab back where it came from (`key` is its id from `list()`).
     * Hosts without it can't open templates for editing.
     */
    update?(
        key: string,
        template: SketchTemplate,
        render: TemplateRender,
    ): Promise<void>;
    remove?(id: string): Promise<void>;
}

/** What the package renders when it saves a template */
export interface TemplateRender {
    /** A small PNG of the first page on the host's field, or null */
    thumbnail: Blob | null;
}

/** Everything the package needs from its host */
export interface SketchStore {
    list(): Promise<SketchSummary[]>;
    load(id: string): Promise<SketchDoc>;
    /** Idempotent; the last write wins */
    save(doc: SketchDoc, render: SketchRender): Promise<void>;
    remove(id: string): Promise<void>;
    getFile(sha256: string): Promise<Blob | undefined>;
    /** Stores a file and returns its sha256 */
    putFile(blob: Blob): Promise<string>;
    templates: TemplateStore;
}
