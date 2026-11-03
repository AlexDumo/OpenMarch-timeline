/**
 * Routes, pathways step 1 (ADR 0010; spec v0.9 R-14, Appendix I.2): a move's marcher walks a drawn
 * path of corner points from where it starts to its end spot. This module holds the app
 * procedures that write routes, and the refusals other procedures use:
 *
 * - **AP-R1** `drawRouteInTransaction`: draw a route for one marcher's move, or draw it again.
 * - **AP-R2** `removeRouteInTransaction`: Remove path. The Move card's Straight and Arc
 *   (`setMovePath`) refuse a move with a route (`refuseMoveRoutesForPath`).
 * - **AP-R3** a deleted transition takes its route with it, in
 *   `deleteTimelineTransitionRowsInTransaction`.
 * - **AP-R6** `refuseRoutesInMoves`: edits that can't keep a route exact refuse, and write nothing.
 * - **AP-R7** the cut at a count lives in `timelineSplitAtBeat` (`planRouteCut` here).
 *
 * Range edits (AP-R4) and end and start changes (AP-R5) leave routes alone: R-14 always walks from
 * the marcher's real start to its real destination.
 */
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import {
    createResolver,
    EPS_GEOM,
    routePath,
    routePoint,
    validateRouteGeometry,
    type RouteGeometry,
    type RoutePoint,
    type XY,
} from "@openmarch/core";
import { ROUTE_MODEL_USER_VERSION } from "@om-electron/database/fileVersion";
import { schema } from "@/global/database/db";
import { readTimelineTables } from "@/timeline/timelineRows";
import { moveName } from "@/timeline/timelineRangeWords";
import { text, type TimelineTextArg } from "@/timeline/timelineText";
import { sql } from "drizzle-orm";
import type { DbConnection, DbTransaction } from "./types";
import { transactionWithHistory } from "./history";
import { assertValid, mapDbErrors, refuse } from "./timelineErrors";
import { readMoveWords } from "./timelineMoveNames";
import { sampleShape } from "./timelineMoveHelpers";
import {
    createTimelineTransitionsInTransaction,
    deleteTimelineTransitionRowsInTransaction,
} from "./timelineTransitionsInTransaction";
import { createTimelineAssignmentsInTransaction } from "./timelineAssignments";

// ---------------------------------------------------------------------------
// Refusals (E-ARGS with the spec's reasons)
// ---------------------------------------------------------------------------

/** The refusals' texts, translated where they are shown. */
export const routeRefusal = {
    /** AP-R1, AP-R7: the marcher's span at the move's start is a join, so it would never walk it */
    takenOverAtStart: (marcher: string) =>
        text.t("timeline.refusals.route.takenOverAtStart", { marcher }),
    /** AP-R7: a resume at or before the count would walk the rest of the route after the cut */
    takenOverEarlier: (marcher: string) =>
        text.t("timeline.refusals.route.takenOverEarlier", { marcher }),
    /** AP-R1: leaving a follow-the-leader move would move the others' targets */
    followsTheLeader: (marcher: string) =>
        text.t("timeline.refusals.route.followsTheLeader", { marcher }),
    /** AP-R2: the Move card's Straight and Arc on a move with a route */
    removePathFirst: (move: TimelineTextArg) =>
        text.t("timeline.refusals.route.removePathFirst", { move }),
    /** AP-R6: an edit this step can't do on a move with a route */
    notYet: (move: TimelineTextArg) =>
        text.t("timeline.refusals.route.notYet", { move }),
    /** The marcher has no part in the move */
    notInMove: (marcher: string) =>
        text.t("timeline.refusals.route.notInMove", { marcher }),
};

/** A marcher's drill number, as refusals name it. */
const marcherName = async (tx: DbTransaction, marcherId: number) => {
    const m = await tx
        .select({
            prefix: schema.marchers.drill_prefix,
            order: schema.marchers.drill_order,
        })
        .from(schema.marchers)
        .where(eq(schema.marchers.id, marcherId))
        .get();
    return m ? `${m.prefix}${m.order}` : `${marcherId}`;
};

/** How refusals name the move (timeline) `timelineId`. */
const moveNameOf = async (tx: DbTransaction, timelineId: number) => {
    const t = await tx
        .select()
        .from(schema.timelines)
        .where(eq(schema.timelines.id, timelineId))
        .get();
    if (!t) return `${timelineId}`;
    const words = await readMoveWords(tx);
    return moveName(
        { start: t.start_beat, end: t.end_beat },
        words.boxes,
        words.moves,
    );
};

/**
 * AP-R6: refuses (`E-ARGS`, "this move has a drawn path") when any of the moves `timelineIds`
 * has a route transition. For edits step 1 can't keep a route through: split by marchers,
 * merging, Remove keyframe's join, holds that would take a route marcher into its own move.
 */
export async function refuseRoutesInMoves(
    tx: DbTransaction,
    timelineIds: Iterable<number>,
): Promise<void> {
    const ids = [...new Set(timelineIds)];
    if (ids.length === 0) return;
    const T = schema.timeline_transitions;
    const withRoute = await tx
        .select({ timelineId: T.timeline_id })
        .from(T)
        .where(and(inArray(T.timeline_id, ids), isNotNull(T.route_id)))
        .orderBy(asc(T.timeline_id))
        .get();
    if (withRoute)
        refuse(routeRefusal.notYet(await moveNameOf(tx, withRoute.timelineId)));
}

/** AP-R6 by transition: refuses when any of `transitionIds` walks a route. */
export async function refuseRouteTransitions(
    tx: DbTransaction,
    transitionIds: Iterable<number>,
): Promise<void> {
    const ids = [...new Set(transitionIds)];
    if (ids.length === 0) return;
    const T = schema.timeline_transitions;
    const withRoute = await tx
        .select({ timelineId: T.timeline_id })
        .from(T)
        .where(and(inArray(T.id, ids), isNotNull(T.route_id)))
        .get();
    if (withRoute)
        refuse(routeRefusal.notYet(await moveNameOf(tx, withRoute.timelineId)));
}

/** AP-R2: the Move card's Straight and Arc refuse a move with a route; the route stays. */
export async function refuseMoveRoutesForPath(
    tx: DbTransaction,
    timelineId: number,
): Promise<void> {
    const T = schema.timeline_transitions;
    const withRoute = await tx
        .select({ id: T.id })
        .from(T)
        .where(and(eq(T.timeline_id, timelineId), isNotNull(T.route_id)))
        .get();
    if (withRoute)
        refuse(routeRefusal.removePathFirst(await moveNameOf(tx, timelineId)));
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** One marcher's route in one move. */
export interface MoveRoute {
    routeId: number;
    transitionId: number;
    timelineId: number;
    marcherId: number;
    start: number;
    end: number;
    geometry: RouteGeometry;
}

/** Every route, with its transition, move and marcher; or only those of `timelineId`. */
export async function readRoutes(
    db: DbConnection | DbTransaction,
    timelineId?: number,
): Promise<MoveRoute[]> {
    const T = schema.timeline_transitions;
    const R = schema.timeline_routes;
    const A = schema.timeline_assignments;
    const rows = await db
        .select({
            routeId: R.id,
            geometry: R.geometry,
            transitionId: T.id,
            timelineId: T.timeline_id,
            start: T.start_beat,
            end: T.end_beat,
            marcherId: A.marcher_id,
        })
        .from(R)
        .innerJoin(T, eq(T.route_id, R.id))
        .innerJoin(A, eq(A.transition_id, T.id))
        .where(
            timelineId === undefined
                ? undefined
                : eq(T.timeline_id, timelineId),
        )
        .orderBy(asc(R.id))
        .all();
    return rows.map((r) => ({
        ...r,
        geometry: JSON.parse(r.geometry) as RouteGeometry,
    }));
}

// ---------------------------------------------------------------------------
// AP-R1: draw a route, or draw it again
// ---------------------------------------------------------------------------

/** A point to draw: an existing point's `id` keeps it (a drag); a point without one is new. */
export interface RoutePointInput {
    id?: string;
    at: XY;
}

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/**
 * A fresh point id (spec 5.2): random, so an id that has left a route never comes back to it.
 * Exported for tests.
 */
export function freshPointId(taken: ReadonlySet<string>): string {
    for (;;) {
        let id = "";
        for (let i = 0; i < 8; i++)
            id += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
        if (!taken.has(id)) return id;
    }
}

/** Writes the route-model file version (10) with a file's first route (ADR 0010). */
async function markRouteModelInTransaction(tx: DbTransaction): Promise<void> {
    const row = await tx
        .select({ version: sql<number>`user_version` })
        .from(sql`pragma_user_version`)
        .get();
    if ((row?.version ?? 0) < ROUTE_MODEL_USER_VERSION)
        await tx.run(
            sql.raw(`PRAGMA user_version = ${ROUTE_MODEL_USER_VERSION}`),
        );
}

export interface DrawRouteResult {
    routeId: number;
    transitionId: number;
    /** The marcher got its own transition first (it was in a shape or shared move) */
    ownTransition: boolean;
}

/**
 * AP-R1: marcher `marcherId` walks `points` (inner corners, in walking order) in move
 * `timelineId`. A marcher in a shape or shared transition first gets its own one-slot shapeless
 * transition ending at its resolved destination, as point drags make one. With no route yet, the
 * route is inserted and the transition becomes `route` in one UPDATE (I-R2); with one, its
 * geometry is updated in place, keeping its id. `from` and `to` are the founding span's origin
 * and destination.
 *
 * Refused (`E-ARGS`, nothing written): a marcher not in the move; one taken over at the move's
 * start (its span there is a join, which step 1 walks straight); one following the leader (leaving
 * that move would move the others' targets). Invalid points are `E-R1`.
 */
export async function drawRouteInTransaction({
    tx,
    timelineId,
    marcherId,
    points,
}: {
    tx: DbTransaction;
    timelineId: number;
    marcherId: number;
    points: readonly RoutePointInput[];
}): Promise<DrawRouteResult> {
    const T = schema.timeline_transitions;
    const A = schema.timeline_assignments;
    const found = await tx
        .select({ row: A, transition: T })
        .from(A)
        .innerJoin(T, eq(A.transition_id, T.id))
        .where(and(eq(T.timeline_id, timelineId), eq(A.marcher_id, marcherId)))
        .get();
    if (!found)
        refuse(routeRefusal.notInMove(await marcherName(tx, marcherId)));
    const { row, transition } = found;
    if (transition.path_style === "follow_the_leader")
        refuse(routeRefusal.followsTheLeader(await marcherName(tx, marcherId)));

    // The founding span: read before anything is written
    const resolver = createResolver((await readTimelineTables(tx)).snapshot);
    const founding = resolver
        .spanInfos(marcherId)
        .find(
            (s) =>
                s.assignmentId === row.id &&
                s.start === transition.start_beat &&
                s.kind === "founding",
        );
    if (!founding)
        refuse(routeRefusal.takenOverAtStart(await marcherName(tx, marcherId)));
    const from = resolver.explain(marcherId, transition.start_beat).origin;
    const to = await destinationOf(tx, transition, row.slot_index);

    // The route's points: kept ids stay, new points get fresh ones
    const current =
        transition.route_id === null
            ? null
            : await tx
                  .select()
                  .from(schema.timeline_routes)
                  .where(eq(schema.timeline_routes.id, transition.route_id))
                  .get();
    const currentIds = new Set(
        current
            ? (JSON.parse(current.geometry) as RouteGeometry).points.map(
                  (p) => p.id,
              )
            : [],
    );
    const taken = new Set(currentIds);
    for (const p of points)
        if (p.id !== undefined && !currentIds.has(p.id))
            refuse(`point ${p.id} is not a point of this route`);
    const routePoints: RoutePoint[] = points.map((p) => {
        const id = p.id ?? freshPointId(taken);
        taken.add(id);
        return { id, at: [p.at[0], p.at[1]] };
    });
    const geometry: RouteGeometry = {
        v: 1,
        from: [from[0], from[1]],
        to: [to[0], to[1]],
        points: routePoints,
    };
    assertValid(validateRouteGeometry(geometry), "route");
    const json = JSON.stringify(geometry);

    return await mapDbErrors(async () => {
        if (current) {
            await tx
                .update(schema.timeline_routes)
                .set({ geometry: json })
                .where(eq(schema.timeline_routes.id, current.id));
            return {
                routeId: current.id,
                transitionId: transition.id,
                ownTransition: false,
            };
        }
        let transitionId = transition.id;
        let ownTransition = false;
        if (transition.dest_shape_id !== null || transition.slot_count > 1) {
            transitionId = await giveOwnTransition(tx, {
                transition,
                row,
                point: to,
            });
            ownTransition = true;
        }
        const route = (await tx
            .insert(schema.timeline_routes)
            .values({ geometry: json })
            .returning()
            .get())!;
        // One UPDATE: any two-statement order breaks the I-R2 CHECK
        await tx
            .update(T)
            .set({ path_style: "route", route_id: route.id, path_params: null })
            .where(eq(T.id, transitionId));
        await markRouteModelInTransaction(tx);
        return { routeId: route.id, transitionId, ownTransition };
    });
}

/** Where slot `slot` of `transition` ends (R-13): its shape's sample or its placed point. */
async function destinationOf(
    tx: DbTransaction,
    transition: typeof schema.timeline_transitions.$inferSelect,
    slot: number,
): Promise<XY> {
    if (transition.dest_shape_id !== null) {
        const shape = await tx
            .select()
            .from(schema.timeline_shapes)
            .where(eq(schema.timeline_shapes.id, transition.dest_shape_id))
            .get();
        if (!shape) refuse(`shape ${transition.dest_shape_id} does not exist`);
        return sampleShape(shape, transition.slot_count)[slot]!;
    }
    const D = schema.timeline_slot_destinations;
    const point = await tx
        .select()
        .from(D)
        .where(and(eq(D.transition_id, transition.id), eq(D.slot_index, slot)))
        .get();
    if (!point)
        refuse(
            `transition ${transition.id} has no destination for slot ${slot}`,
        );
    return [point.x, point.y];
}

/**
 * Moves `row` out of its shape or shared transition into a one-slot shapeless transition of its
 * own in the same move, ending at `point`, over the same counts and layer. The others keep their
 * slots (a vacancy is allowed, D-13), so nobody else moves; a transition left with nobody goes.
 */
async function giveOwnTransition(
    tx: DbTransaction,
    {
        transition,
        row,
        point,
    }: {
        transition: typeof schema.timeline_transitions.$inferSelect;
        row: typeof schema.timeline_assignments.$inferSelect;
        point: XY;
    },
): Promise<number> {
    const A = schema.timeline_assignments;
    await tx.delete(A).where(eq(A.id, row.id));
    const left = await tx
        .select({ id: A.id })
        .from(A)
        .where(eq(A.transition_id, transition.id))
        .get();
    if (!left)
        await deleteTimelineTransitionRowsInTransaction({
            tx,
            transitionIds: new Set([transition.id]),
        });
    const [own] = await createTimelineTransitionsInTransaction({
        tx,
        newTransitions: [
            {
                timelineId: transition.timeline_id,
                slotCount: 1,
                destination: { kind: "individual", points: [point] },
            },
        ],
    });
    await createTimelineAssignmentsInTransaction({
        tx,
        newAssignments: [
            {
                marcherId: row.marcher_id,
                transitionId: own!.id,
                slotIndex: 0,
                startBeat: row.start_beat,
                endBeat: row.end_beat,
                layer: row.layer,
            },
        ],
    });
    return own!.id;
}

/** AP-R1 as one undoable edit. */
export async function drawRoute(args: {
    db: DbConnection;
    timelineId: number;
    marcherId: number;
    points: readonly RoutePointInput[];
}): Promise<DrawRouteResult> {
    const { db, ...rest } = args;
    return await transactionWithHistory(db, "drawRoute", (tx) =>
        drawRouteInTransaction({ tx, ...rest }),
    );
}

// ---------------------------------------------------------------------------
// AP-R2: Remove path
// ---------------------------------------------------------------------------

/**
 * AP-R2: the route transition `transitionId` goes back to `direct` in one UPDATE, then its route
 * is deleted. That order is required: the foreign key refuses the other (I-D3), and undo replays
 * it reversed.
 */
export async function removeRouteInTransaction({
    tx,
    transitionId,
}: {
    tx: DbTransaction;
    transitionId: number;
}): Promise<void> {
    const T = schema.timeline_transitions;
    const t = await tx.select().from(T).where(eq(T.id, transitionId)).get();
    if (!t) refuse(`transition ${transitionId} does not exist`);
    if (t.route_id === null) refuse(`transition ${transitionId} has no path`);
    await mapDbErrors(async () => {
        await tx
            .update(T)
            .set({ path_style: "direct", route_id: null, path_params: null })
            .where(eq(T.id, transitionId));
        await tx
            .delete(schema.timeline_routes)
            .where(eq(schema.timeline_routes.id, t.route_id!));
    });
}

/** AP-R2 as one undoable edit. */
export async function removeRoute({
    db,
    transitionId,
}: {
    db: DbConnection;
    transitionId: number;
}): Promise<void> {
    await transactionWithHistory(db, "removeRoute", (tx) =>
        removeRouteInTransaction({ tx, transitionId }),
    );
}

// ---------------------------------------------------------------------------
// AP-R7: cut a route at a count
// ---------------------------------------------------------------------------

/** How one route transition is cut at a count (AP-R7), planned before anything is written. */
export interface RouteCut {
    /** The transition and its route, which stay with the half from the count */
    transitionId: number;
    routeId: number;
    /** The route's geometry from the count: `from = C`, the points past `d` */
    after: RouteGeometry;
    /** The new route of the half before: `from = A`, `to = C`, the points before `d` */
    before: RouteGeometry;
    /** Where the marcher is on the route at the count */
    C: XY;
}

/**
 * Plans AP-R7 for route transition `t`, whose one row `row` must have a founding span: `C` is
 * R-14's evaluation of that span at the count, and the cleaned path's points split at `d`. A
 * point at or within `EPS_GEOM` of `C` goes to neither half, and points R-14's cleaning drops are
 * dropped from storage too. Kept points keep their ids.
 *
 * Refused (`E-ARGS`): no founding span ("taken over at the start"), or a visible piece of `row`
 * other than it starting at or before the count ("taken over earlier"), since that resume would
 * become a founding span after the cut and walk the rest of the route.
 */
export async function planRouteCut(
    tx: DbTransaction,
    {
        resolver,
        t,
        row,
        beat,
    }: {
        resolver: ReturnType<typeof createResolver>;
        t: typeof schema.timeline_transitions.$inferSelect;
        row: typeof schema.timeline_assignments.$inferSelect;
        beat: number;
    },
): Promise<RouteCut> {
    const m = row.marcher_id;
    const pieces = resolver
        .spanInfos(m)
        .filter((s) => s.assignmentId === row.id)
        .sort((a, b) => a.start - b.start);
    const founding = pieces.find((s) => s.kind === "founding");
    if (!founding)
        refuse(routeRefusal.takenOverAtStart(await marcherName(tx, m)));
    if (pieces.some((p) => p !== founding && p.start <= beat))
        refuse(routeRefusal.takenOverEarlier(await marcherName(tx, m)));
    const route = await tx
        .select()
        .from(schema.timeline_routes)
        .where(eq(schema.timeline_routes.id, t.route_id!))
        .get();
    if (!route) refuse(`route ${t.route_id} does not exist`);
    const geometry = JSON.parse(route.geometry) as RouteGeometry;
    const A = resolver.explain(m, t.start_beat).origin;
    const B = await destinationOf(tx, t, row.slot_index);
    const path = routePath(
        A,
        geometry.points.map((p) => p.at),
        B,
    );
    const pB = (beat - t.start_beat) / (t.end_beat - t.start_beat);
    const d = pB * path.L;
    const C = routePoint(path, pB);
    const far = (k: number) =>
        Math.hypot(path.V[k]![0] - C[0], path.V[k]![1] - C[1]) >= EPS_GEOM;
    const inner = path.source
        .map((src, k) => ({ src, k }))
        .filter(({ src }) => src >= 0);
    const pointAt = (src: number): RoutePoint => {
        const p = geometry.points[src]!;
        return { id: p.id, at: [p.at[0], p.at[1]] };
    };
    const xy = (p: XY): XY => [p[0], p[1]];
    return {
        transitionId: t.id,
        routeId: route.id,
        C,
        before: {
            v: 1,
            from: xy(A),
            to: xy(C),
            points: inner
                .filter(({ k }) => path.D[k]! < d && far(k))
                .map(({ src }) => pointAt(src)),
        },
        after: {
            v: 1,
            from: xy(C),
            to: xy(B),
            points: inner
                .filter(({ k }) => path.D[k]! > d && far(k))
                .map(({ src }) => pointAt(src)),
        },
    };
}

/**
 * Writes the half before the count of a route cut: a new route, then the first half's own
 * one-slot transition in `beforeTimelineId` walking it to `C`, holding `row`'s part before the
 * count. The route goes first so the transition is inserted with it (I-R2).
 */
export async function writeRouteCutBeforeInTransaction(
    tx: DbTransaction,
    {
        cut,
        beforeTimelineId,
        row,
        end,
        orderMode,
    }: {
        cut: RouteCut;
        beforeTimelineId: number;
        row: typeof schema.timeline_assignments.$inferSelect;
        end: number;
        orderMode: "inherit" | "slot";
    },
): Promise<void> {
    assertValid(validateRouteGeometry(cut.before), "route");
    const route = (await tx
        .insert(schema.timeline_routes)
        .values({ geometry: JSON.stringify(cut.before) })
        .returning()
        .get())!;
    const [created] = await createTimelineTransitionsInTransaction({
        tx,
        newTransitions: [
            {
                timelineId: beforeTimelineId,
                slotCount: 1,
                destination: { kind: "individual", points: [cut.C] },
                pathStyle: "route",
                pathParams: null,
                orderMode,
                routeId: route.id,
            },
        ],
    });
    await createTimelineAssignmentsInTransaction({
        tx,
        newAssignments: [
            {
                marcherId: row.marcher_id,
                transitionId: created!.id,
                slotIndex: 0,
                startBeat: row.start_beat,
                endBeat: end,
                layer: row.layer,
            },
        ],
    });
}

/** Updates the route from the count in place, keeping its id (AP-R7). */
export async function writeRouteCutAfterInTransaction(
    tx: DbTransaction,
    cut: RouteCut,
): Promise<void> {
    assertValid(validateRouteGeometry(cut.after), "route");
    await tx
        .update(schema.timeline_routes)
        .set({ geometry: JSON.stringify(cut.after) })
        .where(eq(schema.timeline_routes.id, cut.routeId));
}
