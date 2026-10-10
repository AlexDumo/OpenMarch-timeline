import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";
import { getOrm } from "../../db";
import { DrizzleMigrationService } from "../../services/DrizzleMigrationService";
import { applyFileVersionDecision, readUserVersion } from "../../fileVersion";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, "..");

type Journal = { entries: { idx: number; tag: string }[] };
const journal: Journal = JSON.parse(
    fs.readFileSync(path.join(migrationsDir, "meta/_journal.json"), "utf-8"),
);
const migrationTags = journal.entries
    .sort((a, b) => a.idx - b.idx)
    .map((e) => e.tag);

const RECIPE_MIGRATION = migrationTags[19]!;

/** Runs one migration file the way `DrizzleMigrationService` does, foreign keys off. */
const runMigration = (db: DatabaseSync, tag: string) => {
    const statements = fs
        .readFileSync(path.join(migrationsDir, `${tag}.sql`), "utf-8")
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    for (const statement of statements) {
        db.exec("PRAGMA foreign_keys = OFF");
        db.exec(statement);
    }
    db.exec("PRAGMA foreign_keys = ON");
};

type Row = Record<string, unknown>;

/** A small timeline: one marcher, its own move over beats [1, 9), at (10, 20). */
const TIMELINE_ROWS = `
    INSERT INTO beats (id, duration, position) VALUES (1, 0.5, 1), (2, 0.5, 2);
    INSERT INTO marchers (id, name, section, drill_prefix, drill_order) VALUES (1, 'A', 'Brass', 'B', 1);
    INSERT INTO timelines (id, start_beat, end_beat) VALUES (1, 1, 9);
    INSERT INTO timeline_transitions (id, timeline_id, slot_count, start_beat, end_beat) VALUES (1, 1, 1, 1, 9);
    INSERT INTO timeline_slot_destinations (id, transition_id, slot_index, x, y) VALUES (1, 1, 0, 10, 20);
    INSERT INTO timeline_assignments (id, marcher_id, transition_id, slot_index, start_beat, end_beat) VALUES (5, 1, 1, 0, 1, 9);
`;

/**
 * Migration 0019 adds the Shape tool's recipe tables (ADR 0004): a recipe per placed shape, deleted
 * with its move, and its members, deleted with the recipe or the marcher. It only adds tables, so
 * older files open and keep their rows.
 */
describe(`Migration ${RECIPE_MIGRATION}`, () => {
    let db: DatabaseSync;
    let tempDir: string;
    const all = (statement: string) => db.prepare(statement).all() as Row[];
    const schemaOf = () =>
        all(
            "SELECT type, name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name",
        );

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "om-0019-"));
        db = new DatabaseSync(path.join(tempDir, "pre-0019.dots"));
        for (const tag of migrationTags.slice(0, 19)) runMigration(db, tag);
        db.exec(TIMELINE_ROWS);
    });

    afterEach(() => {
        db?.close();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("adds only the recipe tables, and keeps every existing row", () => {
        const before = schemaOf();
        const rows = () => all("SELECT * FROM timeline_assignments");
        const assignments = rows();
        runMigration(db, RECIPE_MIGRATION);
        const after = schemaOf();

        const afterByName = new Map(after.map((r) => [r.name, r.sql]));
        expect(before.filter((r) => afterByName.get(r.name) !== r.sql)).toEqual(
            [],
        );
        const beforeNames = new Set(before.map((r) => r.name));
        expect(
            after
                .filter((r) => !beforeNames.has(r.name) && r.type === "table")
                .map((r) => r.name),
        ).toEqual(["timeline_shape_recipe_marchers", "timeline_shape_recipes"]);
        expect(rows()).toEqual(assignments);
        expect(all("PRAGMA foreign_key_check")).toEqual([]);
    });

    it("deletes recipes with their move and members with their recipe or marcher", () => {
        runMigration(db, RECIPE_MIGRATION);
        db.exec(`
            INSERT INTO marchers (id, name, section, drill_prefix, drill_order) VALUES (2, 'B', 'Brass', 'B', 2);
            INSERT INTO timelines (id, start_beat, end_beat) VALUES (2, 9, 17);
            INSERT INTO timeline_shape_recipes (id, timeline_id, kind, kind_version, params, order_mode)
                VALUES (1, 2, 'arc', 1, '{"bulge":4}', 'keep'), (2, NULL, 'line', 1, '{}', 'nearest');
            INSERT INTO timeline_shape_recipe_marchers (recipe_id, marcher_id, slot, x, y)
                VALUES (1, 1, 0, 10, 20), (1, 2, 1, 12, 20), (2, 1, 0, 0, 0);
        `);
        // Params must be JSON, and a member belongs to a recipe once
        expect(() =>
            db.exec(
                "INSERT INTO timeline_shape_recipes (kind, kind_version, params, order_mode) VALUES ('arc', 1, 'nope', 'keep')",
            ),
        ).toThrow(/constraint failed/);
        expect(() =>
            db.exec(
                "INSERT INTO timeline_shape_recipe_marchers (recipe_id, marcher_id, slot, x, y) VALUES (1, 1, 3, 0, 0)",
            ),
        ).toThrow(/constraint failed/);

        db.exec("DELETE FROM marchers WHERE id = 2");
        expect(
            all(
                "SELECT recipe_id, marcher_id FROM timeline_shape_recipe_marchers ORDER BY id",
            ),
        ).toEqual([
            { recipe_id: 1, marcher_id: 1 },
            { recipe_id: 2, marcher_id: 1 },
        ]);
        db.exec("DELETE FROM timelines WHERE id = 2");
        expect(all("SELECT id FROM timeline_shape_recipes")).toEqual([
            { id: 2 },
        ]);
        expect(
            all("SELECT recipe_id FROM timeline_shape_recipe_marchers"),
        ).toEqual([{ recipe_id: 2 }]);
    });
});

/**
 * A version-8 file from an earlier development build (migrated through 0018) opens: the app's
 * migrator applies 0019 and leaves the version and the timeline rows alone.
 */
describe("opening a version-8 file from before the recipe tables", () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "om-0019-open-"));
    });
    afterEach(() => fs.rmSync(tempDir, { recursive: true, force: true }));

    /** The migrations folder as a build without 0019 shipped it. */
    const olderMigrationsFolder = () => {
        const folder = path.join(tempDir, "migrations-0018");
        fs.mkdirSync(path.join(folder, "meta"), { recursive: true });
        const kept = journal.entries.filter((e) => e.idx < 19);
        for (const { tag } of kept)
            fs.copyFileSync(
                path.join(migrationsDir, `${tag}.sql`),
                path.join(folder, `${tag}.sql`),
            );
        fs.writeFileSync(
            path.join(folder, "meta/_journal.json"),
            JSON.stringify({ ...journal, entries: kept }),
        );
        return folder;
    };

    const migrate = async (filePath: string, folder: string) => {
        const db = new DatabaseSync(filePath);
        try {
            const orm = getOrm(db);
            const migrator = new DrizzleMigrationService(orm, db);
            applyFileVersionDecision(db, false);
            await migrator.applyPendingMigrations(folder);
        } finally {
            db.close();
        }
    };

    it("applies 0019 and keeps the version and the rows", async () => {
        const filePath = path.join(tempDir, "older-v8.dots");
        const db = new DatabaseSync(filePath);
        applyFileVersionDecision(db, true);
        const orm = getOrm(db);
        await new DrizzleMigrationService(orm, db).applyPendingMigrations(
            olderMigrationsFolder(),
        );
        await DrizzleMigrationService.initializeDatabase(orm, db);
        db.exec(TIMELINE_ROWS);
        db.prepare("PRAGMA user_version = 8").run();
        const hasRecipes = () =>
            db
                .prepare(
                    "SELECT count(*) AS n FROM sqlite_schema WHERE name = 'timeline_shape_recipes'",
                )
                .get() as { n: number };
        expect(hasRecipes().n).toBe(0);
        const assignments = db
            .prepare("SELECT * FROM timeline_assignments")
            .all();
        db.close();

        await migrate(filePath, migrationsDir);

        const after = new DatabaseSync(filePath);
        try {
            expect(readUserVersion(after)).toBe(8);
            expect(
                after
                    .prepare(
                        "SELECT count(*) AS n FROM sqlite_schema WHERE name = 'timeline_shape_recipes'",
                    )
                    .get(),
            ).toEqual({ n: 1 });
            expect(
                after.prepare("SELECT * FROM timeline_assignments").all(),
            ).toEqual(assignments);
            expect(
                after
                    .prepare("SELECT count(*) AS n FROM __drizzle_migrations")
                    .get(),
            ).toEqual({ n: migrationTags.length });
        } finally {
            after.close();
        }
    });
});
