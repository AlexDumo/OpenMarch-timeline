/**
 * The active collaboration session, as the write path sees it.
 *
 * Kept free of imports, so the database functions can read it without loading the connection
 * code. With no session set, nothing about a write changes: `transactionWithHistory` only checks
 * `getSyncSession()`.
 */
import type { LocalOp } from "./types";

export interface SyncSession {
    /** Whether edits are allowed now (`live`); false while connecting or offline */
    isLive(): boolean;
    /**
     * Called after each local edit commits, in commit order, while the write lock is still held.
     * Rolled-back edits and edits that changed no synced row are never passed.
     */
    onLocalOp(op: LocalOp): void;
    /** This member's id block start (`memberIndex * 2 ** 40`, from `welcome`) */
    idBase: number;
    /**
     * Per-user undo and redo (WP-D): `performHistoryAction` hands the action here instead of
     * replaying `history_undo`, whose whole-row inverses would revert other people's columns.
     * A session without it refuses undo with `SyncUndoUnavailableError`.
     */
    historyAction?(
        type: "undo" | "redo",
        options: { currentPageId?: number },
    ): Promise<SyncHistoryResponse>;
    /** How many of this user's ops can be undone (or redone) now, for the toolbar buttons */
    historyStackLength?(type: "undo" | "redo"): number;
    /** An edit was refused because the session is not live (before `SyncReadOnlyError` is thrown) */
    onRefused?(label: string): void;
}

/** `performHistoryAction`'s response, as a session's per-user undo returns it. */
export interface SyncHistoryResponse {
    pageIdToGoTo: number | undefined;
    marcherIdsToSelect: Set<number> | undefined;
    queriesToInvalidate: string[][] | undefined;
    nothingToDo?: boolean;
    failure?: { kind: "error"; message: string };
}

/** The size of each member's id block. */
export const ID_BLOCK_SIZE = 2 ** 40;

let current: SyncSession | null = null;

/** Sets (or, with null, clears) the active session. */
export function setSyncSession(session: SyncSession | null): void {
    current = session;
}

export function getSyncSession(): SyncSession | null {
    return current;
}

/** An edit was refused because the session is not live (connecting or offline). */
export class SyncReadOnlyError extends Error {
    readonly code = "SYNC_READ_ONLY";
    constructor(readonly label: string) {
        super(
            `"${label}" was not run: the show is read-only until the session reconnects`,
        );
        this.name = "SyncReadOnlyError";
    }
}

/**
 * Built-in undo and redo were refused because a session is active: the raw `history_undo` replay
 * never runs in a session (per-user undo replaces `performHistoryAction` there).
 */
export class SyncUndoUnavailableError extends Error {
    readonly code = "SYNC_UNDO_UNAVAILABLE";
    constructor(readonly action: "undo" | "redo") {
        super(`${action} is not available in a collaboration session yet`);
        this.name = "SyncUndoUnavailableError";
    }
}
