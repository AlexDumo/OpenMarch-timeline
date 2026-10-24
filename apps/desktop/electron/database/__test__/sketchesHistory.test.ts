// @vitest-environment node
/**
 * Sketch writes stay out of the show's undo history (ADR 0006 D-5): with the undo triggers the
 * editor creates on every open, saving, renaming, duplicating, deleting and restoring sketches,
 * storing images and templates leave `history_undo` as it was, and the editor's Undo never
 * changes a sketch.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { getOrm } from "../db";
import { createAllUndoTriggers, performUndo } from "@/db-functions/history";
import {
    duplicateSketch,
    listSketches,
    putSketchFile,
    removeSketch,
    renameSketch,
    restoreSketch,
    saveShowTemplate,
    saveSketch,
} from "../sketches";
import { ID_A, ID_B, ID_C, openBlankShow, sketch } from "./sketchFixtures";

let dir: string;
let db: DatabaseSync;

const historyRows = () =>
    db.prepare("SELECT * FROM history_undo ORDER BY sequence").all();

beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "om-sketch-history-"));
    db = openBlankShow(dir);
    await createAllUndoTriggers(getOrm(db) as never);
});

afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
});

describe("sketch writes and the undo history", () => {
    it("leave history_undo unchanged", () => {
        const before = historyRows();

        saveSketch(db, sketch(ID_A, "Opener"));
        saveSketch(db, sketch(ID_A, "Opener v2"));
        renameSketch(db, ID_A, "Closer");
        duplicateSketch(db, ID_A, ID_C);
        putSketchFile(db, { mime: "image/png", data: new Uint8Array([1]) });
        saveShowTemplate(db, {
            id: ID_B,
            name: "Grid",
            style: { preset: "paper" },
        });
        const removed = removeSketch(db, ID_C)!;
        restoreSketch(db, removed);

        expect(historyRows()).toEqual(before);
    });

    it("an editor edit records history, and its Undo leaves sketches alone", async () => {
        const before = historyRows().length;
        db.prepare(
            "INSERT INTO marchers (section, drill_prefix, drill_order) VALUES ('Brass', 'B', 1)",
        ).run();
        expect(historyRows().length).toBeGreaterThan(before);

        saveSketch(db, sketch(ID_A, "Drawn after the edit"));
        await performUndo(getOrm(db) as never);

        expect(db.prepare("SELECT count(*) AS n FROM marchers").get()).toEqual({
            n: 0,
        });
        expect(listSketches(db).map((s) => s.name)).toEqual([
            "Drawn after the edit",
        ]);
    });
});
