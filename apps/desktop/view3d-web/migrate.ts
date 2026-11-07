/**
 * TEMPORARY (see host.ts). Brings a show held in memory by sql.js up to this
 * build's schema, as the app does when it opens a show. Only in memory; the
 * file is never written back.
 */
// cspell:ignore Millis (drizzle's `folderMillis`)
import type { DatabaseSync } from "node:sqlite";
import type { Database } from "sql.js";
import journal from "../electron/database/migrations/meta/_journal.json";
import { skipsExistingColumn } from "../electron/database/migrations/addColumnGuard";
import {
    needsLegacyForkRepair,
    repairLegacyForkFile,
    type FolderMigration,
} from "../electron/database/legacyFork/legacyForkRepair";

const migrationSql = import.meta.glob<string>(
    "../electron/database/migrations/*.sql",
    { query: "?raw", import: "default", eager: true },
);

const toHex = (bytes: ArrayBuffer) =>
    Array.from(new Uint8Array(bytes), (b) =>
        b.toString(16).padStart(2, "0"),
    ).join("");

let folderPromise: Promise<FolderMigration[]> | null = null;

/** The app's migrations, as Drizzle reads its folder (the hash is the SHA-256 of the SQL). */
const folderMigrations = () =>
    (folderPromise ??= Promise.all(
        journal.entries.map(async (entry) => {
            const sql =
                migrationSql[
                    `../electron/database/migrations/${entry.tag}.sql`
                ];
            if (sql === undefined)
                throw new Error(`Missing migration ${entry.tag}`);
            const digest = await crypto.subtle.digest(
                "SHA-256",
                new TextEncoder().encode(sql),
            );
            return {
                tag: entry.tag,
                folderMillis: entry.when,
                hash: toHex(digest),
                sql: sql.split("--> statement-breakpoint"),
            };
        }),
    ));

type Param = string | number | Uint8Array | null;
const bindable = (params: unknown[]) =>
    params.map((p) =>
        p === undefined ? null : typeof p === "bigint" ? Number(p) : p,
    ) as Param[];

/**
 * The part of node:sqlite's `DatabaseSync` the fork-file repair uses
 * (`prepare` with positional parameters, `exec`, `isTransaction`), over a
 * sql.js database, so the preview runs the app's own repair.
 */
export function sqlJsDatabaseSync(db: Database): DatabaseSync {
    const prepare = (source: string) => {
        const rows = (params: unknown[], limit: number) => {
            const statement = db.prepare(source);
            try {
                statement.bind(bindable(params));
                const out: Record<string, unknown>[] = [];
                while (out.length < limit && statement.step())
                    out.push(statement.getAsObject());
                return out;
            } finally {
                statement.free();
            }
        };
        return {
            all: (...params: unknown[]) => rows(params, Infinity),
            get: (...params: unknown[]) => rows(params, 1)[0],
            run: (...params: unknown[]) => {
                db.run(source, bindable(params));
                return {
                    changes: db.getRowsModified(),
                    lastInsertRowid: Number(
                        db.exec("SELECT last_insert_rowid()")[0]!.values[0]![0],
                    ),
                };
            },
        };
    };
    return {
        prepare,
        exec: (source: string) => {
            db.exec(source);
        },
        // sql.js doesn't expose sqlite3_get_autocommit; BEGIN fails only inside a transaction.
        get isTransaction() {
            try {
                db.exec("BEGIN");
            } catch {
                return true;
            }
            db.exec("ROLLBACK");
            return false;
        },
    } as unknown as DatabaseSync;
}

/**
 * Repairs a file a fork build saved, as the app does on open (ADR 0011), then
 * applies the app's migrations the file hasn't had (Drizzle compares each
 * journal entry's `when` with the newest `created_at`).
 */
export async function migrateShow(db: Database) {
    const migrations = await folderMigrations();
    const sync = sqlJsDatabaseSync(db);
    if (needsLegacyForkRepair(sync, migrations))
        repairLegacyForkFile(sync, migrations);

    const result = db.exec("SELECT MAX(created_at) FROM __drizzle_migrations");
    const last = Number(result[0]?.values[0]?.[0] ?? 0);
    const columnsOf = (table: string) =>
        (
            db.exec(`SELECT name FROM pragma_table_info('${table}')`)[0]
                ?.values ?? []
        ).map((row) => String(row[0]));
    for (const migration of migrations) {
        if (migration.folderMillis <= last) continue;
        for (const statement of migration.sql) {
            if (statement.trim() && !skipsExistingColumn(statement, columnsOf))
                db.run(statement);
        }
        db.run(
            "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
            [migration.hash, migration.folderMillis],
        );
    }
}
