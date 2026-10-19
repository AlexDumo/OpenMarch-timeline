// @vitest-environment node
/**
 * Migration 0024 adds items (props-spec section 4, ADR 0002 D-9 and D-10): `marchers.type`,
 * `items` and the beat-keyed `item_geometry`. `type` comes in with ADD COLUMN, so existing rows
 * become performers and nothing that references `marchers` is rebuilt. It comes after
 * `0020_drop_page_era`, so a timeline file takes it on open and a page-era file takes it in its
 * conversion; it needs no `user_version` bump.
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

const ITEMS_MIGRATION = migrationAt(24);
const LIBRARY_ITEM = "11111111-1111-4111-8111-111111111111";
const ITEM_TABLES = ["item_geometry", "items"];
/** `0024_demonic_scream`, the Shape tool's migration on lab builds of #181 */
const SHAPE_LAB_MIGRATION_MS = 1792165936156;
/** The date fork builds gave this migration before it was re-dated */
const EARLIER_FORK_DATE = 1792162434076;

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

const marcherColumns = (db: DatabaseSync) =>
    (
        db.prepare("SELECT name FROM pragma_table_info('marchers')").all() as {
            name: string;
        }[]
    ).map((c) => c.name);

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
            hooks: { now: () => new Date("2026-10-16T12:00:00.000Z") },
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

/** A prop on marcher 100 with two Outline changes, and a piece of equipment on marcher 101. */
const insertItems = (db: DatabaseSync) => {
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(`
        INSERT INTO marchers (id, section, drill_prefix, drill_order, type)
            VALUES (100, 'Prop', 'P', 1, 'item'), (101, 'Equipment', 'E', 1, 'item');
        INSERT INTO items (id, marcher_id, kind, surface_type) VALUES (1, 100, 'prop', 'platform');
        INSERT INTO items (id, marcher_id, kind, library_item_id, library_version_hash)
            VALUES (2, 101, 'equipment', '${LIBRARY_ITEM}', '${"a".repeat(64)}');
        INSERT INTO item_geometry (id, item_id, beat_id, outline_type, width, depth, height)
            VALUES (1, 1, 3, 'rectangle', 2.4, 1.2, 0.6);
        INSERT INTO item_geometry (id, item_id, beat_id, outline_type, width, depth, height, transition_length)
            VALUES (2, 1, 9, 'rectangle', 4.8, 1.2, 0.6, 4);
    `);
};

describe(`Migration ${ITEMS_MIGRATION.tag}`, () => {
    let tempDir: string;
    let showPath: string;

    beforeEach(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "om-0024-"));
        showPath = path.join(tempDir, "show.dots");
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "debug").mockImplementation(() => {});
        await createPageShow(showPath);
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it("leaves items out of a page-era file until it converts", async () => {
        const db = new DatabaseSync(showPath);
        try {
            await migrate(db);
            expect(tableNames(db)).not.toContain("items");
            expect(marcherColumns(db)).not.toContain("type");
        } finally {
            db.close();
        }
    });

    it("adds items when a page-era file converts: every marcher is a performer", async () => {
        const marchers = withDb(showPath, (db) =>
            db
                .prepare("SELECT id, drill_prefix, drill_order FROM marchers")
                .all(),
        );

        await open(showPath);

        withDb(showPath, (db) => {
            expect(readUserVersion(db)).toBe(TIMELINE_MODEL_USER_VERSION);
            expect(
                db
                    .prepare(
                        "SELECT id, drill_prefix, drill_order FROM marchers",
                    )
                    .all(),
            ).toEqual(marchers);
            expect(
                db.prepare("SELECT DISTINCT type FROM marchers").all(),
            ).toEqual([{ type: "marcher" }]);
            insertItems(db);
            expect(count(db, "item_geometry")).toBe(2);
        });
    });

    it("opens a converted timeline file from before it: version 8 and the timeline are kept", async () => {
        await open(showPath);
        rollBackMigrationsFrom(showPath, ITEMS_MIGRATION.idx);
        const before = withDb(showPath, (db) => {
            expect(marcherColumns(db)).not.toContain("type");
            for (const table of ITEM_TABLES)
                expect(tableNames(db)).not.toContain(table);
            return { assignments: count(db, "timeline_assignments") };
        });
        expect(before.assignments).toBeGreaterThan(0);

        // A converted file doesn't convert again
        expect(await open(showPath)).toMatchObject({ kind: "none" });

        withDb(showPath, (db) => {
            expect(readUserVersion(db)).toBe(TIMELINE_MODEL_USER_VERSION);
            expect(count(db, "timeline_assignments")).toBe(before.assignments);
            expect(
                db.prepare("SELECT DISTINCT type FROM marchers").all(),
            ).toEqual([{ type: "marcher" }]);
            insertItems(db);
            expect(count(db, "items")).toBe(2);
        });
    });

    it("runs again on a file that took it under an earlier date, keeping its items", async () => {
        await open(showPath);
        // A fork build gave this migration an earlier date: the file's newest row is that one
        withDb(showPath, (db) => {
            insertItems(db);
            db.prepare(
                "UPDATE __drizzle_migrations SET created_at = ? WHERE created_at = ?",
            ).run(EARLIER_FORK_DATE, ITEMS_MIGRATION.when);
        });

        await open(showPath);

        withDb(showPath, (db) => {
            expect(count(db, "items")).toBe(2);
            expect(count(db, "item_geometry")).toBe(2);
            expect(marcherColumns(db).filter((c) => c === "type")).toHaveLength(
                1,
            );
            expect(
                db
                    .prepare(
                        "SELECT count(*) AS n FROM __drizzle_migrations WHERE created_at = ?",
                    )
                    .get(ITEMS_MIGRATION.when),
            ).toEqual({ n: 1 });
        });
    });

    it("comes to a file that took the Shape tool's lab migration (#181) first", async () => {
        expect(ITEMS_MIGRATION.when).toBeGreaterThan(SHAPE_LAB_MIGRATION_MS);
        await open(showPath);
        rollBackMigrationsFrom(showPath, ITEMS_MIGRATION.idx);
        withDb(showPath, (db) =>
            db
                .prepare(
                    "INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('0024_demonic_scream', ?)",
                )
                .run(SHAPE_LAB_MIGRATION_MS),
        );

        await open(showPath);

        withDb(showPath, (db) => {
            for (const table of ITEM_TABLES)
                expect(tableNames(db)).toContain(table);
            expect(marcherColumns(db)).toContain("type");
            insertItems(db);
            expect(count(db, "items")).toBe(2);
        });
    });

    describe("constraints", () => {
        let db: DatabaseSync;
        beforeEach(async () => {
            await open(showPath);
            db = new DatabaseSync(showPath);
            insertItems(db);
            db.exec(
                "INSERT INTO marchers (id, section, drill_prefix, drill_order, type) VALUES (102, 'Prop', 'P', 2, 'item')",
            );
        });
        afterEach(() => db.close());

        const insertInto = (
            table: string,
            row: Record<string, string | number | null>,
        ) => {
            const names = Object.keys(row);
            db.prepare(
                `INSERT INTO ${table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`,
            ).run(...Object.values(row));
        };
        const item = (columns: Record<string, string | number | null>) =>
            insertInto("items", {
                marcher_id: 102,
                kind: "prop",
                surface_type: "floor",
                ...columns,
            });
        const geometry = (columns: Record<string, string | number | null>) =>
            insertInto("item_geometry", {
                item_id: 1,
                beat_id: 5,
                outline_type: "circle",
                width: 1,
                depth: 1,
                ...columns,
            });

        it("rejects a marcher type other than marcher or item", () => {
            expect(() =>
                db.exec(
                    "INSERT INTO marchers (section, drill_prefix, drill_order, type) VALUES ('Prop', 'P', 3, 'prop')",
                ),
            ).toThrow();
        });

        it.each<[string, Record<string, string | number | null>]>([
            ["an unknown kind", { kind: "costume" }],
            ["a prop with no surface type", { surface_type: null }],
            ["an unknown surface type", { surface_type: "ramp" }],
            ["equipment with a surface type", { kind: "equipment" }],
            [
                "a Library item with no Version",
                { library_item_id: LIBRARY_ITEM },
            ],
            [
                "a Version with no Library item",
                { library_version_hash: "a".repeat(64) },
            ],
            [
                "a Version hash of the wrong length",
                {
                    library_item_id: LIBRARY_ITEM,
                    library_version_hash: "abc",
                },
            ],
            ["a second item on one marcher", { marcher_id: 100 }],
            ["a missing marcher", { marcher_id: 999 }],
        ])("rejects an item with %s", (_, columns) => {
            expect(() => item(columns)).toThrow();
        });

        it.each<[string, Record<string, string | number | null>]>([
            ["a floor prop", {}],
            ["equipment", { kind: "equipment", surface_type: null }],
            [
                "a pinned Library model",
                {
                    library_item_id: LIBRARY_ITEM,
                    library_version_hash: "b".repeat(64),
                },
            ],
        ])("accepts an item that is %s", (_, columns) => {
            expect(() => item(columns)).not.toThrow();
        });

        it.each<[string, Record<string, string | number | null>]>([
            ["an unknown outline type", { outline_type: "star" }],
            ["no width", { width: 0 }],
            ["a negative depth", { depth: -1 }],
            ["a negative height", { height: -0.1 }],
            ["a transition of 0", { transition_length: 0 }],
            ["a fractional transition", { transition_length: 1.5 }],
            ["a custom outline that isn't JSON", { custom_outline: "[" }],
            ["a roll-out with no leading edge", { rolls_out: 1 }],
            ["a leading edge with no roll-out", { leading_edge: "front" }],
            ["an unknown leading edge", { rolls_out: 1, leading_edge: "top" }],
            ["a second change on one beat", { beat_id: 3 }],
            ["a missing beat", { beat_id: 99999 }],
            ["a missing item", { item_id: 99 }],
        ])("rejects geometry with %s", (_, columns) => {
            expect(() => geometry(columns)).toThrow();
        });

        it.each<[string, Record<string, string | number | null>]>([
            ["a circle", {}],
            ["a flat Floor prop", { height: 0 }],
            ["a transition", { transition_length: 8 }],
            [
                "a freehand outline",
                {
                    outline_type: "freehand",
                    custom_outline: '{"points":[{"x":0,"y":0}]}',
                },
            ],
            ["a roll-out", { rolls_out: 1, leading_edge: "back" }],
        ])("accepts geometry with %s", (_, columns) => {
            expect(() => geometry(columns)).not.toThrow();
        });

        it("deletes an item's geometry with its beat, and the item and its geometry with its marcher", () => {
            db.exec("DELETE FROM beats WHERE id = 3");
            expect(
                db.prepare("SELECT id FROM item_geometry ORDER BY id").all(),
            ).toEqual([{ id: 2 }]);
            db.exec("DELETE FROM marchers WHERE id = 100");
            expect(db.prepare("SELECT id FROM items").all()).toEqual([
                { id: 2 },
            ]);
            expect(count(db, "item_geometry")).toBe(0);
        });
    });
});
