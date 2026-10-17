// One client's link to its show's session: sends ops, keeps the queue of unacknowledged ones,
// applies what the server broadcasts, reverts what it refuses, and goes read-only while offline.
import { newOpId } from "../shared/protocol.js";
import { fieldsOf, invertChanges } from "./mirror.js";

export class Connection {
    /**
     * @param {{sessionId: string, user: any, headToken?: string, mirror: import("./mirror.js").Mirror,
     *   onEvent: (event: any) => void}} options
     */
    constructor({ sessionId, user, headToken, mirror, onEvent }) {
        this.sessionId = sessionId;
        this.user = user;
        this.headToken = headToken;
        this.mirror = mirror;
        this.onEvent = onEvent;
        this.state = "connecting"; // connecting | live | offline
        this.role = "collaborator";
        this.seq = -1; // last server seq applied to the mirror; -1 means "send me a snapshot"
        /** @type {{op: any, fields: Set<string>}[]} */
        this.pending = [];
        this.latencyMs = 0;
        this.killed = false;
        this.retryMs = 500;
        this.outAt = 0;
        this.inAt = 0;
    }

    connect() {
        if (this.ws) return;
        this.killed = false;
        this.setState("connecting");
        const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
        const ws = new WebSocket(`${proto}//${window.location.host}/api/sessions/${this.sessionId}/ws`);
        this.ws = ws;
        ws.onopen = () => {
            this.retryMs = 500;
            this.rawSend({ type: "hello", user: this.user, headToken: this.headToken, lastSeq: this.seq });
        };
        ws.onmessage = (e) => this.delayed("in", () => this.ws === ws && this.onMessage(JSON.parse(e.data)));
        ws.onclose = () => this.onClosed(ws);
        ws.onerror = () => {};
    }

    /** Cuts the connection on purpose (the "Kill connection" button) and stays offline. */
    kill() {
        this.killed = true;
        this.ws?.close();
    }

    reconnect() {
        this.killed = false;
        this.connect();
    }

    onClosed(ws) {
        if (this.ws !== ws) return;
        this.ws = null;
        // online-only: edits the server never confirmed are undone, not queued
        const dropped = this.pending.length;
        this.revertAllPending();
        this.setState("offline");
        if (dropped > 0)
            this.onEvent({ type: "dropped", count: dropped });
        if (!this.killed) {
            setTimeout(() => !this.killed && !this.ws && this.connect(), this.retryMs);
            this.retryMs = Math.min(this.retryMs * 2, 5000);
        }
    }

    setState(state) {
        this.state = state;
        this.onEvent({ type: "state", state });
    }

    /**
     * Runs `fn` after the simulated network delay. Each message is delayed by the same amount
     * (not one after another), and messages keep their order.
     */
    delayed(direction, fn) {
        const key = direction === "in" ? "inAt" : "outAt";
        const at = Math.max(performance.now() + this.latencyMs, this[key] ?? 0);
        this[key] = at;
        setTimeout(() => {
            try {
                fn();
            } catch (err) {
                console.error(err);
            }
        }, at - performance.now());
    }

    rawSend(message) {
        this.ws?.readyState === WebSocket.OPEN && this.ws.send(JSON.stringify(message));
    }

    send(message) {
        // a message still "in flight" when its socket drops is lost with it, as on a real network
        const ws = this.ws;
        this.delayed("out", () => this.ws === ws && this.rawSend(message));
    }

    get live() {
        return this.state === "live";
    }

    /**
     * Runs a command against the mirror and sends what it changed. Refused while offline: the
     * session is online-only.
     *
     * @returns {{ok: true, changes: any[]} | {ok: false, reason: string}}
     */
    submit(label, fn, { override = false } = {}) {
        if (!this.live) return { ok: false, reason: "You're offline, so the show is read-only." };
        const changes = this.mirror.transact(fn);
        if (changes.length === 0) return { ok: true, changes };
        const op = {
            opId: newOpId(),
            baseSeq: this.seq,
            gridVersion: Number(this.mirror.meta("grid_version") ?? 1),
            label,
            override,
            changes,
        };
        // the grid version an op carries is the one before it; a structural op moves it on
        const gridChange = changes.find((c) => c.table === "meta" && c.key === "grid_version");
        if (gridChange) op.gridVersion = Number(gridChange.prev?.value ?? gridChange.row?.value) || op.gridVersion;
        this.pending.push({ op, fields: new Set(changes.flatMap(fieldsOf)) });
        this.send({ type: "op", op });
        this.onEvent({ type: "pending", count: this.pending.length });
        return { ok: true, changes };
    }

    isPending(table, key, col) {
        const f = `${table}:${key}:${col}`;
        return this.pending.some((p) => p.fields.has(f));
    }

    /**
     * A remote write to a field this client has an unconfirmed write to is not shown (ours will
     * land after it, and win), but it becomes the value to go back to if ours is refused.
     */
    shadow(changes) {
        for (const ch of changes) {
            if (ch.kind !== "update") continue;
            for (const [col, value] of Object.entries(ch.set)) {
                const f = `${ch.table}:${ch.key}:${col}`;
                const first = this.pending.find((p) => p.fields.has(f));
                if (!first) continue;
                for (const c of first.op.changes)
                    if (c.kind === "update" && c.table === ch.table && c.key === ch.key && col in c.prev)
                        c.prev[col] = value;
            }
        }
    }

    applyRemote(changes) {
        this.shadow(changes);
        this.mirror.applyChanges(changes, (t, k, c) => this.isPending(t, k, c));
    }

    revert(entry) {
        this.pending = this.pending.filter((p) => p !== entry);
        this.mirror.applyChanges(invertChanges(entry.op.changes), (t, k, c) => this.isPending(t, k, c), "revert");
    }

    revertAllPending() {
        while (this.pending.length) this.revert(this.pending[this.pending.length - 1]);
    }

    onMessage(msg) {
        if (msg.type === "welcome") {
            this.role = msg.you.role;
            this.mirror.idBase = msg.you.idBase;
            if (msg.snapshot) this.mirror.load(msg.snapshot);
            else for (const op of msg.ops ?? []) this.mirror.applyChanges(op.changes);
            const caughtUp = msg.ops?.length ?? 0;
            this.seq = msg.seq;
            this.setState("live");
            this.onEvent({ type: "welcome", you: msg.you, claims: msg.claims, caughtUp, ops: msg.ops ?? [], snapshot: !!msg.snapshot });
            return;
        }
        if (msg.type === "applied") {
            if (msg.seq <= this.seq) return;
            const mine = this.pending.find((p) => p.op.opId === msg.opId);
            if (mine) this.pending = this.pending.filter((p) => p !== mine);
            this.applyRemote(msg.changes);
            this.seq = msg.seq;
            this.onEvent({ type: "applied", msg, mine: !!mine });
            this.onEvent({ type: "pending", count: this.pending.length });
            return;
        }
        if (msg.type === "rejected") {
            const entry = this.pending.find((p) => p.op.opId === msg.opId);
            if (entry) this.revert(entry);
            this.onEvent({ type: "rejected", msg, op: entry?.op });
            this.onEvent({ type: "pending", count: this.pending.length });
            return;
        }
        this.onEvent(msg);
    }
}
