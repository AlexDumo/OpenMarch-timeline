// @vitest-environment node
/**
 * Convert on open for the show's floor (ADR 0002 D-23): a show with a legacy field image and no
 * floor gets one, quietly and outside undo history, and every opened 8 is written as 9.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { getOrm } from "../db";
import { DrizzleMigrationService } from "../services/DrizzleMigrationService";
import {
    applyFileVersionDecision,
    FLOOR_MODEL_USER_VERSION,
    readUserVersion,
    TIMELINE_MODEL_USER_VERSION,
} from "../fileVersion";
import { convertFieldImageOnOpen } from "../convertFieldImage";
import { createAllUndoTriggers } from "@/db-functions/historyTriggers";
import type { EmbedLibraryVersion } from "@/db-functions/showLibrary";
import { hashParts, versionHashOf } from "@/view3d/library/showHash";

const migrationsFolder = path.resolve(__dirname, "../migrations");
const FLOOR_ID = "66666666-6666-4666-8666-666666666666";
const LEGACY = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

async function createShow(filePath: string, version: number) {
    const db = new DatabaseSync(filePath);
    applyFileVersionDecision(db, true);
    const orm = getOrm(db);
    await new DrizzleMigrationService(orm, db).applyPendingMigrations(
        migrationsFolder,
    );
    await DrizzleMigrationService.initializeDatabase(orm, db);
    // As an opened show has them, so an undoable write would leave a row
    await createAllUndoTriggers(orm as never);
    db.prepare(`PRAGMA user_version = ${version}`).run();
    return db;
}

const fieldRow = (db: DatabaseSync) =>
    db
        .prepare("SELECT json_data, image FROM field_properties WHERE id = 1")
        .get() as { json_data: string; image: Uint8Array | null };

const count = (db: DatabaseSync, table: string) =>
    (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

const fieldTriggers = (db: DatabaseSync) =>
    (
        db
            .prepare(
                "SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'field_properties' ORDER BY name",
            )
            .all() as { name: string }[]
    ).map((r) => r.name);

async function floorVersion(display: string): Promise<EmbedLibraryVersion> {
    const parts = {
        original: new Uint8Array(LEGACY),
        display: new TextEncoder().encode(display),
    };
    return {
        itemId: FLOOR_ID,
        versionHash: await versionHashOf(await hashParts(parts)),
        kind: "artwork",
        name: "Field image",
        builtIn: false,
        metadata: {
            tags: [],
            createdAt: "2026-10-16T00:00:00.000Z",
            updatedAt: "2026-10-16T00:00:00.000Z",
            originalFilename: "Field image.png",
            derivedFrom: null,
            license: null,
            licenseText: null,
            author: null,
            sourceUrl: null,
            attribution: null,
            modified: false,
        },
        pins: [],
        parts,
    };
}

describe("convertFieldImageOnOpen", () => {
    let dir: string;
    let db: DatabaseSync;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "om-floor-"));
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        db?.close();
        fs.rmSync(dir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    const withLegacyImage = (database: DatabaseSync) =>
        database
            .prepare("UPDATE field_properties SET image = ? WHERE id = 1")
            .run(LEGACY);

    it("makes a floor from the field image, clears the column and writes 9", async () => {
        db = await createShow(
            path.join(dir, "show.dots"),
            TIMELINE_MODEL_USER_VERSION,
        );
        withLegacyImage(db);
        const historyBefore = count(db, "history_undo");
        const triggersBefore = fieldTriggers(db);
        const makeFloor = vi.fn(async () => floorVersion("display"));

        const result = await convertFieldImageOnOpen(db, { makeFloor });

        expect(result).toBe("converted");
        expect(makeFloor).toHaveBeenCalledOnce();
        const [bytes, fieldProperties] = makeFloor.mock.calls[0] as unknown as [
            Uint8Array,
            { name: string },
        ];
        expect(Array.from(bytes)).toEqual(Array.from(LEGACY));
        expect(typeof fieldProperties.name).toBe("string");

        const row = fieldRow(db);
        expect(row.image).toBeNull();
        const version = await floorVersion("display");
        expect(JSON.parse(row.json_data).floor).toEqual({
            itemId: FLOOR_ID,
            versionHash: version.versionHash,
        });
        expect(count(db, "library_items")).toBe(1);
        expect(count(db, "library_blobs")).toBe(2);
        expect(readUserVersion(db)).toBe(FLOOR_MODEL_USER_VERSION);
        // Not an undoable edit, and the history triggers are back
        expect(count(db, "history_undo")).toBe(historyBefore);
        expect(fieldTriggers(db)).toEqual(triggersBefore);
        expect(triggersBefore.length).toBeGreaterThan(0);
    });

    it("only writes 9 for a show with no field image", async () => {
        db = await createShow(
            path.join(dir, "show.dots"),
            TIMELINE_MODEL_USER_VERSION,
        );
        const jsonBefore = fieldRow(db).json_data;
        const makeFloor = vi.fn(async () => floorVersion("display"));

        expect(await convertFieldImageOnOpen(db, { makeFloor })).toBe("none");

        expect(makeFloor).not.toHaveBeenCalled();
        expect(fieldRow(db).json_data).toBe(jsonBefore);
        expect(count(db, "library_items")).toBe(0);
        expect(readUserVersion(db)).toBe(FLOOR_MODEL_USER_VERSION);
    });

    it("leaves the file as it was when the image can't be made into a floor", async () => {
        db = await createShow(
            path.join(dir, "show.dots"),
            TIMELINE_MODEL_USER_VERSION,
        );
        withLegacyImage(db);
        const jsonBefore = fieldRow(db).json_data;

        const result = await convertFieldImageOnOpen(db, {
            makeFloor: async () => {
                throw new Error("not an image");
            },
        });

        expect(result).toBe("failed");
        expect(Array.from(fieldRow(db).image!)).toEqual(Array.from(LEGACY));
        expect(fieldRow(db).json_data).toBe(jsonBefore);
        expect(count(db, "library_items")).toBe(0);
        // Still 8, so the next open tries again
        expect(readUserVersion(db)).toBe(TIMELINE_MODEL_USER_VERSION);
    });

    it("converts a 9 that still holds a field image, such as a repaired copy", async () => {
        db = await createShow(
            path.join(dir, "show.dots"),
            FLOOR_MODEL_USER_VERSION,
        );
        withLegacyImage(db);

        const result = await convertFieldImageOnOpen(db, {
            makeFloor: async () => floorVersion("display"),
        });

        expect(result).toBe("converted");
        expect(fieldRow(db).image).toBeNull();
        expect(JSON.parse(fieldRow(db).json_data).floor.itemId).toBe(FLOOR_ID);
    });

    it("clears a field image left beside a floor without making another", async () => {
        db = await createShow(
            path.join(dir, "show.dots"),
            TIMELINE_MODEL_USER_VERSION,
        );
        withLegacyImage(db);
        await convertFieldImageOnOpen(db, {
            makeFloor: async () => floorVersion("display"),
        });
        // Simulates an older edit writing the column again
        withLegacyImage(db);
        db.prepare("PRAGMA user_version = 8").run();
        const makeFloor = vi.fn(async () => floorVersion("other"));
        const historyBefore = count(db, "history_undo");

        expect(await convertFieldImageOnOpen(db, { makeFloor })).toBe("none");

        expect(makeFloor).not.toHaveBeenCalled();
        expect(fieldRow(db).image).toBeNull();
        expect(count(db, "library_items")).toBe(1);
        expect(count(db, "history_undo")).toBe(historyBefore);
        expect(readUserVersion(db)).toBe(FLOOR_MODEL_USER_VERSION);
    });

    it("leaves a page-model file alone: it converts to timelines first", async () => {
        db = await createShow(path.join(dir, "show.dots"), 7);
        const makeFloor = vi.fn(async () => floorVersion("display"));
        expect(await convertFieldImageOnOpen(db, { makeFloor })).toBe("none");
        expect(readUserVersion(db)).toBe(7);
    });
});
