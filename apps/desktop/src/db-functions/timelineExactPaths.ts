/**
 * Exact paths, ADR 0018 step 3 (spec Appendix M): one marcher's walk during one move, stored as
 * fixed shapes plus timing keys in ticks (480 a beat), in field units with y down like every other
 * resolver coordinate. It is a route with an `exact_path` (migration 0029), walked through the
 * marcher's own lane; the route's `geometry` holds only its ends, so a reader that doesn't know
 * exact paths sees a plain own path. The resolver walks it (EP-R) with its ends on the move's start
 * and end spots (EP-F), so the stored keys never change when a spot moves.
 *
 * What keeps the file sound around it, elsewhere:
 * - a point edit, Corner/Smooth, Re-fit or any other rewrite of the drawn geometry is refused
 *   (`writeRouteGeometryInTransaction`); drawing the marcher's path again replaces it with a drawn
 *   one (`drawRouteInTransaction`, `redrawPathInTransaction`);
 * - Remove path and a deleted move take it with its lane, as any route;
 * - Split at the playhead cuts it in two by EP-T (`planRouteCut`);
 * - a range edit retimes its keys to the move's new length (`retimeExactPathsInTransaction`).
 *
 * There is no editing UI yet (#1166 bakes and edits, #1165 imports); this is the one writer.
 */
import { and, asc, eq } from "drizzle-orm";
import {
    checkExactPath,
    createResolver,
    TICKS_PER_BEAT,
    validateRouteGeometry,
    type ExactPath,
} from "@openmarch/core";
import { schema } from "@/global/database/db";
import { readTimelineTables } from "@/timeline/timelineRows";
import type { DbConnection, DbTransaction } from "./types";
import { transactionWithHistory } from "./history";
import { assertValid, mapDbErrors, refuse } from "./timelineErrors";
import {
    laneOn,
    markExactPathModelInTransaction,
    markLaneModelInTransaction,
    sweepOrphanRoutesInTransaction,
} from "./timelineLanes";
import {
    exactRouteGeometry,
    marcherName,
    refuseSharedSpot,
    routeRefusal,
} from "./timelineRoutes";

/** What `setExactPathInTransaction` wrote. */
export interface SetExactPathResult {
    routeId: number;
    transitionId: number;
    slot: number;
}

/**
 * Refuses (`E-ARGS`) a path that breaks a rule of spec M.2 (EP-1 to EP-6), naming the rule, or
 * whose last key isn't `ticks` (EP-5: the move's length in ticks).
 */
export function refuseBadExactPath(path: ExactPath, ticks: number): void {
    const problems = checkExactPath(path);
    if (problems.length > 0)
        refuse(
            `exact path breaks ${problems[0]!.rule}: ${problems[0]!.message}`,
        );
    const last = path.keys[path.keys.length - 1]!.tick;
    if (last !== ticks)
        refuse(
            `exact path is ${last} ticks long but its move is ${ticks} (EP-5)`,
        );
}

/**
 * Stores `path` as marcher `marcherId`'s walk in move `timelineId` (ADR 0018 step 3), on its own
 * lane. The path's keys count ticks from the move's start and its last key is the move's length
 * (EP-5); its ends needn't be on the marcher's spots, which it follows when it plays (EP-F).
 *
 * - No lane on the slot: a new route with the path, and an own lane to it.
 * - An own lane: its route takes the path, keeping its id (a drawn path is replaced).
 * - A group path's lane: a new route with the path, and the lane re-pointed at it with no offset
 *   and no Adjust; the group path stays with the others ("an exact path belongs to one marcher").
 *
 * The file is written as version 19 (and 11, the lane model, if it wasn't). Refused (`E-ARGS`,
 * nothing written), as drawing a path is: a marcher not in the move, one following the leader,
 * one taken over at the move's start, one whose spot another marcher also walks; and a path that
 * breaks a rule.
 */
// One procedure, read then written in order, as drawRouteInTransaction
// eslint-disable-next-line max-lines-per-function
export async function setExactPathInTransaction({
    tx,
    timelineId,
    marcherId,
    path,
}: {
    tx: DbTransaction;
    timelineId: number;
    marcherId: number;
    path: ExactPath;
}): Promise<SetExactPathResult> {
    const T = schema.timeline_transitions;
    const A = schema.timeline_assignments;
    const R = schema.timeline_routes;
    const L = schema.timeline_lanes;
    const found = await tx
        .select({ row: A, transition: T })
        .from(A)
        .innerJoin(T, eq(A.transition_id, T.id))
        .where(and(eq(T.timeline_id, timelineId), eq(A.marcher_id, marcherId)))
        .orderBy(asc(A.start_beat), asc(A.id))
        .get();
    if (!found)
        refuse(routeRefusal.notInMove(await marcherName(tx, marcherId)));
    const { row, transition } = found;
    if (transition.path_style === "follow_the_leader")
        refuse(routeRefusal.followsTheLeader(await marcherName(tx, marcherId)));
    await refuseSharedSpot(tx, transition, row.slot_index, marcherId);
    const resolver = createResolver((await readTimelineTables(tx)).snapshot);
    const founding = resolver
        .spanInfos(marcherId)
        .some(
            (s) =>
                s.assignmentId === row.id &&
                s.start === transition.start_beat &&
                s.kind === "founding",
        );
    if (!founding)
        refuse(routeRefusal.takenOverAtStart(await marcherName(tx, marcherId)));
    refuseBadExactPath(
        path,
        (transition.end_beat - transition.start_beat) * TICKS_PER_BEAT,
    );
    const geometry = exactRouteGeometry(path);
    assertValid(validateRouteGeometry(geometry), "route");
    const stored = {
        geometry: JSON.stringify(geometry),
        exact_path: JSON.stringify(path),
    };

    const lane = await laneOn(tx, transition.id, row.slot_index);
    const result = (routeId: number): SetExactPathResult => ({
        routeId,
        transitionId: transition.id,
        slot: row.slot_index,
    });
    return await mapDbErrors(async () => {
        await markLaneModelInTransaction(tx);
        await markExactPathModelInTransaction(tx);
        if (lane && lane.offset_x === null) {
            await tx.update(R).set(stored).where(eq(R.id, lane.route_id));
            return result(lane.route_id);
        }
        const route = (await tx.insert(R).values(stored).returning().get())!;
        if (lane) {
            // Off the group path, as drawing an own path does (AP-R1)
            await tx
                .update(L)
                .set({
                    route_id: route.id,
                    offset_x: null,
                    offset_y: null,
                    adjust: null,
                })
                .where(eq(L.id, lane.id));
            // AP-H3: a group path left by its last marcher goes
            await sweepOrphanRoutesInTransaction(tx);
        } else
            await tx.insert(L).values({
                transition_id: transition.id,
                slot_index: row.slot_index,
                route_id: route.id,
                offset_x: null,
                offset_y: null,
            });
        return result(route.id);
    });
}

/** `setExactPathInTransaction` as one undoable edit. */
export async function setExactPath(args: {
    db: DbConnection;
    timelineId: number;
    marcherId: number;
    path: ExactPath;
}): Promise<SetExactPathResult> {
    const { db, ...rest } = args;
    return await transactionWithHistory(db, "setExactPath", (tx) =>
        setExactPathInTransaction({ tx, ...rest }),
    );
}
