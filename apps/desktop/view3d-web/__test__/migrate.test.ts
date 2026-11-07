// @vitest-environment node
/**
 * The web preview opens shows with sql.js and migrates them itself
 * (`../migrate.ts`). A show a fork build saved has the fork's migration
 * dates, so it needs the fork-file repair (ADR 0011) first, as the app gives
 * it on open: without it the collapsed `0017_timeline_model` runs again on
 * top of its tables (#754).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { DatabaseSync as NodeDatabaseSync } from "node:sqlite";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import journal from "../../electron/database/migrations/meta/_journal.json";
import { migrateShow } from "../migrate";
import {
    COLLAPSED_MIGRATION_HASH,
    COLLAPSED_MIGRATION_TAG,
} from "@om-electron/database/legacyFork/legacyForkRepair";
import {
    createForkTimelineFile,
    migrateFile,
    normalizedSchema,
} from "@om-electron/database/legacyFork/__test__/forkFileFixtures";

const DEMO = path.resolve(__dirname, "../public/demos/part1-demo.dots");
const latest = journal.entries[journal.entries.length - 1]!;

let SQL: SqlJsStatic;
beforeAll(async () => {
    SQL = await initSqlJs();
});

const newestMigration = (db: Database) =>
    Number(
        db.exec("SELECT MAX(created_at) FROM __drizzle_migrations")[0]!
            .values[0]![0],
    );

const schemaOf = (db: Database) =>
    (
        db.exec(
            "SELECT type, name, sql FROM sqlite_master WHERE type IN ('table', 'index') AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type, name",
        )[0]?.values ?? []
    ).map(
        ([type, name, sql]) =>
            `${type} ${name}: ${String(sql).replace(/\s+/g, " ")}`,
    );

describe("migrateShow", () => {
    it("opens the bundled demo, which a fork build saved", async () => {
        const db = new SQL.Database(fs.readFileSync(DEMO));
        try {
            await migrateShow(db);
            expect(newestMigration(db)).toBe(latest.when);
            // Recorded as the app records it: the SHA-256 of its SQL
            const collapsed = journal.entries.find(
                (e) => e.tag === COLLAPSED_MIGRATION_TAG,
            )!;
            expect(
                db.exec(
                    "SELECT hash FROM __drizzle_migrations WHERE created_at = ?",
                    [collapsed.when],
                )[0]!.values,
            ).toEqual([[COLLAPSED_MIGRATION_HASH]]);
            const marchers = db.exec("SELECT count(*) FROM marchers")[0]!;
            expect(Number(marchers.values[0]![0])).toBeGreaterThan(0);
        } finally {
            db.close();
        }
    });

    it.each([20, 26, 32])(
        "brings a fork file after migration %i to the schema the app gives it",
        async (level) => {
            const dir = fs.mkdtempSync(
                path.join(os.tmpdir(), "om-view3d-web-"),
            );
            const file = path.join(dir, "fork.dots");
            createForkTimelineFile(file, level);
            const db = new SQL.Database(fs.readFileSync(file));
            try {
                await migrateShow(db);
                expect(newestMigration(db)).toBe(latest.when);
                await migrateFile(file);
                const desktop = new NodeDatabaseSync(file);
                try {
                    expect(schemaOf(db)).toEqual(normalizedSchema(desktop));
                } finally {
                    desktop.close();
                }
            } finally {
                db.close();
                fs.rmSync(dir, { recursive: true, force: true });
            }
        },
    );
});
