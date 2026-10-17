/* global WebSocketPair */
// One Durable Object per show: the authoritative session. It owns the show rows (in its own
// SQLite, created from the same DDL the clients run), orders ops, validates them, applies them
// with field-level last-writer-wins, and broadcasts what it applied.
import { DurableObject } from "cloudflare:workers";
import {
    SHOW_DDL,
    SYNCED,
    KEY,
    TABLE_ORDER,
    isStructural,
    touchesBeats,
} from "../public/shared/schema.js";
import { ID_BLOCK, REJECT } from "../public/shared/protocol.js";

const SERVER_DDL = [
    `CREATE TABLE IF NOT EXISTS server_op_log (
        seq INTEGER PRIMARY KEY,
        op_id TEXT NOT NULL UNIQUE,
        user_json TEXT NOT NULL,
        label TEXT,
        changes TEXT NOT NULL,
        conflicts TEXT,
        at TEXT NOT NULL
    )`,
    // who last wrote each field, and at which seq: the server's half of field-level LWW
    `CREATE TABLE IF NOT EXISTS field_versions (
        tbl TEXT NOT NULL, row_key TEXT NOT NULL, col TEXT NOT NULL,
        seq INTEGER NOT NULL, user_json TEXT NOT NULL,
        PRIMARY KEY (tbl, row_key, col)
    )`,
    `CREATE TABLE IF NOT EXISTS tombstones (
        tbl TEXT NOT NULL, row_key TEXT NOT NULL, seq INTEGER NOT NULL, user_json TEXT NOT NULL,
        PRIMARY KEY (tbl, row_key)
    )`,
    `CREATE TABLE IF NOT EXISTS claims (
        section TEXT PRIMARY KEY, user_json TEXT NOT NULL, at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS members (
        user_id TEXT PRIMARY KEY, idx INTEGER NOT NULL UNIQUE, name TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS session (key TEXT PRIMARY KEY, value TEXT)`,
];

/** A friendlier sentence for a refused SQLite constraint. */
function explainConstraint(message) {
    if (message.includes("moves.marcher_id, moves.start_beat, moves.end_beat"))
        return "That marcher already has a move over exactly those counts.";
    if (message.includes("marchers.drill_prefix"))
        return "That drill number is already taken.";
    if (message.includes("pages.beat"))
        return "There is already a page flag on that count.";
    if (message.includes("FOREIGN KEY"))
        return "It refers to something someone else just deleted.";
    if (message.includes("CHECK"))
        return "That edit breaks a show rule (a move needs at least one count).";
    if (message.includes("UNIQUE"))
        return "That would make two identical rows.";
    return message;
}

class Refusal extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

export class ShowSession extends DurableObject {
    constructor(ctx, env) {
        super(ctx, env);
        this.sql = ctx.storage.sql;
        for (const ddl of [...SHOW_DDL, ...SERVER_DDL]) this.sql.exec(ddl);
    }

    rows(query, ...args) {
        return this.sql.exec(query, ...args).toArray();
    }

    sessionValue(key) {
        return this.rows("SELECT value FROM session WHERE key = ?", key)[0]
            ?.value;
    }

    setSessionValue(key, value) {
        this.sql.exec(
            "INSERT INTO session (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            key,
            String(value),
        );
    }

    seq() {
        return Number(this.sessionValue("seq") ?? 0);
    }

    gridVersion() {
        return Number(
            this.rows("SELECT value FROM meta WHERE key = 'grid_version'")[0]
                ?.value ?? 1,
        );
    }

    snapshot() {
        const out = {};
        for (const table of TABLE_ORDER)
            out[table] = this.rows(
                `SELECT ${SYNCED[table].join(", ")} FROM ${table}`,
            );
        return out;
    }

    async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname.endsWith("/init") && request.method === "POST") {
            if (this.sessionValue("head_token"))
                return Response.json(
                    { error: "already initialized" },
                    { status: 409 },
                );
            const snap = await request.json();
            const headToken = crypto.randomUUID();
            this.ctx.storage.transactionSync(() => {
                for (const table of TABLE_ORDER) {
                    for (const row of snap[table] ?? []) {
                        const cols = SYNCED[table].filter((c) => c in row);
                        this.sql.exec(
                            `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
                            ...cols.map((c) => row[c]),
                        );
                    }
                }
                this.setSessionValue("head_token", headToken);
                this.setSessionValue("seq", 0);
                this.setSessionValue("created_at", new Date().toISOString());
            });
            return Response.json({ headToken });
        }
        if (url.pathname.endsWith("/snapshot")) {
            return Response.json({ seq: this.seq(), ...this.snapshot() });
        }
        if (request.headers.get("Upgrade") === "websocket") {
            if (!this.sessionValue("head_token"))
                return new Response("No such session", { status: 404 });
            const pair = new WebSocketPair();
            this.ctx.acceptWebSocket(pair[1]);
            pair[1].serializeAttachment({ joined: false });
            return new Response(null, { status: 101, webSocket: pair[0] });
        }
        return new Response("Not found", { status: 404 });
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

    claims() {
        return this.rows("SELECT section, user_json, at FROM claims").map(
            (c) => ({
                section: c.section,
                user: JSON.parse(c.user_json),
                at: c.at,
            }),
        );
    }

    async webSocketMessage(ws, data) {
        let msg;
        try {
            msg = JSON.parse(data);
        } catch {
            return;
        }
        const att = ws.deserializeAttachment() ?? {};
        if (msg.type === "hello") return this.onHello(ws, msg);
        if (!att.joined) return;
        if (msg.type === "op") return this.onOp(ws, att, msg.op);
        if (msg.type === "presence") {
            att.presence = msg.presence;
            ws.serializeAttachment(att);
            this.broadcast({ type: "people", people: this.people() });
            return;
        }
        if (msg.type === "claim") return this.onClaim(ws, att, msg.section);
        if (msg.type === "release") return this.onRelease(ws, att, msg.section);
    }

    onHello(ws, msg) {
        const user = {
            id: String(msg.user?.id ?? crypto.randomUUID()),
            name: String(msg.user?.name ?? "Someone").slice(0, 40),
            color: String(msg.user?.color ?? "#888"),
        };
        const role =
            msg.headToken && msg.headToken === this.sessionValue("head_token")
                ? "head"
                : "collaborator";
        // a member keeps its id block across reconnects
        let idx = this.rows(
            "SELECT idx FROM members WHERE user_id = ?",
            user.id,
        )[0]?.idx;
        if (idx === undefined) {
            idx =
                (this.rows("SELECT max(idx) AS m FROM members")[0]?.m ?? 0) + 1;
            this.sql.exec(
                "INSERT INTO members (user_id, idx, name) VALUES (?, ?, ?)",
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
            claims: this.claims(),
        };
        if (lastSeq >= 0 && lastSeq <= seq) {
            // catch up from the op log
            welcome.ops = this.rows(
                "SELECT seq, op_id, user_json, label, changes, conflicts FROM server_op_log WHERE seq > ? ORDER BY seq",
                lastSeq,
            ).map((r) => ({
                seq: r.seq,
                opId: r.op_id,
                by: JSON.parse(r.user_json),
                label: r.label,
                changes: JSON.parse(r.changes),
                conflicts: JSON.parse(r.conflicts ?? "[]"),
            }));
        } else {
            welcome.snapshot = this.snapshot();
        }
        this.send(ws, welcome);
        this.broadcast({ type: "people", people: this.people() });
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

    onClaim(ws, att, section) {
        const held = this.claims().find((c) => c.section === section);
        if (held && held.user.id !== att.user.id && att.role !== "head") {
            this.send(ws, {
                type: "notice",
                message: `${section} is already claimed by ${held.user.name}.`,
            });
            return;
        }
        this.sql.exec(
            "INSERT INTO claims (section, user_json, at) VALUES (?, ?, ?) ON CONFLICT(section) DO UPDATE SET user_json = excluded.user_json, at = excluded.at",
            section,
            JSON.stringify(att.user),
            new Date().toISOString(),
        );
        this.broadcast({ type: "claims", claims: this.claims() });
    }

    onRelease(ws, att, section) {
        const held = this.claims().find((c) => c.section === section);
        if (!held) return;
        if (held.user.id !== att.user.id && att.role !== "head") return;
        this.sql.exec("DELETE FROM claims WHERE section = ?", section);
        this.broadcast({ type: "claims", claims: this.claims() });
    }

    /** The sections of the marchers an op touches. */
    sectionsTouched(op) {
        const marcherIds = new Set();
        const sections = new Set();
        for (const ch of op.changes) {
            if (ch.table === "marchers") {
                if (ch.kind === "insert") sections.add(ch.row.section);
                else marcherIds.add(ch.key);
                if (ch.kind === "update" && "section" in ch.set)
                    sections.add(ch.set.section);
            } else if (ch.table === "moves") {
                if (ch.kind === "insert") marcherIds.add(ch.row.marcher_id);
                else if (ch.kind === "delete")
                    marcherIds.add(ch.prev.marcher_id);
                else {
                    const cur = this.rows(
                        "SELECT marcher_id FROM moves WHERE id = ?",
                        ch.key,
                    )[0];
                    if (cur) marcherIds.add(cur.marcher_id);
                    if ("marcher_id" in ch.set)
                        marcherIds.add(ch.set.marcher_id);
                }
            }
        }
        for (const id of marcherIds) {
            const m = this.rows(
                "SELECT section FROM marchers WHERE id = ?",
                id,
            )[0];
            if (m) sections.add(m.section);
        }
        return sections;
    }

    onOp(ws, att, op) {
        const user = att.user;
        const reject = (code, message) =>
            this.send(ws, { type: "rejected", opId: op?.opId, code, message });
        if (!op || !Array.isArray(op.changes))
            return reject(REJECT.NOT_ALLOWED, "Malformed op.");
        // idempotent retry
        const dup = this.rows(
            "SELECT seq FROM server_op_log WHERE op_id = ?",
            op.opId,
        )[0];
        if (dup) return;

        // 1. allowlist: synced tables and columns only
        for (const ch of op.changes) {
            const cols = SYNCED[ch.table];
            if (!cols)
                return reject(
                    REJECT.NOT_ALLOWED,
                    `Table ${ch.table} does not sync.`,
                );
            const written =
                ch.kind === "insert"
                    ? ch.row
                    : ch.kind === "update"
                      ? ch.set
                      : {};
            for (const c of Object.keys(written))
                if (!cols.includes(c))
                    return reject(
                        REJECT.NOT_ALLOWED,
                        `Column ${ch.table}.${c} does not sync.`,
                    );
        }

        // 2. structure: edits computed on an old beat grid are refused; structural edits are head-only
        const structural = op.changes.some(isStructural);
        const grid = this.gridVersion();
        if (structural && att.role !== "head")
            return reject(
                REJECT.NOT_ALLOWED,
                "Only the head drill writer can insert or remove time.",
            );
        if (
            (structural || op.changes.some(touchesBeats)) &&
            op.gridVersion !== grid
        )
            return reject(
                REJECT.STALE_GRID,
                "Someone changed the show's counts while you were editing, so your edit was undone. Try it again.",
            );

        // 3. claims (structural edits are exempt: they shift everyone)
        let overrides = [];
        if (!structural) {
            const sections = this.sectionsTouched(op);
            const held = this.claims().filter(
                (c) => sections.has(c.section) && c.user.id !== user.id,
            );
            if (held.length > 0) {
                if (att.role === "head" && op.override) overrides = held;
                else
                    return reject(
                        REJECT.CLAIMED,
                        `${held.map((c) => c.section).join(", ")} ${held.length > 1 ? "are" : "is"} claimed by ${held.map((c) => c.user.name).join(", ")}.`,
                    );
            }
        }

        // 4. apply in one transaction, with field-level LWW and conflict detection
        const seq = this.seq() + 1;
        const conflicts = [];
        const effective = [];
        const userJson = JSON.stringify(user);
        try {
            this.ctx.storage.transactionSync(() => {
                this.sql.exec("PRAGMA defer_foreign_keys = ON");
                for (const ch of op.changes)
                    this.applyChange(
                        ch,
                        op,
                        user,
                        userJson,
                        seq,
                        conflicts,
                        effective,
                    );
                if (structural) {
                    const next = String(grid + 1);
                    this.sql.exec(
                        "INSERT INTO meta (key, value) VALUES ('grid_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                        next,
                    );
                    const already = effective.find(
                        (c) => c.table === "meta" && c.key === "grid_version",
                    );
                    if (already)
                        already.set = { ...(already.set ?? {}), value: next };
                    else
                        effective.push({
                            kind: "update",
                            table: "meta",
                            key: "grid_version",
                            set: { value: next },
                            prev: { value: String(grid) },
                        });
                }
                this.sql.exec(
                    "INSERT INTO server_op_log (seq, op_id, user_json, label, changes, conflicts, at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    seq,
                    op.opId,
                    userJson,
                    op.label ?? "",
                    JSON.stringify(effective),
                    JSON.stringify(conflicts),
                    new Date().toISOString(),
                );
                this.setSessionValue("seq", seq);
            });
        } catch (err) {
            if (err instanceof Refusal) return reject(err.code, err.message);
            return reject(
                REJECT.CONSTRAINT,
                explainConstraint(String(err?.message ?? err)),
            );
        }
        this.broadcast({
            type: "applied",
            seq,
            opId: op.opId,
            by: user,
            label: op.label,
            changes: effective,
            conflicts,
            overrides: overrides.map((c) => ({
                section: c.section,
                owner: c.user,
            })),
        });
    }

    applyChange(ch, op, user, userJson, seq, conflicts, effective) {
        const table = ch.table;
        const key = KEY[table];
        const rowKey = String(ch.key);
        const current = this.rows(
            `SELECT * FROM ${table} WHERE ${key} = ?`,
            ch.key,
        )[0];
        const recordWrite = (col) =>
            this.sql.exec(
                "INSERT INTO field_versions (tbl, row_key, col, seq, user_json) VALUES (?, ?, ?, ?, ?) ON CONFLICT(tbl, row_key, col) DO UPDATE SET seq = excluded.seq, user_json = excluded.user_json",
                table,
                rowKey,
                col,
                seq,
                userJson,
            );
        // a field someone else wrote after the op's base, which this op is about to replace
        const unseenWriteOf = (col) => {
            const fv = this.rows(
                "SELECT seq, user_json FROM field_versions WHERE tbl = ? AND row_key = ? AND col = ?",
                table,
                rowKey,
                col,
            )[0];
            if (!fv || fv.seq <= op.baseSeq) return null;
            const other = JSON.parse(fv.user_json);
            return other.id === user.id ? null : { other, seq: fv.seq };
        };

        if (ch.kind === "insert") {
            if (current && table === "meta") {
                // meta keys are shared: an insert of an existing key is an update
                return this.applyChange(
                    {
                        kind: "update",
                        table,
                        key: ch.key,
                        set: { value: ch.row.value },
                        prev: { value: current.value },
                    },
                    op,
                    user,
                    userJson,
                    seq,
                    conflicts,
                    effective,
                );
            }
            const cols = SYNCED[table].filter((c) => c in ch.row);
            this.sql.exec(
                `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
                ...cols.map((c) => ch.row[c]),
            );
            for (const c of cols) recordWrite(c);
            effective.push(ch);
            return;
        }
        if (ch.kind === "update") {
            if (!current) {
                const tomb = this.rows(
                    "SELECT user_json FROM tombstones WHERE tbl = ? AND row_key = ?",
                    table,
                    rowKey,
                )[0];
                const by = tomb ? JSON.parse(tomb.user_json).name : "someone";
                throw new Refusal(
                    REJECT.DELETED,
                    `${by} deleted ${describe(table, current ?? ch.prev)} you were editing.`,
                );
            }
            const cols = Object.keys(ch.set);
            for (const col of cols) {
                const unseen = unseenWriteOf(col);
                if (unseen && current[col] !== ch.set[col])
                    conflicts.push({
                        kind: "overwrite",
                        table,
                        key: ch.key,
                        col,
                        loser: unseen.other,
                        lostValue: current[col],
                        value: ch.set[col],
                        marcherId:
                            table === "moves"
                                ? current.marcher_id
                                : table === "marchers"
                                  ? current.id
                                  : null,
                    });
            }
            this.sql.exec(
                `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE ${key} = ?`,
                ...cols.map((c) => ch.set[c]),
                ch.key,
            );
            for (const c of cols) recordWrite(c);
            effective.push({
                ...ch,
                prev: Object.fromEntries(cols.map((c) => [c, current[c]])),
            });
            return;
        }
        if (ch.kind === "delete") {
            this.sql.exec(
                "INSERT INTO tombstones (tbl, row_key, seq, user_json) VALUES (?, ?, ?, ?) ON CONFLICT(tbl, row_key) DO UPDATE SET seq = excluded.seq, user_json = excluded.user_json",
                table,
                rowKey,
                seq,
                userJson,
            );
            if (!current) return; // already gone (a cascade, or someone else's delete)
            for (const col of SYNCED[table]) {
                const unseen = unseenWriteOf(col);
                if (unseen) {
                    conflicts.push({
                        kind: "deleted-edited",
                        table,
                        key: ch.key,
                        col,
                        loser: unseen.other,
                        marcherId:
                            table === "moves"
                                ? current.marcher_id
                                : table === "marchers"
                                  ? current.id
                                  : null,
                    });
                    break;
                }
            }
            this.sql.exec(`DELETE FROM ${table} WHERE ${key} = ?`, ch.key);
            effective.push({ ...ch, prev: current });
        }
    }
}

function describe(table, row) {
    if (table === "moves") return "the move";
    if (table === "marchers")
        return row?.drill_prefix
            ? `${row.drill_prefix}${row.drill_order}`
            : "the marcher";
    if (table === "pages") return "the page";
    return "the row";
}
