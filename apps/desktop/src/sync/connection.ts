/**
 * The app's link to a collaboration session (docs/collaboration/spike/CONTRACT.md, "Protocol"):
 * one WebSocket per show. A port of `prototypes/collaboration/public/client/connection.js` onto
 * the real database:
 *
 * - each local edit (`onLocalOp`, after commit) is sent as an op and kept as pending until the
 *   server answers;
 * - a peer's applied op is written with `applyRemoteChanges`, skipping fields this client has a
 *   pending write to (and "shadowing" them: the remote value becomes the one to go back to);
 * - a refused op is reverted with `invertChanges`;
 * - on disconnect every pending op is reverted, the show is read-only, and the client reconnects
 *   with its last seq to catch up (unless it was disconnected on purpose).
 *
 * Messages are handled one at a time, in arrival order. Nothing here knows about marchers or
 * timelines: every synced table goes through the same path.
 */
import { create } from "zustand";
import type { QueryClient } from "@tanstack/react-query";
import { db } from "@/global/database/db";
import { withTimelineWriteLock } from "@/db-functions/history";
import {
    applyRemoteChanges,
    invertChanges,
    readSyncedSnapshot,
    replaceAllSyncedTables,
    type ApplyResult,
} from "./apply";
import { startCapture, stopCapture } from "./capture";
import { setSyncSession } from "./session";
import type { LocalOp, RowChange, SyncSnapshot } from "./types";

// ---------------------------------------------------------------------------------------------
// Wire types (the server's messages, CONTRACT.md "As built (WP-B)")

export interface SyncUser {
    id: string;
    name: string;
    color: string;
}

export type SyncConflict =
    | {
          kind: "overwrite";
          table: string;
          id: number;
          col: string;
          loser: SyncUser;
          lostValue: unknown;
          value: unknown;
          marcherId?: number | null;
      }
    | {
          kind: "deleted-edited";
          table: string;
          id: number;
          col: string;
          loser: SyncUser;
          marcherId?: number | null;
      };

interface AppliedMessage {
    type: "applied";
    seq: number;
    opId: string;
    by: SyncUser;
    label: string;
    changes: RowChange[];
    conflicts: SyncConflict[];
    gridVersion: number;
}

interface WelcomeMessage {
    type: "welcome";
    you: { user: SyncUser; role: "owner" | "editor"; idBase: number };
    seq: number;
    gridVersion: number;
    snapshot?: SyncSnapshot;
    ops?: AppliedMessage[];
}

interface RejectedMessage {
    type: "rejected";
    opId?: string;
    code: string;
    message: string;
}

interface PeopleMessage {
    type: "people";
    people: { user: SyncUser; role: string; presence: unknown }[];
}

type ServerMessage =
    | WelcomeMessage
    | AppliedMessage
    | RejectedMessage
    | PeopleMessage;

interface Op {
    opId: string;
    baseSeq: number;
    gridVersion: number;
    label: string;
    changes: RowChange[];
}

// ---------------------------------------------------------------------------------------------
// State the UI reads

export type SyncState = "none" | "connecting" | "live" | "offline";

export interface SyncStoreState {
    state: SyncState;
    role: "owner" | "editor" | null;
    sessionId: string | null;
    serverUrl: string | null;
    pending: number;
    people: PeopleMessage["people"];
    lastError: string | null;
}

export const useSyncStore = create<SyncStoreState>(() => ({
    state: "none",
    role: null,
    sessionId: null,
    serverUrl: null,
    pending: 0,
    people: [],
    lastError: null,
}));

/** What the UI is told about, beyond the store: refusals and conflicts (it shows toasts). */
export type SyncNotice =
    | { kind: "rejected"; code: string; message: string; label?: string }
    | { kind: "conflict"; conflict: SyncConflict; by: SyncUser; mine: boolean }
    | { kind: "dropped"; count: number }
    | { kind: "error"; message: string };

const noticeListeners = new Set<(notice: SyncNotice) => void>();
export function subscribeSyncNotices(
    listener: (notice: SyncNotice) => void,
): () => void {
    noticeListeners.add(listener);
    return () => void noticeListeners.delete(listener);
}
const notify = (notice: SyncNotice) =>
    noticeListeners.forEach((l) => {
        try {
            l(notice);
        } catch (error) {
            console.error(error);
        }
    });

// ---------------------------------------------------------------------------------------------
// Settings

export const SYNC_SERVER_STORAGE_KEY = "openmarch:syncServer";
export const DEFAULT_SYNC_SERVER = "http://127.0.0.1:8791";
const SYNC_USER_STORAGE_KEY = "openmarch:syncUser";

export function getSyncServerUrl(): string {
    return localStorage.getItem(SYNC_SERVER_STORAGE_KEY) || DEFAULT_SYNC_SERVER;
}

export function setSyncServerUrl(url: string): void {
    localStorage.setItem(SYNC_SERVER_STORAGE_KEY, url);
}

const COLORS = ["#e5484d", "#3e63dd", "#30a46c", "#f76b15", "#8e4ec6"];

/** This window's dev identity: kept, so a reconnect keeps its id block. */
function localUser(): SyncUser {
    const stored = localStorage.getItem(SYNC_USER_STORAGE_KEY);
    if (stored) return JSON.parse(stored) as SyncUser;
    const id = crypto.randomUUID();
    const user = {
        id,
        name: `Dev ${id.slice(0, 4)}`,
        color: COLORS[parseInt(id.slice(0, 2), 16) % COLORS.length],
    };
    localStorage.setItem(SYNC_USER_STORAGE_KEY, JSON.stringify(user));
    return user;
}

// ---------------------------------------------------------------------------------------------
// Query invalidation

let queryClient: QueryClient | null = null;

/** The app's QueryClient, for invalidating after remote writes (set by `SyncHost`). */
export function setSyncQueryClient(client: QueryClient | null): void {
    queryClient = client;
}

function invalidate(result: ApplyResult | null, all = false) {
    if (!queryClient) return;
    if (all) {
        void queryClient.invalidateQueries();
        return;
    }
    for (const queryKey of result?.queryKeys ?? [])
        void queryClient.invalidateQueries({ queryKey });
}

// ---------------------------------------------------------------------------------------------
// Measurement (for the spike's RESULTS): when ops commit locally and when remote ones land

export interface SyncEvent {
    kind: "local" | "ack" | "remote" | "rejected" | "reverted";
    opId: string;
    label: string;
    /** `Date.now()`; local is the commit, remote is after the write and the invalidation */
    at: number;
    tables?: string[];
    /** For remote ops: how long the message waited, and how long the write took, in ms */
    waitedMs?: number;
    writeMs?: number;
}

const events: SyncEvent[] = [];
const record = (event: SyncEvent) => {
    events.push(event);
    if (events.length > 500) events.splice(0, events.length - 500);
};
export const syncEvents = (): readonly SyncEvent[] => events;

// ---------------------------------------------------------------------------------------------
// The connection

/** Changes in `beats`/`pages`/`measures` that move the grid (the server's `isStructural`). */
const isStructural = (ch: RowChange) =>
    ch.table === "measures" ||
    ((ch.table === "beats" || ch.table === "pages") &&
        (ch.kind !== "update" ||
            "position" in ch.set ||
            "start_beat" in ch.set));

const fieldsOf = (ch: RowChange): string[] => {
    const cols = Object.keys(
        ch.kind === "insert" ? ch.row : ch.kind === "update" ? ch.set : ch.prev,
    );
    return cols.map((c) => `${ch.table}:${ch.id}:${c}`);
};

interface Pending {
    op: Op;
    fields: Set<string>;
    structural: boolean;
}

class Connection {
    private ws: WebSocket | null = null;
    private killed = false;
    private retryMs = 500;
    private retryTimer: ReturnType<typeof setTimeout> | null = null;
    /** Last server seq applied to this file; -1 asks for a snapshot. */
    seq: number;
    private gridVersion = 1;
    private pending: Pending[] = [];
    private chain: Promise<void> = Promise.resolve();
    private welcomed: (() => void) | null = null;
    private failed: ((error: Error) => void) | null = null;

    constructor(
        readonly serverUrl: string,
        readonly sessionId: string,
        readonly user: SyncUser,
        private ownerToken: string | null,
        lastSeq: number,
        private idBase: number,
    ) {
        this.seq = lastSeq;
    }

    get live() {
        return useSyncStore.getState().state === "live";
    }

    /** The session the write path sees. */
    session() {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const self = this;
        return {
            isLive: () => self.live,
            onLocalOp: (op: LocalOp) => self.onLocalOp(op),
            get idBase() {
                return self.idBase;
            },
        };
    }

    /** Connects and resolves on the first `welcome` (rejects if the socket fails first). */
    connect(): Promise<void> {
        const ready = new Promise<void>((resolve, reject) => {
            this.welcomed = resolve;
            this.failed = reject;
        });
        this.open();
        return ready;
    }

    private open() {
        if (this.ws) return;
        this.killed = false;
        useSyncStore.setState({ state: "connecting" });
        const url = `${this.serverUrl.replace(/^http/, "ws")}/api/sessions/${this.sessionId}/ws`;
        const ws = new WebSocket(url);
        this.ws = ws;
        ws.onopen = () => {
            this.retryMs = 500;
            ws.send(
                JSON.stringify({
                    type: "hello",
                    user: this.user,
                    ownerToken: this.ownerToken ?? undefined,
                    lastSeq: this.seq,
                }),
            );
        };
        ws.onmessage = (e) => {
            const received = Date.now();
            const msg = JSON.parse(String(e.data)) as ServerMessage;
            this.enqueue(() => this.onMessage(msg, received));
        };
        ws.onclose = () => this.onClosed(ws);
        ws.onerror = () => {};
    }

    /** Runs message handlers and reverts one after another, in arrival order. */
    private enqueue(fn: () => Promise<void> | void) {
        this.chain = this.chain.then(fn).catch((error: unknown) => {
            console.error("Collaboration: a message failed to apply", error);
            useSyncStore.setState({ lastError: String(error) });
            notify({ kind: "error", message: String(error) });
        });
    }

    /** Waits until every queued message has been handled. */
    idle(): Promise<void> {
        return this.chain;
    }

    disconnect() {
        this.killed = true;
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.ws?.close();
    }

    reconnect() {
        this.killed = false;
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.open();
    }

    private onClosed(ws: WebSocket) {
        if (this.ws !== ws) return;
        this.ws = null;
        useSyncStore.setState({ state: "offline", people: [] });
        if (this.failed) {
            this.failed(new Error(`Could not connect to ${this.serverUrl}`));
            this.failed = this.welcomed = null;
        }
        // Online-only: edits the server never confirmed are undone, not queued
        this.enqueue(async () => {
            const dropped = this.pending.length;
            await this.revertAllPending();
            if (dropped > 0) notify({ kind: "dropped", count: dropped });
        });
        if (!this.killed) {
            this.retryTimer = setTimeout(() => {
                if (!this.killed && !this.ws) this.open();
            }, this.retryMs);
            this.retryMs = Math.min(this.retryMs * 2, 5000);
        }
    }

    /**
     * After a local edit commits (inside the write lock, so in commit order). Sends it, or, if the
     * socket went away while the edit ran, reverts it at once.
     */
    private onLocalOp({ label, changes }: LocalOp) {
        const structural = changes.some(isStructural);
        // The grid this op is computed on: the server's, moved on by our structural ops ahead of it
        const gridVersion =
            this.gridVersion + this.pending.filter((p) => p.structural).length;
        const op: Op = {
            opId: crypto.randomUUID(),
            baseSeq: this.seq,
            gridVersion,
            label,
            changes,
        };
        const entry: Pending = {
            op,
            fields: new Set(changes.flatMap(fieldsOf)),
            structural,
        };
        this.pending.push(entry);
        useSyncStore.setState({ pending: this.pending.length });
        record({ kind: "local", opId: op.opId, label, at: Date.now() });
        const ws = this.ws;
        if (this.live && ws?.readyState === WebSocket.OPEN)
            ws.send(JSON.stringify({ type: "op", op }));
        else this.enqueue(() => this.revert(entry));
    }

    private isPending = (table: string, id: number, col: string) => {
        const f = `${table}:${id}:${col}`;
        return this.pending.some((p) => p.fields.has(f));
    };

    /**
     * A skip callback for a remote write: a field with a pending local write keeps the local
     * value, and the remote value becomes the one to go back to if the local write is refused.
     */
    private shadowingSkip(changes: readonly RowChange[]) {
        const remote = new Map<string, unknown>();
        for (const ch of changes)
            if (ch.kind === "update")
                for (const [col, v] of Object.entries(ch.set))
                    remote.set(`${ch.table}:${ch.id}:${col}`, v);
        return (table: string, id: number, col: string) => {
            const f = `${table}:${id}:${col}`;
            const first = this.pending.find((p) => p.fields.has(f));
            if (!first) return false;
            if (remote.has(f))
                for (const c of first.op.changes)
                    if (
                        c.kind === "update" &&
                        c.table === table &&
                        c.id === id &&
                        col in c.prev
                    )
                        c.prev[col] = remote.get(f);
            return true;
        };
    }

    private async revert(entry: Pending) {
        this.pending = this.pending.filter((p) => p !== entry);
        useSyncStore.setState({ pending: this.pending.length });
        const result = await applyRemoteChanges(
            db,
            invertChanges(entry.op.changes),
            { skip: this.isPending },
        );
        invalidate(result);
        record({
            kind: "reverted",
            opId: entry.op.opId,
            label: entry.op.label,
            at: Date.now(),
        });
    }

    private async revertAllPending() {
        while (this.pending.length > 0)
            await this.revert(this.pending[this.pending.length - 1]);
    }

    private async onApplied(msg: AppliedMessage, received?: number) {
        if (msg.seq <= this.seq) return;
        this.gridVersion = msg.gridVersion;
        const mine = this.pending.find((p) => p.op.opId === msg.opId);
        if (mine) {
            // Our own op: the file already holds its values (the server's effective changes
            // carry the same values; LWW lets the latest write win), so nothing is written.
            this.pending = this.pending.filter((p) => p !== mine);
            useSyncStore.setState({ pending: this.pending.length });
            record({
                kind: "ack",
                opId: msg.opId,
                label: msg.label,
                at: Date.now(),
            });
        } else {
            const started = Date.now();
            const result = await applyRemoteChanges(db, msg.changes, {
                skip: this.shadowingSkip(msg.changes),
            });
            invalidate(result);
            record({
                kind: "remote",
                opId: msg.opId,
                label: msg.label,
                at: Date.now(),
                tables: [...result.tables],
                waitedMs:
                    received === undefined ? undefined : started - received,
                writeMs: Date.now() - started,
            });
        }
        this.seq = msg.seq;
        for (const conflict of msg.conflicts ?? [])
            notify({ kind: "conflict", conflict, by: msg.by, mine: !!mine });
    }

    private async onMessage(msg: ServerMessage, received?: number) {
        if (msg.type === "welcome") {
            useSyncStore.setState({ role: msg.you.role });
            this.idBase = msg.you.idBase;
            this.gridVersion = msg.gridVersion;
            if (msg.snapshot) {
                await stopCapture(db);
                const result = await replaceAllSyncedTables(db, msg.snapshot);
                await startCapture(db);
                invalidate(result, true);
                this.seq = msg.seq;
            } else {
                for (const op of msg.ops ?? []) await this.onApplied(op);
                this.seq = Math.max(this.seq, msg.seq);
            }
            this.gridVersion = msg.gridVersion;
            useSyncStore.setState({ state: "live", lastError: null });
            this.welcomed?.();
            this.welcomed = this.failed = null;
            return;
        }
        if (msg.type === "applied") return this.onApplied(msg, received);
        if (msg.type === "rejected") {
            const entry = this.pending.find((p) => p.op.opId === msg.opId);
            if (entry) await this.revert(entry);
            record({
                kind: "rejected",
                opId: msg.opId ?? "",
                label: entry?.op.label ?? "",
                at: Date.now(),
            });
            useSyncStore.setState({ lastError: `${msg.code}: ${msg.message}` });
            notify({
                kind: "rejected",
                code: msg.code,
                message: msg.message,
                label: entry?.op.label,
            });
            return;
        }
        if (msg.type === "people")
            useSyncStore.setState({ people: msg.people });
    }
}

let connection: Connection | null = null;

// ---------------------------------------------------------------------------------------------
// Session lifecycle

async function begin(
    serverUrl: string,
    sessionId: string,
    ownerToken: string | null,
    lastSeq: number,
): Promise<void> {
    connection = new Connection(
        serverUrl,
        sessionId,
        localUser(),
        ownerToken,
        lastSeq,
        0,
    );
    useSyncStore.setState({
        sessionId,
        serverUrl,
        state: "connecting",
        pending: 0,
        lastError: null,
    });
    // Not live until welcome: edits are refused meanwhile
    setSyncSession(connection.session());
    try {
        await connection.connect();
    } catch (error) {
        await endSession();
        throw error;
    }
}

/**
 * "Make collaborative": uploads this show's synced tables as a new session and joins it as its
 * owner. Resolves with the session id once live.
 */
export async function makeCollaborative(
    serverUrl = getSyncServerUrl(),
): Promise<{ sessionId: string }> {
    if (connection) throw new Error("This show is already in a session");
    // Refuse edits first, then wait for the ones in flight, so the snapshot and capture agree
    setSyncSession({ isLive: () => false, onLocalOp: () => {}, idBase: 0 });
    try {
        await withTimelineWriteLock(async () => {});
        await startCapture(db);
        const snapshot = await readSyncedSnapshot(db);
        const res = await fetch(`${serverUrl}/api/sessions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ snapshot }),
        });
        const body = (await res.json()) as {
            sessionId?: string;
            ownerToken?: string;
            error?: string;
        };
        if (!res.ok || !body.sessionId)
            throw new Error(body.error ?? `The server answered ${res.status}`);
        // The uploaded snapshot is seq 0; catching up from there needs no snapshot back
        await begin(serverUrl, body.sessionId, body.ownerToken ?? null, 0);
        return { sessionId: body.sessionId };
    } catch (error) {
        if (!connection) {
            setSyncSession(null);
            await stopCapture(db).catch(() => {});
        }
        throw error;
    }
}

/** Joins a session: this show's synced tables are replaced with the session's. */
export async function joinSession(
    sessionId: string,
    serverUrl = getSyncServerUrl(),
): Promise<void> {
    if (connection) throw new Error("This show is already in a session");
    // Capture starts after the snapshot is written (in the welcome handler)
    await begin(serverUrl, sessionId.trim(), null, -1);
}

/** Drops the socket on purpose: the show goes read-only until `reconnect`. */
export function disconnect(): void {
    connection?.disconnect();
}

export function reconnect(): void {
    connection?.reconnect();
}

/** Leaves the session: the show is solo again, with whatever it holds now. */
export async function endSession(): Promise<void> {
    const c = connection;
    connection = null;
    c?.disconnect();
    await c?.idle();
    setSyncSession(null);
    await stopCapture(db).catch(() => {});
    useSyncStore.setState({
        state: "none",
        role: null,
        sessionId: null,
        pending: 0,
        people: [],
    });
}

/** Resolves once every received message has been handled. */
export async function syncIdle(): Promise<void> {
    await connection?.idle();
}

/** The synced tables as they are in this file now (for tests comparing two windows). */
export function syncedSnapshot(): Promise<SyncSnapshot> {
    return readSyncedSnapshot(db);
}

export function syncSeq(): number {
    return connection?.seq ?? -1;
}
