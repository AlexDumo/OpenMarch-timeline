// The app's schema as the server runs it, and the rules that read it: which tables and columns
// sync (the allowlist), and which changes are structural or write beat ranges (the grid rule).
// Both generated files come from scripts/dump-schema.ts.
import SCHEMA_SQL from "../generated/schema.sql";
import TABLES from "../generated/tables.json";

/** The app's DDL, one statement each (the dump separates them with `-- statement` lines). */
export const APP_DDL = SCHEMA_SQL.split(/^-- statement$/m)
    .slice(1)
    .map((s) => s.trim())
    .filter(Boolean);

/** Synced tables, every FK parent before its children (snapshot inserts run in this order). */
export const TABLE_ORDER = TABLES.order;

/** table -> { key, columns, writable } */
export const SYNCED = Object.fromEntries(
    TABLE_ORDER.map((t) => {
        const info = TABLES.tables[t];
        return [
            t,
            {
                key: info.key,
                columns: info.columns,
                blobColumns: info.blobColumns,
                // blobs are out of the spike's scope (CONTRACT.md, "Op")
                writable: new Set(
                    info.columns.filter((c) => !info.blobColumns.includes(c)),
                ),
            },
        ];
    }),
);

/** The columns a change writes. */
export function writtenColumns(ch) {
    if (ch.kind === "insert") return Object.keys(ch.row);
    if (ch.kind === "update") return Object.keys(ch.set);
    return [];
}

/**
 * Structural: any change to `beats` or `pages` (insert, delete, or update of `position` or
 * `start_beat`), or to `measures` (CONTRACT.md, "Grid version").
 */
export function isStructural(ch) {
    if (ch.table === "measures") return true;
    if (ch.table !== "beats" && ch.table !== "pages") return false;
    if (ch.kind !== "update") return true;
    return "position" in ch.set || "start_beat" in ch.set;
}

const RANGED = new Set([
    "timelines",
    "timeline_transitions",
    "timeline_assignments",
]);

/** Writes `start_beat`/`end_beat` of a timeline, transition or assignment (inserts and deletes too). */
export function writesBeatRange(ch) {
    if (!RANGED.has(ch.table)) return false;
    if (ch.kind !== "update") return true;
    return "start_beat" in ch.set || "end_beat" in ch.set;
}
