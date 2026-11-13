// @vitest-environment node
// cspell:ignore Millis
/**
 * Migration 0025 adds linked Adjusts, pathways step 26 (spec v0.10 J.1): `timeline_route_adjusts`
 * and `timeline_lanes.group_adjust_id`. A new table and a nullable column added in place: a file
 * from before it opens with every row and its version unchanged (QA-MIG-J1), and the column's
 * CHECK and foreign key hold: none on an own lane, never a missing linked Adjust, and a linked
 * Adjust can't go while a lane shares it (RESTRICT).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { getOrm } from "../../db";
import {
    CONVERTER_SCHEMA_MIGRATION_TAGS,
    DrizzleMigrationService,
    readTaggedMigrations,
} from "../../services/DrizzleMigrationService";
import {
    decideFileVersion,
    LANE_MODEL_USER_VERSION,
    LINKED_ADJUST_MODEL_USER_VERSION,
    readUserVersion,
} from "../../fileVersion";
import {
    createNewTimelineShow,
    migrationsFolder,
    withDb,
} from "../../__test__/convertOnOpenFixtures";
import { migrationAt } from "../../__test__/migrationRollback";

const LINKED_MIGRATION = migrationAt(25);

const open = async (file: string) => {
    const db = new DatabaseSync(file);
    try {
        await new DrizzleMigrationService(
            getOrm(db),
            db,
        ).applyPendingMigrations(migrationsFolder);
    } finally {
        db.close();
    }
};

const ROUTE = JSON.stringify({
    v: 1,
    from: [0, 0],
    to: [40, 0],
    points: [{ id: "p", at: [20, 15] }],
});
const PROFILE = JSON.stringify({
    v: 1,
    keys: [{ a: "from", b: "p", f: 1, d: [0, 3] }],
});

/** Every row of the timeline tables, for "nothing else changed" */
const timelineRows = (db: DatabaseSync) =>
    Object.fromEntries(
        [
            "timelines",
            "timeline_transitions",
            "timeline_assignments",
            "timeline_slot_destinations",
            "timeline_routes",
        ].map((t) => [
            t,
            db
                .prepare(`SELECT * FROM ${t} ORDER BY id`)
                .all()
                .map((r) => ({ ...r })),
        ]),
    );
const laneRows = (db: DatabaseSync) =>
    db
        .prepare(
            "SELECT id, transition_id, slot_index, route_id, offset_x, offset_y, adjust FROM timeline_lanes ORDER BY id",
        )
        .all()
        .map((r) => ({ ...r }));

/** A new show put back to before 0025: two group lanes on one route, version 11, no column */
async function fileBefore0025(file: string) {
    await createNewTimelineShow(file);
    withDb(file, (db) => {
        db.exec(`
            DROP VIEW IF EXISTS timeline_route_violations;
            DROP TRIGGER IF EXISTS timeline_log_lanes_ins;
            DROP TRIGGER IF EXISTS timeline_log_lanes_upd;
            DROP TRIGGER IF EXISTS timeline_log_lanes_del;
            DROP TRIGGER IF EXISTS timeline_lanes_ut;
            DROP TRIGGER IF EXISTS timeline_lanes_dt;
            DROP INDEX IF EXISTS timeline_idx_lane_adjust;
            ALTER TABLE timeline_lanes DROP COLUMN group_adjust_id;
            DROP TABLE timeline_route_adjusts;
        `);
        db.prepare(
            "DELETE FROM __drizzle_migrations WHERE created_at >= ?",
        ).run(LINKED_MIGRATION.when);
        db.exec(`
            PRAGMA foreign_keys = OFF;
            INSERT INTO marchers (id, section, drill_prefix, drill_order, home_x, home_y) VALUES (1, 'Brass', 'B', 1, 0, 0), (2, 'Brass', 'B', 2, 0, 4);
            INSERT INTO timelines (id, start_beat, end_beat) VALUES (1, 0, 8);
            INSERT INTO timeline_routes (id, geometry) VALUES (1, '${ROUTE}');
            INSERT INTO timeline_transitions (id, timeline_id, path_style, slot_count, start_beat, end_beat) VALUES (1, 1, 'direct', 2, 0, 8);
            INSERT INTO timeline_slot_destinations (transition_id, slot_index, x, y) VALUES (1, 0, 40, 0), (1, 1, 40, 4);
            INSERT INTO timeline_assignments (marcher_id, transition_id, slot_index, start_beat, end_beat) VALUES (1, 1, 0, 0, 8), (2, 1, 1, 0, 8);
            INSERT INTO timeline_lanes (transition_id, slot_index, route_id, offset_x, offset_y, adjust) VALUES (1, 0, 1, 0, -2, NULL), (1, 1, 1, 0, 2, '${PROFILE}');
            PRAGMA user_version = 11;
        `);
    });
}

describe(`Migration ${LINKED_MIGRATION.tag}`, () => {
    let tempDir: string;
    let file: string;
    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "om-0025-"));
        file = path.join(tempDir, "show.dots");
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "debug").mockImplementation(() => {});
        vi.spyOn(console, "info").mockImplementation(() => {});
    });
    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it("adds a table and a column in place, rebuilding nothing; it runs in a conversion too", () => {
        const { sql } = readTaggedMigrations(migrationsFolder).find(
            (m) => m.folderMillis === LINKED_MIGRATION.when,
        )!;
        const statements = sql
            .join("\n")
            .split("\n")
            .filter((line) => !line.startsWith("--"))
            .join("\n");
        expect(statements).not.toMatch(
            /__new_|DROP TABLE|INSERT INTO|UPDATE `/,
        );
        expect(statements).toMatch(
            /ALTER TABLE `timeline_lanes` ADD COLUMN `group_adjust_id`/,
        );
        expect(CONVERTER_SCHEMA_MIGRATION_TAGS).toContain(LINKED_MIGRATION.tag);
        // later than step 5's 0024 (pins, PR #903), so it applies after it on any file
        expect(LINKED_MIGRATION.when).toBeGreaterThan(1794602403700);
    });

    it("QA-MIG-J1: a file from before it keeps every row and its version; opening again is a no-op", async () => {
        await fileBefore0025(file);
        const before = withDb(file, timelineRows);
        const lanes = withDb(file, laneRows);
        await open(file);
        withDb(file, (db) => {
            expect(timelineRows(db)).toEqual(before);
            expect(laneRows(db)).toEqual(lanes);
            expect(readUserVersion(db)).toBe(LANE_MODEL_USER_VERSION);
            expect(
                db.prepare("SELECT group_adjust_id FROM timeline_lanes").all(),
            ).toEqual([{ group_adjust_id: null }, { group_adjust_id: null }]);
            expect(
                db.prepare("SELECT * FROM timeline_route_adjusts").all(),
            ).toEqual([]);
        });
        await open(file);
    });

    it("checks the column: none on an own lane, a real linked Adjust, RESTRICT", async () => {
        await fileBefore0025(file);
        await open(file);
        withDb(file, (db) => {
            db.exec("PRAGMA foreign_keys = ON");
            expect(() =>
                db.exec(
                    "INSERT INTO timeline_route_adjusts (route_id, profile) VALUES (1, 'not json')",
                ),
            ).toThrow(/CHECK/);
            db.exec(
                `INSERT INTO timeline_route_adjusts (id, route_id, profile) VALUES (5, 1, '${PROFILE}')`,
            );
            db.exec("UPDATE timeline_lanes SET group_adjust_id = 5");
            expect(() =>
                db.exec("UPDATE timeline_lanes SET group_adjust_id = 6"),
            ).toThrow(/FOREIGN KEY/);
            // an own lane walks alone
            expect(() =>
                db.exec(
                    "UPDATE timeline_lanes SET offset_x = NULL, offset_y = NULL WHERE id = 1",
                ),
            ).toThrow(/CHECK/);
            // a linked Adjust can't go while a lane shares it
            expect(() =>
                db.exec("DELETE FROM timeline_route_adjusts WHERE id = 5"),
            ).toThrow(/FOREIGN KEY/);
            db.exec("UPDATE timeline_lanes SET group_adjust_id = NULL");
            db.exec("DELETE FROM timeline_route_adjusts WHERE id = 5");
        });
    });

    it("QA-FV-J1: 16 is this build's; 17 is refused", () => {
        expect(LINKED_ADJUST_MODEL_USER_VERSION).toBe(16);
        expect(decideFileVersion(16, false).action).toBe("accept");
        expect(decideFileVersion(17, false).action).toBe("refuse-too-new");
    });
});
