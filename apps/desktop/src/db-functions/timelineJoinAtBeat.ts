import { and, eq, inArray } from "drizzle-orm";
import { schema } from "@/global/database/db";
import type { DbTransaction } from "./types";
import { readPageGrid } from "./timelineRipple";
import { fitMoveInTransaction } from "./timelineSplitMoves";
import { deleteTimelinesInTransaction } from "./timelines";

/**
 * **Remove keyframe joins the halves after a split** (holds README decision 14, #470). When
 * Remove keyframe takes away a move's end and the marcher's next move starts on that same count,
 * the two moves become one again, so the marcher walks the original path at even speed instead of
 * standing still and then going at double speed (#362 Repro, question 14). In practice that is
 * right after Split at playhead.
 *
 * Remove keyframe deletes the rows ending on the count as it always has. The join then fits the
 * move after the count back over the removed move's counts, as a merge fits a move (UI-25,
 * `fitMoveInTransaction`): its rows that started on the count start where the removed move did,
 * and its destinations, paths and shape recipes stay. After a split that is the move as it was.
 *
 * It joins only:
 *
 * - at a count that isn't a page flag (review, semantics M1): at a flag Remove behaves as before,
 *   and the page follows the page before;
 * - when the whole membership was removed (#470): nobody is left in the removed move, and every marcher
 *   starting the next move on the count was in it. Joining part of a group would mean taking
 *   marchers out of both halves first (#471, which pulls them into a move of their own and then
 *   removes there, so this step runs on their own moves);
 * - when the fit is allowed (`fitMoveInTransaction`); otherwise those marchers keep the plain
 *   Remove.
 *
 * Joining never changes anyone's membership: the move after the count keeps its marchers, so
 * shape and follow-the-leader members (holds ownership, owner 2026-10-30) join like the others.
 */

/** A move end Remove keyframe takes away: a row ending on the count, and its move's counts. */
export interface RemovedMoveEnd {
    readonly marcherId: number;
    /** Where the row started */
    readonly start: number;
    readonly timelineId: number;
    readonly timelineStart: number;
    readonly timelineEnd: number;
}

/** The move ends of assignment rows `assignmentIds`, read before Remove deletes them. */
export async function readMoveEnds(
    tx: DbTransaction,
    assignmentIds: readonly number[],
): Promise<RemovedMoveEnd[]> {
    if (assignmentIds.length === 0) return [];
    const A = schema.timeline_assignments;
    const T = schema.timeline_transitions;
    const L = schema.timelines;
    return await tx
        .select({
            marcherId: A.marcher_id,
            start: A.start_beat,
            timelineId: L.id,
            timelineStart: L.start_beat,
            timelineEnd: L.end_beat,
        })
        .from(A)
        .innerJoin(T, eq(T.id, A.transition_id))
        .innerJoin(L, eq(L.id, T.timeline_id))
        .where(inArray(A.id, [...assignmentIds]))
        .all();
}

/**
 * Joins the moves that start on `beat` back over the counts of the removed moves that ended there
 * (see the module comment), once Remove has deleted `ends` (`readMoveEnds`, read before). Returns
 * the marchers that walk a joined move, ascending.
 */
export async function joinMovesAtInTransaction({
    tx,
    beat,
    ends,
}: {
    tx: DbTransaction;
    beat: number;
    ends: readonly RemovedMoveEnd[];
}): Promise<number[]> {
    if (ends.length === 0) return [];
    const grid = await readPageGrid(tx);
    if (grid.pages.some((p) => p.start === beat)) return [];

    const byMove = new Map<number, RemovedMoveEnd[]>();
    for (const end of ends) {
        const list = byMove.get(end.timelineId) ?? [];
        list.push(end);
        byMove.set(end.timelineId, list);
    }
    const joined: number[] = [];
    for (const [removedId, its] of byMove) {
        const { timelineStart, timelineEnd } = its[0]!;
        // The removed move ended on the count, every row of it ran from its start, and nobody is
        // left in it (the whole membership was selected), though it may be left empty
        if (timelineEnd !== beat) continue;
        if (its.some((e) => e.start !== timelineStart)) continue;
        if (await hasMembers(tx, removedId)) continue;
        const removed = new Set(its.map((e) => e.marcherId));
        for (const [nextId, starting] of await movesStartingAt(
            tx,
            beat,
            removed,
        )) {
            if (starting.some((id) => !removed.has(id))) continue;
            const end = (await timelineEndOf(tx, nextId))!;
            const why = await fitMoveInTransaction({
                tx,
                sourceId: nextId,
                target: {
                    id: removedId,
                    start_beat: timelineStart,
                    end_beat: end,
                },
            });
            if (why !== null) continue;
            joined.push(...starting);
            // The removed move is one with the next now. Remove may have left it, emptied, with
            // a vacant slot in a shared transition (D-13)
            await deleteTimelinesInTransaction({
                tx,
                timelineIds: new Set([removedId]),
            });
        }
    }
    return [...new Set(joined)].sort((a, b) => a - b);
}

/** Whether move `timelineId` still exists with a marcher in it. */
const hasMembers = async (tx: DbTransaction, timelineId: number) =>
    (await tx
        .select({ id: schema.timeline_assignments.id })
        .from(schema.timeline_assignments)
        .innerJoin(
            schema.timeline_transitions,
            eq(
                schema.timeline_transitions.id,
                schema.timeline_assignments.transition_id,
            ),
        )
        .where(eq(schema.timeline_transitions.timeline_id, timelineId))
        .limit(1)
        .get()) !== undefined;

const timelineEndOf = async (tx: DbTransaction, id: number) =>
    (
        await tx
            .select({ end: schema.timelines.end_beat })
            .from(schema.timelines)
            .where(eq(schema.timelines.id, id))
            .get()
    )?.end;

/**
 * The moves starting on `beat` that one of `marcherIds` starts a row of on it, each with every
 * marcher that starts a row of it on `beat`.
 */
async function movesStartingAt(
    tx: DbTransaction,
    beat: number,
    marcherIds: ReadonlySet<number>,
): Promise<Map<number, number[]>> {
    const A = schema.timeline_assignments;
    const T = schema.timeline_transitions;
    const L = schema.timelines;
    const rows = await tx
        .select({ marcherId: A.marcher_id, timelineId: L.id })
        .from(A)
        .innerJoin(T, eq(T.id, A.transition_id))
        .innerJoin(L, eq(L.id, T.timeline_id))
        .where(and(eq(L.start_beat, beat), eq(A.start_beat, beat)))
        .all();
    const out = new Map<number, number[]>();
    for (const r of rows) {
        const list = out.get(r.timelineId) ?? [];
        list.push(r.marcherId);
        out.set(r.timelineId, list);
    }
    for (const [id, list] of out)
        if (!list.some((m) => marcherIds.has(m))) out.delete(id);
    return out;
}
