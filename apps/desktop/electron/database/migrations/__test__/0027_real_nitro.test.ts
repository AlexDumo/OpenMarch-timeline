// @vitest-environment node
/**
 * Migration 0027 adds the Sketchpad's tables (ADR 0006 D-5): `sketches`, `sketch_files` and
 * `sketch_pins`. New tables only, each `IF NOT EXISTS` so the migration can run twice, and none
 * with undo triggers. It comes after `0020_drop_page_era`, so a timeline file takes it on open and
 * a page-era file takes it in its conversion; it needs no `user_version` bump.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { getOrm } from "../../db";
import { DrizzleMigrationService } from "../../services/DrizzleMigrationService";
import {
    applyFileVersionDecision,
    readUserVersion,
    TIMELINE_MODEL_USER_VERSION,
} from "../../fileVersion";
import { runConvertOnOpen, type ConvertOnOpenUi } from "../../convertOnOpen";
import {
    createPageShow,
    migrationsFolder,
    withDb,
} from "../../__test__/convertOnOpenFixtures";
import {
    migrationAt,
    rollBackMigrationsFrom,
} from "../../__test__/migrationRollback";

const SKETCH_MIGRATION = migrationAt(27);
const SKETCH_ID = "11111111-1111-4111-8111-111111111111";
const SKETCH_TABLES = ["sketch_files", "sketch_pins", "sketches"];

type Row = Record<string, string | number | null | Uint8Array>;

const count = (db: DatabaseSync, table: string) =>
    Number(
        (
            db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as {
                n: number;
            }
        ).n,
    );

const tableNames = (db: DatabaseSync) =>
    (
        db
            .prepare("SELECT name FROM sqlite_schema WHERE type = 'table'")
            .all() as { name: string }[]
    ).map((r) => r.name);

const triggerTables = (db: DatabaseSync) =>
    (
        db
            .prepare(
                "SELECT DISTINCT tbl_name AS name FROM sqlite_schema WHERE type = 'trigger'",
            )
            .all() as { name: string }[]
    ).map((r) => r.name);

const migrate = async (db: DatabaseSync) => {
    applyFileVersionDecision(db, false);
    await new DrizzleMigrationService(getOrm(db), db).applyPendingMigrations(
        migrationsFolder,
    );
};

const ui: ConvertOnOpenUi = { whilePreparing: async (work) => work(() => {}) };

/**
 * Opens a file as `openShow` does: convert on open (the person agreed), the migrations, then the
 * undo triggers the renderer creates on every open.
 */
const open = async (filePath: string) => {
    const db = new DatabaseSync(filePath);
    try {
        const outcome = await runConvertOnOpen(filePath, db, ui, {
            confirmed: true,
            migrationsFolder,
            hooks: { now: () => new Date("2026-10-24T12:00:00.000Z") },
        });
        await migrate(db);
        const { createAllUndoTriggers } =
            await import("@/db-functions/history");
        await createAllUndoTriggers(getOrm(db) as never);
        return outcome;
    } finally {
        db.close();
    }
};

/** A sketch with an image and a pin on beat 3 */
const insertSketch = (db: DatabaseSync) => {
    db.exec("PRAGMA foreign_keys = ON");
    db.prepare(
        "INSERT INTO sketches (id, kind, name, field_json, doc_json, sort_index) VALUES (?, 'sketch', 'Sketch 1', '{}', '{}', 1)",
    ).run(SKETCH_ID);
    db.prepare(
        "INSERT INTO sketch_files (sha256, mime, data) VALUES (?, 'image/png', ?)",
    ).run("a".repeat(64), new Uint8Array([1, 2, 3]));
    db.prepare(
        "INSERT INTO sketch_pins (sketch_id, page_id, beat_id) VALUES (?, 'p1', 3)",
    ).run(SKETCH_ID);
};

describe(`Migration ${SKETCH_MIGRATION.tag}`, () => {
    let tempDir: string;
    let showPath: string;

    beforeEach(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "om-0027-"));
        showPath = path.join(tempDir, "show.dots");
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "debug").mockImplementation(() => {});
        await createPageShow(showPath);
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    const hasSketches = (db: DatabaseSync) =>
        SKETCH_TABLES.every((t) => tableNames(db).includes(t));

    it("leaves sketches out of a page-era file until it converts", async () => {
        const db = new DatabaseSync(showPath);
        try {
            await migrate(db);
            expect(tableNames(db)).not.toContain("sketches");
        } finally {
            db.close();
        }
    });

    it("adds the sketch tables when a page-era file converts, without undo triggers", async () => {
        await open(showPath);
        withDb(showPath, (db) => {
            expect(readUserVersion(db)).toBe(TIMELINE_MODEL_USER_VERSION);
            expect(hasSketches(db)).toBe(true);
            expect(triggerTables(db)).toContain("beats");
            for (const t of SKETCH_TABLES)
                expect(triggerTables(db)).not.toContain(t);
            insertSketch(db);
            expect(count(db, "sketch_pins")).toBe(1);
        });
    });

    it("opens a converted timeline file from before it: version 8 and the timeline are kept", async () => {
        await open(showPath);
        rollBackMigrationsFrom(showPath, SKETCH_MIGRATION.idx);
        const before = withDb(showPath, (db) => {
            expect(tableNames(db)).not.toContain("sketches");
            return { assignments: count(db, "timeline_assignments") };
        });
        expect(before.assignments).toBeGreaterThan(0);

        expect(await open(showPath)).toMatchObject({ kind: "none" });

        withDb(showPath, (db) => {
            expect(readUserVersion(db)).toBe(TIMELINE_MODEL_USER_VERSION);
            expect(count(db, "timeline_assignments")).toBe(before.assignments);
            insertSketch(db);
        });
    });

    it("runs again on a file that already has the tables, keeping its rows", async () => {
        await open(showPath);
        withDb(showPath, (db) => {
            insertSketch(db);
            // Forget the migration but keep the tables, as a file a lab build migrated would
            db.prepare(
                "DELETE FROM __drizzle_migrations WHERE created_at = ?",
            ).run(SKETCH_MIGRATION.when);
        });

        await open(showPath);

        withDb(showPath, (db) => {
            expect(count(db, "sketches")).toBe(1);
            expect(count(db, "sketch_files")).toBe(1);
            expect(count(db, "sketch_pins")).toBe(1);
        });
    });

    describe("constraints", () => {
        let db: DatabaseSync;
        beforeEach(async () => {
            await open(showPath);
            db = new DatabaseSync(showPath);
            insertSketch(db);
        });
        afterEach(() => db.close());

        const insert = (table: string, row: Row) => {
            const names = Object.keys(row);
            db.prepare(
                `INSERT INTO ${table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`,
            ).run(...Object.values(row));
        };
        const sketch = (columns: Row) =>
            insert("sketches", {
                id: "22222222-2222-4222-8222-222222222222",
                kind: "sketch",
                name: "Sketch 2",
                field_json: "{}",
                doc_json: "{}",
                sort_index: 2,
                ...columns,
            });
        const pin = (columns: Row) =>
            insert("sketch_pins", {
                sketch_id: SKETCH_ID,
                page_id: "p2",
                beat_id: 3,
                ...columns,
            });

        it("takes a template", () => {
            sketch({ kind: "template" });
            expect(count(db, "sketches")).toBe(2);
        });

        it.each<[string, Row]>([
            ["an unknown kind", { kind: "drawing" }],
            ["no name", { name: null }],
            ["no doc", { doc_json: null }],
            ["no field", { field_json: null }],
            ["no sort index", { sort_index: null }],
            ["a taken id", { id: SKETCH_ID }],
        ])("rejects a sketch with %s", (_, columns) => {
            expect(() => sketch(columns)).toThrow();
        });

        it("rejects a file whose data isn't a blob", () => {
            expect(() =>
                insert("sketch_files", {
                    sha256: "b".repeat(64),
                    mime: "image/png",
                    data: "text",
                }),
            ).toThrow();
        });

        it.each<[string, Row]>([
            ["no opacity", { opacity: 0 }],
            ["an opacity over 1", { opacity: 1.5 }],
            ["an unknown position", { position: "beside" }],
            ["a missing sketch", { sketch_id: "nope" }],
            ["a missing beat", { beat_id: 99999 }],
        ])("rejects a pin with %s", (_, columns) => {
            expect(() => pin(columns)).toThrow();
        });

        it("defaults a pin to half opacity below the marchers", () => {
            pin({});
            expect(
                db
                    .prepare(
                        "SELECT opacity, position FROM sketch_pins WHERE page_id = 'p2'",
                    )
                    .get(),
            ).toEqual({ opacity: 0.5, position: "below" });
        });

        it("unpins a pin when its beat is deleted, and drops pins with their sketch", () => {
            db.exec("DELETE FROM beats WHERE id = 3");
            expect(db.prepare("SELECT beat_id FROM sketch_pins").get()).toEqual(
                { beat_id: null },
            );
            db.prepare("DELETE FROM sketches WHERE id = ?").run(SKETCH_ID);
            expect(count(db, "sketch_pins")).toBe(0);
        });
    });
});
