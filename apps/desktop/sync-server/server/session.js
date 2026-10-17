/* global WebSocketPair */
// One Durable Object per show: the authoritative session (docs/collaboration/spike/CONTRACT.md).
// It runs the app's real schema in its own SQLite, orders ops, validates them (allowlist, grid
// version, the schema's constraints and triggers, the timeline commit check), applies them with
// field-level last-writer-wins, keeps an op log for catch-up and broadcasts what it applied.
// Ported from prototypes/collaboration/server/session.js.
import { DurableObject } from "cloudflare:workers";
import {
    APP_DDL,
    SYNCED,
    TABLE_ORDER,
    isStructural,
    writesBeatRange,
    writtenColumns,
} from "./schema.js";

/** Each member's insert ids come from [idBase, idBase + ID_BLOCK) (CONTRACT.md, "IDs"). */
export const ID_BLOCK = 2 ** 40;

export const REJECT = {
    STALE_GRID: "STALE_GRID",
    DELETED: "DELETED",
    CONSTRAINT: "CONSTRAINT",
    NOT_ALLOWED: "NOT_ALLOWED",
    MALFORMED: "MALFORMED",
};

// Server bookkeeping. The `sync_` prefix keeps it apart from the app's tables.
const SERVER_DDL = [
    `CREATE TABLE IF NOT EXISTS sync_op_log (
        seq INTEGER PRIMARY KEY,
        op_id TEXT NOT NULL UNIQUE,
        user_json TEXT NOT NULL,
        label TEXT,
        changes TEXT NOT NULL,
        conflicts TEXT NOT NULL,
        grid_version INTEGER NOT NULL,
        at TEXT NOT NULL
    )`,
    // who last wrote each field, and at which seq: the server's half of field-level LWW
    `CREATE TABLE IF NOT EXISTS sync_field_versions (
        tbl TEXT NOT NULL, row_id INTEGER NOT NULL, col TEXT NOT NULL,
        seq INTEGER NOT NULL, user_json TEXT NOT NULL,
        PRIMARY KEY (tbl, row_id, col)
    )`,
    `CREATE TABLE IF NOT EXISTS sync_tombstones (
        tbl TEXT NOT NULL, row_id INTEGER NOT NULL, seq INTEGER NOT NULL, user_json TEXT NOT NULL,
        PRIMARY KEY (tbl, row_id)
    )`,
    `CREATE TABLE IF NOT EXISTS sync_members (
        user_id TEXT PRIMARY KEY, idx INTEGER NOT NULL UNIQUE, name TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS sync_session (key TEXT PRIMARY KEY, value TEXT)`,
];

const STALE_GRID_MESSAGE =
    "Someone changed the show's counts while you were editing, so your edit was undone. Try it again.";

/**
 * A readable sentence for a refused SQLite statement. The timeline triggers raise messages that
 * start with the spec's code (`E-A1: ...`); those pass through as they are.
 */
export function explainSqliteError(raw) {
    const message = String(raw ?? "");
    const coded = message.match(/\bE-[A-Z]+\d[\s\S]*?(?=: SQLITE_|$)/);
    if (coded) return coded[0].trim();
    const raised = message.match(
        /((?:Modification|Deletion) not allowed for the [^.]+\.)/,
    );
    if (raised) return raised[1];
    if (/FOREIGN KEY/i.test(message))
        return "It refers to something that no longer exists (FOREIGN KEY constraint failed).";
    const unique = message.match(/UNIQUE constraint failed: ([\w., ]+)/);
    if (unique) return `That would make two identical rows (${unique[1]}).`;
    const check = message.match(/CHECK constraint failed: (\w+)/);
    if (check) return `That edit breaks a show rule (${check[1]}).`;
    const notNull = message.match(/NOT NULL constraint failed: ([\w.]+)/);
    if (notNull) return `A required value is missing (${notNull[1]}).`;
    return message.replace(/^Error:\s*/, "");
}

class Refusal extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

const isPlainObject = (v) =>
    v !== null && typeof v === "object" && !Array.isArray(v);
const isSqlValue = (v) =>
    v === null ||
    typeof v === "string" ||
    (typeof v === "number" && Number.isFinite(v));

/** A shape error in an op, or null (MALFORMED). */
function malformed(op) {
    if (!isPlainObject(op)) return "The op is not an object.";
    if (typeof op.opId !== "string" || op.opId.length === 0)
        return "The op has no opId.";
    if (!Number.isInteger(op.baseSeq)) return "The op has no baseSeq.";
    if (!Number.isInteger(op.gridVersion)) return "The op has no gridVersion.";
    if (!Array.isArray(op.changes) || op.changes.length === 0)
        return "The op has no changes.";
    for (const [i, ch] of op.changes.entries()) {
        const where = `changes[${i}]`;
        if (!isPlainObject(ch)) return `${where} is not an object.`;
        if (!["insert", "update", "delete"].includes(ch.kind))
            return `${where} has an unknown kind.`;
        if (typeof ch.table !== "string") return `${where} has no table.`;
        if (!Number.isSafeInteger(ch.id)) return `${where} has no integer id.`;
        const values =
            ch.kind === "insert"
                ? ch.row
                : ch.kind === "update"
                  ? ch.set
                  : ch.prev;
        if (!isPlainObject(values))
            return `${where} has no ${ch.kind === "insert" ? "row" : ch.kind === "update" ? "set" : "prev"}.`;
        if (ch.kind === "update" && !isPlainObject(ch.prev))
            return `${where} has no prev.`;
        if (ch.kind === "update" && Object.keys(ch.set).length === 0)
            return `${where} sets nothing.`;
        if (ch.kind !== "delete")
            for (const [col, v] of Object.entries(values))
                if (!isSqlValue(v))
                    return `${where}.${col} is not a number, text or null.`;
    }
    return null;
}

/** An allowlist error in an op, or null (NOT_ALLOWED). */
function notAllowed(op) {
    for (const ch of op.changes) {
        const table = SYNCED[ch.table];
        if (!table) return `Table ${ch.table} does not sync.`;
        for (const col of writtenColumns(ch)) {
            if (!table.writable.has(col))
                return `Column ${ch.table}.${col} does not sync.`;
        }
        if (ch.kind === "insert" && table.key in ch.row) {
            if (ch.row[table.key] !== ch.id)
                return `${ch.table}: row ${table.key} differs from the change's id.`;
        }
        if (ch.kind === "update" && table.key in ch.set)
            return `${ch.table}: a row's ${table.key} can't change.`;
    }
    return null;
}

/** The marcher a conflict is about, for the client's toast. */
function marcherOf(table, row) {
    if (table === "marchers") return row?.id ?? null;
    if (table === "timeline_assignments") return row?.marcher_id ?? null;
    return null;
}

function describe(table, row) {
    if (table === "marchers")
        return row?.drill_prefix
            ? `${row.drill_prefix}${row.drill_order}`
            : "the marcher";
    if (table === "timeline_assignments" || table === "timeline_transitions")
        return "the move";
    if (table === "pages") return "the page";
    return `the ${table} row`;
}

export class ShowSession extends DurableObject {
    constructor(ctx, env) {
        super(ctx, env);
        this.sql = ctx.storage.sql;
        ctx.storage.transactionSync(() => {
            for (const ddl of SERVER_DDL) this.sql.exec(ddl);
        });
    }

    rows(query, ...args) {
        return this.sql.exec(query, ...args).toArray();
    }

    sessionValue(key) {
        return this.rows("SELECT value FROM sync_session WHERE key = ?", key)[0]
            ?.value;
    }

    setSessionValue(key, value) {
        this.sql.exec(
            "INSERT INTO sync_session (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            key,
            String(value),
        );
    }

    initialized() {
        return Boolean(this.sessionValue("owner_token"));
    }

    seq() {
        return Number(this.sessionValue("seq") ?? 0);
    }

    gridVersion() {
        return Number(this.sessionValue("grid_version") ?? 1);
    }

    snapshot() {
        const out = {};
        for (const table of TABLE_ORDER)
            out[table] = this.rows(
                `SELECT ${[...SYNCED[table].writable].map((c) => `"${c}"`).join(", ")} FROM "${table}" ORDER BY "${SYNCED[table].key}"`,
            );
        return out;
    }

    /**
     * Foreign-key violations in `tables` and in the tables whose keys point at them, checked
     * before the transaction ends. Durable Object SQLite resets the whole object when a
     * deferred foreign key fails at commit (the socket drops, no JS error), so the op must
     * never reach commit with one.
     */
    foreignKeyViolations(tables) {
        const check = new Set();
        for (const t of tables) {
            check.add(t);
            for (const child of this.referencing(t)) check.add(child);
        }
        const out = [];
        for (const t of check)
            for (const v of this.rows(`PRAGMA foreign_key_check("${t}")`))
                out.push(v);
        return out;
    }

    /** Synced tables with a foreign key to `table`. */
    referencing(table) {
        if (!this.children) {
            this.children = new Map();
            for (const child of TABLE_ORDER)
                for (const fk of this.rows(
                    `SELECT "table" AS parent FROM pragma_foreign_key_list(?)`,
                    child,
                )) {
                    if (!this.children.has(fk.parent))
                        this.children.set(fk.parent, new Set());
                    this.children.get(fk.parent).add(child);
                }
        }
        return this.children.get(table) ?? [];
    }

    violations() {
        return this.rows(
            "SELECT code, transition_id, detail FROM timeline_commit_violations",
        );
    }

    async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/init" && request.method === "POST")
            return this.init(request);
        if (url.pathname.endsWith("/snapshot")) {
            if (!this.initialized())
                return Response.json(
                    { error: "No such session" },
                    { status: 404 },
                );
            return Response.json({
                seq: this.seq(),
                gridVersion: this.gridVersion(),
                snapshot: this.snapshot(),
            });
        }
        if (
            url.pathname.endsWith("/ws") &&
            request.headers.get("Upgrade") === "websocket"
        ) {
            if (!this.initialized())
                return new Response("No such session", { status: 404 });
            const pair = new WebSocketPair();
            this.ctx.acceptWebSocket(pair[1]);
            pair[1].serializeAttachment({ joined: false });
            return new Response(null, { status: 101, webSocket: pair[0] });
        }
        return new Response("Not found", { status: 404 });
    }

    /** "Make collaborative": fill the show from the uploaded snapshot. */
    async init(request) {
        if (this.initialized())
            return Response.json(
                { error: "already initialized" },
                { status: 409 },
            );
        let body;
        try {
            body = await request.json();
        } catch {
            return Response.json(
                { error: "Body is not JSON" },
                { status: 400 },
            );
        }
        const snapshot = body?.snapshot;
        if (!isPlainObject(snapshot))
            return Response.json(
                { error: "Body needs a snapshot object" },
                { status: 400 },
            );
        for (const [table, rows] of Object.entries(snapshot)) {
            if (!SYNCED[table])
                return Response.json(
                    { error: `Table ${table} does not sync` },
                    { status: 400 },
                );
            if (!Array.isArray(rows))
                return Response.json(
                    { error: `${table} is not an array of rows` },
                    { status: 400 },
                );
        }
        const ownerToken = crypto.randomUUID();
        const dropped = new Set();
        try {
            this.ctx.storage.transactionSync(() => {
                // first use: the app's schema (generated/schema.sql)
                if (this.sessionValue("schema") !== "app") {
                    for (const ddl of APP_DDL) this.sql.exec(ddl);
                    this.setSessionValue("schema", "app");
                }
                this.sql.exec("PRAGMA defer_foreign_keys = ON");
                for (const table of TABLE_ORDER) {
                    const { columns, writable, key } = SYNCED[table];
                    for (const row of snapshot[table] ?? []) {
                        if (
                            !isPlainObject(row) ||
                            !Number.isSafeInteger(row[key])
                        )
                            throw new Error(
                                `${table}: a row has no integer ${key}`,
                            );
                        for (const c of Object.keys(row)) {
                            if (!columns.includes(c))
                                throw new Error(
                                    `Column ${table}.${c} does not sync`,
                                );
                            if (!writable.has(c)) dropped.add(`${table}.${c}`);
                            else if (!isSqlValue(row[c]))
                                throw new Error(
                                    `${table}.${c} is not a number, text or null`,
                                );
                        }
                        const cols = Object.keys(row).filter((c) =>
                            writable.has(c),
                        );
                        this.sql.exec(
                            `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
                            ...cols.map((c) => row[c]),
                        );
                    }
                }
                const dangling = this.foreignKeyViolations(TABLE_ORDER);
                if (dangling.length > 0)
                    throw new Error(
                        `FOREIGN KEY constraint failed: ${dangling
                            .slice(0, 5)
                            .map(
                                (v) =>
                                    `${v.table} row ${v.rowid} -> ${v.parent}`,
                            )
                            .join(", ")}`,
                    );
                const bad = this.violations();
                if (bad.length > 0)
                    throw new Error(
                        bad.map((v) => `${v.code}: ${v.detail}`).join("; "),
                    );
                this.setSessionValue("owner_token", ownerToken);
                this.setSessionValue("seq", 0);
                this.setSessionValue("grid_version", 1);
                this.setSessionValue("created_at", new Date().toISOString());
            });
        } catch (err) {
            return Response.json(
                { error: explainSqliteError(err?.message ?? err) },
                { status: 400 },
            );
        }
        return Response.json({ ownerToken, droppedColumns: [...dropped] });
    }

    send(ws, message) {
        try {
            ws.send(JSON.stringify(message));
        } catch {
            // closed
        }
    }

    broadcast(message) {
        const text = JSON.stringify(message);
        for (const ws of this.ctx.getWebSockets()) {
            if (!ws.deserializeAttachment()?.joined) continue;
            try {
                ws.send(text);
            } catch {
                // closed
            }
        }
    }

    people() {
        return this.ctx
            .getWebSockets()
            .map((ws) => ws.deserializeAttachment())
            .filter((a) => a?.joined)
            .map((a) => ({
                user: a.user,
                role: a.role,
                presence: a.presence ?? null,
            }));
    }

    async webSocketMessage(ws, data) {
        let msg;
        try {
            msg = JSON.parse(data);
        } catch {
            return;
        }
        const att = ws.deserializeAttachment() ?? {};
        if (msg?.type === "hello") return this.onHello(ws, msg);
        if (!att.joined) return;
        if (msg.type === "op") return this.onOp(ws, att, msg.op);
        if (msg.type === "presence") {
            att.presence = msg.presence ?? null;
            ws.serializeAttachment(att);
            this.broadcast({ type: "people", people: this.people() });
        }
    }

    onHello(ws, msg) {
        const user = {
            id: String(msg.user?.id ?? crypto.randomUUID()),
            name: String(msg.user?.name ?? "Someone").slice(0, 40),
            color: String(msg.user?.color ?? "#888"),
        };
        const role =
            msg.ownerToken &&
            msg.ownerToken === this.sessionValue("owner_token")
                ? "owner"
                : "editor";
        // a member keeps its id block across reconnects
        let idx = this.rows(
            "SELECT idx FROM sync_members WHERE user_id = ?",
            user.id,
        )[0]?.idx;
        if (idx === undefined) {
            idx =
                (this.rows("SELECT max(idx) AS m FROM sync_members")[0]?.m ??
                    0) + 1;
            this.sql.exec(
                "INSERT INTO sync_members (user_id, idx, name) VALUES (?, ?, ?)",
                user.id,
                idx,
                user.name,
            );
        }
        ws.serializeAttachment({ joined: true, user, role, presence: null });

        const seq = this.seq();
        const lastSeq = Number(msg.lastSeq ?? -1);
        const welcome = {
            type: "welcome",
            you: { user, role, idBase: idx * ID_BLOCK },
            seq,
            gridVersion: this.gridVersion(),
        };
        if (Number.isInteger(lastSeq) && lastSeq >= 0 && lastSeq <= seq) {
            welcome.ops = this.rows(
                "SELECT * FROM sync_op_log WHERE seq > ? ORDER BY seq",
                lastSeq,
            ).map((r) => this.appliedMessage(r));
        } else {
            welcome.snapshot = this.snapshot();
        }
        this.send(ws, welcome);
        this.broadcast({ type: "people", people: this.people() });
    }

    appliedMessage(r) {
        return {
            type: "applied",
            seq: r.seq,
            opId: r.op_id,
            by: JSON.parse(r.user_json),
            label: r.label,
            changes: JSON.parse(r.changes),
            conflicts: JSON.parse(r.conflicts),
            gridVersion: r.grid_version,
        };
    }

    async webSocketClose(ws) {
        const att = ws.deserializeAttachment();
        if (att) ws.serializeAttachment({ ...att, joined: false });
        try {
            ws.close();
        } catch {
            // already closed
        }
        this.broadcast({ type: "people", people: this.people() });
    }

    async webSocketError(ws) {
        return this.webSocketClose(ws);
    }

    onOp(ws, att, op) {
        const reject = (code, message) =>
            this.send(ws, {
                type: "rejected",
                opId: isPlainObject(op) ? op.opId : undefined,
                code,
                message,
            });

        const shape = malformed(op);
        if (shape) return reject(REJECT.MALFORMED, shape);

        // an idempotent retry gets the original outcome again
        const dup = this.rows(
            "SELECT * FROM sync_op_log WHERE op_id = ?",
            op.opId,
        )[0];
        if (dup) return this.send(ws, this.appliedMessage(dup));

        // 1. allowlist
        const disallowed = notAllowed(op);
        if (disallowed) return reject(REJECT.NOT_ALLOWED, disallowed);

        // 2. grid version
        const structural = op.changes.some(isStructural);
        const grid = this.gridVersion();
        if (
            (structural || op.changes.some(writesBeatRange)) &&
            op.gridVersion !== grid
        )
            return reject(REJECT.STALE_GRID, STALE_GRID_MESSAGE);

        // 3-5. apply in one transaction: constraints and triggers, the commit check, LWW
        const user = att.user;
        const userJson = JSON.stringify(user);
        const seq = this.seq() + 1;
        const nextGrid = structural ? grid + 1 : grid;
        const conflicts = [];
        const effective = [];
        try {
            this.ctx.storage.transactionSync(() => {
                this.sql.exec("PRAGMA defer_foreign_keys = ON");
                for (const ch of op.changes)
                    this.applyChange(ch, op, user, userJson, seq, {
                        conflicts,
                        effective,
                    });
                const dangling = this.foreignKeyViolations(
                    new Set(op.changes.map((ch) => ch.table)),
                );
                if (dangling.length > 0)
                    throw new Refusal(
                        REJECT.CONSTRAINT,
                        `It refers to something that no longer exists (FOREIGN KEY constraint failed: ${dangling
                            .slice(0, 5)
                            .map(
                                (v) =>
                                    `${v.table} row ${v.rowid} -> ${v.parent}`,
                            )
                            .join(", ")}).`,
                    );
                const bad = this.violations();
                if (bad.length > 0)
                    throw new Refusal(
                        REJECT.CONSTRAINT,
                        bad
                            .map(
                                (v) =>
                                    `${v.code}: ${v.detail} (transition ${v.transition_id})`,
                            )
                            .join("; "),
                    );
                this.sql.exec(
                    "INSERT INTO sync_op_log (seq, op_id, user_json, label, changes, conflicts, grid_version, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    seq,
                    op.opId,
                    userJson,
                    String(op.label ?? ""),
                    JSON.stringify(effective),
                    JSON.stringify(conflicts),
                    nextGrid,
                    new Date().toISOString(),
                );
                this.setSessionValue("seq", seq);
                if (structural) this.setSessionValue("grid_version", nextGrid);
            });
        } catch (err) {
            if (err instanceof Refusal) return reject(err.code, err.message);
            return reject(
                REJECT.CONSTRAINT,
                explainSqliteError(err?.message ?? err),
            );
        }
        this.broadcast({
            type: "applied",
            seq,
            opId: op.opId,
            by: user,
            label: String(op.label ?? ""),
            changes: effective,
            conflicts,
            gridVersion: nextGrid,
        });
    }

    applyChange(ch, op, user, userJson, seq, { conflicts, effective }) {
        const { table } = ch;
        const { key, writable } = SYNCED[table];
        const current = this.rows(
            `SELECT * FROM "${table}" WHERE "${key}" = ?`,
            ch.id,
        )[0];
        const recordWrite = (col) =>
            this.sql.exec(
                "INSERT INTO sync_field_versions (tbl, row_id, col, seq, user_json) VALUES (?, ?, ?, ?, ?) ON CONFLICT(tbl, row_id, col) DO UPDATE SET seq = excluded.seq, user_json = excluded.user_json",
                table,
                ch.id,
                col,
                seq,
                userJson,
            );
        // a field someone else wrote after the op's base, which this op is about to replace
        const unseenWriteOf = (col) => {
            const fv = this.rows(
                "SELECT seq, user_json FROM sync_field_versions WHERE tbl = ? AND row_id = ? AND col = ?",
                table,
                ch.id,
                col,
            )[0];
            if (!fv || fv.seq <= op.baseSeq) return null;
            const other = JSON.parse(fv.user_json);
            return other.id === user.id ? null : { other, seq: fv.seq };
        };

        if (ch.kind === "insert") {
            const row = { ...ch.row, [key]: ch.id };
            const cols = Object.keys(row);
            this.sql.exec(
                `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
                ...cols.map((c) => row[c]),
            );
            this.sql.exec(
                "DELETE FROM sync_tombstones WHERE tbl = ? AND row_id = ?",
                table,
                ch.id,
            );
            for (const c of cols) recordWrite(c);
            effective.push({ kind: "insert", table, id: ch.id, row });
            return;
        }
        if (ch.kind === "update") {
            if (!current) {
                const tomb = this.rows(
                    "SELECT user_json FROM sync_tombstones WHERE tbl = ? AND row_id = ?",
                    table,
                    ch.id,
                )[0];
                const by = tomb ? JSON.parse(tomb.user_json).name : "Someone";
                throw new Refusal(
                    REJECT.DELETED,
                    `${by} deleted ${describe(table, ch.prev)} you were editing.`,
                );
            }
            const cols = Object.keys(ch.set);
            for (const col of cols) {
                const unseen = unseenWriteOf(col);
                if (unseen && current[col] !== ch.set[col])
                    conflicts.push({
                        kind: "overwrite",
                        table,
                        id: ch.id,
                        col,
                        loser: unseen.other,
                        lostValue: current[col],
                        value: ch.set[col],
                        marcherId: marcherOf(table, current),
                    });
            }
            this.sql.exec(
                `UPDATE "${table}" SET ${cols.map((c) => `"${c}" = ?`).join(", ")} WHERE "${key}" = ?`,
                ...cols.map((c) => ch.set[c]),
                ch.id,
            );
            for (const c of cols) recordWrite(c);
            effective.push({
                kind: "update",
                table,
                id: ch.id,
                set: ch.set,
                prev: Object.fromEntries(cols.map((c) => [c, current[c]])),
            });
            return;
        }
        // delete
        this.sql.exec(
            "INSERT INTO sync_tombstones (tbl, row_id, seq, user_json) VALUES (?, ?, ?, ?) ON CONFLICT(tbl, row_id) DO UPDATE SET seq = excluded.seq, user_json = excluded.user_json",
            table,
            ch.id,
            seq,
            userJson,
        );
        if (!current) return; // already gone (a cascade, or someone else's delete)
        for (const col of writable) {
            const unseen = unseenWriteOf(col);
            if (unseen) {
                conflicts.push({
                    kind: "deleted-edited",
                    table,
                    id: ch.id,
                    col,
                    loser: unseen.other,
                    marcherId: marcherOf(table, current),
                });
                break;
            }
        }
        this.sql.exec(`DELETE FROM "${table}" WHERE "${key}" = ?`, ch.id);
        const prev = Object.fromEntries(
            [...writable].map((c) => [c, current[c]]),
        );
        effective.push({ kind: "delete", table, id: ch.id, prev });
    }
}
