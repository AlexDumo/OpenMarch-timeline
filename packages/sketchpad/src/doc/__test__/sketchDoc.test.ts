import { describe, expect, it } from "vitest";
import { FieldPropertiesTemplates } from "@openmarch/core";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import {
    createSketchDoc,
    docFromTemplate,
    nextSketchName,
    parseOmSketchFile,
    parseSketchDoc,
    referencedFileIds,
    serializeSketchDoc,
    SketchDocError,
    templateFromDoc,
    docForTemplateEdit,
    templateFromEditedDoc,
} from "../sketchDoc";
import { toFieldPropertiesJson } from "../../field/fieldStyle";

const hs = toFieldPropertiesJson(
    FieldPropertiesTemplates.HIGH_SCHOOL_FOOTBALL_FIELD_NO_END_ZONES,
);
const college = toFieldPropertiesJson(
    FieldPropertiesTemplates.COLLEGE_FOOTBALL_FIELD_NO_END_ZONES,
);

/** An element as Excalidraw stores it, with the fields collaboration needs (owner decision Q6) */
const element = (overrides: Partial<ExcalidrawElement> = {}) =>
    ({
        id: "el-1",
        type: "rectangle",
        x: -90,
        y: -315,
        width: 180,
        height: 90,
        angle: 0,
        strokeColor: "#1e1e1e",
        backgroundColor: "#1e1e1e",
        fillStyle: "om-dots:22.5:m",
        strokeWidth: 2,
        strokeStyle: "solid",
        roughness: 1,
        opacity: 100,
        groupIds: [],
        frameId: null,
        index: "a0",
        roundness: null,
        seed: 42,
        version: 7,
        versionNonce: 991,
        isDeleted: false,
        boundElements: null,
        updated: 1,
        link: null,
        locked: false,
        ...overrides,
    }) as unknown as ExcalidrawElement;

describe("SketchDoc", () => {
    it("round-trips through JSON with pages, deleted elements and versions intact", () => {
        const doc = createSketchDoc({
            name: "Opener",
            fieldProperties: hs,
            style: { grid: false },
        });
        doc.pages[0]!.elements = [
            element(),
            element({ id: "gone", isDeleted: true, version: 3 }),
        ];
        doc.pages.push({
            id: "p2",
            name: "Page 2",
            elements: [
                element({ id: "img", type: "image", fileId: "abc" } as never),
            ],
        });
        const back = parseSketchDoc(serializeSketchDoc(doc));
        expect(back).toEqual(doc);
        expect(back.pages[0]!.elements[1]).toMatchObject({
            id: "gone",
            isDeleted: true,
            version: 3,
            versionNonce: 991,
        });
        expect(back.field.style.grid).toBe(false);
        expect(back.schemaVersion).toBe(1);
    });

    it("refuses what it can't read", () => {
        const doc = createSketchDoc({ name: "x", fieldProperties: hs });
        expect(() => parseSketchDoc({ ...doc, schemaVersion: 2 })).toThrow(
            SketchDocError,
        );
        expect(() => parseSketchDoc({ ...doc, pages: [] })).toThrow(
            SketchDocError,
        );
        expect(() => parseSketchDoc({ ...doc, field: {} })).toThrow(
            SketchDocError,
        );
        expect(() => parseSketchDoc("[]")).toThrow(SketchDocError);
    });

    it("fills in a missing field style", () => {
        const doc = createSketchDoc({ name: "x", fieldProperties: hs });
        const raw = JSON.parse(serializeSketchDoc(doc));
        delete raw.field.style;
        expect(parseSketchDoc(raw).field.style).toMatchObject({
            preset: "show",
            grid: true,
            opacity: 1,
        });
    });

    it("reads a .omsketch file with its images", () => {
        const doc = createSketchDoc({ name: "x", fieldProperties: hs });
        const file = {
            type: "openmarch-sketch",
            sketch: doc,
            files: {
                abc: {
                    mimeType: "image/png",
                    dataURL: "data:image/png;base64,AA==",
                },
            },
        };
        const back = parseOmSketchFile(JSON.stringify(file));
        expect(back.sketch).toEqual(doc);
        expect(back.files.abc!.mimeType).toBe("image/png");
        expect(() =>
            parseOmSketchFile(JSON.stringify({ type: "other" })),
        ).toThrow(SketchDocError);
    });

    it("drops files that aren't image data URLs", () => {
        const doc = createSketchDoc({ name: "x", fieldProperties: hs });
        const back = parseOmSketchFile(
            JSON.stringify({
                type: "openmarch-sketch",
                sketch: doc,
                files: {
                    web: { mimeType: "image/png", dataURL: "https://x/y.png" },
                    disk: {
                        mimeType: "image/png",
                        dataURL: "file:///etc/passwd",
                    },
                    html: {
                        mimeType: "text/html",
                        dataURL: "data:text/html;base64,AA==",
                    },
                    ok: { dataURL: "data:image/webp;base64,AA==" },
                },
            }),
        );
        expect(Object.keys(back.files)).toEqual(["ok"]);
        expect(back.files.ok!.mimeType).toBe("image/webp");
    });

    it("lists the image files live elements refer to", () => {
        const doc = createSketchDoc({ name: "x", fieldProperties: hs });
        doc.pages[0]!.elements = [
            element({ id: "a", type: "image", fileId: "f1" } as never),
            element({
                id: "b",
                type: "image",
                fileId: "f2",
                isDeleted: true,
            } as never),
            element({ id: "c", type: "image", fileId: "f1" } as never),
        ];
        expect(referencedFileIds(doc)).toEqual(["f1"]);
    });

    it("names new sketches with the next free number", () => {
        expect(nextSketchName([])).toBe("Sketch 1");
        expect(nextSketchName(["Sketch 1", "Sketch 3"])).toBe("Sketch 2");
        expect(nextSketchName(["Opener 1"], "Opener")).toBe("Opener 2");
    });
});

describe("templates", () => {
    it("carry every page and the field style, never the field layout", () => {
        const doc = createSketchDoc({
            name: "Opener",
            fieldProperties: hs,
            style: { preset: "turf", grid: false },
        });
        doc.pages[0]!.elements = [
            element(),
            element({ id: "gone", isDeleted: true }),
        ];
        doc.pages.push({ id: "p2", name: "Closer", elements: [] });
        const template = templateFromDoc(doc, { name: "Block" });
        expect(template).not.toHaveProperty("field");
        expect(JSON.stringify(template)).not.toContain("xCheckpoints");
        expect(template.style).toMatchObject({ preset: "turf", grid: false });
        expect(template.pages.map((p) => p.name)).toEqual(["Page 1", "Closer"]);
        // Deleted elements are dropped from templates
        expect(template.pages[0]!.elements.map((e) => e.id)).toEqual(["el-1"]);

        const fromTemplate = docFromTemplate(template, college, "Block 1");
        expect(fromTemplate.field.fieldProperties).toEqual(college);
        expect(fromTemplate.field.style).toMatchObject({
            preset: "turf",
            grid: false,
        });
        expect(fromTemplate.pages).toHaveLength(2);
        expect(fromTemplate.pages[0]!.id).not.toBe(doc.pages[0]!.id);
        expect(fromTemplate.id).not.toBe(doc.id);
    });

    it("can leave out the drawing or the style", () => {
        const doc = createSketchDoc({
            name: "x",
            fieldProperties: hs,
            style: { preset: "dark" },
        });
        doc.pages[0]!.elements = [element()];
        const t = templateFromDoc(doc, {
            name: "Empty",
            includeDrawing: false,
            includeFieldStyle: false,
        });
        expect(t.pages[0]!.elements).toEqual([]);
        expect(t.style.preset).toBe("show");
    });
});

describe("editing a template", () => {
    it("draws it on the host's field and saves it back without the layout, under its id", () => {
        const doc = createSketchDoc({ name: "Opener", fieldProperties: hs });
        const template = templateFromDoc(doc, { name: "Grid" });
        const editing = docForTemplateEdit(template, college);
        expect(editing.id).toBe(template.id);
        expect(editing.name).toBe("Grid");
        expect(editing.field.fieldProperties).toEqual(college);
        expect(editing.field.style).toEqual(template.style);
        expect(editing.pages.map((p) => p.id)).toEqual(
            template.pages.map((p) => p.id),
        );
        const saved = templateFromEditedDoc({ ...editing, name: "Grid 2" });
        expect(saved.id).toBe(template.id);
        expect(saved.name).toBe("Grid 2");
        expect(saved).not.toHaveProperty("field");
        expect(saved.style).toEqual(template.style);
    });
});
