// @vitest-environment node
/**
 * Migration 0025 adds item Placement (props-spec section 4, ADR 0002 D-10): the beat-keyed
 * `item_placements` and their holders and crew in `item_placement_marchers`. New tables only, each
 * `IF NOT EXISTS` so the migration can run twice. A ripple's rows carry its definition, as a cue
 * does (`ripple_json`), and `beat_rank` orders changes on one beat.
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
/** `0024_demonic_scream`, the Shape tool's migration on lab builds of #181 */
const SHAPE_LAB_MIGRATION_MS = 1792165936156;
/** The date fork builds gave this migration before it was re-dated */
const EARLIER_FORK_DATE = 1792168750467;
const RIPPLE = '{"version":1,"span":4,"order":"left_right"}';

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
        INSERT INTO item_placements (id, item_id, beat_id, state, group_id, ripple_json) VALUES (3, 2, 5, 'off_field', 1, '${RIPPLE}');
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

    it("runs again on a file that took it under an earlier date, keeping its rows", async () => {
        await open(showPath);
        // A fork build gave this migration an earlier date, and the file has nothing newer
        rollBackMigrationsFrom(showPath, PLACEMENT_MIGRATION.idx + 1);
        withDb(showPath, (db) => {
            insertPlacements(db);
            db.prepare(
                "UPDATE __drizzle_migrations SET created_at = ? WHERE created_at = ?",
            ).run(EARLIER_FORK_DATE, PLACEMENT_MIGRATION.when);
        });

        await open(showPath);

        withDb(showPath, (db) => {
            expect(count(db, "item_placements")).toBe(3);
            expect(count(db, "item_placement_marchers")).toBe(3);
        });
    });

    it("comes to a file that took the Shape tool's lab migration (#181) first", async () => {
        expect(PLACEMENT_MIGRATION.when).toBeGreaterThan(
            SHAPE_LAB_MIGRATION_MS,
        );
        await open(showPath);
        // A file from before the props migrations that a lab build of #181 opened
        rollBackMigrationsFrom(showPath, PLACEMENT_MIGRATION.idx - 1);
        withDb(showPath, (db) =>
            db
                .prepare(
                    "INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('0024_demonic_scream', ?)",
                )
                .run(SHAPE_LAB_MIGRATION_MS),
        );

        await open(showPath);

        withDb(showPath, (db) => {
            expect(tables(db)).toEqual([
                "item_placement_marchers",
                "item_placements",
            ]);
            insertPlacements(db);
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
            ["a group id of 0", { group_id: 0, ripple_json: RIPPLE }],
            ["a fractional group id", { group_id: 1.5, ripple_json: RIPPLE }],
            ["a text group id", { group_id: "a", ripple_json: RIPPLE }],
            ["a group with no ripple", { group_id: 1 }],
            ["a ripple with no group", { ripple_json: RIPPLE }],
            [
                "a ripple of span 0",
                {
                    group_id: 1,
                    ripple_json: '{"version":1,"span":0,"order":"drill"}',
                },
            ],
            [
                "a ripple in an unknown order",
                {
                    group_id: 1,
                    ripple_json: '{"version":1,"span":2,"order":"random"}',
                },
            ],
            [
                "a ripple of another version",
                {
                    group_id: 1,
                    ripple_json: '{"version":2,"span":2,"order":"drill"}',
                },
            ],
            ["a ripple that isn't JSON", { group_id: 1, ripple_json: "{" }],
            ["a fractional beat rank", { beat_rank: 0.5 }],
            ["no beat rank", { beat_rank: null }],
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
            ["in a ripple group", { group_id: 1, ripple_json: RIPPLE }],
            ["ranked below others on its beat", { beat_rank: -2 }],
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
