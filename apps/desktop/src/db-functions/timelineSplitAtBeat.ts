import { asc, eq, inArray } from "drizzle-orm";
import { createResolver, type Resolver, type XY } from "@openmarch/core";
import { schema } from "@/global/database/db";
import { readTimelineTables } from "@/timeline/timelineRows";
import { beatWhere, countsText, moveName } from "@/timeline/timelineRangeWords";
import type { DbConnection, DbTransaction } from "./types";
import { transactionWithHistory } from "./history";
import { mapDbErrors, refuse } from "./timelineErrors";
import {
    createRangeTimelineInTransaction,
    readMoveWords,
} from "./timelineMoveNames";
import { findTimelineByRange, type DatabaseTimeline } from "./timelines";
import {
    createTimelineTransitionsInTransaction,
    deleteTimelineTransitionRowsInTransaction,
    type DatabaseTimelineTransition,
} from "./timelineTransitionsInTransaction";
import {
    createTimelineAssignmentsInTransaction,
    type DatabaseTimelineAssignment,
} from "./timelineAssignments";
import {
    keptAmong,
    markAssignmentsKeptInTransaction,
} from "./timelineKeptMarkers";

/**
 * **Split at playhead** (docs/timeline/ui.md UI-27): one move becomes two that meet at a count,
 * with every marcher where it was at that count. The split is in time, not by marcher: the
 * move's whole membership is in both halves.
 *
 * For a move (a timeline, C-11) over `[s, e)` and a whole count `s < beat < e`:
 *
 * - The move keeps its id, name, transitions and destinations, and now runs over `[beat, e)`:
 *   it is the half that still arrives where the move did. Its rows that crossed `beat` now start
 *   there; rows that ended at or before `beat` leave it, and a transition nobody takes any more
 *   goes with them.
 * - A new move ("Move N", or unnamed over a page's box) runs over `[s, beat)`. Each transition of
 *   the original gets a shapeless direct counterpart there whose destinations are the resolver's
 *   positions at `beat`, one slot per marcher in it, and the rows that started before `beat`
 *   (cut at `beat` where they crossed it), on their own layers. A kept row split in two is kept in
 *   both halves, as Basic's split leaves it (`splitMovesAtBeatInTransaction`).
 *
 * **Motion is unchanged for direct paths.** A direct span is a straight line at a constant speed
 * per beat over its progress (spec R-5, R-7), so the first half reaching the sampled point over
 * its own counts, and the second starting from it, trace what the whole did:
 * `lerp(A, lerp(A, B, p), b/p) = lerp(A, B, b)`. A row hidden at `beat` by another move on a
 * higher layer, or ending before it, gets the point its own span would have reached
 * (`extrapolateAlongChord`), which is exact too.
 *
 * **Any other path style is sampled** (project owner, 2026-10-19: arcs are deprecated and
 * pathways will be redone, so for now a path is a straight line). Before `beat` its marchers go
 * straight to where they were; from `beat` the transition keeps its style and parameters from
 * there. Those marchers are listed in `motionChanged` with the count their path changes from, for
 * the toast.
 *
 * Refused (`E-ARGS`) before any write: a beat that isn't whole or strictly inside the move, a
 * move that already runs over either half (one timeline per range, C-12), and a move with no row
 * before or none after the beat (the halves would be empty).
 */

export interface MotionChange {
    marcherId: number;
    /** The first count whose position differs from before the split */
    fromBeat: number;
}

export interface SplitTimelineResult {
    /** The new move, over `[start, beat)` */
    before: DatabaseTimeline;
    /** The original move, now over `[beat, end)` */
    after: DatabaseTimeline;
    /** Marchers whose motion isn't what it was, sorted by id */
    motionChanged: MotionChange[];
}

/** A first-half row with the point it heads for. */
interface FirstHalfRow {
    row: DatabaseTimelineAssignment;
    point: XY;
}

type Row = DatabaseTimelineAssignment;

/**
 * Where a straight move from `origin` that reaches `at` after a fraction `reached` of its counts
 * would be after a fraction `wanted` of them: `wanted / reached` of the way from `origin` to
 * `at`. Returns `at` when `reached` is 0 (nothing to extrapolate from).
 */
export function extrapolateAlongChord(
    origin: XY,
    at: XY,
    reached: number,
    wanted: number,
): XY {
    if (!(reached > 0)) return at;
    const t = wanted / reached;
    return [
        origin[0] + (at[0] - origin[0]) * t,
        origin[1] + (at[1] - origin[1]) * t,
    ];
}

/**
 * Splits timeline `timelineId` at `beat` as one undoable edit. See the module comment.
 */
export async function splitTimelineAtBeat({
    db,
    timelineId,
    beat,
}: {
    db: DbConnection;
    timelineId: number;
    beat: number;
}): Promise<SplitTimelineResult> {
    return await transactionWithHistory(db, "splitTimelineAtBeat", (tx) =>
        splitTimelineAtBeatInTransaction({ tx, timelineId, beat }),
    );
}

export async function splitTimelineAtBeatInTransaction({
    tx,
    timelineId,
    beat,
}: {
    tx: DbTransaction;
    timelineId: number;
    beat: number;
}): Promise<SplitTimelineResult> {
    const L = schema.timelines;
    const timeline = await tx
        .select()
        .from(L)
        .where(eq(L.id, timelineId))
        .get();
    if (!timeline) refuse(`timeline ${timelineId} does not exist`);
    const s0 = timeline.start_beat;
    const { transitions, rows } = await refuseUnlessSplitAllowed(
        tx,
        timeline,
        beat,
    );
    const kept = await keptAmong(
        tx,
        rows.map((r) => r.id),
    );

    // Where everyone is, from the rows as they are now: read before anything is written
    const resolver = createResolver((await readTimelineTables(tx)).snapshot);
    const changed = new Map<number, number>();
    const noteChange = (marcherId: number, fromBeat: number) => {
        const known = changed.get(marcherId);
        if (known === undefined || fromBeat < known)
            changed.set(marcherId, fromBeat);
    };

    const plans: TransitionPlan[] = transitions.map((t) => {
        const own = rows.filter((r) => r.transition_id === t.id);
        return {
            t,
            first: own
                .filter((r) => r.start_beat < beat)
                .map((row) => firstHalfOf(resolver, t, row, beat, noteChange)),
            anyAfter: own.some((r) => r.end_beat > beat),
        };
    });

    return await mapDbErrors(() =>
        writeSplit({ tx, timelineId, beat, s0, rows, plans, kept, changed }),
    );
}

/** One transition's part of a split: its first-half rows, and whether anyone stays after. */
interface TransitionPlan {
    t: DatabaseTimelineTransition;
    first: FirstHalfRow[];
    anyAfter: boolean;
}

/** The writes of a split, in the order the triggers want (see the module comment). */
async function writeSplit({
    tx,
    timelineId,
    beat,
    s0,
    rows,
    plans,
    kept,
    changed,
}: {
    tx: DbTransaction;
    timelineId: number;
    beat: number;
    s0: number;
    rows: readonly Row[];
    plans: readonly TransitionPlan[];
    kept: ReadonlySet<number>;
    changed: ReadonlyMap<number, number>;
}): Promise<SplitTimelineResult> {
    const L = schema.timelines;
    const T = schema.timeline_transitions;
    const A = schema.timeline_assignments;
    // 1. Rows ending at or before the beat leave the original (their kept markers go with
    //    them); rows crossing it now start there
    const leaving = rows.filter((r) => r.end_beat <= beat).map((r) => r.id);
    if (leaving.length > 0) await tx.delete(A).where(inArray(A.id, leaving));
    const crossing = rows
        .filter((r) => r.start_beat < beat && beat < r.end_beat)
        .map((r) => r.id);
    if (crossing.length > 0)
        await tx
            .update(A)
            .set({ start_beat: beat })
            .where(inArray(A.id, crossing));

    // 2. A transition nobody takes any more goes
    const emptied = new Set(
        plans.filter((p) => !p.anyAfter).map((p) => p.t.id),
    );
    if (emptied.size > 0)
        await deleteTimelineTransitionRowsInTransaction({
            tx,
            transitionIds: emptied,
        });

    // 3. The original now runs from the beat: its transitions first, then the timeline
    //    (the triggers want a transition inside its timeline, and no stranded row)
    await tx
        .update(T)
        .set({ start_beat: beat })
        .where(eq(T.timeline_id, timelineId));
    const after = await tx
        .update(L)
        .set({ start_beat: beat })
        .where(eq(L.id, timelineId))
        .returning()
        .get();

    const before = await writeBeforeMove(tx, { s0, beat, plans, kept });

    return {
        before,
        after: after!,
        motionChanged: [...changed]
            .map(([marcherId, fromBeat]) => ({ marcherId, fromBeat }))
            .sort((a, b) => a.marcherId - b.marcherId),
    };
}

/**
 * The move's transitions and rows, once the split is allowed: a whole beat strictly inside the
 * move, neither half taken by another timeline, and someone moving on each side of the beat.
 */
async function refuseUnlessSplitAllowed(
    tx: DbTransaction,
    timeline: DatabaseTimeline,
    beat: number,
): Promise<{ transitions: DatabaseTimelineTransition[]; rows: Row[] }> {
    const T = schema.timeline_transitions;
    const A = schema.timeline_assignments;
    const s0 = timeline.start_beat;
    const e0 = timeline.end_beat;
    const words = await readMoveWords(tx);
    const name = moveName({ start: s0, end: e0 }, words.boxes, words.moves);
    const where = beatWhere(beat, words.boxes) ?? `beat ${beat}`;
    if (!Number.isInteger(beat))
        refuse(`${name} can only be split on a whole count, not ${beat}`);
    if (!(s0 < beat && beat < e0))
        refuse(
            `${where} isn't inside ${name}. Put the playhead inside the move to split it.`,
        );
    for (const half of [
        { start: s0, end: beat },
        { start: beat, end: e0 },
    ]) {
        if (await findTimelineByRange(tx, half))
            refuse(
                `${moveName(half, words.boxes, words.moves)} already runs over ${countsText(half, words.boxes)}; there is one move per range`,
            );
    }

    const transitions = await tx
        .select()
        .from(T)
        .where(eq(T.timeline_id, timeline.id))
        .orderBy(asc(T.id))
        .all();
    const transitionIds = transitions.map((t) => t.id);
    const rows: Row[] =
        transitionIds.length === 0
            ? []
            : await tx
                  .select()
                  .from(A)
                  .where(inArray(A.transition_id, transitionIds))
                  .orderBy(asc(A.id))
                  .all();
    if (!rows.some((r) => r.start_beat < beat))
        refuse(
            `No one in ${name} moves before ${where}, so there is nothing to split off.`,
        );
    if (!rows.some((r) => r.end_beat > beat))
        refuse(
            `No one in ${name} moves after ${where}, so there is nothing to split off.`,
        );
    return { transitions, rows };
}

/** The new move over `[s0, beat)`: a shapeless direct transition per transition with rows there. */
async function writeBeforeMove(
    tx: DbTransaction,
    {
        s0,
        beat,
        plans,
        kept,
    }: {
        s0: number;
        beat: number;
        plans: readonly TransitionPlan[];
        kept: ReadonlySet<number>;
    },
): Promise<DatabaseTimeline> {
    // 4. The new move before the beat, with a shapeless direct transition per transition
    const before = await createRangeTimelineInTransaction(tx, {
        startBeat: s0,
        endBeat: beat,
    });
    for (const { t, first } of plans) {
        if (first.length === 0) continue;
        const [created] = await createTimelineTransitionsInTransaction({
            tx,
            newTransitions: [
                {
                    timelineId: before.id,
                    slotCount: first.length,
                    destination: {
                        kind: "individual",
                        points: first.map((f) => f.point),
                    },
                    pathStyle: "direct",
                    pathParams: null,
                    orderMode: t.order_mode as "inherit" | "slot",
                },
            ],
        });
        const made = await createTimelineAssignmentsInTransaction({
            tx,
            newAssignments: first.map((f, slot) => ({
                marcherId: f.row.marcher_id,
                transitionId: created!.id,
                slotIndex: slot,
                startBeat: f.row.start_beat,
                endBeat: Math.min(f.row.end_beat, beat),
                layer: f.row.layer,
            })),
        });
        await markAssignmentsKeptInTransaction(
            tx,
            made.filter((_, i) => kept.has(first[i]!.row.id)).map((a) => a.id),
        );
    }

    return before;
}

/** The visible pieces of `row` (spec R-2: an assignment cut by higher layers), in order. */
const piecesOf = (resolver: Resolver, row: Row) =>
    resolver
        .spanInfos(row.marcher_id)
        .filter((s) => s.assignmentId === row.id)
        .sort((a, b) => a.start - b.start);

/**
 * Where `row` heads in the first half: the marcher's position at `beat` when its row is what
 * shows there, else the point its own span would have reached by `beat` (`extrapolateAlongChord`;
 * exact for a direct span). Rows of any other path style are noted as changed, since a straight
 * line replaces their path before the beat.
 */
function firstHalfOf(
    resolver: Resolver,
    t: DatabaseTimelineTransition,
    row: Row,
    beat: number,
    noteChange: (marcherId: number, fromBeat: number) => void,
): FirstHalfRow {
    const m = row.marcher_id;
    const pieces = piecesOf(resolver, row);
    const through = pieces.find((p) => p.start < beat && beat <= p.end);
    if (through) {
        if (t.path_style !== "direct") noteChange(m, through.start);
        return { row, point: resolver.positionAt(m, beat) };
    }
    const last = [...pieces].reverse().find((p) => p.end <= beat);
    if (last) {
        if (t.path_style !== "direct") noteChange(m, last.start);
        const origin = resolver.explain(m, last.start).origin;
        return {
            row,
            point: extrapolateAlongChord(
                origin,
                resolver.positionAt(m, last.end),
                (last.end - last.start) / (t.end_beat - last.start),
                (beat - last.start) / (t.end_beat - last.start),
            ),
        };
    }
    // Hidden by another move until the beat or later: it never shows in the first half
    return { row, point: resolver.positionAt(m, beat) };
}
