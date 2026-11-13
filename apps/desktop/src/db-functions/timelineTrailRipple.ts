/**
 * Ripple into the next form, pathways step 9 (spec Appendix L.10, RP-1 to RP-6, AP-T12): a line
 * standing in one form follows its leader along a straight connector (or drawn corners) into the
 * form its end spots make, and along it, in one follow move (register E-4, J-7).
 *
 * - `planRipple` (`timelineTrailRipplePlan`, pure): the deal and the trail as the resolver builds
 *   it; the Follow tool's drawing and this write both use it.
 * - `rippleFormAt`: the next form, the members' end spots in their remembered or guessed order.
 * - `rippleTrailInTransaction`: the write (AP-T12): step 4's Follow (AP-T1) onto the dealt spots,
 *   then the move's shape recipes re-dealt so they agree.
 */
import { and, eq, inArray } from "drizzle-orm";
import { createResolver, type XY } from "@openmarch/core";
import { schema } from "@/global/database/db";
import { readTimelineTables } from "@/timeline/timelineRows";
import { text } from "@/timeline/timelineText";
import type { DbConnection, DbTransaction } from "./types";
import { transactionWithHistory } from "./history";
import { refuse } from "./timelineErrors";
import { marcherName, type RoutePointInput } from "./timelineRoutes";
import { isOrderMarkKind } from "./shapeRecipes";
import {
    followTrailInTransaction,
    trailRefusal,
    type FollowTrailResult,
} from "./timelineTrails";
import { planRipple, type RippleForm } from "./timelineTrailRipplePlan";
import {
    followOrderAt,
    trailDragRefusal,
    trailOrderFrom,
    windowMoveOf,
    type TrailWindow,
} from "./timelineTrailDrag";

/** The refusals' texts of step 9, translated where they are shown */
export const rippleRefusal = {
    /** RP-2: the members' end spots don't stand in a line, curve or arc */
    notAForm: () => text.t("timeline.refusals.trail.notAForm"),
};

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * RP-2: the next form, `spots` (each of `ids`'s end spot at `beat`, the move's end) in the order
 * the show remembers for them there, or else the one their spots suggest. Null when neither has
 * one: the spots don't stand in a line, curve or arc.
 */
export async function rippleFormAt(
    db: DbConnection | DbTransaction,
    ids: readonly number[],
    beat: number,
    spots: ReadonlyMap<number, XY>,
): Promise<RippleForm | null> {
    const sorted = [...new Set(ids)].sort((a, b) => a - b);
    const at = sorted.map((m) => spots.get(m)!);
    const found = await followOrderAt(db, sorted, beat, at);
    if (!found) return null;
    return {
        ids: found.order.map((i) => sorted[i]!),
        spots: found.order.map((i) => at[i]!),
    };
}

// ---------------------------------------------------------------------------
// AP-T12
// ---------------------------------------------------------------------------

export interface RippleInput {
    /** The edit window `[start flag, end flag)`: the line's starts are at its start */
    window: TrailWindow;
    /** The selected marchers (two or more) */
    marcherIds: readonly number[];
    /** The end of the line pressed: the leader (DL-1) */
    leaderId: number;
    /** The connector's corners, in walking order from the leader; none for a straight one */
    points: readonly RoutePointInput[];
    /**
     * The move the line ripples in (step 4's target: the one every member is in at the playhead);
     * the one over exactly the window when absent
     */
    keepMove?: number | null;
    /** The marcher whose spot is the entrance, when the finish was on it (RP-4) */
    enter?: number | null;
}

export interface RippleResult extends FollowTrailResult {
    /** Whose spot each member of the line took, tail first */
    takes: number[];
    /** The shape recipe rows re-dealt */
    recipeRows: number;
}

/**
 * RP-3, AP-T12: every shape recipe of move `timelineId` (not order marks) re-deals its rows of
 * the members: the row of a spot names whoever stands on it now (`holder`: who stood there →
 * who stands there), keeping its id, slot and point. Rows are deleted and written again with
 * their ids, since the unique (recipe, marcher) pair forbids swapping two in place.
 */
async function dealRecipesAgainInTransaction(
    tx: DbTransaction,
    timelineId: number,
    holder: ReadonlyMap<number, number>,
): Promise<number> {
    const R = schema.timeline_shape_recipes;
    const M = schema.timeline_shape_recipe_marchers;
    const rows = (
        await tx
            .select({ row: M, kind: R.kind })
            .from(M)
            .innerJoin(R, eq(R.id, M.recipe_id))
            .where(
                and(
                    eq(R.timeline_id, timelineId),
                    inArray(M.marcher_id, [...holder.keys()]),
                ),
            )
            .all()
    )
        .filter((r) => !isOrderMarkKind(r.kind))
        .map((r) => r.row)
        .filter((r) => holder.get(r.marcher_id) !== r.marcher_id);
    if (rows.length === 0) return 0;
    await tx.delete(M).where(
        inArray(
            M.id,
            rows.map((r) => r.id),
        ),
    );
    await tx
        .insert(M)
        .values(
            rows.map((r) => ({ ...r, marcher_id: holder.get(r.marcher_id)! })),
        );
    return rows.length;
}

/**
 * AP-T12 (spec L.10), inside one write-wrapper transaction: the line of `marcherIds` (its order
 * at the window's start, the grabbed end leading, as AP-T8 reads it) ripples into the form its
 * end spots make in move `keepMove`: the form's spots dealt in trail order from the entrance
 * (RP-3, RP-4), then AP-T1 in that move with the dealt spots as the slots' destinations and the
 * connector's corners as the trail, then the move's shape recipes re-dealt to match.
 *
 * Refused (`E-ARGS`, nothing written): AP-T1's and AP-T8's refusals; no move with end spots for
 * every member; end spots that don't stand in a form; the line already a trail's line there.
 */
export async function rippleTrailInTransaction(
    tx: DbTransaction,
    input: RippleInput,
): Promise<RippleResult> {
    const { window, leaderId, points } = input;
    const ids = [...new Set(input.marcherIds)].sort((a, b) => a - b);
    if (ids.length < 2) refuse(trailRefusal.tooFew());
    if (!(window.end > window.start) || window.start < 0)
        refuse(trailDragRefusal.noWindow());
    const resolver = createResolver((await readTimelineTables(tx)).snapshot);
    // The line's order where it stands at the start flag, the grabbed end leading (AP-T8)
    const starts = ids.map((m): XY => {
        const [x, y] = resolver.positionAt(m, window.start);
        return [x, y];
    });
    const along = await followOrderAt(tx, ids, window.start, starts);
    if (!along) refuse(trailDragRefusal.notFitted());
    const order = trailOrderFrom(along.order, ids.indexOf(leaderId));
    if (!order) refuse(trailDragRefusal.notAnEnd());
    const line = order.map((i) => ids[i]!);
    // The move the line ripples in, and its end spots there
    const move = input.keepMove ?? (await windowMoveOf(tx, window, ids));
    if (move === null) refuse(trailDragRefusal.noSpots());
    const timeline = await tx
        .select({ end_beat: schema.timelines.end_beat })
        .from(schema.timelines)
        .where(eq(schema.timelines.id, move))
        .get();
    if (!timeline) refuse(trailDragRefusal.noSpots());
    const spots = new Map(
        ids.map((m): [number, XY] => {
            const [x, y] = resolver.positionAt(m, timeline.end_beat);
            return [m, [x, y]];
        }),
    );
    const form = await rippleFormAt(tx, ids, timeline.end_beat, spots);
    if (!form) refuse(rippleRefusal.notAForm());
    const plan = planRipple(
        order.map((i) => starts[i]!),
        form,
        points,
        input.enter,
    );
    const followed = await followTrailInTransaction({
        tx,
        timelineId: move,
        marcherIds: line,
        points,
        line,
        destinations: new Map(line.map((m, q) => [m, plan.spots[q]!])),
    });
    // A line that already follows a trail there is drawn again by Follow, never re-dealt
    if (followed.redrawn)
        refuse(trailRefusal.alreadyFollows(await marcherName(tx, leaderId)));
    const recipeRows = await dealRecipesAgainInTransaction(
        tx,
        move,
        new Map(plan.takes.map((was, q) => [was, line[q]!])),
    );
    return { ...followed, takes: plan.takes, recipeRows };
}

/** AP-T12 as one undoable edit. */
export async function rippleTrail(
    args: { db: DbConnection } & RippleInput,
): Promise<RippleResult> {
    const { db, ...input } = args;
    return await transactionWithHistory(db, "rippleTrail", (tx) =>
        rippleTrailInTransaction(tx, input),
    );
}
