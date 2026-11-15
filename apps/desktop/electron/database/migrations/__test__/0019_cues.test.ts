// @vitest-environment node
/**
 * 0019 adds the cue tables (ADR 0015 D-9): a file from before it gets them empty and ends with a
 * new file's schema, and a cue of a type this build doesn't know is still there after the file
 * is opened again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
    createNewTimelineShow,
    withDb,
} from "../../__test__/convertOnOpenFixtures";
import { rollBackMigrationsFrom } from "../../__test__/migrationRollback";
import {
    migrateFile,
    normalizedSchema,
} from "../../legacyFork/__test__/forkFileFixtures";

describe("0019_cues", () => {
    let dir: string;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "om-0019-"));
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "debug").mockImplementation(() => {});
    });
    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    const tables = (file: string) =>
        withDb(file, (db) =>
            (
                db
                    .prepare(
                        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name LIKE 'cue%' ORDER BY name",
                    )
                    .all() as { name: string }[]
            ).map((t) => t.name),
        );
    it("adds both tables, empty: the file ends as a new file", async () => {
        const file = path.join(dir, "show.dots");
        await createNewTimelineShow(file);
        const fresh = withDb(file, normalizedSchema);
        rollBackMigrationsFrom(file, 19);
        expect(tables(file)).toEqual([]);

        await migrateFile(file);

        expect(withDb(file, normalizedSchema)).toEqual(fresh);
        expect(tables(file)).toEqual(["cue_marchers", "cues"]);
        expect(
            withDb(file, (db) => db.prepare("SELECT * FROM cues").all()),
        ).toEqual([]);
    });

    it("keeps a cue of a type and value no build knows yet when the file is opened again", async () => {
        const file = path.join(dir, "show.dots");
        await createNewTimelineShow(file);
        withDb(file, (db) =>
            db.exec(`
                INSERT INTO marchers (id, section, drill_prefix, drill_order) VALUES (1, 'Brass', 'B', 1);
                INSERT INTO cues (id, type, beat_id, value, settings_json, length, transition, label, notes)
                    VALUES (7, 'lights', 0, 'future:lights.on', '{"color":"#ff0000"}', 4, 2, 'Brass', 'from a later build');
                INSERT INTO cue_marchers (id, cue_id, marcher_id) VALUES (3, 7, 1);
            `),
        );
        const rows = () =>
            withDb(file, (db) => ({
                cues: db
                    .prepare(
                        "SELECT id, type, beat_id, value, settings_json, length, transition, label, notes FROM cues",
                    )
                    .all(),
                performers: db.prepare("SELECT * FROM cue_marchers").all(),
            }));
        const before = rows();

        await migrateFile(file);

        expect(rows()).toEqual(before);
        expect(before.cues).toEqual([
            {
                id: 7,
                type: "lights",
                beat_id: 0,
                value: "future:lights.on",
                settings_json: '{"color":"#ff0000"}',
                length: 4,
                transition: 2,
                label: "Brass",
                notes: "from a later build",
            },
        ]);
    });

    it("deletes a cue's performers with it, and a marcher's cue rows with the marcher", async () => {
        const file = path.join(dir, "show.dots");
        await createNewTimelineShow(file);
        const left = withDb(file, (db) => {
            db.exec(`
                PRAGMA foreign_keys = ON;
                INSERT INTO marchers (id, section, drill_prefix, drill_order) VALUES (1, 'Brass', 'B', 1), (2, 'Brass', 'B', 2);
                INSERT INTO cues (id, type, beat_id, value) VALUES (7, 'look', 0, 'builtin:look.guard'), (8, 'look', 0, 'builtin:look.band');
                INSERT INTO cue_marchers (cue_id, marcher_id) VALUES (7, 1), (7, 2), (8, 1);
                DELETE FROM cues WHERE id = 8;
                DELETE FROM marchers WHERE id = 2;
            `);
            return db
                .prepare("SELECT cue_id, marcher_id FROM cue_marchers")
                .all();
        });
        expect(left).toEqual([{ cue_id: 7, marcher_id: 1 }]);
    });

    it("refuses a performer twice on one cue, a length or transition under 1, and settings that aren't JSON", async () => {
        const file = path.join(dir, "show.dots");
        await createNewTimelineShow(file);
        withDb(file, (db) => {
            db.exec(`
                INSERT INTO marchers (id, section, drill_prefix, drill_order) VALUES (1, 'Brass', 'B', 1);
                INSERT INTO cues (id, type, beat_id, value) VALUES (7, 'look', 0, 'builtin:look.guard');
                INSERT INTO cue_marchers (cue_id, marcher_id) VALUES (7, 1);
            `);
            const refused = [
                "INSERT INTO cue_marchers (cue_id, marcher_id) VALUES (7, 1)",
                "INSERT INTO cues (type, beat_id, value, length) VALUES ('look', 0, 'v', 0)",
                "INSERT INTO cues (type, beat_id, value, transition) VALUES ('look', 0, 'v', 0)",
                "INSERT INTO cues (type, beat_id, value, settings_json) VALUES ('look', 0, 'v', 'not json')",
            ];
            for (const statement of refused)
                expect(() => db.exec(statement), statement).toThrow();
            // any text is a type or a value: they are checked in code
            db.exec(
                "INSERT INTO cues (type, beat_id, value) VALUES ('anything', 0, 'at all')",
            );
        });
    });
});
