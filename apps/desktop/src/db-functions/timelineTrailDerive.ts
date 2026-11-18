/**
 * A trail's path is the only truth (owner, 2026-11-17, spec L.18): the end spots of a trail dragged
 * out of a line (`path_params.ends = "along"`, R-13″) are always where its path puts them. The
 * marchers are beads on a string: each stands its own distance back from the head along the path
 * (the spacing: Keep spacing, Even N or the gaps of a slid tail), so every route edit (a point
 * dragged, added or deleted, Corner or Smooth, an arc leg, the pen drawing it again, the head or a
 * marcher of the form dragged) plans every spot again in the same transaction and undo step.
 * `timeline_slot_destinations` still stores the spots, because the rest of the app reads them.
 *
 * - `planTrailEdit` (pure): the spots a route edit gives. The spacing is read back from the spots
 *   on the old route (each member's distance back from the leader's spot along it, which no route
 *   edit changes), then laid on the new route. A member the path is too short for hasn't left the
 *   form yet: it stays where it starts (L.18, TM-5); the path is never compressed and no spot is
 *   invented off it.
 * - `deriveTrailSpotsInTransaction`: the write, after the route.
 * - `leaveTrailInTransaction`: an end spot moved by anything but the path (a field drag, Alt, typed
 *   coordinates, a shape tool, paste) takes that marcher out of the trail into a plain move to its
 *   new spot (TM-3). No per-marcher offset is ever stored inside a trail.
 * - `convertTrailToShapeInTransaction`: **Convert to shape** places a Line through the end spots
 *   and ends the derivation: the trail then leads into that form (R-13′), as Follow into a form
 *   does, so the shape tools own the spots and the marchers still walk the path into them.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import {
    alongEnds,
    createResolver,
    EPS_GEOM,
    type RouteGeometry,
    type XY,
} from "@openmarch/core";
import { schema } from "@/global/database/db";
import { readTimelineTables } from "@/timeline/timelineRows";
import { text, type TimelineText } from "@/timeline/timelineText";
import type { DbConnection, DbTransaction } from "./types";
import { transactionWithHistory } from "./history";
import { mapDbErrors, refuse, TimelineWriteError } from "./timelineErrors";
import type { RoutePointInput } from "./timelineRoutes";
import { planTrailDrag, type TrailDragPlan } from "./timelineTrailDrag";
import { saveShapeRecipeInTransaction } from "./shapeRecipes";
import { trailShapeRecipe } from "./timelineTrailShape";
import { removeAssignmentRowsInTransaction } from "./timelineMembership";
import { createTimelineAssignmentsInTransaction } from "./timelineAssignments";
import { writeRouteGeometryInTransaction } from "./timelineRouteGeometry";

type TransitionDbRow = typeof schema.timeline_transitions.$inferSelect;

const FTL = "follow_the_leader";
/** Spots this close are where the plan puts them, in field units (`ON_SHAPE`'s reach) */
const ON_PLAN = 1e-3;
/** A spot moved less than this hasn't moved, in field units */
const UNMOVED = 1e-6;

/** The refusals' texts, translated where they are shown */
export const trailModelRefusal = {
    /** Convert to shape on a trail whose tail hasn't left the line it stands in yet */
    convertInLineUp: () => text.t("timeline.refusals.trail.convertInLineUp"),
    /** Convert to shape on a trail that isn't dragged out of a line */
    convertNotAlong: () => text.t("timeline.refusals.trail.convertNotAlong"),
};

const paramsOf = (t: TransitionDbRow): Record<string, unknown> | null => {
    if (t.path_params === null) return null;
    try {
        return JSON.parse(t.path_params) as Record<string, unknown>;
    } catch {
        return null;
    }
};

/**
 * Whether `t` is a trail whose end spots its path derives (L.18): a shapeless follow-the-leader
 * move with a trail route, its ends along the way (R-13″), not round an outline
 */
export const derivesSpots = (t: TransitionDbRow): boolean =>
    t.path_style === FTL &&
    t.route_id !== null &&
    t.dest_shape_id === null &&
    paramsOf(t)?.ends === "along";

// ---------------------------------------------------------------------------
// Pure: the spots a route edit gives
// ---------------------------------------------------------------------------

/**
 * Each member's distance back from the leader's spot along the way `before` (with the line
 * `starts`, tail first) makes, read from its spot: the trail's spacing, which no route edit changes.
 * Spots where Keep spacing puts them read back exactly; any other spot by its projection (R-13″),
 * kept in trail order. The leader's is 0: the head is the path's end (L.18, TM-6).
 */
export function spacingBack(
    starts: readonly XY[],
    before: readonly RoutePointInput[],
    spots: readonly XY[],
): number[] {
    const keep = planTrailDrag(starts, before, { kind: "keep" }, 1);
    const onKeep = keep.spots.every(
        (p, q) =>
            Math.hypot(p[0] - spots[q]![0], p[1] - spots[q]![1]) <= ON_PLAN,
    );
    const e = onKeep
        ? keep.ends
        : alongEnds(keep.way, spots, keep.startDist).endDist;
    const lead = e.at(-1) ?? 0;
    return e.map((x, q) => (q === e.length - 1 ? 0 : Math.max(0, lead - x)));
}

/**
 * The spots a route edit gives (L.18, TM-1): the spacing read back from `spots` on the route
 * `before`, laid on the route `after`, the leader at its head. A member the new path is too short
 * for stands where it starts: it hasn't left the form yet (TM-5), and nobody walks backward.
 */
export function planTrailEdit(
    starts: readonly XY[],
    before: readonly RoutePointInput[],
    spots: readonly XY[],
    after: readonly RoutePointInput[],
): TrailDragPlan {
    return planOnBack(starts, after, spacingBack(starts, before, spots));
}

/** The plan with each member `back[q]` from the head of `points`, nobody behind its start */
export function planOnBack(
    starts: readonly XY[],
    points: readonly RoutePointInput[],
    back: readonly number[],
): TrailDragPlan {
    const plan = planTrailDrag(starts, points, { kind: "gaps", back }, 1);
    const ends = plan.ends.map((e, q) => Math.max(e, plan.startDist[q]!));
    return {
        ...plan,
        ends,
        spots: ends.map((e) => plan.way.at(e)),
        forward: true,
    };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * The line of trail `transition` (tail first, R-12′), where each starts, each one's slot, and
 * every slot someone holds (joiners taken over at the start too)
 */
async function lineOf(
    tx: DbTransaction,
    transition: TransitionDbRow,
): Promise<{
    line: number[];
    starts: XY[];
    slots: Map<number, number>;
    held: Set<number>;
}> {
    const resolver = createResolver((await readTimelineTables(tx)).snapshot);
    const line = [...resolver.ftlEntry(transition.id).members];
    const starts = line.map((m): XY => {
        const [x, y] = resolver.positionAt(m, transition.start_beat);
        return [x, y];
    });
    const A = schema.timeline_assignments;
    const rows = await tx
        .select({ marcherId: A.marcher_id, slot: A.slot_index })
        .from(A)
        .where(eq(A.transition_id, transition.id))
        .all();
    const inLine = new Set(line);
    return {
        line,
        starts,
        slots: new Map(
            rows
                .filter((r) => inLine.has(r.marcherId))
                .map((r) => [r.marcherId, r.slot]),
        ),
        held: new Set(rows.map((r) => r.slot)),
    };
}

/** The placed spot of each slot of `transitionId` */
async function spotsOf(
    tx: DbTransaction,
    transitionId: number,
): Promise<Map<number, XY>> {
    const d = schema.timeline_slot_destinations;
    const rows = await tx
        .select()
        .from(d)
        .where(eq(d.transition_id, transitionId))
        .all();
    return new Map(rows.map((r) => [r.slot_index, [r.x, r.y] as XY]));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Writes `plan`'s spots (tail first) on the line's slots, as the trail's own (no one leaves it). A
 * slot nobody holds (a marcher who left, AP-T6) is put on the path between the spots either side,
 * so the line through the slots (R-13′, after Convert to shape) stays on the path too.
 */
async function writeSpots(
    tx: DbTransaction,
    transition: TransitionDbRow,
    found: Awaited<ReturnType<typeof lineOf>>,
    plan: Pick<TrailDragPlan, "spots" | "ends" | "way">,
): Promise<void> {
    const { line, slots, held } = found;
    const d = schema.timeline_slot_destinations;
    const at = new Map<number, XY>();
    const endOf = new Map<number, number>();
    for (const [q, m] of line.entries()) {
        const slot = slots.get(m);
        if (slot === undefined || !plan.spots[q]) continue;
        at.set(slot, plan.spots[q]!);
        endOf.set(slot, plan.ends[q]!);
    }
    const known = [...endOf.keys()].sort((a, b) => a - b);
    for (let slot = 0; slot < transition.slot_count; slot++) {
        if (at.has(slot) || held.has(slot) || known.length === 0) continue;
        const below = known.filter((k) => k < slot).at(-1);
        const above = known.find((k) => k > slot);
        const e =
            below === undefined
                ? endOf.get(above!)!
                : above === undefined
                  ? endOf.get(below)!
                  : endOf.get(below)! +
                    ((endOf.get(above)! - endOf.get(below)!) * (slot - below)) /
                        (above - below);
        at.set(slot, plan.way.at(e));
    }
    for (const [slot, point] of at)
        await mapDbErrors(() =>
            tx
                .update(d)
                .set({ x: point[0], y: point[1] })
                .where(
                    and(
                        eq(d.transition_id, transition.id),
                        eq(d.slot_index, slot),
                    ),
                )
                .run(),
        );
}

/**
 * A trail's line used to get a placed Line, Arc or Curve for its end spots (step 4c, DL-11), a
 * third copy of the path. It is no longer saved (L.18, TM-4); one left in a file from before is
 * unlinked on the trail's next edit: the shapes of its move whose marchers are exactly the line
 * go. Order marks (step 4g) aren't shapes and stay.
 */
export async function unlinkTrailShapesInTransaction(
    tx: DbTransaction,
    timelineId: number,
    line: readonly number[],
): Promise<void> {
    if (line.length === 0) return;
    const R = schema.timeline_shape_recipes;
    const M = schema.timeline_shape_recipe_marchers;
    const recipes = await tx
        .select({ id: R.id, kind: R.kind })
        .from(R)
        .where(
            and(
                eq(R.timeline_id, timelineId),
                inArray(R.kind, ["line", "arc", "curve"]),
            ),
        )
        .all();
    if (recipes.length === 0) return;
    const members = await tx
        .select({ recipe: M.recipe_id, marcher: M.marcher_id })
        .from(M)
        .where(
            inArray(
                M.recipe_id,
                recipes.map((r) => r.id),
            ),
        )
        .all();
    const want = new Set(line);
    for (const r of recipes) {
        const own = members.filter((m) => m.recipe === r.id);
        if (own.length === want.size && own.every((m) => want.has(m.marcher)))
            await tx.delete(R).where(eq(R.id, r.id)).run();
    }
}

/**
 * After a route edit of trail `transition` (L.18, TM-1): every founder's end spot planned again
 * on the route `after`, with the spacing read back from its spot on the route `before`. Nothing
 * for a trail that doesn't derive its spots (into end spots, round an outline). The old end shape
 * of step 4c is unlinked (TM-4). Call inside the route edit's transaction, after the route write.
 */
export async function deriveTrailSpotsInTransaction(
    tx: DbTransaction,
    transition: TransitionDbRow,
    before: readonly RoutePointInput[],
    after: readonly RoutePointInput[],
): Promise<void> {
    if (!derivesSpots(transition)) return;
    const found = await lineOf(tx, transition);
    const { line, starts, slots } = found;
    if (line.length === 0) return;
    const placed = await spotsOf(tx, transition.id);
    const spots = line.map((m) => placed.get(slots.get(m) ?? -1) ?? starts[0]!);
    const plan = planTrailEdit(starts, before, spots, after);
    await writeSpots(tx, transition, found, plan);
    await unlinkTrailShapesInTransaction(tx, transition.timeline_id, line);
}

/** Writes `plan`'s spots on the line of `transition` and unlinks its old end shape (AP-T16) */
export async function writeTrailPlanInTransaction(
    tx: DbTransaction,
    transition: TransitionDbRow,
    plan: Pick<TrailDragPlan, "spots" | "ends" | "way">,
): Promise<void> {
    const found = await lineOf(tx, transition);
    await writeSpots(tx, transition, found, plan);
    await unlinkTrailShapesInTransaction(
        tx,
        transition.timeline_id,
        found.line,
    );
}

/**
 * The end spot of slot `slotIndex` of `transitionId` moved to `point` by something other than the
 * path (L.18, TM-3: a field drag, Alt + drag, typed coordinates, a shape tool, paste): when that
 * transition is a trail deriving its spots and the spot really moves, its marcher leaves the trail
 * (AP-T6, as split by marchers peels it) into a one-slot `direct` move of its own to `point`, in
 * the same move, counts and layer, and that destination is returned. The trail goes on with the
 * others, a gap left where it stood; with fewer than two left it's removed (AP-T4) and null is
 * returned, the slot then an ordinary move's, which the caller writes. Null too when nothing
 * leaves (another kind of move, a vacant slot, the spot unmoved).
 */
export async function leaveTrailInTransaction(
    tx: DbTransaction,
    transitionId: number,
    slotIndex: number,
    point: XY,
): Promise<typeof schema.timeline_slot_destinations.$inferSelect | null> {
    const T = schema.timeline_transitions;
    const A = schema.timeline_assignments;
    const d = schema.timeline_slot_destinations;
    const transition = await tx
        .select()
        .from(T)
        .where(eq(T.id, transitionId))
        .get();
    if (!transition || !derivesSpots(transition)) return null;
    const now = await tx
        .select()
        .from(d)
        .where(
            and(eq(d.transition_id, transitionId), eq(d.slot_index, slotIndex)),
        )
        .get();
    if (now && Math.hypot(now.x - point[0], now.y - point[1]) <= UNMOVED)
        return null;
    const rows = await tx
        .select()
        .from(A)
        .where(
            and(eq(A.transition_id, transitionId), eq(A.slot_index, slotIndex)),
        )
        .orderBy(asc(A.start_beat))
        .all();
    if (rows.length === 0) return null;
    const everyone = await tx
        .selectDistinct({ id: A.marcher_id })
        .from(A)
        .where(eq(A.transition_id, transitionId))
        .all();
    const leaving = new Set(rows.map((r) => r.marcher_id));
    if (everyone.filter((m) => !leaving.has(m.id)).length < 2) {
        // One left: the trail goes (AP-T4) and everyone keeps a plain move to the spot they have
        const { removeTrailInTransaction } = await import("./timelineTrails");
        await removeTrailInTransaction({
            tx,
            routeId: transition.route_id!,
            keepOrder: false,
        });
        return null;
    }
    return await peelIntoOwnMove(tx, transition, rows, point);
}

/** `rows` (one slot of trail `transition`) peeled into a one-slot direct move to `point` (AP-T6) */
async function peelIntoOwnMove(
    tx: DbTransaction,
    transition: TransitionDbRow,
    rows: (typeof schema.timeline_assignments.$inferSelect)[],
    point: XY,
): Promise<typeof schema.timeline_slot_destinations.$inferSelect | null> {
    const d = schema.timeline_slot_destinations;
    // Old rows first, so the new ones don't overlap them at the same layer (I-A3); a trail's line
    // keeps a gap (AP-T6)
    await removeAssignmentRowsInTransaction({
        tx,
        removed: rows,
        compact: true,
        deleteEmptied: true,
    });
    const { createTimelineTransitionsInTransaction } =
        await import("./timelineTransitionsInTransaction");
    const [own] = await createTimelineTransitionsInTransaction({
        tx,
        newTransitions: [
            {
                timelineId: transition.timeline_id,
                slotCount: 1,
                destination: { kind: "individual", points: [point] },
                pathStyle: "direct",
                pathParams: null,
                orderMode: "inherit",
            },
        ],
    });
    await createTimelineAssignmentsInTransaction({
        tx,
        newAssignments: rows.map((r) => ({
            marcherId: r.marcher_id,
            transitionId: own!.id,
            slotIndex: 0,
            startBeat: r.start_beat,
            endBeat: r.end_beat,
            layer: r.layer,
        })),
    });
    return (
        (await tx
            .select()
            .from(d)
            .where(and(eq(d.transition_id, own!.id), eq(d.slot_index, 0)))
            .get()) ?? null
    );
}

// ---------------------------------------------------------------------------
// Convert to shape
// ---------------------------------------------------------------------------

/** Why Convert to shape can't run on trail `routeId` now, or null. Writes nothing. */
export async function convertTrailRefusalInTransaction(
    tx: DbTransaction,
    routeId: number,
): Promise<TimelineText | null> {
    try {
        await planConvert(tx, routeId);
        return null;
    } catch (error) {
        if (error instanceof TimelineWriteError && error.text)
            return error.text;
        throw error;
    }
}

async function planConvert(tx: DbTransaction, routeId: number) {
    const T = schema.timeline_transitions;
    const transition = await tx
        .select()
        .from(T)
        .where(and(eq(T.route_id, routeId), eq(T.path_style, FTL)))
        .get();
    if (!transition || !derivesSpots(transition))
        refuse(trailModelRefusal.convertNotAlong());
    const found = await lineOf(tx, transition);
    const { line, starts, slots } = found;
    if (line.length < 2) refuse(trailModelRefusal.convertNotAlong());
    const route = await tx
        .select()
        .from(schema.timeline_routes)
        .where(eq(schema.timeline_routes.id, routeId))
        .get();
    if (!route) refuse(trailModelRefusal.convertNotAlong());
    const geometry = JSON.parse(route.geometry) as RouteGeometry;
    const placed = await spotsOf(tx, transition.id);
    const spots = line.map((m) => placed.get(slots.get(m) ?? -1) ?? starts[0]!);
    const plan = planTrailEdit(starts, geometry.points, spots, geometry.points);
    const lineLen = plan.startDist.at(-1) ?? 0;
    // The tail still in the line it stands in: the trail into the form would start behind its
    // leader. Lengthen the trail first
    if (plan.ends[0]! < lineLen - EPS_GEOM)
        refuse(trailModelRefusal.convertInLineUp());
    return { transition, found, plan, geometry, lineLen };
}

/**
 * The route's points before distance `d` along the drawn part of `way` (AP-R7's cut, as
 * `cutAt` cuts a trail's head): the points walked before it, ids kept, and the bulge of the leg
 * from the last of them into the cut, an arc's share of its sweep
 */
function routeCut(
    way: TrailDragPlan["way"],
    points: RouteGeometry["points"],
    d: number,
): { points: RouteGeometry["points"]; toBulge?: number } {
    const W = way.drawn?.path;
    if (!W) return { points: [] };
    const kept: number[] = [];
    for (let k = 1; k < W.V.length - 1; k++)
        if (W.source[k]! >= 0 && W.D[k]! < d - EPS_GEOM) kept.push(k);
    let j = 0;
    while (j < W.D.length - 2 && !(d < W.D[j + 1]!)) j++;
    const piece = W.pieces[j];
    const kb = kept.at(-1) ?? 0;
    let toBulge: number | undefined;
    if (kb === j && piece?.kind === "arc") {
        const f = Math.min(
            1,
            Math.max(0, (d - W.D[j]!) / (W.D[j + 1]! - W.D[j]!)),
        );
        const k = Math.tan((2 * Math.atan(2 * piece.k) * f) / 2) / 2;
        if (k !== 0) toBulge = k;
    }
    return {
        points: kept.map((k) => points[W.source[k]!]!),
        ...(toBulge === undefined ? {} : { toBulge }),
    };
}

/**
 * **Convert to shape** (L.18, TM-4), inside one write-wrapper transaction: a Line (or an Arc, or a
 * Curve with corners and smooth points, as step 4c laid them, `trailShapeRecipe`) is placed
 * through the trail's end spots, each member where it stands, and the trail stops deriving them:
 * its route is cut at the tail's spot, where the line now enters the form, and it becomes a trail
 * into the end spots (R-13′, `ends` dropped), as Follow into a form makes. Nobody's end spot moves
 * and the line still walks the path; from now on the shape tools move the spots, and the trail's
 * points only reshape the walk in. Refused for a trail that isn't dragged out of a line, and while
 * the tail is still in the line it stands in. Returns the shape's id.
 */
export async function convertTrailToShapeInTransaction(
    tx: DbTransaction,
    routeId: number,
): Promise<{ recipeId: number; transitionId: number }> {
    const { transition, found, plan, geometry, lineLen } = await planConvert(
        tx,
        routeId,
    );
    // The spots exactly where the path has them, then the route cut where the tail ends: the
    // leader's start, the points before that spot, then the spot, which R-13′ enters (its `to`)
    await writeSpots(tx, transition, found, plan);
    const cut = routeCut(plan.way, geometry.points, plan.ends[0]! - lineLen);
    const tail = plan.spots[0]!;
    const next: RouteGeometry = {
        v: 1,
        from: geometry.from,
        to: [tail[0], tail[1]],
        points: cut.points,
        ...(cut.toBulge === undefined ? {} : { toBulge: cut.toBulge }),
    };
    await mapDbErrors(async () => {
        await writeRouteGeometryInTransaction(tx, routeId, next);
        await tx
            .update(schema.timeline_transitions)
            .set({ path_params: JSON.stringify({ waypoints: [] }) })
            .where(eq(schema.timeline_transitions.id, transition.id))
            .run();
    });
    const { recipe, members } = trailShapeRecipe(plan, found.line);
    const recipeId = await saveShapeRecipeInTransaction({
        tx,
        timelineId: transition.timeline_id,
        recipe,
        members,
    });
    return { recipeId, transitionId: transition.id };
}

/** Convert to shape as one undoable edit */
export async function convertTrailToShape(args: {
    db: DbConnection;
    routeId: number;
}): Promise<{ recipeId: number; transitionId: number }> {
    const { db, routeId } = args;
    return await transactionWithHistory(db, "convertTrailToShape", (tx) =>
        convertTrailToShapeInTransaction(tx, routeId),
    );
}
