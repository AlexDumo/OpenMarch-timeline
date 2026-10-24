import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { createFieldSnapshot, normalizeFieldStyle } from "../field/fieldStyle";
import { uuid } from "../ids";
import {
    SKETCH_SCHEMA_VERSION,
    type FieldPropertiesJson,
    type FieldStyle,
    type SketchDoc,
    type SketchPage,
    type SketchTemplate,
} from "../types";

/** A page with no drawing */
export function createPage(
    name: string,
    elements: ExcalidrawElement[] = [],
): SketchPage {
    return { id: uuid(), name, elements };
}

/** A new sketch on the host's current field */
export function createSketchDoc({
    name,
    fieldProperties,
    style,
    pages,
}: {
    name: string;
    fieldProperties: FieldPropertiesJson;
    style?: Partial<FieldStyle>;
    pages?: SketchPage[];
}): SketchDoc {
    return {
        id: uuid(),
        name,
        field: createFieldSnapshot(fieldProperties, style),
        pages: pages && pages.length > 0 ? pages : [createPage("Page 1")],
        schemaVersion: SKETCH_SCHEMA_VERSION,
    };
}

/** The next free "Sketch N" (or "<base> N") name */
export function nextSketchName(
    existing: readonly string[],
    base = "Sketch",
): string {
    const taken = new Set(existing);
    for (let n = 1; ; n++) {
        const name = `${base} ${n}`;
        if (!taken.has(name)) return name;
    }
}

/** The next free "Page N" name in a sketch */
export function nextPageName(
    pages: readonly Pick<SketchPage, "name">[],
): string {
    return nextSketchName(
        pages.map((p) => p.name),
        "Page",
    );
}

/** The image types a sketch may hold; SVG is drawn as an image, so its scripts never run */
const IMAGE_DATA_URL =
    /^data:image\/(png|jpeg|gif|webp|svg\+xml|avif|bmp);base64,/i;

/** Whether a string is an image data URL, the only kind of URL a sketch file may carry */
export const isImageDataUrl = (dataURL: unknown): dataURL is string =>
    typeof dataURL === "string" && IMAGE_DATA_URL.test(dataURL);

export class SketchDocError extends Error {}

const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Checks and normalizes a sketch read from a store or a `.omsketch` file. Elements are kept as
 * they are, deleted ones included (ADR 0006 D-3); Excalidraw's `restore` repairs them on load.
 */
export function parseSketchDoc(input: unknown): SketchDoc {
    const raw =
        typeof input === "string" ? (JSON.parse(input) as unknown) : input;
    if (!isRecord(raw)) throw new SketchDocError("A sketch must be an object");
    if (raw.schemaVersion !== SKETCH_SCHEMA_VERSION)
        throw new SketchDocError(
            `Unsupported sketch version ${String(raw.schemaVersion)}; this build reads version ${SKETCH_SCHEMA_VERSION}`,
        );
    if (typeof raw.id !== "string" || !raw.id)
        throw new SketchDocError("A sketch needs an id");
    const field = raw.field;
    if (!isRecord(field) || !isRecord(field.fieldProperties))
        throw new SketchDocError("A sketch needs a field snapshot");
    const fp = field.fieldProperties;
    if (!Array.isArray(fp.xCheckpoints) || !Array.isArray(fp.yCheckpoints))
        throw new SketchDocError("The field snapshot needs checkpoints");
    if (!Array.isArray(raw.pages) || raw.pages.length === 0)
        throw new SketchDocError("A sketch needs at least one page");
    const pages: SketchPage[] = raw.pages.map((page, i) => {
        if (!isRecord(page))
            throw new SketchDocError(`Page ${i + 1} is not an object`);
        if (!Array.isArray(page.elements))
            throw new SketchDocError(`Page ${i + 1} has no elements list`);
        return {
            id: typeof page.id === "string" && page.id ? page.id : uuid(),
            name: typeof page.name === "string" ? page.name : `Page ${i + 1}`,
            elements: page.elements as ExcalidrawElement[],
        };
    });
    return {
        id: raw.id,
        name: typeof raw.name === "string" ? raw.name : "Sketch",
        field: {
            fieldProperties: fp as unknown as FieldPropertiesJson,
            style: normalizeFieldStyle(field.style as Partial<FieldStyle>),
        },
        pages,
        schemaVersion: SKETCH_SCHEMA_VERSION,
    };
}

/** The JSON a store or a `.omsketch` file keeps */
export function serializeSketchDoc(doc: SketchDoc): string {
    return JSON.stringify(doc);
}

/** The file type of a sketch saved to disk */
export const OMSKETCH_EXTENSION = ".omsketch";
export const OMSKETCH_MIME = "application/vnd.openmarch.sketch+json";

/** A `.omsketch` file: the sketch plus the image files it refers to, as data URLs */
export interface OmSketchFile {
    type: "openmarch-sketch";
    sketch: SketchDoc;
    files: Record<string, { mimeType: string; dataURL: string }>;
}

export function parseOmSketchFile(text: string): OmSketchFile {
    const raw = JSON.parse(text) as unknown;
    if (!isRecord(raw) || raw.type !== "openmarch-sketch")
        throw new SketchDocError("This is not an OpenMarch sketch file");
    return {
        type: "openmarch-sketch",
        sketch: parseSketchDoc(raw.sketch),
        files: parseOmSketchFiles(raw.files),
    };
}

/** The image files of a `.omsketch` file, keeping only image data URLs */
function parseOmSketchFiles(input: unknown): OmSketchFile["files"] {
    const files: OmSketchFile["files"] = {};
    if (!isRecord(input)) return files;
    for (const [id, file] of Object.entries(input)) {
        if (!isRecord(file) || !isImageDataUrl(file.dataURL)) continue;
        files[id] = {
            mimeType:
                typeof file.mimeType === "string"
                    ? file.mimeType
                    : file.dataURL.slice(5, file.dataURL.indexOf(";")),
            dataURL: file.dataURL,
        };
    }
    return files;
}

/** The sha256 file ids a sketch's live image elements refer to */
export function referencedFileIds(doc: Pick<SketchDoc, "pages">): string[] {
    const ids = new Set<string>();
    for (const page of doc.pages)
        for (const el of page.elements)
            if (el.type === "image" && !el.isDeleted && el.fileId)
                ids.add(el.fileId);
    return [...ids];
}

/** Drops deleted elements (compaction; not done on save, so collaboration can merge later) */
export function compactSketchDoc(doc: SketchDoc): SketchDoc {
    return {
        ...doc,
        pages: doc.pages.map((p) => ({
            ...p,
            elements: p.elements.filter((e) => !e.isDeleted),
        })),
    };
}

/** A template from a sketch: every page (or none) and the field style, never the layout */
export function templateFromDoc(
    doc: SketchDoc,
    {
        name,
        includeDrawing = true,
        includeFieldStyle = true,
    }: { name: string; includeDrawing?: boolean; includeFieldStyle?: boolean },
): SketchTemplate {
    return {
        id: uuid(),
        name,
        style: includeFieldStyle
            ? normalizeFieldStyle(doc.field.style)
            : normalizeFieldStyle({}),
        pages: includeDrawing
            ? compactSketchDoc(doc).pages.map((p) => ({ ...p }))
            : doc.pages.map((p) => ({ id: p.id, name: p.name, elements: [] })),
        schemaVersion: SKETCH_SCHEMA_VERSION,
    };
}

/** A new sketch from a template, on the host's current field */
export function docFromTemplate(
    template: SketchTemplate,
    fieldProperties: FieldPropertiesJson,
    name: string,
): SketchDoc {
    return createSketchDoc({
        name,
        fieldProperties,
        style: template.style,
        pages: template.pages.map((p) => ({
            id: uuid(),
            name: p.name,
            elements: p.elements.filter((e) => !e.isDeleted),
        })),
    });
}

/**
 * A template as a sketch, to edit it in a tab: its pages (ids kept) and field style on the
 * host's current field. Saving it back goes through `templateFromDoc` with the template's id, so
 * the layout never gets into the template (ADR 0006 D-6).
 */
export function docForTemplateEdit(
    template: SketchTemplate,
    fieldProperties: FieldPropertiesJson,
): SketchDoc {
    return {
        id: template.id,
        name: template.name,
        field: createFieldSnapshot(fieldProperties, template.style),
        pages:
            template.pages.length > 0
                ? template.pages.map((p) => ({ ...p }))
                : [createPage("Page 1")],
        schemaVersion: SKETCH_SCHEMA_VERSION,
    };
}

/** An edited template tab's doc as the template it saves back to, under the same id */
export function templateFromEditedDoc(doc: SketchDoc): SketchTemplate {
    return {
        ...templateFromDoc(doc, { name: doc.name }),
        id: doc.id,
    };
}
