// Messages between a client and its show's Durable Object (JSON over one WebSocket).
//
// Client to server:
//   hello    { user: {id, name, color}, headToken?, lastSeq }
//   op       { op: Op }
//   presence { selection: number[], playhead: number, range: [a, b] | null, dragging: boolean }
//   claim    { section }            release { section }
//
// Server to client:
//   welcome  { you: {role, idBase}, seq, snapshot? | ops?, claims, people }
//   applied  { seq, opId, by: User, label, changes, conflicts, override? }
//   rejected { opId, code, message }
//   people   { people: Presence[] }
//   claims   { claims: Claim[] }

/**
 * @typedef {{kind: "insert", table: string, key: any, row: Record<string, any>}
 *   | {kind: "update", table: string, key: any, set: Record<string, any>, prev: Record<string, any>}
 *   | {kind: "delete", table: string, key: any, prev: Record<string, any>}} RowChange
 *
 * @typedef {{opId: string, baseSeq: number, gridVersion: number, label: string,
 *   override?: boolean, changes: RowChange[]}} Op
 */

/** Each member's insert ids come from its own block, so two clients never pick the same id. */
export const ID_BLOCK = 1_000_000_000;

export const REJECT = {
    CLAIMED: "CLAIMED",
    DELETED: "DELETED",
    STALE_GRID: "STALE_GRID",
    CONSTRAINT: "CONSTRAINT",
    NOT_ALLOWED: "NOT_ALLOWED",
    READ_ONLY: "READ_ONLY",
};

export function newOpId() {
    return crypto.randomUUID();
}
