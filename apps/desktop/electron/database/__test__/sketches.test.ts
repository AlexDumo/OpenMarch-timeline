// @vitest-environment node
/**
 * The Sketchpad's database functions (ADR 0006 D-5) on a real show file: a copy of `_blank.dots`,
 * which has every migration.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
    duplicateSketch,
    getSketchFile,
    listShowTemplates,
    listSketches,
    loadShowTemplateJson,
    loadSketchJson,
    pruneSketchFiles,
    putSketchFile,
    removeShowTemplate,
    renameShowTemplate,
    showTemplateThumbnail,
    removeSketch,
    renameSketch,
    restoreSketch,
    saveShowTemplate,
    saveSketch,
    sha256Hex,
    storedTimeMs,
} from "../sketches";
import { ID_A, ID_B, ID_C, openBlankShow, sketch } from "./sketchFixtures";

const image = (fileId: string, isDeleted = false) => ({
    id: `img-${fileId.slice(0, 4)}`,
    type: "image",
    fileId,
    isDeleted,
});

let dir: string;
let db: DatabaseSync;

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "om-sketches-"));
    db = openBlankShow(dir);
});

afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
});

describe("sketches", () => {
    it("inserts a sketch at the top of the list and reads it back", () => {
        saveSketch(db, sketch(ID_A, "Opener idea"));
        saveSketch(db, sketch(ID_B, "Ballad"));

        expect(listSketches(db).map((s) => s.name)).toEqual([
            "Ballad",
            "Opener idea",
        ]);
        const [first] = listSketches(db);
        expect(first!.thumbnail).toEqual(new Uint8Array([137, 80, 78, 71]));
        expect(first!.updatedAt).toBeGreaterThan(Date.now() - 60_000);
        expect(JSON.parse(loadSketchJson(db, ID_A)!)).toMatchObject({
            id: ID_A,
            name: "Opener idea",
        });
        expect(loadSketchJson(db, ID_C)).toBeNull();
    });

    it("updates a sketch in place: its place and creation time stay, the last write wins", () => {
        saveSketch(db, sketch(ID_A, "Opener"));
        saveSketch(db, sketch(ID_B, "Ballad"));
        const before = db
            .prepare("SELECT created_at, sort_index FROM sketches WHERE id = ?")
            .get(ID_A);

        saveSketch(db, sketch(ID_A, "Opener v2"));
        saveSketch(db, sketch(ID_A, "Opener v3"));

        expect(listSketches(db).map((s) => s.name)).toEqual([
            "Ballad",
            "Opener v3",
        ]);
        expect(
            db
                .prepare(
                    "SELECT created_at, sort_index FROM sketches WHERE id = ?",
                )
                .get(ID_A),
        ).toEqual(before);
        expect(
            JSON.parse(
                (
                    db
                        .prepare(
                            "SELECT render_json FROM sketches WHERE id = ?",
                        )
                        .get(ID_A) as { render_json: string }
                ).render_json,
            ),
        ).toEqual({ pages: [{ pageId: "p1", svg: "<svg/>", bounds: null }] });
    });

    it("renames a sketch in its row and its doc", () => {
        saveSketch(db, sketch(ID_A, "Opener"));
        expect(renameSketch(db, ID_A, "Closer")).toBe(true);
        expect(listSketches(db)[0]!.name).toBe("Closer");
        expect(JSON.parse(loadSketchJson(db, ID_A)!).name).toBe("Closer");
        expect(renameSketch(db, ID_C, "Nothing")).toBe(false);
    });

    it("duplicates a sketch right below the original, with a new id in its doc", () => {
        saveSketch(db, sketch(ID_A, "Opener"));
        saveSketch(db, sketch(ID_B, "Ballad"));

        expect(duplicateSketch(db, ID_B, ID_C)).toEqual({
            id: ID_C,
            name: "Ballad copy",
        });
        expect(listSketches(db).map((s) => s.name)).toEqual([
            "Ballad",
            "Ballad copy",
            "Opener",
        ]);
        const copy = JSON.parse(loadSketchJson(db, ID_C)!);
        expect(copy).toMatchObject({ id: ID_C, name: "Ballad copy" });
        expect(copy.pages).toEqual(JSON.parse(loadSketchJson(db, ID_B)!).pages);
        expect(duplicateSketch(db, "nope", ID_A)).toBeNull();
    });

    it("deletes a sketch with its pins and brings both back", () => {
        saveSketch(db, sketch(ID_A, "Opener"));
        const beat = (
            db
                .prepare("SELECT id FROM beats ORDER BY position LIMIT 1")
                .get() as {
                id: number;
            }
        ).id;
        db.prepare(
            "INSERT INTO sketch_pins (sketch_id, page_id, beat_id, opacity, position) VALUES (?, 'p1', ?, 0.3, 'above')",
        ).run(ID_A, beat);
        const row = db.prepare("SELECT * FROM sketches").get();
        const pins = db.prepare("SELECT * FROM sketch_pins").all();

        const removed = removeSketch(db, ID_A)!;

        expect(listSketches(db)).toEqual([]);
        expect(db.prepare("SELECT * FROM sketch_pins").all()).toEqual([]);
        expect(removeSketch(db, ID_A)).toBeNull();

        expect(restoreSketch(db, removed)).toBe(true);
        expect(db.prepare("SELECT * FROM sketches").get()).toEqual(row);
        expect(db.prepare("SELECT * FROM sketch_pins").all()).toEqual(pins);
        // Restoring twice does nothing
        expect(restoreSketch(db, removed)).toBe(false);
    });

    it("parses SQLite's own times and ISO times", () => {
        expect(storedTimeMs("2026-10-24 12:00:00")).toBe(
            Date.UTC(2026, 9, 24, 12),
        );
        expect(storedTimeMs("2026-10-24T12:00:00.500Z")).toBe(
            Date.UTC(2026, 9, 24, 12, 0, 0, 500),
        );
        expect(storedTimeMs("not a time")).toBe(0);
    });
});

describe("sketch files", () => {
    it("stores an image once, under the sha256 of its bytes", () => {
        const data = new Uint8Array([1, 2, 3, 4]);
        const sha = putSketchFile(db, { mime: "image/png", data });
        expect(sha).toBe(sha256Hex(data));
        expect(putSketchFile(db, { mime: "image/png", data })).toBe(sha);
        expect(
            db.prepare("SELECT count(*) AS n FROM sketch_files").get(),
        ).toEqual({ n: 1 });
        expect(getSketchFile(db, sha)).toEqual({ mime: "image/png", data });
        expect(getSketchFile(db, "0".repeat(64))).toBeNull();
    });

    it("prunes images no live element refers to", () => {
        const kept = putSketchFile(db, {
            mime: "image/png",
            data: new Uint8Array([1]),
        });
        const deleted = putSketchFile(db, {
            mime: "image/png",
            data: new Uint8Array([2]),
        });
        const orphan = putSketchFile(db, {
            mime: "image/png",
            data: new Uint8Array([3]),
        });
        const inTemplate = putSketchFile(db, {
            mime: "image/png",
            data: new Uint8Array([4]),
        });
        saveSketch(
            db,
            sketch(ID_A, "Opener", [image(kept), image(deleted, true)]),
        );
        saveShowTemplate(db, {
            id: ID_B,
            name: "Grid",
            style: { preset: "paper" },
            pages: [
                { id: "p1", name: "Page 1", elements: [image(inTemplate)] },
            ],
            schemaVersion: 1,
        } as never);

        expect(pruneSketchFiles(db)).toBe(2);

        expect(getSketchFile(db, kept)).not.toBeNull();
        expect(getSketchFile(db, inTemplate)).not.toBeNull();
        expect(getSketchFile(db, deleted)).toBeNull();
        expect(getSketchFile(db, orphan)).toBeNull();
    });
});

describe("show templates", () => {
    const template = {
        id: ID_B,
        name: "Grid paper",
        style: { preset: "paper", grid: true },
        pages: [{ id: "p1", name: "Page 1", elements: [] }],
        schemaVersion: 1,
    };

    it("saves, lists, loads and deletes a template, apart from the sketches", () => {
        saveSketch(db, sketch(ID_A, "Opener"));
        saveShowTemplate(db, template);

        expect(listShowTemplates(db)).toMatchObject([
            { id: ID_B, name: "Grid paper", destination: "show" },
        ]);
        expect(listSketches(db).map((s) => s.id)).toEqual([ID_A]);
        expect(JSON.parse(loadShowTemplateJson(db, ID_B)!)).toEqual(template);
        expect(loadShowTemplateJson(db, ID_A)).toBeNull();
        expect(loadSketchJson(db, ID_B)).toBeNull();
        // A template keeps the field style, never the layout (D-6)
        expect(
            db
                .prepare("SELECT field_json FROM sketches WHERE id = ?")
                .get(ID_B),
        ).toEqual({
            field_json: JSON.stringify({ style: template.style }),
        });

        expect(removeShowTemplate(db, ID_A)).toBe(false);
        expect(removeShowTemplate(db, ID_B)).toBe(true);
        expect(listShowTemplates(db)).toEqual([]);
    });

    it("won't save a sketch over a template, or a template over a sketch", () => {
        saveSketch(db, sketch(ID_A, "Opener"));
        saveShowTemplate(db, template);
        expect(() => saveSketch(db, sketch(ID_B, "Not a sketch"))).toThrow();
        expect(() => saveShowTemplate(db, { ...template, id: ID_A })).toThrow();
        expect(listSketches(db)[0]!.name).toBe("Opener");
    });

    it("renames and duplicates a template, and keeps its thumbnail unless given one", () => {
        const thumb = new Uint8Array([9, 9]);
        saveShowTemplate(db, template, thumb);
        expect(renameShowTemplate(db, ID_B, "Hash grid")).toBe(true);
        expect(renameShowTemplate(db, ID_A, "Nothing")).toBe(false);
        expect(JSON.parse(loadShowTemplateJson(db, ID_B)!).name).toBe(
            "Hash grid",
        );
        saveShowTemplate(db, { ...template, name: "Hash grid 2" });
        expect(showTemplateThumbnail(db, ID_B)).toEqual(thumb);
        saveShowTemplate(db, template, null);
        expect(showTemplateThumbnail(db, ID_B)).toBeNull();

        expect(duplicateSketch(db, ID_B, ID_C, "template")).toEqual({
            id: ID_C,
            name: "Grid paper copy",
        });
        expect(JSON.parse(loadShowTemplateJson(db, ID_C)!)).toMatchObject({
            id: ID_C,
            name: "Grid paper copy",
            pages: template.pages,
        });
        expect(listSketches(db)).toEqual([]);
        // A sketch isn't duplicated as a template
        saveSketch(db, sketch(ID_A, "Opener"));
        expect(duplicateSketch(db, ID_A, "x", "template")).toBeNull();
    });
});
