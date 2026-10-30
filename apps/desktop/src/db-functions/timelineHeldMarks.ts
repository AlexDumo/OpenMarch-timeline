import { and, desc, eq, inArray } from "drizzle-orm";
import { schema } from "@/global/database/db";
import type { DbConnection, DbTransaction } from "./types";

/**
 * **Held** holds (holds README decisions 2 and 4; ADR 0001 amendment 2026-10-30): a stored mark
 * (`timeline_held_marks`) over a stretch where one marcher has no move, meaning "stand still here
 * on purpose". The resolver never reads it: the marcher holds there anyway (spec R-6). It changes
 * only how an edit inside it is routed, and what the timeline draws.
 *
 * A mark runs over `[start, end)` in spec beats. A count `c` is **inside** it when
 * `start < c <= end`: the marcher stands there at every such count, and at `start` it is still
 * arriving. No move of the marcher overlaps a mark (H-1) and one marcher's marks don't overlap
 * (H-3); the commit check (`timeline_held_violations`) rejects an edit that breaks either.
 */

/** One Held mark. */
export interface HeldMark {
    readonly id: number;
    readonly marcherId: number;
    /** Where the hold starts: the arrival, a count the marcher has a move ending at */
    readonly start: number;
    /** Where it ends; the marcher may move again from here */
    readonly end: number;
}

const toMark = (row: typeof schema.timeline_held_marks.$inferSelect) => ({
    id: row.id,
    marcherId: row.marcher_id,
    start: row.start_beat,
    end: row.end_beat,
});

/** Every Held mark, or only `marcherIds`' ones, by marcher and start. */
export async function readHeldMarks(
    db: DbConnection | DbTransaction,
    marcherIds?: readonly number[],
): Promise<HeldMark[]> {
    if (marcherIds && marcherIds.length === 0) return [];
    const h = schema.timeline_held_marks;
    const rows = await db
        .select()
        .from(h)
        .where(marcherIds ? inArray(h.marcher_id, [...marcherIds]) : undefined)
        .orderBy(h.marcher_id, h.start_beat)
        .all();
    return rows.map(toMark);
}

/** Whether the count `beat` is inside `mark` (`start < beat <= end`). */
export const isInsideHeldMark = (mark: HeldMark, beat: number): boolean =>
    mark.start < beat && beat <= mark.end;

/** A Held marcher's edit, routed to the move that arrives at its hold's start (decision 4). */
export interface HeldArrivalEdit<M extends { marcherId: number }> {
    readonly move: M;
    readonly mark: HeldMark;
    /** The move (timeline) whose end is the hold's start */
    readonly timelineId: number;
}

/**
 * Splits an edit at the count `beat` into the moved marchers that are Held there and the rest.
 *
 * A Held marcher's edit is the edit of the move that arrives at its hold's start: the row of the
 * marcher ending there (the highest layer, should there be several), whose timeline ends there
 * too, so setting that move's ending moves the arrival and the whole hold with it. A marcher Held
 * at `beat` with no such move (a borrowed hold, which only #474 makes) stays with the rest.
 */
export async function splitHeldEditsInTransaction<
    M extends { marcherId: number },
>(
    tx: DbTransaction,
    beat: number,
    moves: readonly M[],
): Promise<{ held: HeldArrivalEdit<M>[]; rest: M[] }> {
    const marks = (
        await readHeldMarks(
            tx,
            moves.map((m) => m.marcherId),
        )
    ).filter((mark) => isInsideHeldMark(mark, beat));
    if (marks.length === 0) return { held: [], rest: [...moves] };
    const markOf = new Map(marks.map((mark) => [mark.marcherId, mark]));
    const held: HeldArrivalEdit<M>[] = [];
    const rest: M[] = [];
    for (const move of moves) {
        const mark = markOf.get(move.marcherId);
        const timelineId = mark
            ? await arrivalTimeline(tx, mark.marcherId, mark.start)
            : null;
        if (mark && timelineId !== null) held.push({ move, mark, timelineId });
        else rest.push(move);
    }
    return { held, rest };
}

/** The move of `marcherId` that arrives at `beat` and ends there, if there is one. */
async function arrivalTimeline(
    tx: DbTransaction,
    marcherId: number,
    beat: number,
): Promise<number | null> {
    const a = schema.timeline_assignments;
    const t = schema.timeline_transitions;
    const row = await tx
        .select({ timelineId: t.timeline_id, transitionEnd: t.end_beat })
        .from(a)
        .innerJoin(t, eq(t.id, a.transition_id))
        .where(and(eq(a.marcher_id, marcherId), eq(a.end_beat, beat)))
        .orderBy(desc(a.layer))
        .get();
    return row && row.transitionEnd === beat ? row.timelineId : null;
}
