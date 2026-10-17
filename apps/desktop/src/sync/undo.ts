/**
 * Per-user, selective undo in a collaboration session (docs/collaboration/REPORT.md §4.4), a port
 * of `prototypes/collaboration/public/client/app.js` ("per-user undo"):
 *
 * - The stack holds this user's **acknowledged** ops: the server's effective `changes` from
 *   `applied`, whose `prev` is what the server had. Never trigger SQL, never anyone else's edit.
 * - Undo builds the inverse field by field and keeps only the fields that still hold what this
 *   user wrote. A field someone changed since is left alone (the last writer of every field is
 *   tracked from every applied message), and the user is told who kept it.
 * - The inverse of an insert (a delete) is skipped if someone else edited the row since; the
 *   inverse of a delete puts the row back with the same id.
 * - A structural op (CONTRACT.md's grid rule) is all or nothing, and is refused once another
 *   member's beat-writing op has been applied after it: moves others wrote on the new grid would
 *   land over the wrong music.
 * - The inverse runs as an ordinary edit through `transactionWithHistory`, so it is captured and
 *   sent like any other and the server validates it. Redo is the inverse of the undo's op.
 *
 * Nothing here knows about marchers or timelines: every synced table goes through the same path.
 */
import { sql } from "drizzle-orm";
import type { ChangeBatch } from "@openmarch/core";
import {
    transactionWithHistory,
    withTimelineWriteLock,
} from "@/db-functions/history";
import { subscribeTimelineChanges } from "@/db-functions/timelineChanges";
import { timelineHistoryFocus } from "@/db-functions/timelineHistoryFocus";
import type { DbConnection, DbTransaction } from "@/db-functions/types";
import { tableNamesToQueryKeys } from "@/hooks/queries/utils";
import {
    invertChanges,
    readRowImage,
    writeChangesInTransaction,
} from "./apply";
import { SyncReadOnlyError, type SyncHistoryResponse } from "./session";
import { readSyncedTables, rowValue, type SyncedTable } from "./tables";
import type { RowChange, RowValues, SyncUser } from "./types";

// ---------------------------------------------------------------------------------------------
// What an op writes

/** Changes in `beats`/`pages`/`measures` that move the grid (the server's `isStructural`). */
export const isStructural = (ch: RowChange): boolean =>
    ch.table === "measures" ||
    ((ch.table === "beats" || ch.table === "pages") &&
        (ch.kind !== "update" ||
            "position" in ch.set ||
            "start_beat" in ch.set));

const TIMED_TABLES = new Set([
    "timelines",
    "timeline_transitions",
    "timeline_assignments",
]);

/** A change that depends on the beat grid: structural, or a timeline row's beats (CONTRACT.md). */
export const writesBeats = (ch: RowChange): boolean =>
    isStructural(ch) ||
    (TIMED_TABLES.has(ch.table) &&
        (ch.kind !== "update" ||
            "start_beat" in ch.set ||
            "end_beat" in ch.set));

/** The columns a change writes. */
export const columnsOf = (ch: RowChange): string[] =>
    Object.keys(
        ch.kind === "insert" ? ch.row : ch.kind === "update" ? ch.set : ch.prev,
    );

const fieldKey = (table: string, id: number, col: string) =>
    `${table}:${id}:${col}`;
const rowKey = (table: string, id: number) => `${table}:${id}`;

// ---------------------------------------------------------------------------------------------
// Planning (pure)

/** Timestamps every write touches: not worth telling anyone about */
const BOOKKEEPING = new Set(["created_at", "updated_at"]);

export interface UndoEntry {
    label: string;
    /** The server's effective changes for the op */
    changes: RowChange[];
    /** The op's server seq */
    seq: number;
}

export interface SkippedChange {
    table: string;
    id: number;
    col?: string;
    /** The last writer of the field (or the row's deleting user), when known */
    who: SyncUser | undefined;
    why: "changed" | "deleted";
}

export interface InversePlan {
    keep: RowChange[];
    skipped: SkippedChange[];
}

export interface PlanContext {
    /** The row as it is now, or undefined if there is none */
    current(table: string, id: number): RowValues | undefined;
    /** The last writer of a field (`col` "*" names a row's deleting user) */
    writer(table: string, id: number, col: string): SyncUser | undefined;
    /** Every synced column of a table */
    columns(table: string): readonly string[];
    meId: string;
}

/** Splits an op's inverse into what can still be undone and what someone has changed since. */
export function planInverse(
    changes: readonly RowChange[],
    ctx: PlanContext,
): InversePlan {
    const keep: RowChange[] = [];
    const skipped: SkippedChange[] = [];
    for (const inv of invertChanges(changes)) {
        const row = ctx.current(inv.table, inv.id);
        if (inv.kind === "update") {
            if (!row) {
                skipped.push({
                    table: inv.table,
                    id: inv.id,
                    who: ctx.writer(inv.table, inv.id, "*"),
                    why: "deleted",
                });
                continue;
            }
            const set: RowValues = {};
            const prev: RowValues = {};
            for (const [col, value] of Object.entries(inv.set)) {
                // `inv.prev[col]` is what I wrote; undo it only if it is still there
                if (row[col] === inv.prev[col]) {
                    set[col] = value;
                    prev[col] = row[col];
                } else
                    skipped.push({
                        table: inv.table,
                        id: inv.id,
                        col,
                        who: ctx.writer(inv.table, inv.id, col),
                        why: "changed",
                    });
            }
            // A row whose only remaining field is a timestamp has nothing left to undo
            if (Object.keys(set).some((c) => !BOOKKEEPING.has(c)))
                keep.push({ ...inv, set, prev });
        } else if (inv.kind === "delete") {
            // Undoing my insert: only if nobody else has edited the row since
            if (!row) continue;
            const other = ctx
                .columns(inv.table)
                .map((c) => ctx.writer(inv.table, inv.id, c))
                .find((w) => w && w.id !== ctx.meId);
            if (other)
                skipped.push({
                    table: inv.table,
                    id: inv.id,
                    who: other,
                    why: "changed",
                });
            else keep.push({ ...inv, prev: row });
        } else if (!row) {
            // Undoing my delete: the row comes back with the same id, unless someone already did
            keep.push(inv);
        }
    }
    return { keep, skipped };
}

/**
 * Orders an inverse so every statement leaves a state the timeline triggers accept (they check
 * each statement, not the commit): deletes first, children before parents; then updates, in the
 * inverse's order (the reverse of the op's); then inserts, parents before children. The timeline
 * tables have no delete triggers, so deleting first never trips one, and growing a transition's
 * range or slot count before its new assignments go in is what the insert triggers need.
 */
export function orderForTriggers(
    changes: readonly RowChange[],
    parentsFirst: readonly string[],
): RowChange[] {
    const rank = new Map(parentsFirst.map((t, i) => [t, i]));
    const r = (ch: RowChange) => rank.get(ch.table) ?? 0;
    const stable = (kind: RowChange["kind"], dir: 1 | -1) =>
        changes
            .map((ch, i) => ({ ch, i }))
            .filter(({ ch }) => ch.kind === kind)
            .sort((a, b) => dir * (r(a.ch) - r(b.ch)) || a.i - b.i)
            .map(({ ch }) => ch);
    return [
        ...stable("delete", -1),
        ...changes.filter((ch) => ch.kind === "update"),
        ...stable("insert", 1),
    ];
}

// ---------------------------------------------------------------------------------------------
// The stacks

export type UndoKind = "edit" | "undo" | "redo";

/** What the UI is told about an undo or redo (it shows toasts). */
export type UndoNotice =
    | {
          kind: "undo-partial";
          which: "undo" | "redo";
          label: string;
          names: string[];
      }
    | {
          kind: "undo-refused";
          which: "undo" | "redo";
          label: string;
          message: string;
      };

export interface UndoHost {
    db: DbConnection;
    me(): SyncUser;
    /** Resolves once every local op sent so far has been answered (or after a timeout) */
    settled(): Promise<void>;
    notify(notice: UndoNotice): void;
    /** The stacks changed (the toolbar's can-undo state) */
    changed(): void;
}

interface Tag {
    kind: UndoKind;
    label: string;
    /** For an undo or redo: the entry it came from, to put back if the server refuses it */
    source?: UndoEntry;
}

class UndoRefusal extends Error {}

const verbOf = (which: "undo" | "redo") => (which === "undo" ? "Undo" : "Redo");

/** The skipped changes worth reporting. */
const reported = (skipped: readonly SkippedChange[]) =>
    skipped.filter((s) => !s.col || !BOOKKEEPING.has(s.col));

const namesOf = (skipped: readonly SkippedChange[]) => [
    ...new Set(reported(skipped).map((s) => s.who?.name ?? "someone")),
];

const listNames = (names: readonly string[]) =>
    names.length <= 1
        ? (names[0] ?? "someone")
        : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

export class UserUndo {
    readonly undoStack: UndoEntry[] = [];
    readonly redoStack: UndoEntry[] = [];
    /** Last writer of every field, from every applied message; `col` "*" is a row's deleting user */
    private writers = new Map<string, SyncUser>();
    /** The seq of the latest beat-writing op by someone else */
    private othersBeatSeq = 0;
    /** Local ops sent and not yet answered, by op id */
    private inFlight = new Map<string, Tag>();
    /** Set by an undo or redo while its edit runs, so the op it produces is tagged with it */
    private nextTag: Tag | null = null;

    constructor(private host: UndoHost) {}

    length(type: "undo" | "redo"): number {
        return (type === "undo" ? this.undoStack : this.redoStack).length;
    }

    /** Forgets everything (a join replaced the show). */
    reset(): void {
        this.undoStack.length = 0;
        this.redoStack.length = 0;
        this.writers.clear();
        this.inFlight.clear();
        this.othersBeatSeq = 0;
        this.host.changed();
    }

    /** A local op was sent (or is about to be reverted): remember what it was. */
    tagLocal(opId: string, label: string): void {
        const tag =
            this.nextTag && this.nextTag.label === label
                ? this.nextTag
                : { kind: "edit" as const, label };
        this.nextTag = null;
        this.inFlight.set(opId, tag);
    }

    /** A local op the server refused, or one dropped on disconnect: its source goes back. */
    dropped(opId: string): void {
        const tag = this.inFlight.get(opId);
        this.inFlight.delete(opId);
        if (!tag?.source) return;
        (tag.kind === "undo" ? this.undoStack : this.redoStack).push(
            tag.source,
        );
        this.host.changed();
    }

    /** Every applied message, mine or not, in seq order. */
    applied(
        msg: {
            seq: number;
            opId: string;
            by: SyncUser;
            changes: RowChange[];
            label: string;
        },
        mine: boolean,
    ): void {
        for (const ch of msg.changes) {
            if (ch.kind === "delete") {
                this.writers.set(fieldKey(ch.table, ch.id, "*"), msg.by);
                continue;
            }
            for (const col of columnsOf(ch))
                this.writers.set(fieldKey(ch.table, ch.id, col), msg.by);
        }
        if (!mine) {
            if (msg.changes.some(writesBeats)) this.othersBeatSeq = msg.seq;
            return;
        }
        const tag = this.inFlight.get(msg.opId);
        this.inFlight.delete(msg.opId);
        if (!tag || msg.changes.length === 0) return;
        const entry: UndoEntry = {
            label: tag.source?.label ?? tag.label,
            changes: msg.changes,
            seq: msg.seq,
        };
        if (tag.kind === "undo") this.redoStack.push(entry);
        else {
            this.undoStack.push(entry);
            if (tag.kind === "edit") this.redoStack.length = 0;
        }
        this.host.changed();
    }

    /** `performHistoryAction` in a session. */
    // eslint-disable-next-line max-lines-per-function
    async run(
        which: "undo" | "redo",
        options: { currentPageId?: number },
    ): Promise<SyncHistoryResponse> {
        const none: SyncHistoryResponse = {
            pageIdToGoTo: undefined,
            marcherIdsToSelect: undefined,
            queriesToInvalidate: undefined,
        };
        // An edit just made is only on the stack once the server has confirmed it
        await this.host.settled();
        const stack = which === "undo" ? this.undoStack : this.redoStack;
        const entry = stack.pop();
        if (!entry) return { ...none, nothingToDo: true };
        this.host.changed();
        const verb = verbOf(which);
        const label = `${verb}: ${entry.label}`;
        const structural = entry.changes.some(isStructural);
        let plan: InversePlan | undefined;
        let batch: ChangeBatch | undefined;
        let mineRunning = false;
        const stopListening = subscribeTimelineChanges((event) => {
            if (mineRunning && event.kind === "batch") batch = event.batch;
            mineRunning = false;
        });
        let tables = new Set<string>();
        try {
            await transactionWithHistory(this.host.db, label, async (tx) => {
                const info = await readSyncedTables(tx);
                const byName = new Map(info.map((t) => [t.name, t]));
                plan = await this.planNow(tx, entry, byName);
                const { keep, skipped } = plan;
                const names = listNames(namesOf(skipped));
                if (structural && this.othersBeatSeq > entry.seq)
                    throw new UndoRefusal(
                        `Can't ${which} "${entry.label}": others have edited moves or pages since.`,
                    );
                if (structural && reported(skipped).length > 0)
                    throw new UndoRefusal(
                        `Can't ${which} "${entry.label}": ${names} changed the counts since.`,
                    );
                if (keep.length === 0)
                    throw new UndoRefusal(
                        `Nothing left to ${which} in "${entry.label}": ${names} changed all of it since.`,
                    );
                const ordered = orderForTriggers(
                    keep,
                    info.map((t) => t.name),
                );
                tables = await writeChangesInTransaction(tx, ordered);
                await this.refuseCascadesIntoOthersWork(tx, ordered);
                this.nextTag = { kind: which, label, source: entry };
                mineRunning = true;
            });
        } catch (error) {
            stack.push(entry);
            this.nextTag = null;
            this.host.changed();
            if (error instanceof UndoRefusal) {
                this.host.notify({
                    kind: "undo-refused",
                    which,
                    label: entry.label,
                    message: error.message,
                });
                return none;
            }
            // Offline: the session's read-only notice already told the user
            if (error instanceof SyncReadOnlyError) return none;
            return {
                ...none,
                failure: { kind: "error", message: String(error) },
            };
        } finally {
            stopListening();
            if (this.nextTag?.source === entry && !this.isInFlight(entry))
                this.nextTag = null;
        }
        if (plan && reported(plan.skipped).length > 0)
            this.host.notify({
                kind: "undo-partial",
                which,
                label: entry.label,
                names: namesOf(plan.skipped),
            });
        // Jump to what the undo touched, as solo undo does (P7.13)
        const focus = batch
            ? await withTimelineWriteLock(() =>
                  timelineHistoryFocus(this.host.db, batch!, {
                      currentPageId: options.currentPageId,
                      beatsChanged: tables.has("beats"),
                  }),
              )
            : undefined;
        return {
            pageIdToGoTo: focus?.pageIdToGoTo,
            marcherIdsToSelect: focus?.marcherIdsToSelect,
            queriesToInvalidate: tableNamesToQueryKeys(tables),
        };
    }

    private isInFlight(entry: UndoEntry) {
        for (const tag of this.inFlight.values())
            if (tag.source === entry) return true;
        return false;
    }

    /** The plan against the rows as they are in this transaction. */
    private async planNow(
        tx: DbTransaction,
        entry: UndoEntry,
        tables: Map<string, SyncedTable>,
    ): Promise<InversePlan> {
        const rows = new Map<string, RowValues | undefined>();
        for (const ch of entry.changes) {
            const table = tables.get(ch.table);
            if (!table) throw new Error(`${ch.table} is not a synced table`);
            rows.set(
                rowKey(ch.table, ch.id),
                await readRowImage(tx, table, ch.id),
            );
        }
        return planInverse(entry.changes, {
            current: (t, id) => rows.get(rowKey(t, id)),
            writer: (t, id, col) => this.writers.get(fieldKey(t, id, col)),
            columns: (t) => tables.get(t)?.columns.map((c) => c.name) ?? [],
            meId: this.host.me().id,
        });
    }

    /**
     * Deleting a row of mine can cascade (foreign keys) into rows someone else wrote, such as a
     * move a peer made for a marcher I added. The capture log already holds the cascade, so the
     * check is generic: any row the edit touched beyond the plan whose last writer is someone
     * else refuses the undo.
     */
    private async refuseCascadesIntoOthersWork(
        tx: DbTransaction,
        planned: readonly RowChange[],
    ) {
        const plannedRows = new Set(planned.map((c) => rowKey(c.table, c.id)));
        const logged = (await tx.all(
            sql.raw(`SELECT DISTINCT tbl, row_id FROM temp.sync_change_log`),
        )) as unknown[];
        const meId = this.host.me().id;
        const others = new Set<string>();
        for (const r of logged) {
            const table = String(rowValue(r, 0, "tbl"));
            const id = Number(rowValue(r, 1, "row_id"));
            if (plannedRows.has(rowKey(table, id))) continue;
            const prefix = `${table}:${id}:`;
            for (const [k, who] of this.writers)
                if (k.startsWith(prefix) && who.id !== meId)
                    others.add(who.name);
        }
        if (others.size > 0)
            throw new UndoRefusal(
                `Can't undo this: it would also remove what ${listNames([...others])} made since.`,
            );
    }
}

// ---------------------------------------------------------------------------------------------
// "Put mine back"

export interface LostValue {
    table: string;
    id: number;
    col: string;
    value: unknown;
}

/**
 * Writes the values an overwrite conflict took from this user back, as a new edit (so it is
 * captured, sent and validated like any other). Rows that are gone are skipped.
 */
export async function putValuesBack(
    db: DbConnection,
    lost: readonly LostValue[],
): Promise<void> {
    const changes: RowChange[] = [];
    const byRow = new Map<string, Extract<RowChange, { kind: "update" }>>();
    for (const l of lost) {
        const k = rowKey(l.table, l.id);
        let ch = byRow.get(k);
        if (!ch) {
            ch = {
                kind: "update",
                table: l.table,
                id: l.id,
                set: {},
                prev: {},
            };
            byRow.set(k, ch);
            changes.push(ch);
        }
        ch.set[l.col] = l.value;
    }
    await transactionWithHistory(db, "Put my change back", async (tx) => {
        await writeChangesInTransaction(tx, changes);
    });
}
