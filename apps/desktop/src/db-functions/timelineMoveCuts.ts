import { and, asc, eq, gt, inArray, lt } from "drizzle-orm";
import { schema } from "@/global/database/db";
import { TimelineEditRefusedError } from "@/timeline/timelineEditRefusals";
import { joinList } from "@/timeline/timelineRangeWords";
import type { DbTransaction } from "./types";
import type { DatabaseTimelineAssignment } from "./timelineAssignments";
import { marcherLabels, type BeatRange } from "./timelineMembership";
import {
    splitTimelineAtBeatInTransaction,
    type SplitTimelineResult,
} from "./timelineSplitAtBeat";
import { hasShapeRecipes } from "./shapeRecipes";
import { setTimelineTransitionDestinationInTransaction } from "./timelineTransitionsInTransaction";
// A cycle (it imports this module), safe because neither module uses the other at load time
import { clearOwnPageMoves, sampleShape } from "./timelineMoves";

/**
 * The two move operations the holds commands share (holds spec, docs/timeline/research/holds/,
 * decision 16; ADR 0001 amendment draft part 1). Every holds command that takes a marcher out of
 * some counts goes through them, so they stay one seam:
 *
 * 1. **Cut a move in time at a count** (`cutMoveAtBeatInTransaction`): Split at playhead's split
 *    (`splitTimelineAtBeatInTransaction`, UI-27), the whole membership in both parts, with motion
 *    unchanged for direct paths. A part may land on a range another move already has, as a split
 *    by marcher may (UI-25), so a cut at a page's flags can make a move over exactly the page box.
 *    The original move keeps its id, and with it any shape recipe (#363), as the part after the
 *    count. A count not strictly inside the move, or one with nobody moving on a side of it, needs
 *    no cut: nothing is written.
 * 2. **Remove marchers from a move for a range of counts**
 *    (`removeMarchersFromMoveForRangeInTransaction`): the move is cut at the range's ends where one
 *    of the marchers' rows crosses them, then the marchers leave the part over the range. Their
 *    slots in a shared transition are compacted, a transition they empty is deleted, and so is a
 *    move they empty (`clearOwnPageMoves` with `tidyShared`, as Basic's Set to previous page).
 *    Their motion outside the range is unchanged; after it, they walk from wherever they now are.
 *
 * **Shape and follow-the-leader members stay** (owner, 2026-10-30, holds README decisions 6–14,
 * interim until fork #504): a marcher in a shape recipe of the move (#363), or whose row is in a
 * follow-the-leader transition, is left in it and reported in `skipped` with the reason. The
 * others are still removed. `skippedRefusal` words them for the usual refusal toast. A transition
 * into a stored shape (Q-14, no recipe) is switched to individual points first, as a canvas move
 * switches it, so the marchers who stay keep their spots.
 *
 * Both run inside the caller's edit (`transactionWithHistory`), so the command is one undo step.
 */

/** Why a marcher can't be taken out of its move. */
export type MoveMemberSkipReason = "shape" | "followTheLeader";

/** A marcher left in its move, with why. */
export interface MoveMemberSkip {
    marcherId: number;
    timelineId: number;
    reason: MoveMemberSkipReason;
}

/** What a removal did, marcher ids ascending. */
export interface RemoveFromRangeResult {
    /** The marchers taken out of the range */
    removed: number[];
    /** The marchers left in, one entry each */
    skipped: MoveMemberSkip[];
    /** The cuts made, in order */
    cuts: SplitTimelineResult[];
}

const ascending = (ids: Iterable<number>) =>
    [...new Set(ids)].sort((a, b) => a - b);

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
    if (move && Number.isInteger(beat)) {
        if (!(move.start_beat < beat && beat < move.end_beat)) return null;
        const rows = await rowsIn(tx, timelineId);
        if (
            !rows.some((r) => r.row.start_beat < beat) ||
            !rows.some((r) => r.row.end_beat > beat)
        )
            return null;
    }
    // A missing move or a fractional beat: the split's own refusal says so
    return await splitTimelineAtBeatInTransaction({
        tx,
        timelineId,
        beat,
        allowSharedRanges: true,
    });
}

/** A row in a move, with what decides whether its marcher may leave. */
interface MoveRow {
    row: DatabaseTimelineAssignment;
    timelineId: number;
    shapeId: number | null;
    pathStyle: string;
}

/** The rows of move `timelineId` (or of every move), optionally only `marcherIds`' over `range`. */
async function rowsIn(
    tx: DbTransaction,
    timelineId: number | null,
    {
        marcherIds,
        range,
    }: { marcherIds?: readonly number[]; range?: BeatRange } = {},
): Promise<MoveRow[]> {
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
    const result: RemoveFromRangeResult = {
        removed: [],
        skipped: [],
        cuts: [],
    };
    if (marcherIds.length === 0) return result;
    const rows = await rowsIn(tx, timelineId, { marcherIds, range });
    const stay = await membersThatStay(tx, rows);
    result.skipped = [...stay.values()].sort(
        (a, b) => a.marcherId - b.marcherId,
    );
    const leaving = rows.filter((r) => !stay.has(r.row.marcher_id));
    if (leaving.length === 0) return result;
    const crosses = (beat: number) =>
        leaving.some((r) => r.row.start_beat < beat && beat < r.row.end_beat);

    // The original keeps the part after each cut, so after cutting at the range's start it still
    // holds the range; cutting it at the range's end leaves the range in the new part before
    let part = timelineId;
    if (crosses(range.start)) {
        const cut = await cutMoveAtBeatInTransaction({
            tx,
            timelineId,
            beat: range.start,
        });
        if (cut) result.cuts.push(cut);
    }
    if (crosses(range.end)) {
        const cut = await cutMoveAtBeatInTransaction({
            tx,
            timelineId,
            beat: range.end,
        });
        if (cut) {
            result.cuts.push(cut);
            part = cut.before.id;
        }
    }
    const ids = ascending(leaving.map((r) => r.row.marcher_id));
    const removed = await rowsIn(tx, part, { marcherIds: ids, range });
    await switchToIndividualPoints(tx, removed);
    await clearOwnPageMoves(
        tx,
        removed.map((r) => r.row),
        { tidyShared: true },
    );
    result.removed = ascending(removed.map((r) => r.row.marcher_id));
    return result;
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
    const result: RemoveFromRangeResult = {
        removed: [],
        skipped: [],
        cuts: [],
    };
    if (marcherIds.length === 0) return result;
    const rows = await rowsIn(tx, null, { marcherIds, range });
    const stay = await membersThatStay(tx, rows);
    result.skipped = [...stay.values()].sort(
        (a, b) => a.marcherId - b.marcherId,
    );
    const leaving = rows.filter((r) => !stay.has(r.row.marcher_id));
    const removed = new Set<number>();
    for (const timelineId of ascending(leaving.map((r) => r.timelineId))) {
        const part = await removeMarchersFromMoveForRangeInTransaction({
            tx,
            timelineId,
            marcherIds: ascending(
                leaving
                    .filter((r) => r.timelineId === timelineId)
                    .map((r) => r.row.marcher_id),
            ),
            range,
        });
        for (const id of part.removed) removed.add(id);
        result.cuts.push(...part.cuts);
    }
    result.removed = ascending(removed);
    return result;
}

const REASON_WORDS: Record<MoveMemberSkipReason, [string, string]> = {
    shape: ["is in a shape", "are in a shape"],
    followTheLeader: ["follows the leader", "follow the leader"],
};

/**
 * The refusal naming `skipped` (`TimelineEditRefusedError("inShapeOrFollowTheLeader")`, its
 * `marcherIds` the skipped marchers), for the toast after a command that still did the rest, or
 * `null` when nobody was skipped.
 */
export async function skippedRefusal(
    tx: DbTransaction,
    skipped: readonly MoveMemberSkip[],
): Promise<TimelineEditRefusedError | null> {
    if (skipped.length === 0) return null;
    const ids = ascending(skipped.map((s) => s.marcherId));
    const labels = await marcherLabels(tx, ids);
    const parts = (["shape", "followTheLeader"] as const).flatMap((reason) => {
        const names = skipped
            .filter((s) => s.reason === reason)
            .sort((a, b) => a.marcherId - b.marcherId)
            .map((s) => labels.get(s.marcherId) ?? `Marcher ${s.marcherId}`);
        if (names.length === 0) return [];
        const shown =
            names.length > 3
                ? [...names.slice(0, 3), `${names.length - 3} more`]
                : names;
        return [
            `${joinList(shown)} ${REASON_WORDS[reason][names.length === 1 ? 0 : 1]}`,
        ];
    });
    const them = ids.length === 1 ? "it keeps its" : "they keep their";
    return new TimelineEditRefusedError("inShapeOrFollowTheLeader", {
        marcherIds: ids,
        message: `${parts.join(", and ")}, so ${them} move here.`,
    });
}
