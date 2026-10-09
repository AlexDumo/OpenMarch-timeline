import { schema } from "@/global/database/db";
import { assignmentFromRow } from "@/timeline/timelineRows";
import {
    keptStatesForSelection,
    type KeptPageBox,
    type KeptState,
    type KeptStatesOnBox,
} from "@/timeline/timelineKept";
import type { DbConnection, DbTransaction } from "./types";
import { transactionWithHistory } from "./history";
import { refuse } from "./timelineErrors";
import { addMarchersToTimelineInTransaction } from "./timelineMembership";
import { readPageGrid } from "./timelineRipple";
import { clearOwnPageMoves, isPageBox, ownPageMoves } from "./timelineMoves";
import {
    markAssignmentsKeptInTransaction,
    readKeptAssignmentIds,
} from "./timelineKeptMarkers";

/**
 * **Keep** and **Follow again** on a later page, in timeline mode (keep later pages,
 * defined-coordinates 10, owner decision 2026-10-09; ADR 0001 amendment 2026-10-09).
 *
 * A page box where a marcher has no move follows the page it last moved on (UI-18): an edit of
 * that page carries into it. **Keep** stops that for the given marchers: each gets its own
 * zero-motion move over the box (a one-slot shapeless transition, C-11, ending where it stands
 * there), and that assignment is marked kept (`timeline_kept_assignments`), so the file tells the
 * designer's kept spot apart from a move that happens to go nowhere. **Follow again** deletes the
 * kept move and its marker. Each command is one undo step; one that would write nothing opens no
 * edit.
 *
 * Moves are decided as elsewhere (`timelineMoves.ts`): an edit that moves a kept spot's ending
 * makes it an ordinary own move, a drag back never clears a kept spot, and the page deletes take
 * kept moves like any other page move, the marker with them.
 */

/** Why a marcher wasn't kept or followed again: its state on the box (`KeptState`). */
export interface KeepSkip {
    marcherId: number;
    state: KeptState;
}

/** What **Keep** or **Follow again** did, marcher ids ascending. */
export interface KeepResult {
    /** The marchers kept (Keep) or following again (Follow again) */
    changed: number[];
    /** The others, with why */
    skipped: KeepSkip[];
}

/** Thrown inside an edit that turned out to write nothing, so it rolls back with no undo step. */
class NothingToDo extends Error {
    constructor(readonly result: KeepResult) {
        super("nothing to keep or follow");
    }
}

const refuseUnlessPageBox = async (tx: DbTransaction, box: KeptPageBox) => {
    if (!isPageBox(await readPageGrid(tx), box))
        refuse(
            `beats ${box.start}–${box.end} aren't a page, so there's nothing to keep there`,
        );
};

/** The asked marchers' states on `box`, read in `db`. */
const statesOnBox = async (
    db: DbConnection | DbTransaction,
    box: KeptPageBox,
    marcherIds: readonly number[],
): Promise<Map<number, KeptState>> =>
    (await keptStatesOnPageBoxes({ db, pageBoxes: [box], marcherIds }))[0]!
        .states;

const ascending = (ids: Iterable<number>) => [...ids].sort((a, b) => a - b);

/** Runs `edit` as one undoable edit, or none when it throws `NothingToDo`. */
const asOneEdit = async (
    db: DbConnection,
    name: string,
    edit: (tx: DbTransaction) => Promise<KeepResult>,
): Promise<KeepResult> => {
    try {
        return await transactionWithHistory(db, name, edit);
    } catch (e) {
        if (e instanceof NothingToDo) return e.result;
        throw e;
    }
};

/**
 * **Keep**: each of `marcherIds` that follows on the page box `pageBox` (no row over any of its
 * beats) gets its own zero-motion move over the box, at where it stands there, marked kept.
 * Marchers already kept, with their own move there, or partway through a longer move at one of
 * the box's flags are skipped. Refused (E-ARGS) when `pageBox` isn't a page's box, or a marcher
 * doesn't exist. Nobody to keep writes nothing and adds no undo step.
 */
export async function keepMarchersOnPage({
    db,
    pageBox,
    marcherIds,
}: {
    db: DbConnection;
    pageBox: KeptPageBox;
    marcherIds: readonly number[];
}): Promise<KeepResult> {
    if (marcherIds.length === 0) return { changed: [], skipped: [] };
    return await asOneEdit(db, "keepMarchersOnPage", async (tx) => {
        await refuseUnlessPageBox(tx, pageBox);
        const states = await statesOnBox(tx, pageBox, marcherIds);
        const toKeep = ascending(
            [...states].filter(([, s]) => s === "follows").map(([id]) => id),
        );
        const result: KeepResult = {
            changed: toKeep,
            skipped: ascending(states.keys())
                .filter((id) => states.get(id) !== "follows")
                .map((marcherId) => ({
                    marcherId,
                    state: states.get(marcherId)!,
                })),
        };
        if (toKeep.length === 0) throw new NothingToDo(result);
        // Each one holds through the box, so the add's destination (where it is at the box's
        // end) is where it stands at the box's start: a move that goes nowhere
        const { added } = await addMarchersToTimelineInTransaction({
            tx,
            range: pageBox,
            marcherIds: toKeep,
        });
        await markAssignmentsKeptInTransaction(
            tx,
            added.map((o) => o.assignmentId),
        );
        return result;
    });
}

/**
 * **Follow again**: deletes each of `marcherIds`' kept move over the page box `pageBox` with its
 * marker, and the move's timeline when that leaves it empty (children first, C-1), so the page
 * follows earlier pages again. The others (following already, their own move, partway through a
 * move) are skipped. Refused (E-ARGS) when `pageBox` isn't a page's box. Nobody kept writes
 * nothing and adds no undo step.
 */
export async function followAgainOnPage({
    db,
    pageBox,
    marcherIds,
}: {
    db: DbConnection;
    pageBox: KeptPageBox;
    marcherIds: readonly number[];
}): Promise<KeepResult> {
    if (marcherIds.length === 0) return { changed: [], skipped: [] };
    return await asOneEdit(db, "followAgainOnPage", async (tx) => {
        await refuseUnlessPageBox(tx, pageBox);
        const states = await statesOnBox(tx, pageBox, marcherIds);
        const keptIds = ascending(
            [...states].filter(([, s]) => s === "kept").map(([id]) => id),
        );
        const result: KeepResult = {
            changed: keptIds,
            skipped: ascending(states.keys())
                .filter((id) => states.get(id) !== "kept")
                .map((marcherId) => ({
                    marcherId,
                    state: states.get(marcherId)!,
                })),
        };
        // A kept move is the marcher's own page move (`ownPageMoves`), as Keep wrote it
        const own = await ownPageMoves(
            tx,
            await readPageGrid(tx),
            pageBox,
            keptIds,
        );
        result.changed = ascending(own.keys());
        if (own.size === 0) throw new NothingToDo(result);
        await clearOwnPageMoves(tx, [...own.values()]);
        return result;
    });
}

/**
 * Each of `marcherIds`' state on each of `pageBoxes` (`keptStatesForSelection`), read from the
 * stored rows: for the chains on the page boxes and the inspector line. The renderer can call the
 * pure helper over its own snapshot instead, with `readKeptAssignmentIds`.
 */
export async function keptStatesOnPageBoxes({
    db,
    pageBoxes,
    marcherIds,
}: {
    db: DbConnection | DbTransaction;
    pageBoxes: readonly KeptPageBox[];
    marcherIds: readonly number[];
}): Promise<KeptStatesOnBox[]> {
    const rows = await db.select().from(schema.timeline_assignments).all();
    return keptStatesForSelection({
        assignments: rows.map(assignmentFromRow),
        kept: await readKeptAssignmentIds(db),
        boxes: pageBoxes,
        marcherIds,
    });
}
