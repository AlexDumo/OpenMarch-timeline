// @vitest-environment node
/**
 * Migration 0029 stores a shape recipe at a count (ADR 0006 revision of 2026-11-22, §1.6-§1.8).
 * A 0.2.0-beta file (an ordinary 0017 file, version 8) with recipes in moves, at the starting
 * spots and order marks keeps every recipe at the count it was read at, fills `beat` and
 * `shape_key`, gives a marcher listed twice at one count to the newer recipe, keeps every member
 * row (foreign keys off), clears the undo history only when it names the table, and is written as
 * version 19. Rolling it back and opening it again keeps every recipe at its count.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
    createNewTimelineShow,
    withDb,
} from "../../__test__/convertOnOpenFixtures";
import {
    migrationAt,
    rollBackMigrationsFrom,
} from "../../__test__/migrationRollback";
import { migrateFile } from "../../legacyFork/__test__/forkFileFixtures";
import {
    readUserVersion,
    SHAPE_AT_COUNT_USER_VERSION,
} from "../../fileVersion";

const AT_COUNT = migrationAt(29);

/**
 * A beta file: marchers 1-5, move 1 over [0, 8) (marchers 1-3) and move 2 over [8, 16) (marchers
 * 1 and 2; 3 stands still), and recipes as 0017 stores them:
 *
 * 1. a line in move 1 (1, 2, 3): count 8
 * 2. a box at the starting spots (4, 5): count 0
 * 3. an order mark in no move with its own beat 12.5 (1, 2)
 * 4. an order mark in move 2 from before marks kept a beat (1, 2): count 16
 * 5. a shape in move 2 (1), older than
 * 6. a shape in move 2 (1, 2): both at 16, so 5 loses marcher 1 and goes
 * 7. an order mark at 12.5 (2), newer than 3: 3 loses marcher 2
 * 8. a shape in a move that's gone (only with foreign keys off): dropped, as the cascade would
 */
async function betaFile(file: string, history: "names recipes" | "other") {
    await createNewTimelineShow(file);
    rollBackMigrationsFrom(file, 29);
    withDb(file, (db) => {
        db.exec("PRAGMA foreign_keys = OFF");
        db.exec(`
            INSERT INTO marchers (id, section, drill_prefix, drill_order) VALUES
              (1, 'Brass', 'B', 1), (2, 'Brass', 'B', 2), (3, 'Brass', 'B', 3),
              (4, 'Brass', 'B', 4), (5, 'Brass', 'B', 5);
            INSERT INTO timelines (id, start_beat, end_beat) VALUES (1, 0, 8), (2, 8, 16);
            INSERT INTO timeline_transitions (id, timeline_id, slot_count, start_beat, end_beat) VALUES
              (1, 1, 3, 0, 8), (2, 2, 2, 8, 16);
            INSERT INTO timeline_slot_destinations (transition_id, slot_index, x, y) VALUES
              (1, 0, 10, 0), (1, 1, 20, 0), (1, 2, 30, 0), (2, 0, 10, 5), (2, 1, 20, 5);
            INSERT INTO timeline_assignments (id, marcher_id, transition_id, slot_index, start_beat, end_beat) VALUES
              (1, 1, 1, 0, 0, 8), (2, 2, 1, 1, 0, 8), (3, 3, 1, 2, 0, 8),
              (4, 1, 2, 0, 8, 16), (5, 2, 2, 1, 8, 16);
            INSERT INTO timeline_shape_recipes (id, timeline_id, kind, kind_version, params, order_mode) VALUES
              (1, 1, 'line', 1, '{"spots":3}', 'nearest'),
              (2, NULL, 'block', 1, '{"spots":2}', 'nearest'),
              (3, NULL, 'order', 1, '{"spots":2,"beat":12.5}', 'keep'),
              (4, 2, 'order', 1, '{"spots":2}', 'keep'),
              (5, 2, 'line', 1, '{"spots":1}', 'nearest'),
              (6, 2, 'line', 1, '{"spots":2}', 'nearest'),
              (7, NULL, 'order', 1, '{"spots":1,"beat":12.5}', 'keep'),
              (8, 99, 'line', 1, '{"spots":1}', 'nearest');
            INSERT INTO timeline_shape_recipe_marchers (id, recipe_id, marcher_id, slot, x, y) VALUES
              (1, 1, 1, 0, 10, 0), (2, 1, 2, 1, 20, 0), (3, 1, 3, 2, 30, 0),
              (4, 2, 4, 0, 0, 50), (5, 2, 5, 1, 4, 50),
              (6, 3, 1, 0, 0, 0), (7, 3, 2, 1, 0, 0),
              (8, 4, 1, 0, 0, 0), (9, 4, 2, 1, 0, 0),
              (10, 5, 1, 0, 10, 5),
              (11, 6, 1, 0, 10, 5), (12, 6, 2, 1, 20, 5),
              (13, 7, 2, 0, 0, 0),
              (14, 8, 3, 0, 0, 0);
            -- The renderer's history trigger on members, as a real file keeps it across
            -- migrations: 0029's clean-up must log nothing through it
            CREATE TRIGGER IF NOT EXISTS timeline_shape_recipe_marchers_dt BEFORE DELETE ON timeline_shape_recipe_marchers
            BEGIN
              INSERT INTO history_undo (history_group, sql) VALUES (9, 'INSERT INTO "timeline_shape_recipe_marchers" VALUES (' || OLD.id || ')');
            END;
            UPDATE history_stats SET cur_undo_group = 3, cur_redo_group = 2;
            PRAGMA user_version = 8;
        `);
        if (history === "names recipes")
            db.exec(`
                INSERT INTO history_undo (history_group, sql) VALUES (1, 'DELETE FROM "timeline_shape_recipes" WHERE rowid=6');
                INSERT INTO history_undo (history_group, sql) VALUES (2, 'UPDATE "marchers" SET "name"=NULL WHERE rowid=1');
                INSERT INTO history_redo (history_group, sql) VALUES (1, 'UPDATE "marchers" SET "name"=''A'' WHERE rowid=1');
            `);
        else
            db.exec(`
                INSERT INTO history_undo (history_group, sql) VALUES (2, 'UPDATE "marchers" SET "name"=NULL WHERE rowid=1');
                INSERT INTO history_redo (history_group, sql) VALUES (1, 'UPDATE "marchers" SET "name"=''A'' WHERE rowid=1');
            `);
    });
}

type Recipe = {
    id: number;
    beat: number;
    shape_key: number;
    kind: string;
    params: string;
    members: string;
};

const recipesOf = (file: string): Recipe[] =>
    withDb(file, (db) =>
        (
            db
                .prepare(
                    `SELECT r.id, r.beat, r.shape_key, r.kind, r.params,
                        (SELECT group_concat(m.marcher_id, ',') FROM (SELECT marcher_id FROM timeline_shape_recipe_marchers WHERE recipe_id = r.id ORDER BY marcher_id) m) AS members
                     FROM timeline_shape_recipes r ORDER BY r.id`,
                )
                .all() as Recipe[]
        ).map((r) => ({ ...r })),
    );

describe(`Migration ${AT_COUNT.tag}`, () => {
    let dir: string;
    let file: string;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "om-0029-"));
        file = path.join(dir, "show.dots");
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "debug").mockImplementation(() => {});
        vi.spyOn(console, "info").mockImplementation(() => {});
    });
    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it("a new file stores recipes at a count, and is written as version 19", async () => {
        await createNewTimelineShow(file);
        withDb(file, (db) => {
            const columns = (
                db
                    .prepare(
                        "SELECT name FROM pragma_table_info('timeline_shape_recipes')",
                    )
                    .all() as { name: string }[]
            ).map((c) => c.name);
            expect(columns).toContain("beat");
            expect(columns).toContain("shape_key");
            expect(columns).not.toContain("timeline_id");
            expect(readUserVersion(db)).toBe(SHAPE_AT_COUNT_USER_VERSION);
        });
    });

    it("keeps each recipe at the count it was read at, with its own id as its shape key", async () => {
        await betaFile(file, "other");
        await migrateFile(file);
        expect(recipesOf(file)).toEqual([
            {
                id: 1,
                beat: 8,
                shape_key: 1,
                kind: "line",
                params: '{"spots":3}',
                members: "1,2,3",
            },
            {
                id: 2,
                beat: 0,
                shape_key: 2,
                kind: "block",
                params: '{"spots":2}',
                members: "4,5",
            },
            // An order mark's own beat moves to the column; 7 is newer at 12.5 and keeps 2
            {
                id: 3,
                beat: 12.5,
                shape_key: 3,
                kind: "order",
                params: '{"spots":2}',
                members: "1",
            },
            // An order mark from before marks kept a beat stands where its move ends
            {
                id: 4,
                beat: 16,
                shape_key: 4,
                kind: "order",
                params: '{"spots":2}',
                members: "1,2",
            },
            // 5 lost marcher 1 to the newer 6 at 16 and went; order marks are another class
            {
                id: 6,
                beat: 16,
                shape_key: 6,
                kind: "line",
                params: '{"spots":2}',
                members: "1,2",
            },
            {
                id: 7,
                beat: 12.5,
                shape_key: 7,
                kind: "order",
                params: '{"spots":1}',
                members: "2",
            },
        ]);
        withDb(file, (db) => {
            expect(readUserVersion(db)).toBe(SHAPE_AT_COUNT_USER_VERSION);
            // No member row is left without its recipe
            expect(
                db
                    .prepare(
                        "SELECT count(*) AS n FROM timeline_shape_recipe_marchers WHERE recipe_id NOT IN (SELECT id FROM timeline_shape_recipes)",
                    )
                    .get(),
            ).toEqual({ n: 0 });
            expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
        });
    });

    it("keeps every member row though the old table is dropped (foreign keys off)", async () => {
        await betaFile(file, "other");
        await migrateFile(file);
        withDb(file, (db) =>
            expect(
                (
                    db
                        .prepare(
                            "SELECT id FROM timeline_shape_recipe_marchers ORDER BY id",
                        )
                        .all() as { id: number }[]
                ).map((r) => r.id),
            ).toEqual(
                // 7 (3's marcher 2) and 10 (5's marcher 1) were listed twice; 14 was in a move
                // that's gone
                [1, 2, 3, 4, 5, 6, 8, 9, 11, 12, 13],
            ),
        );
    });

    it("clears undo and redo in a file whose history names the recipes table, and logs no step of its own", async () => {
        await betaFile(file, "names recipes");
        await migrateFile(file);
        withDb(file, (db) => {
            expect(db.prepare("SELECT * FROM history_undo").all()).toEqual([]);
            expect(db.prepare("SELECT * FROM history_redo").all()).toEqual([]);
            expect(
                db
                    .prepare(
                        "SELECT cur_undo_group, cur_redo_group FROM history_stats",
                    )
                    .get(),
            ).toEqual({ cur_undo_group: 1, cur_redo_group: 1 });
        });
    });

    it("keeps the history of a file whose history doesn't name the table", async () => {
        await betaFile(file, "other");
        await migrateFile(file);
        withDb(file, (db) => {
            expect(
                (
                    db.prepare("SELECT sql FROM history_undo").all() as {
                        sql: string;
                    }[]
                ).map((r) => r.sql),
            ).toEqual(['UPDATE "marchers" SET "name"=NULL WHERE rowid=1']);
            expect(
                db.prepare("SELECT count(*) AS n FROM history_redo").get(),
            ).toEqual({ n: 1 });
        });
    });

    it("rolls back and opens again with every recipe at the same count", async () => {
        await betaFile(file, "other");
        await migrateFile(file);
        const after = recipesOf(file);
        rollBackMigrationsFrom(file, 29);
        withDb(file, (db) => {
            // The rollback stores what 0017 did: shapes in a move, order marks in none with a beat
            expect(
                db
                    .prepare(
                        "SELECT id, timeline_id, params FROM timeline_shape_recipes ORDER BY id",
                    )
                    .all()
                    .map((r) => ({ ...r })),
            ).toEqual([
                { id: 1, timeline_id: 1, params: '{"spots":3}' },
                { id: 2, timeline_id: null, params: '{"spots":2}' },
                { id: 3, timeline_id: null, params: '{"spots":2,"beat":12.5}' },
                // The column is REAL, so JSON reads 16.0: the same number
                { id: 4, timeline_id: null, params: '{"spots":2,"beat":16.0}' },
                { id: 6, timeline_id: 2, params: '{"spots":2}' },
                { id: 7, timeline_id: null, params: '{"spots":1,"beat":12.5}' },
            ]);
        });
        await migrateFile(file);
        expect(recipesOf(file)).toEqual(after);
    });
});
