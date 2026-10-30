import { and, asc, eq, gt, inArray, lt } from "drizzle-orm";
import { schema } from "@/global/database/db";
import { TimelineEditRefusedError } from "@/timeline/timelineEditRefusals";
import { joinList } from "@/timeline/timelineRangeWords";
import type { DbTransaction } from "./types";
import type { DatabaseTimelineAssignment } from "./timelineAssignments";
import { marcherLabels, type BeatRange } from "./timelineMembership";
import {
    splitTimelineAtBeatInTransaction,
    type SplitIdKeeper,
    type SplitTimelineResult,
} from "./timelineSplitAtBeat";
import { hasShapeRecipes } from "./shapeRecipes";
import { setTimelineTransitionDestinationInTransaction } from "./timelineTransitionsInTransaction";
import { timelinesWithRange } from "./timelines";
import { clearOwnPageMoves, sampleShape } from "./timelineMoveHelpers";

/**
 * Cut and remove: the two move operations the holds commands share (holds spec,
 * docs/timeline/research/holds/, decision 16; ADR 0001, amendment of 2026-10-30). Every holds
 * command that takes a marcher out of some counts goes through them, so they stay one seam.
 * Joining moves back together is #470's `timelineJoinAtBeat.ts`.
 *
 * 1. **Cut a move in time at a count** (`cutMoveAtBeatInTransaction`): Split at playhead's split
 *    (`splitTimelineAtBeatInTransaction`, UI-27), the whole membership in both parts, with motion
 *    unchanged for direct paths. A part may land on a range another move already has, as a split
 *    by marcher may (UI-25), so a cut at a page's flags can make a move over exactly the page box.
 *    The original move keeps its id as the part after the count, unless that part would take over
 *    a page's move (it would be the oldest over a range a newer move has: a page's own move is the
 *    oldest over its box). Then the part before keeps the id, or neither does (the original goes)
 *    when that part would take one over too (`SplitIdKeeper`). The transitions after the count,
 *    and any shape recipe (#363), stay with the part after it. A count not strictly inside the
 *    move, or one with nobody moving on a side of it, needs no cut: nothing is written.
 * 2. **Remove marchers from a move for a range of counts**
 *    (`removeMarchersFromMoveForRangeInTransaction`): the move is cut at the range's ends where one
 *    of the marchers' rows crosses them, then the marchers leave the piece over the range. Their
 *    slots in a shared transition are compacted, a transition they empty is deleted, and so is a
 *    move they empty (`clearOwnPageMoves` with `tidyShared`, as Basic's Set to previous page).
 *    Their motion outside the range is unchanged; after it, they walk from wherever they now are.
 *
 * **Shape and follow-the-leader members stay** (owner, 2026-10-30, holds README decisions 6–14,
 * interim until fork #504): a marcher in a shape recipe of the move (#363), or whose row is in a
 * follow-the-leader transition, is left in it and reported in `skipped` with the reason. The
 * others are still removed. `skippedRefusal` words them for the toast. A transition into a stored
 * shape (Q-14, no recipe) is switched to individual points first, as a canvas move switches it,
 * so the marchers who stay keep their spots.
 *
 * **Preview:** `planRemovalFromRange` changes nothing and says what a removal would do: who would
 * be refused and why, who would leave, and the cuts. The write functions carry out its plan, so a
 * command's preview and its write can't disagree.
 *
 * The writes run inside the caller's edit (`transactionWithHistory`), so the command is one undo
 * step.
 */

/** Why a marcher can't be taken out of its move. */
export type MoveMemberSkipReason = "shape" | "followTheLeader";

/** A marcher left in its move, with why. */
export interface MoveMemberSkip {
    marcherId: number;
    timelineId: number;
    reason: MoveMemberSkipReason;
}

/** A cut a removal makes, as planned before any write. */
export interface PlannedCut {
    /** The stored move the cut's piece comes from (as it is before the removal) */
    timelineId: number;
    beat: number;
    /** Which part keeps the id of the piece being cut (`SplitIdKeeper`) */
    idStaysWith: SplitIdKeeper;
}

/** What removing marchers from one move over a range would do. */
export interface MoveRemovalPlan {
    timelineId: number;
    /** The marchers that would leave, ascending */
    removed: number[];
    /** The cuts, in order: at the range's start, then at its end */
    cuts: PlannedCut[];
}

/** What a removal would do (`planRemovalFromRange`), marcher ids ascending. */
export interface RemovalPlan {
    /** The marchers that would be taken out */
    removed: number[];
    /** The marchers that would be left in, one entry each, with why */
    skipped: MoveMemberSkip[];
    /** Per move they'd leave, by move id */
    moves: MoveRemovalPlan[];
}

/** The piece of a move marchers were removed from. */
export interface RemovedFromPiece {
    /** The stored move the piece comes from (as it was before the removal) */
    timelineId: number;
    /** The piece over the range, the move itself when it needed no cut */
    pieceId: number;
    /** Whether the removal emptied the piece, so it was deleted */
    deleted: boolean;
}

/** What a removal did, marcher ids ascending. */
export interface RemoveFromRangeResult {
    /** The marchers taken out of the range */
    removed: number[];
    /** The marchers left in, one entry each */
    skipped: MoveMemberSkip[];
    /** The cuts made, in order */
    cuts: SplitTimelineResult[];
    /** The pieces they were removed from, one per move, by move id */
    pieces: RemovedFromPiece[];
}

const ascending = (ids: Iterable<number>) =>
    [...new Set(ids)].sort((a, b) => a - b);

/** A stored move's id and range. */
interface MoveSpan {
    id: number;
    start: number;
    end: number;
}

/**
 * Whether move `id` would take over the move of `range` if it ran over it: some other move has the
 * range and all of them are newer, so `id` would be the oldest there, which is what makes a page
 * box's move the page's own (`timelinesWithRange(...)[0]`).
 */
async function wouldTakeOver(
    tx: DbTransaction,
    id: number,
    range: BeatRange,
): Promise<boolean> {
    const oldest = (await timelinesWithRange(tx, range)).find(
        (l) => l.id !== id,
    );
    return oldest !== undefined && oldest.id > id;
}

/** Which part of `move` cut at `beat` keeps its id (see the module comment). */
async function idKeeperFor(
    tx: DbTransaction,
    move: MoveSpan,
    beat: number,
): Promise<SplitIdKeeper> {
    if (!(await wouldTakeOver(tx, move.id, { start: beat, end: move.end })))
        return "after";
    return (await wouldTakeOver(tx, move.id, { start: move.start, end: beat }))
        ? "neither"
        : "before";
}

/**
 * **Cut a move in time at a count**: move `timelineId` becomes two meeting at `beat` (see the
 * module comment). Returns the split, or `null` when no cut is needed (`beat` isn't strictly
 * inside the move, or nobody in it moves before or after `beat`). Refused (E-ARGS) for a missing
 * move or a beat that isn't whole.
 */
export async function cutMoveAtBeatInTransaction({
    tx,
    timelineId,
    beat,
}: {
    tx: DbTransaction;
    timelineId: number;
    beat: number;
}): Promise<SplitTimelineResult | null> {
    const L = schema.timelines;
    const move = await tx.select().from(L).where(eq(L.id, timelineId)).get();
    let idStaysWith: SplitIdKeeper = "after";
    if (move && Number.isInteger(beat)) {
        if (!(move.start_beat < beat && beat < move.end_beat)) return null;
        const rows = await rowsIn(tx, timelineId);
        if (
            !rows.some((r) => r.row.start_beat < beat) ||
            !rows.some((r) => r.row.end_beat > beat)
        )
            return null;
        idStaysWith = await idKeeperFor(
            tx,
            { id: move.id, start: move.start_beat, end: move.end_beat },
            beat,
        );
    }
    // A missing move or a fractional beat: the split's own refusal says so
    return await splitTimelineAtBeatInTransaction({
        tx,
        timelineId,
        beat,
        allowSharedRanges: true,
        idStaysWith,
    });
}

/** A row in a move, with what decides whether its marcher may leave. */
export interface MoveRow {
    row: DatabaseTimelineAssignment;
    timelineId: number;
    shapeId: number | null;
    pathStyle: string;
}

/**
 * The rows of move `timelineId` (or of every move, `null`), optionally only `marcherIds`' and only
 * those over `range`, by row id.
 */
export async function rowsIn(
    tx: DbTransaction,
    timelineId: number | null,
    {
        marcherIds,
        range,
    }: { marcherIds?: readonly number[]; range?: BeatRange } = {},
): Promise<MoveRow[]> {
    if (marcherIds?.length === 0) return [];
    const a = schema.timeline_assignments;
    const t = schema.timeline_transitions;
    const conditions = [
        ...(timelineId === null ? [] : [eq(t.timeline_id, timelineId)]),
        ...(marcherIds ? [inArray(a.marcher_id, [...marcherIds])] : []),
        ...(range
            ? [lt(a.start_beat, range.end), gt(a.end_beat, range.start)]
            : []),
    ];
    return await tx
        .select({
            row: a,
            timelineId: t.timeline_id,
            shapeId: t.dest_shape_id,
            pathStyle: t.path_style,
        })
        .from(a)
        .innerJoin(t, eq(t.id, a.transition_id))
        .where(and(...conditions))
        .orderBy(asc(a.id))
        .all();
}

/**
 * Switches the shape-backed transitions among `rows` to individual points first, copying the
 * shape's samples (Q-14, as a canvas move does), so the slots can be compacted and the marchers
 * who stay keep their spots.
 */
async function switchToIndividualPoints(
    tx: DbTransaction,
    rows: readonly MoveRow[],
): Promise<void> {
    const T = schema.timeline_transitions;
    for (const transitionId of ascending(
        rows.filter((r) => r.shapeId !== null).map((r) => r.row.transition_id),
    )) {
        const transition = await tx
            .select()
            .from(T)
            .where(eq(T.id, transitionId))
            .get();
        if (!transition || transition.dest_shape_id === null) continue;
        const shape = await tx
            .select()
            .from(schema.timeline_shapes)
            .where(eq(schema.timeline_shapes.id, transition.dest_shape_id))
            .get();
        if (!shape) continue;
        await setTimelineTransitionDestinationInTransaction({
            tx,
            transitionId,
            destination: {
                kind: "individual",
                points: sampleShape(shape, transition.slot_count),
            },
        });
    }
}

/** Each marcher among `rows` that has to stay in its move, with why (see the module comment). */
async function membersThatStay(
    tx: DbTransaction,
    rows: readonly MoveRow[],
): Promise<Map<number, MoveMemberSkip>> {
    const out = new Map<number, MoveMemberSkip>();
    const note = (r: MoveRow, reason: MoveMemberSkipReason) => {
        if (!out.has(r.row.marcher_id))
            out.set(r.row.marcher_id, {
                marcherId: r.row.marcher_id,
                timelineId: r.timelineId,
                reason,
            });
    };
    for (const r of rows)
        if (r.pathStyle === "follow_the_leader") note(r, "followTheLeader");
    if (rows.length === 0 || !(await hasShapeRecipes(tx))) return out;
    const recipes = schema.timeline_shape_recipes;
    const members = schema.timeline_shape_recipe_marchers;
    const inRecipes = await tx
        .selectDistinct({
            marcherId: members.marcher_id,
            timelineId: recipes.timeline_id,
        })
        .from(members)
        .innerJoin(recipes, eq(recipes.id, members.recipe_id))
        .where(
            and(
                inArray(
                    members.marcher_id,
                    ascending(rows.map((r) => r.row.marcher_id)),
                ),
                inArray(
                    recipes.timeline_id,
                    ascending(rows.map((r) => r.timelineId)),
                ),
            ),
        )
        .all();
    const recipeKeys = new Set(
        inRecipes.map((m) => `${m.marcherId}:${m.timelineId}`),
    );
    for (const r of rows)
        if (recipeKeys.has(`${r.row.marcher_id}:${r.timelineId}`))
            note(r, "shape");
    return out;
}

/** The cuts removing `leaving`'s rows of `move` over `range` takes (see the module comment). */
async function planCuts(
    tx: DbTransaction,
    move: MoveSpan,
    leaving: readonly MoveRow[],
    range: BeatRange,
): Promise<PlannedCut[]> {
    const crosses = (beat: number) =>
        leaving.some((r) => r.row.start_beat < beat && beat < r.row.end_beat);
    const cuts: PlannedCut[] = [];
    // The piece holding the range: the move, or after a cut at the range's start its part from
    // there, whose id is the move's only if the cut left it the part after
    let piece = move;
    if (crosses(range.start)) {
        const idStaysWith = await idKeeperFor(tx, piece, range.start);
        cuts.push({ timelineId: move.id, beat: range.start, idStaysWith });
        // A new part is the newest move, so it takes over nothing (an id no move has stands in)
        piece = {
            id: idStaysWith === "after" ? move.id : Number.MAX_SAFE_INTEGER,
            start: range.start,
            end: move.end,
        };
    }
    if (crosses(range.end))
        cuts.push({
            timelineId: move.id,
            beat: range.end,
            idStaysWith: await idKeeperFor(tx, piece, range.end),
        });
    return cuts;
}

/**
 * **Preview** (changes nothing): what removing `marcherIds` from move `timelineId` over `range`
 * (`removeMarchersFromMoveForRangeInTransaction`), or with no `timelineId` from every move they
 * have there (`takeMarchersOutOfRangeInTransaction`), would do. With no `timelineId`, a marcher
 * that has to stay in any of those moves stays in all of them. Marchers with no row there are
 * ignored.
 */
export async function planRemovalFromRange({
    tx,
    marcherIds,
    range,
    timelineId = null,
}: {
    tx: DbTransaction;
    marcherIds: readonly number[];
    range: BeatRange;
    timelineId?: number | null;
}): Promise<RemovalPlan> {
    const rows = await rowsIn(tx, timelineId, { marcherIds, range });
    const stay = await membersThatStay(tx, rows);
    const leaving = rows.filter((r) => !stay.has(r.row.marcher_id));
    const L = schema.timelines;
    const moves: MoveRemovalPlan[] = [];
    for (const id of ascending(leaving.map((r) => r.timelineId))) {
        const move = (await tx.select().from(L).where(eq(L.id, id)).get())!;
        const theirs = leaving.filter((r) => r.timelineId === id);
        moves.push({
            timelineId: id,
            removed: ascending(theirs.map((r) => r.row.marcher_id)),
            cuts: await planCuts(
                tx,
                { id, start: move.start_beat, end: move.end_beat },
                theirs,
                range,
            ),
        });
    }
    return {
        removed: ascending(moves.flatMap((m) => m.removed)),
        skipped: [...stay.values()].sort((a, b) => a.marcherId - b.marcherId),
        moves,
    };
}

/** Carries out one move's part of a plan: its cuts, then the removal from the piece over `range`. */
async function removeFromMove(
    tx: DbTransaction,
    plan: MoveRemovalPlan,
    range: BeatRange,
): Promise<{ cuts: SplitTimelineResult[]; piece: RemovedFromPiece }> {
    const cuts: SplitTimelineResult[] = [];
    let pieceId = plan.timelineId;
    for (const cut of plan.cuts) {
        const split = await splitTimelineAtBeatInTransaction({
            tx,
            timelineId: pieceId,
            beat: cut.beat,
            allowSharedRanges: true,
            idStaysWith: cut.idStaysWith,
        });
        cuts.push(split);
        // The range is after a cut at its start, and before one at its end
        pieceId = cut.beat === range.start ? split.after.id : split.before.id;
    }
    const removed = await rowsIn(tx, pieceId, {
        marcherIds: plan.removed,
        range,
    });
    await switchToIndividualPoints(tx, removed);
    await clearOwnPageMoves(
        tx,
        removed.map((r) => r.row),
        { tidyShared: true },
    );
    const L = schema.timelines;
    const deleted = !(await tx
        .select({ id: L.id })
        .from(L)
        .where(eq(L.id, pieceId))
        .get());
    return {
        cuts,
        piece: { timelineId: plan.timelineId, pieceId, deleted },
    };
}

/** Carries out `plan` (`planRemovalFromRange`). */
async function carryOut(
    tx: DbTransaction,
    plan: RemovalPlan,
    range: BeatRange,
): Promise<RemoveFromRangeResult> {
    const result: RemoveFromRangeResult = {
        removed: plan.removed,
        skipped: plan.skipped,
        cuts: [],
        pieces: [],
    };
    for (const move of plan.moves) {
        const done = await removeFromMove(tx, move, range);
        result.cuts.push(...done.cuts);
        result.pieces.push(done.piece);
    }
    return result;
}

/**
 * **Remove marchers from a move for a range of counts**: each of `marcherIds` leaves move
 * `timelineId` over `range`, the move being cut at the range's ends where their rows cross them
 * (see the module comment). Shape and follow-the-leader members stay and are listed in `skipped`.
 * Marchers with no row in the move over the range are ignored.
 */
export async function removeMarchersFromMoveForRangeInTransaction({
    tx,
    timelineId,
    marcherIds,
    range,
}: {
    tx: DbTransaction;
    timelineId: number;
    marcherIds: readonly number[];
    range: BeatRange;
}): Promise<RemoveFromRangeResult> {
    const plan = await planRemovalFromRange({
        tx,
        marcherIds,
        range,
        timelineId,
    });
    return await carryOut(tx, plan, range);
}

/**
 * Takes `marcherIds` out of **every** move they have over `range`
 * (`removeMarchersFromMoveForRangeInTransaction` per move), so they have no row there and the
 * counts are Not set. A marcher that has to stay in any of those moves (a shape or
 * follow-the-leader member) is left untouched everywhere and listed once in `skipped`.
 */
export async function takeMarchersOutOfRangeInTransaction({
    tx,
    marcherIds,
    range,
}: {
    tx: DbTransaction;
    marcherIds: readonly number[];
    range: BeatRange;
}): Promise<RemoveFromRangeResult> {
    const plan = await planRemovalFromRange({ tx, marcherIds, range });
    return await carryOut(tx, plan, range);
}

const REASON_WORDS: Record<MoveMemberSkipReason, [string, string]> = {
    shape: ["is in a shape", "are in a shape"],
    followTheLeader: ["follows the leader", "follow the leader"],
};

/**
 * The refusal naming `skipped` (`TimelineEditRefusedError("inShapeOrFollowTheLeader")`, its
 * `marcherIds` the skipped marchers), for the toast after a command that still did the rest, or
 * `null` when nobody was skipped. Its message is the English text; its parameters (`count`, and
 * per reason a count and the names) fill the translated `timeline.edit.inShapeOrFollowTheLeader`.
 */
export async function skippedRefusal(
    tx: DbTransaction,
    skipped: readonly MoveMemberSkip[],
): Promise<TimelineEditRefusedError | null> {
    if (skipped.length === 0) return null;
    const ids = ascending(skipped.map((s) => s.marcherId));
    const labels = await marcherLabels(tx, ids);
    const named = (reason: MoveMemberSkipReason) => {
        const names = skipped
            .filter((s) => s.reason === reason)
            .sort((a, b) => a.marcherId - b.marcherId)
            .map((s) => labels.get(s.marcherId) ?? `Marcher ${s.marcherId}`);
        const shown =
            names.length > 3
                ? [...names.slice(0, 3), `${names.length - 3} more`]
                : names;
        return { count: names.length, names: joinList(shown) };
    };
    const shape = named("shape");
    const leader = named("followTheLeader");
    const parts = (
        [
            ["shape", shape],
            ["followTheLeader", leader],
        ] as const
    ).flatMap(([reason, { count, names }]) =>
        count === 0
            ? []
            : [`${names} ${REASON_WORDS[reason][count === 1 ? 0 : 1]}`],
    );
    const them = ids.length === 1 ? "it keeps its" : "they keep their";
    return new TimelineEditRefusedError("inShapeOrFollowTheLeader", {
        marcherIds: ids,
        message: `${parts.join(", and ")}, so ${them} move here.`,
        params: {
            count: ids.length,
            shapeCount: shape.count,
            shapeNames: shape.names,
            leaderCount: leader.count,
            leaderNames: leader.names,
        },
    });
}
