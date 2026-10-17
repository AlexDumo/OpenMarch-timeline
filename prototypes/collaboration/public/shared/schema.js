// The prototype's show schema, run unchanged by the browser mirror (sql.js) and the Durable
// Object (ctx.storage.sql). It is a small stand-in for the real timeline tables: a "move" is one
// marcher going to (x, y) over a beat range, the way a one-slot shapeless transition and its
// assignment do in apps/desktop. Who wins between overlapping moves is derived (model.js), never
// stored, which is the ADR 0001 2026-10-16 rule.
//
// The CHECKs and UNIQUEs are the point: the server enforces them just by running the same DDL.

export const SHOW_DDL = [
    `CREATE TABLE IF NOT EXISTS marchers (
        id INTEGER PRIMARY KEY,
        name TEXT,
        section TEXT NOT NULL,
        drill_prefix TEXT NOT NULL,
        drill_order INTEGER NOT NULL,
        home_x REAL NOT NULL DEFAULT 0,
        home_y REAL NOT NULL DEFAULT 0,
        UNIQUE (drill_prefix, drill_order)
    )`,
    // A page flag: the beat a page ends on. The flag at beat 0 is the show's start.
    `CREATE TABLE IF NOT EXISTS pages (
        id INTEGER PRIMARY KEY,
        beat INTEGER NOT NULL UNIQUE CHECK (beat >= 0)
    )`,
    `CREATE TABLE IF NOT EXISTS moves (
        id INTEGER PRIMARY KEY,
        marcher_id INTEGER NOT NULL REFERENCES marchers(id) ON DELETE CASCADE,
        start_beat INTEGER NOT NULL CHECK (start_beat >= 0),
        end_beat INTEGER NOT NULL,
        x REAL NOT NULL CHECK (abs(x) <= 1e6),
        y REAL NOT NULL CHECK (abs(y) <= 1e6),
        CHECK (end_beat > start_beat),
        -- L-4: two moves of one marcher over exactly the same counts are refused
        UNIQUE (marcher_id, start_beat, end_beat)
    )`,
    // Show-wide values: name, total_beats, grid_version (bumped by every structural edit)
    `CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT
    )`,
];

/** Tables and columns that sync. Anything else is refused by the server. */
export const SYNCED = {
    marchers: [
        "id",
        "name",
        "section",
        "drill_prefix",
        "drill_order",
        "home_x",
        "home_y",
    ],
    pages: ["id", "beat"],
    moves: ["id", "marcher_id", "start_beat", "end_beat", "x", "y"],
    meta: ["key", "value"],
};

/** Each table's key column. */
export const KEY = { marchers: "id", pages: "id", moves: "id", meta: "key" };

/** Parent tables first, so inserts in this order satisfy foreign keys. */
export const TABLE_ORDER = ["meta", "marchers", "pages", "moves"];

/**
 * Change-capture triggers: the generalized `timeline_change_log` the report proposes. Each one
 * writes a JSON before/after image of the row, but only while `sync_state.recording` is 1, so
 * applying a remote change records nothing.
 */
export function captureDdl() {
    const out = [
        `CREATE TABLE IF NOT EXISTS sync_change_log (
            seq INTEGER PRIMARY KEY,
            tbl TEXT NOT NULL,
            row_key TEXT NOT NULL,
            before TEXT,
            after TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS sync_state (id INTEGER PRIMARY KEY CHECK (id = 1), recording INTEGER NOT NULL)`,
        `INSERT OR IGNORE INTO sync_state (id, recording) VALUES (1, 1)`,
    ];
    for (const [table, cols] of Object.entries(SYNCED)) {
        const image = (row) =>
            `json_object(${cols.map((c) => `'${c}', ${row}.${c}`).join(", ")})`;
        const key = KEY[table];
        const when = `WHEN (SELECT recording FROM sync_state) = 1`;
        out.push(
            `CREATE TRIGGER IF NOT EXISTS ${table}_sync_ins AFTER INSERT ON ${table} ${when} BEGIN
                INSERT INTO sync_change_log (tbl, row_key, before, after) VALUES ('${table}', NEW.${key}, NULL, ${image("NEW")});
            END`,
            `CREATE TRIGGER IF NOT EXISTS ${table}_sync_upd AFTER UPDATE ON ${table} ${when} BEGIN
                INSERT INTO sync_change_log (tbl, row_key, before, after) VALUES ('${table}', NEW.${key}, ${image("OLD")}, ${image("NEW")});
            END`,
            `CREATE TRIGGER IF NOT EXISTS ${table}_sync_del AFTER DELETE ON ${table} ${when} BEGIN
                INSERT INTO sync_change_log (tbl, row_key, before, after) VALUES ('${table}', OLD.${key}, ${image("OLD")}, NULL);
            END`,
        );
    }
    return out;
}

/**
 * Coalesces raw change-log rows into row changes: the first `before` and the last `after` of
 * each row, in the order rows were first touched.
 *
 * @param {{tbl: string, row_key: string, before: string | null, after: string | null}[]} logRows
 * @returns {import("./protocol.js").RowChange[]}
 */
export function coalesceLog(logRows) {
    const byRow = new Map();
    for (const r of logRows) {
        const k = `${r.tbl}:${r.row_key}`;
        const before = r.before === null ? null : JSON.parse(r.before);
        const after = r.after === null ? null : JSON.parse(r.after);
        const seen = byRow.get(k);
        if (seen) seen.after = after;
        else byRow.set(k, { table: r.tbl, before, after });
    }
    const changes = [];
    for (const { table, before, after } of byRow.values()) {
        const key = before ? before[KEY[table]] : after[KEY[table]];
        if (!before && !after) continue;
        if (!before) changes.push({ kind: "insert", table, key, row: after });
        else if (!after) changes.push({ kind: "delete", table, key, prev: before });
        else {
            const set = {};
            const prev = {};
            for (const col of SYNCED[table]) {
                if (before[col] !== after[col]) {
                    set[col] = after[col];
                    prev[col] = before[col];
                }
            }
            if (Object.keys(set).length > 0)
                changes.push({ kind: "update", table, key, set, prev });
        }
    }
    return changes;
}

/** A column is structural when changing it moves the beat grid every move is measured on. */
export function isStructural(change) {
    if (change.table === "pages") return true;
    if (change.table === "meta") {
        const key = change.key;
        return key === "total_beats" || key === "grid_version";
    }
    return false;
}

/** A change that depends on the beat grid: anything that writes a beat. */
export function touchesBeats(change) {
    if (change.table === "pages") return true;
    if (change.table !== "moves") return false;
    if (change.kind !== "update") return true;
    return "start_beat" in change.set || "end_beat" in change.set;
}
