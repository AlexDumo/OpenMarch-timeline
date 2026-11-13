// @vitest-environment node
// cspell:ignore Millis
/**
 * Migration 0024 adds `timeline_routes.timing`, pathways step 5 (spec Appendix M, QA-MIG-P1,
 * QA-FV-P1): a nullable column in place, no table rebuilt; a file with lanes, an Adjust and a
 * trail keeps every row and stays at its version until its first pin; E-R7 reads the column.
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
    ADJUST_MODEL_USER_VERSION,
    ARC_MODEL_USER_VERSION,
    decideFileVersion,
    PIN_MODEL_USER_VERSION,
    readUserVersion,
} from "../../fileVersion";
import {
    createNewTimelineShow,
    migrationsFolder,
    withDb,
} from "../../__test__/convertOnOpenFixtures";
import { migrationAt } from "../../__test__/migrationRollback";

const PIN_MIGRATION = migrationAt(24);

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
const ADJUST = JSON.stringify({
    v: 1,
    keys: [{ a: "from", b: "to", f: 0.5, d: [0, 3] }],
});

/** A new show put back to before 0024: a group lane with an Adjust, version 12, the column gone */
async function fileBefore0024(file: string) {
    await createNewTimelineShow(file);
    withDb(file, (db) => {
        db.exec(`
            DROP VIEW IF EXISTS timeline_route_violations;
            DROP TRIGGER IF EXISTS timeline_log_routes_ins;
            DROP TRIGGER IF EXISTS timeline_log_routes_upd;
            DROP TRIGGER IF EXISTS timeline_log_routes_del;
            DROP TRIGGER IF EXISTS timeline_routes_ut;
            DROP TRIGGER IF EXISTS timeline_routes_dt;
        `);
        db.exec("ALTER TABLE timeline_routes DROP COLUMN timing");
        db.prepare(
            "DELETE FROM __drizzle_migrations WHERE created_at >= ?",
        ).run(PIN_MIGRATION.when);
        db.exec(`
            PRAGMA foreign_keys = OFF;
            INSERT INTO marchers (id, section, drill_prefix, drill_order, home_x, home_y) VALUES (1, 'Brass', 'B', 1, 0, 0);
            INSERT INTO marchers (id, section, drill_prefix, drill_order, home_x, home_y) VALUES (2, 'Brass', 'B', 2, 0, 5);
            INSERT INTO timelines (id, start_beat, end_beat) VALUES (1, 0, 8);
            INSERT INTO timeline_routes (id, geometry) VALUES (1, '${ROUTE}');
            INSERT INTO timeline_transitions (id, timeline_id, path_style, slot_count, start_beat, end_beat) VALUES (1, 1, 'direct', 2, 0, 8);
            INSERT INTO timeline_slot_destinations (transition_id, slot_index, x, y) VALUES (1, 0, 40, 0);
            INSERT INTO timeline_slot_destinations (transition_id, slot_index, x, y) VALUES (1, 1, 40, 5);
            INSERT INTO timeline_assignments (marcher_id, transition_id, slot_index, start_beat, end_beat) VALUES (1, 1, 0, 0, 8);
            INSERT INTO timeline_assignments (marcher_id, transition_id, slot_index, start_beat, end_beat) VALUES (2, 1, 1, 0, 8);
            INSERT INTO timeline_lanes (transition_id, slot_index, route_id, offset_x, offset_y, adjust) VALUES (1, 0, 1, 0, 0, '${ADJUST}');
            INSERT INTO timeline_lanes (transition_id, slot_index, route_id, offset_x, offset_y) VALUES (1, 1, 1, 0, 5);
            PRAGMA user_version = 12;
        `);
    });
}

describe(`Migration ${PIN_MIGRATION.tag}`, () => {
    let tempDir: string;
    let file: string;
    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "om-0024-"));
        file = path.join(tempDir, "show.dots");
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "debug").mockImplementation(() => {});
        vi.spyOn(console, "info").mockImplementation(() => {});
    });
    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it("adds the column in place: no rebuild, one statement; it runs before a conversion too", () => {
        const { sql } = readTaggedMigrations(migrationsFolder).find(
            (m) => m.folderMillis === PIN_MIGRATION.when,
        )!;
        expect(sql.join("\n")).not.toMatch(/__new_|DROP TABLE/);
        expect(sql).toHaveLength(1);
        expect(CONVERTER_SCHEMA_MIGRATION_TAGS).toContain(PIN_MIGRATION.tag);
    });

    it("a new file has the column and stays a timeline file; its view reads it", async () => {
        await createNewTimelineShow(file);
        withDb(file, (db) => {
            expect(readUserVersion(db)).toBe(8);
            expect(
                db.prepare("SELECT * FROM timeline_route_violations").all(),
            ).toEqual([]);
        });
    });

    it("QA-MIG-P1: a file with lanes and an Adjust keeps every row, timing NULL, and stays at 12", async () => {
        await fileBefore0024(file);
        await open(file);
        withDb(file, (db) => {
            expect(
                db
                    .prepare("SELECT id, geometry, timing FROM timeline_routes")
                    .all()
                    .map((r) => ({ ...r })),
            ).toEqual([{ id: 1, geometry: ROUTE, timing: null }]);
            expect(
                db.prepare("SELECT COUNT(*) AS n FROM timeline_lanes").get(),
            ).toEqual({ n: 2 });
            expect(readUserVersion(db)).toBe(ADJUST_MODEL_USER_VERSION);
            // The change-log trigger was rebuilt with the column
            db.exec(
                `UPDATE timeline_routes SET timing = '{"v":1,"pins":[{"point":"p","at":3}]}' WHERE id = 1`,
            );
            const log = db
                .prepare(
                    `SELECT "after" FROM timeline_change_log WHERE tbl = 'routes' ORDER BY rowid DESC LIMIT 1`,
                )
                .get() as { after: string };
            expect(JSON.parse(log.after).timing).toEqual({
                v: 1,
                pins: [{ point: "p", at: 3 }],
            });
            expect(
                db.prepare("SELECT * FROM timeline_route_violations").all(),
            ).toEqual([]);
            // E-R7: a pin outside the move, or on a missing point
            for (const pin of [
                '{"point":"p","at":8}',
                '{"point":"q","at":3}',
            ]) {
                db.exec(
                    `UPDATE timeline_routes SET timing = '{"v":1,"pins":[${pin}]}' WHERE id = 1`,
                );
                expect(
                    db
                        .prepare("SELECT code FROM timeline_route_violations")
                        .all()
                        .map((r) => ({ ...r })),
                ).toEqual([{ code: "E-R7" }]);
            }
            expect(() =>
                db.exec(
                    `UPDATE timeline_routes SET timing = 'not json' WHERE id = 1`,
                ),
            ).toThrow(/CHECK/);
        });
        // Opening again is a no-op: the column isn't added twice
        await open(file);
    });

    it("QA-FV-P1: 15 is past what the arc build opened, so it refuses; this build opens it", () => {
        expect(PIN_MODEL_USER_VERSION).toBe(15);
        expect(PIN_MODEL_USER_VERSION).toBeGreaterThan(ARC_MODEL_USER_VERSION);
        expect(decideFileVersion(15, false).action).toBe("accept");
        expect(decideFileVersion(16, false).action).toBe("refuse-too-new");
    });
});
