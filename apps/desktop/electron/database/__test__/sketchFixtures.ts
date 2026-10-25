/** Fixtures for the Sketchpad's database and handler tests */
import { DatabaseSync } from "node:sqlite";
import * as fs from "fs";
import * as path from "path";
import type { SketchToSave } from "../sketches";

export const BLANK_DOTS = path.resolve(__dirname, "../migrations/_blank.dots");

/** A fresh show file with every migration, foreign keys on */
export function openBlankShow(dir: string): DatabaseSync {
    const file = path.join(dir, "show.dots");
    fs.copyFileSync(BLANK_DOTS, file);
    const db = new DatabaseSync(file);
    db.exec("PRAGMA foreign_keys = ON");
    return db;
}

export const ID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const ID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const ID_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

export function sketch(
    id: string,
    name: string,
    elements: Record<string, unknown>[] = [],
): SketchToSave {
    return {
        doc: {
            id,
            name,
            field: {
                fieldProperties: { xCheckpoints: [], yCheckpoints: [] },
                style: { preset: "show" },
            },
            pages: [{ id: "p1", name: "Page 1", elements }],
            schemaVersion: 1,
        } as SketchToSave["doc"],
        render: {
            pages: [{ pageId: "p1", svg: "<svg/>", bounds: null }],
            thumbnail: new Uint8Array([137, 80, 78, 71]),
        },
    };
}
