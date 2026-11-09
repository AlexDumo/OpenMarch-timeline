/**
 * Path edits addressed by the path, pathways step 3a (spec Appendix I.10, AP-O8; model C 07 N3):
 * an open path's point edits and drawing it again name the route, never a marcher. They are path
 * edits, so the personal refusals of AP-R1 and AP-R8 (who is selected, taken over at the start,
 * more than one row in the move) never apply: after spots change hands the edit still reaches the
 * path, and moves whoever walks its lanes now (D-22).
 *
 * - `editPathPointsInTransaction`: AP-R1 "editing a route's points", own or group.
 * - `redrawPathInTransaction`: AP-R1 or AP-R8 "again", from the open or selected path.
 */
import {
    createResolver,
    validateRouteGeometry,
    type Resolver,
    type RouteGeometry,
    type XY,
} from "@openmarch/core";
import { eq } from "drizzle-orm";
import { schema } from "@/global/database/db";
import { readTimelineTables } from "@/timeline/timelineRows";
import type { DbConnection, DbTransaction } from "./types";
import { transactionWithHistory } from "./history";
import { assertValid, mapDbErrors, refuse } from "./timelineErrors";
import {
    destinationOf,
    samePoint,
    type RoutePointInput,
} from "./timelineRoutes";
import {
    editGroupRoutePointsInTransaction,
    meanOf,
    offsetColumns,
    pointsToStore,
    routeGeometryOf,
    walkersOf,
    type Walker,
} from "./timelineGroupRoutes";
import { isGroupLane, lanesOfRoute } from "./timelineLanes";

/** Whether walker `w`'s row founds its span at its transition's start (R-14's A is real). */
const founds = (resolver: Resolver, w: Walker): boolean =>
    resolver
        .spanInfos(w.row.marcher_id)
        .some(
            (s) =>
                s.assignmentId === w.row.id &&
                s.start === w.transition.start_beat &&
                s.kind === "founding",
        );

const originOf = (resolver: Resolver, w: Walker): XY => {
    const o = resolver.explain(
        w.row.marcher_id,
        w.transition.start_beat,
    ).origin;
    return [o[0], o[1]];
};

/** Whether route `routeId` is a group path (its lanes carry offsets); refused with no lane. */
async function isGroupRoute(
    tx: DbTransaction,
    routeId: number,
): Promise<boolean> {
    const lanes = await lanesOfRoute(tx, routeId);
    if (lanes.length === 0) refuse(`route ${routeId} has no lane`);
    return lanes.some(isGroupLane);
}

/**
 * AP-R1 on an own route, by the route: the whole new point list (ids kept, new points fresh, as
 * step 2). `from` is kept while the first point keeps its id and position, else written as the
 * real start `A` of the lane's founding occupant (kept when the spot has none); `to` likewise with
 * the last point and the lane slot's destination `B`. Nothing but the route's geometry is written.
 */
async function editOwnRoutePointsInTransaction(
    tx: DbTransaction,
    routeId: number,
    points: readonly RoutePointInput[],
): Promise<void> {
    const current = await routeGeometryOf(tx, routeId);
    const lanes = await lanesOfRoute(tx, routeId);
    if (lanes.length !== 1 || isGroupLane(lanes[0]!))
        refuse(`route ${routeId} is not an own path`);
    const lane = lanes[0]!;
    const routePoints = pointsToStore(points, current);
    const keepFrom = samePoint(current.points[0], routePoints[0]);
    const keepTo = samePoint(current.points.at(-1), routePoints.at(-1));
    let from = current.from;
    let to = current.to;
    if (!keepFrom) {
        const resolver = createResolver(
            (await readTimelineTables(tx)).snapshot,
        );
        const founder = (await walkersOf(tx, routeId)).find((w) =>
            founds(resolver, w),
        );
        if (founder) from = originOf(resolver, founder);
    }
    if (!keepTo) {
        const transition = await tx
            .select()
            .from(schema.timeline_transitions)
            .where(eq(schema.timeline_transitions.id, lane.transition_id))
            .get();
        if (!transition) refuse(`transition ${lane.transition_id} is gone`);
        to = await destinationOf(tx, transition, lane.slot_index);
    }
    const geometry: RouteGeometry = { v: 1, from, to, points: routePoints };
    assertValid(validateRouteGeometry(geometry), "route");
    await mapDbErrors(async () => {
        await tx
            .update(schema.timeline_routes)
            .set({ geometry: JSON.stringify(geometry) })
            .where(eq(schema.timeline_routes.id, routeId));
    });
}

/**
 * AP-R1 "editing a route's points" (spec J.8, I.10 AP-O8): the path `routeId`'s points become
 * `points`, own or group, whoever is selected and whoever holds its spots now. A group path's
 * offsets are kept, so every lane moves with the edit.
 */
export async function editPathPointsInTransaction({
    tx,
    routeId,
    points,
}: {
    tx: DbTransaction;
    routeId: number;
    points: readonly RoutePointInput[];
}): Promise<void> {
    if (await isGroupRoute(tx, routeId))
        await editGroupRoutePointsInTransaction({ tx, routeId, points });
    else await editOwnRoutePointsInTransaction(tx, routeId, points);
}

/** AP-O8's point edit as one undoable edit. */
export async function editPathPoints(args: {
    db: DbConnection;
    routeId: number;
    points: readonly RoutePointInput[];
}): Promise<void> {
    const { db, ...rest } = args;
    await transactionWithHistory(db, "editPathPoints", (tx) =>
        editPathPointsInTransaction({ tx, ...rest }),
    );
}

/**
 * Draw the path `routeId` again (AP-R1 or AP-R8 "again" from the open or selected path, I.10
 * AP-O8), keeping its id. The drawn points are all new (fresh ids).
 *
 * - **Own path:** as a point edit with every point new, so `from` and `to` are the real ends.
 * - **Group path:** `F` and `G` are the means of `A` and `B` over the lanes' founding occupants (in
 *   ascending marcher id); each of those lanes' offset is rewritten to `A − F`, so lanes start
 *   where their marchers stand now. A lane whose spot has no founding occupant keeps its offset.
 *   Refused (`E-ARGS`) when no lane has a founding occupant: nobody starts the path, so there is
 *   no middle to draw it from.
 */
export async function redrawPathInTransaction({
    tx,
    routeId,
    points,
}: {
    tx: DbTransaction;
    routeId: number;
    points: readonly RoutePointInput[];
}): Promise<void> {
    const fresh = points.map(({ at, tension }) =>
        tension === undefined ? { at } : { at, tension },
    );
    if (!(await isGroupRoute(tx, routeId))) {
        await editOwnRoutePointsInTransaction(tx, routeId, fresh);
        return;
    }
    const resolver = createResolver((await readTimelineTables(tx)).snapshot);
    const seenLanes = new Set<number>();
    const founders: { w: Walker; A: XY; B: XY }[] = [];
    for (const w of await walkersOf(tx, routeId)) {
        if (seenLanes.has(w.lane.id) || !founds(resolver, w)) continue;
        seenLanes.add(w.lane.id);
        founders.push({
            w,
            A: originOf(resolver, w),
            B: await destinationOf(tx, w.transition, w.lane.slot_index),
        });
    }
    if (founders.length === 0)
        refuse(`route ${routeId} has no marcher starting on it`);
    const F = meanOf(founders.map((f) => f.A));
    const G = meanOf(founders.map((f) => f.B));
    const geometry: RouteGeometry = {
        v: 1,
        from: F,
        to: G,
        points: pointsToStore(fresh, null),
    };
    assertValid(validateRouteGeometry(geometry), "route");
    await mapDbErrors(async () => {
        await tx
            .update(schema.timeline_routes)
            .set({ geometry: JSON.stringify(geometry) })
            .where(eq(schema.timeline_routes.id, routeId));
        for (const { w, A } of founders)
            await tx
                .update(schema.timeline_lanes)
                .set(offsetColumns([A[0] - F[0], A[1] - F[1]]))
                .where(eq(schema.timeline_lanes.id, w.lane.id));
    });
}

/** AP-O8's draw again as one undoable edit. */
export async function redrawPath(args: {
    db: DbConnection;
    routeId: number;
    points: readonly RoutePointInput[];
}): Promise<void> {
    const { db, ...rest } = args;
    await transactionWithHistory(db, "redrawPath", (tx) =>
        redrawPathInTransaction({ tx, ...rest }),
    );
}
