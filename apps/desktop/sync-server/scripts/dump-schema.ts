/* eslint-disable no-console */
/**
 * Writes the sync server's schema from the app's own blank file (CONTRACT.md, "Server rules").
 *
 * It opens a copy of `electron/database/migrations/_blank.dots`, runs the app's migration
 * service on it (the same path as opening a file: pending migrations, then every invariant
 * trigger and view rebuilt by `createAllTriggers`), and dumps `sqlite_master`, minus the
 * history triggers, the timeline change-log triggers, the bookkeeping tables and the tables
 * out of the spike's scope.
 *
 * Run from `apps/desktop`: `pnpm exec tsx sync-server/scripts/dump-schema.ts`
 * Outputs `sync-server/generated/schema.sql` and `sync-server/generated/tables.json`.
 */
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getTableName, type Table } from "drizzle-orm";
import * as schema from "../../electron/database/migrations/schema";
import { getOrm } from "../../electron/database/db";
import { DrizzleMigrationService } from "../../electron/database/services/DrizzleMigrationService";

const DESKTOP = path.resolve(__dirname, "../..");
const HISTORY_TRIGGERS = path.join(
    DESKTOP,
    "src/db-functions/historyTriggers.ts",
);
const BLANK = path.join(DESKTOP, "electron/database/migrations/_blank.dots");
const MIGRATIONS = path.join(DESKTOP, "electron/database/migrations");
const OUT = path.join(DESKTOP, "sync-server/generated");

/** Bookkeeping: undo/redo, the timeline change log, drizzle's journal. */
const BOOKKEEPING = [
    "history_undo",
    "history_redo",
    "history_stats",
    "timeline_change_log",
    "__drizzle_migrations",
];
/** Out of the spike's scope (CONTRACT.md, "Scope"). */
const OUT_OF_SCOPE = [
    "workspace_settings",
    "view3d_cameras",
    "audio_files",
    "library_blobs",
    "library_items",
];
const EXCLUDED_TABLES = new Set([...BOOKKEEPING, ...OUT_OF_SCOPE]);

type MasterRow = { type: string; name: string; tbl_name: string; sql: string };

/** Why a schema object is left out, or null to keep it. */
function exclusion(row: MasterRow): string | null {
    if (row.name.startsWith("sqlite_")) return "internal";
    if (EXCLUDED_TABLES.has(row.tbl_name)) return `on ${row.tbl_name}`;
    if (row.type === "trigger") {
        if (/_(it|ut|dt)$/.test(row.name)) return "history trigger";
        if (/timeline_change_log/i.test(row.sql)) return "change-log trigger";
        if (/history_(undo|redo|stats)/i.test(row.sql)) return "writes history";
    }
    return null;
}

/**
 * The tables of `tablesWithHistory`, read from its source: importing the module pulls in the
 * renderer's constants, which need Vite's environment.
 */
function tablesWithHistory(): string[] {
    const source = fs.readFileSync(HISTORY_TRIGGERS, "utf8");
    const list = source.match(
        /export const tablesWithHistory = \[([\s\S]*?)\];/,
    )?.[1];
    if (!list) throw new Error("tablesWithHistory not found");
    const names = [...list.replace(/\/\/.*$/gm, "").matchAll(/schema\.(\w+)/g)];
    return names
        .map(([, key]) => {
            const table = (schema as Record<string, unknown>)[key!];
            if (!table) throw new Error(`schema.${key} not found`);
            return getTableName(table as Table);
        })
        .sort();
}

async function migratedCopy(): Promise<{ db: DatabaseSync; file: string }> {
    const file = path.join(
        fs.mkdtempSync(path.join(os.tmpdir(), "om-sync-schema-")),
        "blank.dots",
    );
    fs.copyFileSync(BLANK, file);
    const db = new DatabaseSync(file);
    const before = db
        .prepare("SELECT count(*) AS c FROM __drizzle_migrations")
        .get() as { c: number };
    await new DrizzleMigrationService(getOrm(db), db).applyPendingMigrations(
        MIGRATIONS,
    );
    const after = db
        .prepare("SELECT count(*) AS c FROM __drizzle_migrations")
        .get() as { c: number };
    console.log(
        after.c === before.c
            ? `_blank.dots is current (${after.c} migrations)`
            : `_blank.dots was behind: applied ${after.c - before.c} migrations to the copy (regenerate it with pnpm run migrate)`,
    );
    return { db, file };
}

/** Synced tables in an order where every FK parent comes before its children. */
function parentFirst(db: DatabaseSync, tables: string[]): string[] {
    const set = new Set(tables);
    const parents = new Map(
        tables.map((t) => [
            t,
            (
                db.prepare(`PRAGMA foreign_key_list("${t}")`).all() as {
                    table: string;
                }[]
            )
                .map((f) => f.table)
                .filter((p) => p !== t && set.has(p)),
        ]),
    );
    const out: string[] = [];
    const visit = (t: string, stack: string[]) => {
        if (out.includes(t)) return;
        if (stack.includes(t))
            throw new Error(`FK cycle: ${[...stack, t].join(" -> ")}`);
        for (const p of parents.get(t) ?? []) visit(p, [...stack, t]);
        out.push(t);
    };
    for (const t of [...tables].sort()) visit(t, []);
    return out;
}

async function main() {
    const { db } = await migratedCopy();
    const master = db
        .prepare(
            "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL",
        )
        .all() as MasterRow[];

    const kept: MasterRow[] = [];
    const dropped: string[] = [];
    for (const row of master) {
        const why = exclusion(row);
        if (why) dropped.push(`${row.type} ${row.name} (${why})`);
        else kept.push(row);
    }

    const tables = kept.filter((r) => r.type === "table").map((r) => r.name);
    const order = parentFirst(db, tables);

    // Every kept table, trigger and view must only reference kept tables
    for (const t of order) {
        for (const fk of db
            .prepare(`PRAGMA foreign_key_list("${t}")`)
            .all() as { table: string }[])
            if (!order.includes(fk.table))
                throw new Error(
                    `${t} has a foreign key to excluded ${fk.table}`,
                );
    }
    for (const r of kept.filter(
        (k) => k.type === "trigger" || k.type === "view",
    ))
        for (const ex of EXCLUDED_TABLES)
            if (new RegExp(`\\b${ex}\\b`).test(r.sql))
                throw new Error(`${r.type} ${r.name} references ${ex}`);

    // The synced tables are the history tables (CONTRACT.md, "Scope")
    const history = tablesWithHistory();
    const missing = history.filter((t) => !order.includes(t));
    const extra = order.filter((t) => !history.includes(t));
    if (missing.length || extra.length)
        throw new Error(
            `synced tables differ from tablesWithHistory: missing ${missing.join(", ") || "-"}, extra ${extra.join(", ") || "-"}`,
        );

    const tableInfo: Record<
        string,
        {
            key: string;
            rowidAlias: boolean;
            columns: string[];
            blobColumns: string[];
        }
    > = {};
    for (const t of order) {
        const cols = db.prepare(`PRAGMA table_info("${t}")`).all() as {
            name: string;
            type: string;
            pk: number;
        }[];
        const pk = cols.filter((c) => c.pk > 0);
        const rowidAlias =
            pk.length === 1 && pk[0]!.type.toUpperCase() === "INTEGER";
        if (!rowidAlias)
            throw new Error(`${t}: key is not a rowid alias (CONTRACT.md IDs)`);
        tableInfo[t] = {
            key: pk[0]!.name,
            rowidAlias,
            columns: cols.map((c) => c.name),
            blobColumns: cols
                .filter((c) => /BLOB/i.test(c.type))
                .map((c) => c.name),
        };
    }

    const rank = { table: 0, index: 1, view: 2, trigger: 3 } as const;
    const tableRank = (name: string) => order.indexOf(name);
    kept.sort(
        (a, b) =>
            rank[a.type as keyof typeof rank] -
                rank[b.type as keyof typeof rank] ||
            tableRank(a.tbl_name) - tableRank(b.tbl_name) ||
            a.name.localeCompare(b.name),
    );

    const header = [
        "-- Generated by sync-server/scripts/dump-schema.ts from electron/database/migrations/_blank.dots.",
        "-- Do not edit. Regenerate: cd apps/desktop && pnpm exec tsx sync-server/scripts/dump-schema.ts",
        "-- Statements are separated by lines holding only `-- statement`.",
        "",
    ].join("\n");
    const body = kept.map((r) => `-- statement\n${r.sql.trim()};\n`).join("\n");
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, "schema.sql"), `${header}\n${body}`);
    fs.writeFileSync(
        path.join(OUT, "tables.json"),
        JSON.stringify(
            {
                generatedBy: "sync-server/scripts/dump-schema.ts",
                order,
                tables: tableInfo,
                excluded: dropped.sort(),
            },
            null,
            4,
        ) + "\n",
    );
    // keep the committed file identical to what the pre-commit hook would format
    try {
        execFileSync(
            path.join(DESKTOP, "../../node_modules/.bin/prettier"),
            ["--write", path.join(OUT, "tables.json")],
            { stdio: "ignore" },
        );
    } catch {
        console.warn("prettier not found; tables.json left unformatted");
    }

    const count = (type: string) => kept.filter((r) => r.type === type).length;
    console.log(
        `wrote ${count("table")} tables, ${count("index")} indexes, ${count("view")} views, ${count("trigger")} triggers; excluded ${dropped.length} objects`,
    );
    db.close();
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
