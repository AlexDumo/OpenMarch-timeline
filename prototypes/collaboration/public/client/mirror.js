// The client's local SQLite (sql.js), standing in for the app's show file during a session.
// Commands write plain SQL in a transaction, the way db-functions do inside
// transactionWithHistory; capture triggers turn that transaction into an op. Remote changes are
// applied with recording off, the way an undo replays, and then the UI refreshes from the list of
// tables that changed.
import {
    SHOW_DDL,
    SYNCED,
    KEY,
    TABLE_ORDER,
    captureDdl,
    coalesceLog,
} from "../shared/schema.js";
import { ID_BLOCK } from "../shared/protocol.js";

export class Mirror {
    /** @param {any} SQL sql.js module */
    constructor(SQL) {
        this.SQL = SQL;
        this.db = null;
        this.listeners = new Set();
        this.idBase = 0;
    }

    load(snapshot) {
        this.db?.close();
        this.db = new this.SQL.Database();
        this.db.run("PRAGMA foreign_keys = ON");
        for (const ddl of [...SHOW_DDL, ...captureDdl()]) this.db.run(ddl);
        this.setRecording(false);
        this.db.run("BEGIN");
        for (const table of TABLE_ORDER) {
            for (const row of snapshot[table] ?? []) this.insertRow(table, row);
        }
        this.db.run("COMMIT");
        this.setRecording(true);
        this.emit(new Set(TABLE_ORDER), "load");
    }

    setRecording(on) {
        this.db.run("UPDATE sync_state SET recording = ?", [on ? 1 : 0]);
    }

    all(sql, params = []) {
        const stmt = this.db.prepare(sql);
        stmt.bind(params);
        const rows = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        stmt.free();
        return rows;
    }

    run(sql, params = []) {
        this.db.run(sql, params);
    }

    meta(key) {
        return this.all("SELECT value FROM meta WHERE key = ?", [key])[0]?.value;
    }

    /** A fresh id from this member's block (solo files have block 0, so this is max + 1). */
    nextId(table) {
        const key = KEY[table];
        const hi = this.idBase + ID_BLOCK;
        const max = this.all(
            `SELECT max(${key}) AS m FROM ${table} WHERE ${key} >= ? AND ${key} < ?`,
            [this.idBase, hi],
        )[0]?.m;
        return max === null || max === undefined ? this.idBase + 1 : max + 1;
    }

    snapshot() {
        const out = {};
        for (const table of TABLE_ORDER)
            out[table] = this.all(`SELECT ${SYNCED[table].join(", ")} FROM ${table}`);
        return out;
    }

    /**
     * Runs a command in one local transaction and returns what it changed, as row changes.
     * A command that throws rolls back and changes nothing.
     */
    transact(fn) {
        this.db.run("BEGIN");
        let changes;
        try {
            this.db.run("DELETE FROM sync_change_log");
            fn(this);
            changes = coalesceLog(
                this.all("SELECT tbl, row_key, before, after FROM sync_change_log ORDER BY seq"),
            );
            this.db.run("DELETE FROM sync_change_log");
            this.db.run("COMMIT");
        } catch (err) {
            this.db.run("ROLLBACK");
            throw err;
        }
        if (changes.length > 0)
            this.emit(new Set(changes.map((c) => c.table)), "local");
        return changes;
    }

    insertRow(table, row) {
        const cols = SYNCED[table].filter((c) => c in row);
        this.db.run(
            `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
            cols.map((c) => row[c]),
        );
    }

    /**
     * Applies changes that came from the server (or an inverse), recording nothing.
     *
     * @param {import("../shared/protocol.js").RowChange[]} changes
     * @param {(table: string, key: any, col: string) => boolean} skip fields with a pending local write
     */
    applyChanges(changes, skip = () => false, source = "remote") {
        if (changes.length === 0) return;
        this.setRecording(false);
        this.db.run("BEGIN");
        try {
            this.db.run("PRAGMA defer_foreign_keys = ON");
            for (const ch of changes) {
                const key = KEY[ch.table];
                const exists =
                    this.all(`SELECT 1 FROM ${ch.table} WHERE ${key} = ?`, [ch.key]).length > 0;
                if (ch.kind === "insert") {
                    if (exists) {
                        const cols = Object.keys(ch.row).filter(
                            (c) => c !== key && !skip(ch.table, ch.key, c),
                        );
                        if (cols.length)
                            this.db.run(
                                `UPDATE ${ch.table} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE ${key} = ?`,
                                [...cols.map((c) => ch.row[c]), ch.key],
                            );
                    } else if (!skip(ch.table, ch.key, key)) this.insertRow(ch.table, ch.row);
                } else if (ch.kind === "update") {
                    if (!exists) continue;
                    const cols = Object.keys(ch.set).filter((c) => !skip(ch.table, ch.key, c));
                    if (cols.length)
                        this.db.run(
                            `UPDATE ${ch.table} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE ${key} = ?`,
                            [...cols.map((c) => ch.set[c]), ch.key],
                        );
                } else if (ch.kind === "delete") {
                    if (exists) this.db.run(`DELETE FROM ${ch.table} WHERE ${key} = ?`, [ch.key]);
                }
            }
            this.db.run("COMMIT");
        } catch (err) {
            this.db.run("ROLLBACK");
            throw err;
        } finally {
            this.setRecording(true);
        }
        this.emit(new Set(changes.map((c) => c.table)), source);
    }

    onChange(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    emit(tables, source) {
        for (const l of this.listeners) l(tables, source);
    }
}

/** The inverse of a list of changes, in reverse order. */
export function invertChanges(changes) {
    return [...changes].reverse().map((ch) => {
        if (ch.kind === "insert")
            return { kind: "delete", table: ch.table, key: ch.key, prev: ch.row };
        if (ch.kind === "delete")
            return { kind: "insert", table: ch.table, key: ch.key, row: ch.prev };
        return { kind: "update", table: ch.table, key: ch.key, set: ch.prev, prev: ch.set };
    });
}

/** The fields a change writes, as "table:key:col" strings. */
export function fieldsOf(ch) {
    const cols =
        ch.kind === "update" ? Object.keys(ch.set) : SYNCED[ch.table];
    return cols.map((c) => `${ch.table}:${ch.key}:${c}`);
}
