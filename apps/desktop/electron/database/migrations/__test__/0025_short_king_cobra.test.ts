// @vitest-environment node
/**
 * Migration 0025 adds item Placement (props-spec section 4, ADR 0002 D-10): the beat-keyed
 * `item_placements` and their holders and crew in `item_placement_marchers`. New tables only.
 * It comes after `0020_drop_page_era`, so a timeline file takes it on open and a page-era file
 * takes it in its conversion; it needs no `user_version` bump.
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

const PLACEMENT_MIGRATION = migrationAt(25);

type Row = Record<string, string | number | null>;

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

/**
 * A flag (item 1) held by performer 1 from beat 3 and placed with performers 2 and 3 as crew on
 * beat 9, and a cone (item 2) taken off field on beat 5 as part of ripple group 1.
 */
const insertPlacements = (db: DatabaseSync) => {
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(`
        INSERT INTO marchers (id, section, drill_prefix, drill_order, type)
            VALUES (100, 'Equipment', 'E', 1, 'item'), (101, 'Prop', 'P', 1, 'item');
        INSERT INTO items (id, marcher_id, kind) VALUES (1, 100, 'equipment');
        INSERT INTO items (id, marcher_id, kind, surface_type) VALUES (2, 101, 'prop', 'obstacle');
        INSERT INTO item_placements (id, item_id, beat_id, state) VALUES (1, 1, 3, 'held');
        INSERT INTO item_placements (id, item_id, beat_id, state) VALUES (2, 1, 9, 'placed');
        INSERT INTO item_placements (id, item_id, beat_id, state, group_id) VALUES (3, 2, 5, 'off_field', 1);
        INSERT INTO item_placement_marchers (id, placement_id, marcher_id, role, hand)
            VALUES (1, 1, 1, 'holder', 'both'), (2, 2, 2, 'crew', NULL), (3, 2, 3, 'crew', NULL);
    `);
};

describe(`Migration ${PLACEMENT_MIGRATION.tag}`, () => {
    let tempDir: string;
    let showPath: string;

    beforeEach(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "om-0025-"));
        showPath = path.join(tempDir, "show.dots");
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "debug").mockImplementation(() => {});
        await createPageShow(showPath);
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    const tables = (db: DatabaseSync) =>
        tableNames(db)
            .filter((name) => name.startsWith("item_placement"))
            .sort();

    it("leaves Placement out of a page-era file until it converts", async () => {
        const db = new DatabaseSync(showPath);
        try {
            await migrate(db);
            expect(tables(db)).toEqual([]);
        } finally {
            db.close();
        }
    });

    it("adds Placement when a page-era file converts, and keeps the show", async () => {
        const marchers = withDb(showPath, (db) => count(db, "marchers"));

        await open(showPath);

        withDb(showPath, (db) => {
            expect(readUserVersion(db)).toBe(TIMELINE_MODEL_USER_VERSION);
            expect(tables(db)).toEqual([
                "item_placement_marchers",
                "item_placements",
            ]);
            expect(count(db, "marchers")).toBe(marchers);
            insertPlacements(db);
            expect(count(db, "item_placement_marchers")).toBe(3);
        });
    });

    it("opens a converted timeline file from before it: version 8 and the timeline are kept", async () => {
        await open(showPath);
        rollBackMigrationsFrom(showPath, PLACEMENT_MIGRATION.idx);
        const before = withDb(showPath, (db) => {
            expect(tables(db)).toEqual([]);
            return { assignments: count(db, "timeline_assignments") };
        });
        expect(before.assignments).toBeGreaterThan(0);

        // A converted file doesn't convert again
        expect(await open(showPath)).toMatchObject({ kind: "none" });

        withDb(showPath, (db) => {
            expect(readUserVersion(db)).toBe(TIMELINE_MODEL_USER_VERSION);
            expect(count(db, "timeline_assignments")).toBe(before.assignments);
            insertPlacements(db);
            expect(count(db, "item_placements")).toBe(3);
        });
    });

    describe("constraints", () => {
        let db: DatabaseSync;
        beforeEach(async () => {
            await open(showPath);
            db = new DatabaseSync(showPath);
            insertPlacements(db);
        });
        afterEach(() => db.close());

        const insertInto = (table: string, row: Row) => {
            const names = Object.keys(row);
            db.prepare(
                `INSERT INTO ${table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`,
            ).run(...Object.values(row));
        };
        const placement = (columns: Row) =>
            insertInto("item_placements", {
                item_id: 2,
                beat_id: 7,
                state: "placed",
                ...columns,
            });
        const member = (columns: Row) =>
            insertInto("item_placement_marchers", {
                placement_id: 2,
                marcher_id: 4,
                role: "crew",
                hand: null,
                ...columns,
            });

        it.each<[string, Row]>([
            ["an unknown state", { state: "carried" }],
            ["no state", { state: null }],
            ["a group id of 0", { group_id: 0 }],
            ["a fractional group id", { group_id: 1.5 }],
            ["a text group id", { group_id: "a" }],
            ["a second change on one beat", { beat_id: 5 }],
            ["a missing beat", { beat_id: 99999 }],
            ["a missing item", { item_id: 99 }],
        ])("rejects a Placement change with %s", (_, columns) => {
            expect(() => placement(columns)).toThrow();
        });

        it.each<[string, Row]>([
            ["placed", {}],
            ["held", { state: "held" }],
            ["off field", { state: "off_field" }],
            ["in a ripple group", { group_id: 1 }],
        ])("accepts a Placement change %s", (_, columns) => {
            expect(() => placement(columns)).not.toThrow();
        });

        it.each<[string, Row]>([
            ["a holder with no hand", { role: "holder", hand: null }],
            ["a holder with an unknown hand", { role: "holder", hand: "foot" }],
            ["crew with a hand", { role: "crew", hand: "left" }],
            ["an unknown role", { role: "spotter" }],
            ["no role", { role: null }],
            ["a marcher twice on one change", { marcher_id: 2 }],
            ["a missing marcher", { marcher_id: 9999 }],
            ["a missing change", { placement_id: 99 }],
        ])("rejects a performer with %s", (_, columns) => {
            expect(() => member(columns)).toThrow();
        });

        it.each<[string, Row]>([
            ["crew", {}],
            ["a holder's left hand", { role: "holder", hand: "left" }],
            ["a holder's both hands", { role: "holder", hand: "both" }],
        ])("accepts a performer as %s", (_, columns) => {
            expect(() => member(columns)).not.toThrow();
        });

        it("deletes a change with its beat, its performers with it, and everything with the item", () => {
            db.exec("DELETE FROM beats WHERE id = 3");
            expect(
                db.prepare("SELECT id FROM item_placements ORDER BY id").all(),
            ).toEqual([{ id: 2 }, { id: 3 }]);
            expect(
                db
                    .prepare(
                        "SELECT id FROM item_placement_marchers ORDER BY id",
                    )
                    .all(),
            ).toEqual([{ id: 2 }, { id: 3 }]);
            db.exec("DELETE FROM marchers WHERE id = 2");
            expect(count(db, "item_placement_marchers")).toBe(1);
            db.exec("DELETE FROM marchers WHERE id = 100");
            expect(db.prepare("SELECT id FROM item_placements").all()).toEqual([
                { id: 3 },
            ]);
            expect(count(db, "item_placement_marchers")).toBe(0);
        });
    });
});
