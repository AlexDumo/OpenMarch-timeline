// @vitest-environment node
/**
 * Migration 0020 adds the performer cue tables (ADR 0004 D-5): `cues`, `cue_marchers`,
 * `phrase_assets` and `page_performer_settings`. It only creates tables and indexes, needs no
 * conversion step and no `user_version` bump, so page-mode and converted timeline files both
 * open with it, and convert-on-open leaves cue rows alone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { getOrm } from "../../db";
import { DrizzleMigrationService } from "../../services/DrizzleMigrationService";
import { applyFileVersionDecision, readUserVersion } from "../../fileVersion";
import { runConvertOnOpen, type ConvertOnOpenUi } from "../../convertOnOpen";
import {
    createPageShow,
    GATE_ON,
    migrationsFolder,
    withDb,
} from "../../__test__/convertOnOpenFixtures";

type Journal = { entries: { idx: number; tag: string; when: number }[] };
const journal: Journal = JSON.parse(
    fs.readFileSync(path.join(migrationsFolder, "meta/_journal.json"), "utf-8"),
);
const CUE_MIGRATION = journal.entries.find((e) => e.idx === 20)!;

const CUE_TABLES = [
    "cue_marchers",
    "cues",
    "page_performer_settings",
    "phrase_assets",
];

const tableNames = (db: DatabaseSync) =>
    (
        db
            .prepare(
                "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name",
            )
            .all() as { name: string }[]
    ).map((r) => r.name);

const count = (db: DatabaseSync, table: string) =>
    Number(
        (
            db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as {
                n: number;
            }
        ).n,
    );

/** Turns a migrated file back into one from before 0020: no cue tables, 0020 not recorded. */
const removeCueMigration = (filePath: string) =>
    withDb(filePath, (db) => {
        db.exec("PRAGMA foreign_keys = OFF");
        for (const table of CUE_TABLES) db.exec(`DROP TABLE ${table}`);
        db.prepare("DELETE FROM __drizzle_migrations WHERE created_at = ?").run(
            CUE_MIGRATION.when,
        );
    });

/** The database steps of `setActiveDb` before convert-on-open: version check and migrations. */
const openAndMigrate = async (filePath: string) => {
    const db = new DatabaseSync(filePath);
    try {
        applyFileVersionDecision(db, false);
        await new DrizzleMigrationService(
            getOrm(db),
            db,
        ).applyPendingMigrations(migrationsFolder);
        // The renderer creates the undo triggers on every open, the new tables' included
        const { createAllUndoTriggers } =
            await import("@/db-functions/history");
        await createAllUndoTriggers(getOrm(db) as never);
    } finally {
        db.close();
    }
};

const ui: ConvertOnOpenUi = {
    warnOlderRelease: async () => "stop",
    whilePreparing: async (work) => work(() => {}),
};

const convert = async (filePath: string) => {
    const db = new DatabaseSync(filePath);
    try {
        return await runConvertOnOpen(filePath, db, ui, {
            env: GATE_ON,
            hooks: { now: () => new Date("2026-10-12T12:00:00.000Z") },
        });
    } finally {
        db.close();
    }
};

/** A few cue rows on the page show's beats, marchers and pages. */
const insertCues = (db: DatabaseSync) => {
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(`
        INSERT INTO tags (id, name) VALUES (1, 'Front');
        INSERT INTO phrase_assets (id, name, label, source, channels_json, format_version, data_json)
            VALUES (1, 'Toss', '1x', 'copied_builtin', '["horn_equipment"]', 1, '{}');
        INSERT INTO cues (id, channel, kind, target_kind, beat_id, value, settings_json)
            VALUES (1, 'horn_equipment', 'state', 'band', 3, 'builtin:horn_equipment.horn.up', '{"angle":"box"}');
        INSERT INTO cues (id, channel, kind, target_kind, target_tag_id, beat_id, value, phrase_asset_id, length)
            VALUES (2, 'horn_equipment', 'phrase', 'tag', 1, 9, 'show:1', 1, 3);
        INSERT INTO cues (id, channel, kind, target_kind, beat_id, value, ripple_json)
            VALUES (3, 'silk', 'state', 'set', 10, 'library:4f1c2a7e@9a8b', '{"version":1,"span":4,"order":"drill"}');
        INSERT INTO cue_marchers (cue_id, marcher_id) VALUES (3, 1), (3, 2);
        INSERT INTO page_performer_settings (page_id, dot_mode) VALUES (1, 'body');
    `);
};

const cueRows = (db: DatabaseSync) => ({
    cues: db.prepare("SELECT * FROM cues ORDER BY id").all(),
    cue_marchers: db.prepare("SELECT * FROM cue_marchers ORDER BY id").all(),
    phrase_assets: db.prepare("SELECT * FROM phrase_assets ORDER BY id").all(),
    page_performer_settings: db
        .prepare("SELECT * FROM page_performer_settings ORDER BY page_id")
        .all(),
});

describe(`Migration ${CUE_MIGRATION.tag}`, () => {
    let tempDir: string;
    let showPath: string;

    beforeEach(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "om-0020-"));
        showPath = path.join(tempDir, "show.dots");
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "debug").mockImplementation(() => {});
        await createPageShow(showPath);
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it("opens a page-mode file from before it: the tables appear, the show is kept, version 7", async () => {
        removeCueMigration(showPath);
        const before = withDb(showPath, (db) => ({
            tables: tableNames(db),
            marcherPages: count(db, "marcher_pages"),
            beats: count(db, "beats"),
        }));
        expect(before.tables).not.toContain("cues");

        await openAndMigrate(showPath);

        withDb(showPath, (db) => {
            expect(tableNames(db)).toEqual(
                [...before.tables, ...CUE_TABLES].sort(),
            );
            expect(count(db, "marcher_pages")).toBe(before.marcherPages);
            expect(count(db, "beats")).toBe(before.beats);
            expect(readUserVersion(db)).toBe(7);
            insertCues(db);
            expect(count(db, "cues")).toBe(3);
        });
    });

    it("opens a converted timeline file from before it: the tables appear, version 8 and the timeline are kept", async () => {
        await openAndMigrate(showPath);
        const outcome = await convert(showPath);
        expect(outcome).toMatchObject({
            kind: "conversion",
            status: "converted",
        });
        removeCueMigration(showPath);
        const before = withDb(showPath, (db) => ({
            timelines: count(db, "timelines"),
            assignments: count(db, "timeline_assignments"),
        }));
        expect(before.timelines).toBeGreaterThan(0);

        await openAndMigrate(showPath);

        withDb(showPath, (db) => {
            expect(tableNames(db)).toEqual(expect.arrayContaining(CUE_TABLES));
            expect(readUserVersion(db)).toBe(8);
            expect(count(db, "timelines")).toBe(before.timelines);
            expect(count(db, "timeline_assignments")).toBe(before.assignments);
            insertCues(db);
            expect(count(db, "cue_marchers")).toBe(2);
        });
        // Reopening a converted file doesn't convert it again
        expect(await convert(showPath)).toMatchObject({ kind: "none" });
    });

    it("leaves cue rows intact through convert-on-open", async () => {
        await openAndMigrate(showPath);
        const before = withDb(showPath, (db) => {
            insertCues(db);
            return cueRows(db);
        });

        const outcome = await convert(showPath);

        expect(outcome).toMatchObject({
            kind: "conversion",
            status: "converted",
        });
        withDb(showPath, (db) => {
            expect(readUserVersion(db)).toBe(8);
            expect(cueRows(db)).toEqual(before);
        });
    });

    describe("constraints", () => {
        let db: DatabaseSync;
        beforeEach(async () => {
            await openAndMigrate(showPath);
            db = new DatabaseSync(showPath);
            insertCues(db);
        });
        afterEach(() => db.close());

        const insert = (columns: Record<string, string | number | null>) => {
            const row = {
                channel: "body",
                kind: "state",
                target_kind: "band",
                beat_id: 4,
                value: "builtin:body.kneel",
                ...columns,
            };
            const names = Object.keys(row);
            db.prepare(
                `INSERT INTO cues (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`,
            ).run(...Object.values(row));
        };

        it.each<[string, Record<string, string | number | null>]>([
            ["a channel outside the seven", { channel: "head" }],
            ["an unknown kind", { kind: "move" }],
            ["an unknown target", { target_kind: "everyone" }],
            ["a section target with no section", { target_kind: "section" }],
            ["a tag target with no tag", { target_kind: "tag" }],
            ["a band target with a section", { target_section: "Trumpet" }],
            [
                "a section target with a tag too",
                {
                    target_kind: "section",
                    target_section: "T",
                    target_tag_id: 1,
                },
            ],
            [
                "a set target with a tag",
                { target_kind: "set", target_tag_id: 1 },
            ],
            ["a phrase with no length", { kind: "phrase" }],
            ["a phrase of length 1", { kind: "phrase", length: 1 }],
            [
                "a phrase with a transition",
                { kind: "phrase", length: 4, transition_length: 2 },
            ],
            ["a state with a length", { length: 4 }],
            ["a transition of 0", { transition_length: 0 }],
            ["a fractional transition", { transition_length: 1.5 }],
            ["a value with no form", { value: "kneel" }],
            ["a builtin value naming a phrase asset", { phrase_asset_id: 1 }],
            [
                "a show value on a state",
                { value: "show:1", phrase_asset_id: 1 },
            ],
            [
                "a show value naming another asset",
                {
                    kind: "phrase",
                    length: 3,
                    value: "show:2",
                    phrase_asset_id: 1,
                },
            ],
            [
                "a show value with no asset",
                { kind: "phrase", length: 3, value: "show:1" },
            ],
            ["a library value on Body", { value: "library:a@b" }],
            [
                "a library value with no version",
                { channel: "uniform", value: "library:a" },
            ],
            [
                "a library value on a phrase",
                {
                    channel: "carry",
                    kind: "phrase",
                    length: 3,
                    value: "library:a@b",
                },
            ],
            ["none on Silk", { channel: "silk", value: "none" }],
            ["settings that aren't an object", { settings_json: "[]" }],
            ["settings that aren't JSON", { settings_json: "{" }],
            [
                "a ripple on Feet",
                {
                    channel: "feet",
                    value: "builtin:feet.step",
                    ripple_json: '{"version":1,"span":4,"order":"drill"}',
                },
            ],
            [
                "a ripple of another version",
                { ripple_json: '{"version":2,"span":4,"order":"drill"}' },
            ],
            [
                "a ripple of 0 counts",
                { ripple_json: '{"version":1,"span":0,"order":"drill"}' },
            ],
            [
                "a ripple with a fractional span",
                { ripple_json: '{"version":1,"span":1.5,"order":"drill"}' },
            ],
            [
                "a ripple in an unknown order",
                { ripple_json: '{"version":1,"span":4,"order":"spiral"}' },
            ],
            ["a missing beat", { beat_id: 99999 }],
            ["a missing tag", { target_kind: "tag", target_tag_id: 99 }],
        ])("rejects %s", (_, columns) => {
            expect(() => insert(columns)).toThrow();
        });

        it.each<[string, Record<string, string | number | null>]>([
            ["a band state", {}],
            [
                "a section state",
                { target_kind: "section", target_section: "Trumpet" },
            ],
            ["a tag state", { target_kind: "tag", target_tag_id: 1 }],
            ["a set state", { target_kind: "set" }],
            [
                "a builtin phrase",
                { kind: "phrase", length: 8, value: "builtin:body.dance" },
            ],
            [
                "a show phrase",
                {
                    kind: "phrase",
                    length: 3,
                    value: "show:1",
                    phrase_asset_id: 1,
                },
            ],
            ["a transition", { transition_length: 3 }],
            ["Carry none", { channel: "carry", value: "none" }],
            [
                "a Carry library item",
                { channel: "carry", value: "library:3b1a@ff00" },
            ],
            [
                "a Uniform library item",
                { channel: "uniform", value: "library:3b1a@ff00" },
            ],
            [
                "a ripple on Silk",
                {
                    channel: "silk",
                    value: "library:a@b",
                    ripple_json: '{"version":1,"span":8,"order":"down_form"}',
                },
            ],
            // States only on Facing, Carry, Silk and Uniform is compile's rule (a flag), not storage's
            [
                "a builtin phrase on Facing",
                {
                    channel: "facing",
                    kind: "phrase",
                    length: 2,
                    value: "builtin:facing.spin",
                },
            ],
        ])("accepts %s", (_, columns) => {
            expect(() => insert(columns)).not.toThrow();
        });

        it("cascades beat, tag, marcher and cue deletes, and restricts a phrase asset in use", () => {
            db.exec("DELETE FROM beats WHERE id = 3");
            expect(db.prepare("SELECT id FROM cues ORDER BY id").all()).toEqual(
                [{ id: 2 }, { id: 3 }],
            );
            expect(() =>
                db.exec("DELETE FROM phrase_assets WHERE id = 1"),
            ).toThrow();
            db.exec("DELETE FROM tags WHERE id = 1");
            expect(db.prepare("SELECT id FROM cues ORDER BY id").all()).toEqual(
                [{ id: 3 }],
            );
            db.exec("DELETE FROM phrase_assets WHERE id = 1");
            db.exec("DELETE FROM marchers WHERE id = 1");
            expect(
                db.prepare("SELECT marcher_id FROM cue_marchers").all(),
            ).toEqual([{ marcher_id: 2 }]);
            db.exec("DELETE FROM cues WHERE id = 3");
            expect(count(db, "cue_marchers")).toBe(0);
        });

        it("rejects a duplicate set member and an unknown dot mode; deleting a page deletes its dot mode", () => {
            expect(() =>
                db.exec(
                    "INSERT INTO cue_marchers (cue_id, marcher_id) VALUES (3, 1)",
                ),
            ).toThrow();
            expect(() =>
                db.exec(
                    "INSERT INTO page_performer_settings (page_id, dot_mode) VALUES (2, 'hip')",
                ),
            ).toThrow();
            db.exec("DELETE FROM pages WHERE id = 1");
            expect(count(db, "page_performer_settings")).toBe(0);
        });
    });
});
