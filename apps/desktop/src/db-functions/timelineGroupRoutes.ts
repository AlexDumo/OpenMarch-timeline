/**
 * Group paths, pathways steps 15 and 24 (spec v0.10 R-14′, Appendix J.8; ADR 0015): several
 * marchers of one move walk one route, each slot on its own **lane** (the route's reference line
 * moved by the lane's offset), and every member passes its copy of each point at the same
 * moment. Since step 24 a group path writes lanes on the members' slots and never moves a marcher
 * out of its move: a shaped or shared move stays as it is, and Remove path leaves it as it was.
 *
 * - **AP-R8** `drawGroupRouteInTransaction`: draw a group path for two or more marchers, or again.
 * - **AP-R1** (group branch) `editGroupRoutePointsInTransaction`: point edits on the open group
 *   path move every lane; no offset changes.
 * - **AP-R9** `detachInTransaction`: members break off with a verbatim copy of the group path,
 *   keeping offset and Adjust, so nobody moves (step 3c; it replaced step 15's baked Own path).
 * - **AP-R10** `rejoinGroupPathInTransaction`: marchers follow the group path (back from Detach,
 *   or new).
 *
 * AP-R2 (Remove path removes the whole group's) lives with the own-path procedures; AP-R3 and the
 * orphan sweep (AP-H3) in `timelineLanes`; AP-R7 refuses a group path in `timelineSplitAtBeat`.
 */
import { and, asc, eq, isNotNull } from "drizzle-orm";
import {
    createResolver,
    validateLaneOffset,
    validateRouteGeometry,
    type RouteGeometry,
    type RoutePoint,
    type XY,
} from "@openmarch/core";
import { schema } from "@/global/database/db";
import { readTimelineTables } from "@/timeline/timelineRows";
import type { DbConnection, DbTransaction } from "./types";
import { transactionWithHistory } from "./history";
import { assertValid, mapDbErrors, refuse } from "./timelineErrors";
import {
    destinationOf,
    freshPointId,
    marcherName,
    moveNameOf,
    refuseSharedSpot,
    routeRefusal,
    samePoint,
    storedPoint,
    type RoutePointInput,
} from "./timelineRoutes";
import {
    lastLegBulge,
    markArcsInTransaction,
    NOTHING_REHOMED,
    writeRouteGeometryInTransaction,
    type RehomeReport,
} from "./timelineRouteGeometry";
import {
    detachedSourceOf,
    isGroupLane,
    laneOffset,
    laneOn,
    lanesOfRoute,
    markLaneModelInTransaction,
    sweepOrphanRoutesInTransaction,
    type DatabaseTimelineLane,
} from "./timelineLanes";

type TransitionRow = typeof schema.timeline_transitions.$inferSelect;
type AssignmentRow = typeof schema.timeline_assignments.$inferSelect;

/** A marcher of the move as the group procedures read it, before anything is written. */
interface Member {
    marcherId: number;
    row: AssignmentRow;
    transition: TransitionRow;
    /** Its real start at the move's start (the origin of its founding span), R-14's A */
    A: XY;
    /** Its destination (R-13), R-14's B */
    B: XY;
    /** The lane on its slot, if any */
    lane: DatabaseTimelineLane | undefined;
}

/** A lane's offset columns for `offset` (spec J.1), validated (`E-P1`). */
export function offsetColumns(offset: XY): {
    offset_x: number;
    offset_y: number;
} {
    assertValid(validateLaneOffset([offset[0], offset[1]]), "lane offset");
    return { offset_x: offset[0], offset_y: offset[1] };
}

/**
 * The spec's mean (Appendix I.8): per coordinate, the sum in the order given from left to right in
 * float64, then one division by `n`. Callers pass members in ascending marcher id.
 */
export function meanOf(points: readonly XY[]): XY {
    let x = 0;
    let y = 0;
    for (const p of points) {
        x += p[0];
        y += p[1];
    }
    return [x / points.length, y / points.length];
}

const sub = (p: XY, q: XY): XY => [p[0] - q[0], p[1] - q[1]];

/**
 * Reads `marcherIds` in move `timelineId`, in ascending marcher id, with AP-R1's refusals naming
 * the first such marcher: not in the move, follows the leader there, taken over at its start.
 */
async function readMembers(
    tx: DbTransaction,
    timelineId: number,
    marcherIds: readonly number[],
): Promise<Member[]> {
    const T = schema.timeline_transitions;
    const A = schema.timeline_assignments;
    const ids = [...new Set(marcherIds)].sort((a, b) => a - b);
    const resolver = createResolver((await readTimelineTables(tx)).snapshot);
    const out: Member[] = [];
    for (const marcherId of ids) {
        const found = await tx
            .select({ row: A, transition: T })
            .from(A)
            .innerJoin(T, eq(A.transition_id, T.id))
            .where(
                and(eq(T.timeline_id, timelineId), eq(A.marcher_id, marcherId)),
            )
            .orderBy(asc(A.start_beat), asc(A.id))
            .get();
        if (!found)
            refuse(routeRefusal.notInMove(await marcherName(tx, marcherId)));
        const { row, transition } = found;
        if (transition.path_style === "follow_the_leader")
            refuse(
                routeRefusal.followsTheLeader(await marcherName(tx, marcherId)),
            );
        const founding = resolver
            .spanInfos(marcherId)
            .find(
                (s) =>
                    s.assignmentId === row.id &&
                    s.start === transition.start_beat &&
                    s.kind === "founding",
            );
        if (!founding)
            refuse(
                routeRefusal.takenOverAtStart(await marcherName(tx, marcherId)),
            );
        const origin = resolver.explain(
            marcherId,
            transition.start_beat,
        ).origin;
        out.push({
            marcherId,
            row,
            transition,
            A: [origin[0], origin[1]],
            B: await destinationOf(tx, transition, row.slot_index),
            lane: await laneOn(tx, transition.id, row.slot_index),
        });
    }
    return out;
}

/** One lane of a route with the row on its slot (its marcher) and its transition. */
export interface Walker {
    lane: DatabaseTimelineLane;
    transition: TransitionRow;
    row: AssignmentRow;
}

/** Every lane of `routeId` with a marcher on its slot, by marcher id. */
export async function walkersOf(
    tx: DbTransaction,
    routeId: number,
): Promise<Walker[]> {
    const T = schema.timeline_transitions;
    const A = schema.timeline_assignments;
    const L = schema.timeline_lanes;
    return await tx
        .select({ lane: L, transition: T, row: A })
        .from(L)
        .innerJoin(T, eq(T.id, L.transition_id))
        .innerJoin(
            A,
            and(
                eq(A.transition_id, L.transition_id),
                eq(A.slot_index, L.slot_index),
            ),
        )
        .where(eq(L.route_id, routeId))
        .orderBy(asc(A.marcher_id), asc(A.start_beat))
        .all();
}

/** Every lane of `routeId`, with its transition, by id (vacant ones too, owner Q1). */
async function lanesWithTransitions(tx: DbTransaction, routeId: number) {
    const T = schema.timeline_transitions;
    const L = schema.timeline_lanes;
    return await tx
        .select({ lane: L, transition: T })
        .from(L)
        .innerJoin(T, eq(T.id, L.transition_id))
        .where(eq(L.route_id, routeId))
        .orderBy(asc(L.id))
        .all();
}

export async function routeGeometryOf(
    tx: DbTransaction,
    routeId: number,
): Promise<RouteGeometry> {
    const r = await tx
        .select()
        .from(schema.timeline_routes)
        .where(eq(schema.timeline_routes.id, routeId))
        .get();
    if (!r) refuse(`route ${routeId} does not exist`);
    return JSON.parse(r.geometry) as RouteGeometry;
}

/**
 * Puts member `m`'s slot on route `routeId` with `offset`: updates the slot's lane, or inserts
 * one. No transition or row is written (AP-R8, AP-R10). A lane moved to another route loses its
 * Adjust, whose anchors named the old one (AP-R8); returns whether it had one.
 */
async function setLane(
    tx: DbTransaction,
    m: Member,
    routeId: number,
    offset: XY,
): Promise<boolean> {
    const L = schema.timeline_lanes;
    const columns = offsetColumns(offset);
    const leaves = m.lane !== undefined && m.lane.route_id !== routeId;
    const hadAdjust = leaves && m.lane!.adjust !== null;
    if (m.lane)
        await tx
            .update(L)
            .set({
                route_id: routeId,
                ...columns,
                ...(leaves ? { adjust: null } : {}),
            })
            .where(eq(L.id, m.lane.id));
    else
        await tx.insert(L).values({
            transition_id: m.transition.id,
            slot_index: m.row.slot_index,
            route_id: routeId,
            ...columns,
        });
    return hadAdjust;
}

/** Points to store: kept ids stay (refused when not `current`'s), new points get fresh ids. */
export function pointsToStore(
    points: readonly RoutePointInput[],
    current: RouteGeometry | null,
): RoutePoint[] {
    const currentIds = new Set(current?.points.map((p) => p.id) ?? []);
    const taken = new Set(currentIds);
    for (const p of points)
        if (p.id !== undefined && !currentIds.has(p.id))
            refuse(`point ${p.id} is not a point of this route`);
    return points.map((p) => {
        const id = p.id ?? freshPointId(taken);
        taken.add(id);
        return storedPoint(id, p.at, p.tension, p.bulge);
    });
}

// ---------------------------------------------------------------------------
// AP-R8: draw a group path, or draw it again
// ---------------------------------------------------------------------------

export interface DrawGroupRouteResult {
    routeId: number;
    /** Each member's transition, by marcher id (its own move's, unchanged) */
    transitions: Record<number, number>;
    /** Drawn again: what it did to the group path's Adjusts (AP-H1) */
    rehome: RehomeReport;
    /** A new path: how many spots lost an Adjust anchored on the route they left (AP-R8) */
    adjustsRemoved: number;
}

/**
 * AP-R8 (spec v0.10 J.8): the marchers `marcherIds` (two or more) in move `timelineId` walk one
 * group path through `points` (the reference line). `from` and `to` are the means of the members'
 * starts and destinations, and each member's lane offset is its start less `from`, so every
 * member starts on its lane. When the marchers are exactly the walkers of one group path in the
 * move, that route is updated in place and the offsets rewritten (draw it again); otherwise a new
 * route is inserted with a lane on each member's slot (a slot that had a lane is re-pointed), and
 * routes nobody walks any more are deleted (AP-H3). A group path keeping members outside the
 * selection stays as it is. No transition or row is written: members stay in their moves.
 */
// One procedure, read then written in the order the spec gives (AP-R8)
// eslint-disable-next-line max-lines-per-function
export async function drawGroupRouteInTransaction({
    tx,
    timelineId,
    marcherIds,
    points,
}: {
    tx: DbTransaction;
    timelineId: number;
    marcherIds: readonly number[];
    points: readonly RoutePointInput[];
}): Promise<DrawGroupRouteResult> {
    if (new Set(marcherIds).size < 2) refuse(routeRefusal.groupTooSmall());
    const members = await readMembers(tx, timelineId, marcherIds);
    const F = meanOf(members.map((m) => m.A));
    const G = meanOf(members.map((m) => m.B));
    const offsets = new Map(members.map((m) => [m.marcherId, sub(m.A, F)]));

    // Again: the selection is exactly the walkers of one group path in the move
    const groupRoutes = new Set(
        members
            .filter((m) => m.lane !== undefined && m.lane.offset_x !== null)
            .map((m) => m.lane!.route_id),
    );
    let again: { routeId: number; geometry: RouteGeometry } | null = null;
    if (groupRoutes.size === 1) {
        const [rid] = groupRoutes;
        const walkers = await walkersOf(tx, rid!);
        const walkerIds = new Set(walkers.map((w) => w.row.marcher_id));
        if (
            walkerIds.size === members.length &&
            members.every((m) => walkerIds.has(m.marcherId))
        )
            again = {
                routeId: rid!,
                geometry: await routeGeometryOf(tx, rid!),
            };
    }
    // D-22: a new path is personal; drawing it again from its own walkers is a path edit (07 N3)
    if (!again) {
        const inSelection = new Set(members.map((m) => m.marcherId));
        for (const m of members) await refuseSharedOutside(tx, m, inSelection);
    }
    const geometry: RouteGeometry = {
        v: 1,
        from: F,
        to: G,
        points: pointsToStore(points, again?.geometry ?? null),
    };
    assertValid(validateRouteGeometry(geometry), "route");
    const json = JSON.stringify(geometry);
    const transitions: Record<number, number> = Object.fromEntries(
        members.map((m) => [m.marcherId, m.transition.id]),
    );

    return await mapDbErrors(async () => {
        if (again) {
            const rehome = await writeRouteGeometryInTransaction(
                tx,
                again.routeId,
                geometry,
            );
            for (const m of members)
                await setLane(tx, m, again.routeId, offsets.get(m.marcherId)!);
            return {
                routeId: again.routeId,
                transitions,
                rehome,
                adjustsRemoved: 0,
            };
        }
        const route = (await tx
            .insert(schema.timeline_routes)
            .values({ geometry: json })
            .returning()
            .get())!;
        await markArcsInTransaction(tx, geometry);
        let adjustsRemoved = 0;
        for (const m of members)
            if (await setLane(tx, m, route.id, offsets.get(m.marcherId)!))
                adjustsRemoved++;
        await sweepOrphanRoutesInTransaction(tx);
        await markLaneModelInTransaction(tx);
        return {
            routeId: route.id,
            transitions,
            rehome: NOTHING_REHOMED,
            adjustsRemoved,
        };
    });
}

/** AP-R8's `SHARED`: refused when the other holder of a member's spot isn't in the selection. */
async function refuseSharedOutside(
    tx: DbTransaction,
    m: Member,
    inSelection: ReadonlySet<number>,
): Promise<void> {
    const A = schema.timeline_assignments;
    const rows = await tx
        .select({ marcher: A.marcher_id })
        .from(A)
        .where(
            and(
                eq(A.transition_id, m.transition.id),
                eq(A.slot_index, m.row.slot_index),
            ),
        )
        .all();
    if (rows.some((r) => !inSelection.has(r.marcher)))
        await refuseSharedSpot(tx, m.transition, m.row.slot_index, m.marcherId);
}

/** AP-R8 as one undoable edit. */
export async function drawGroupRoute(args: {
    db: DbConnection;
    timelineId: number;
    marcherIds: readonly number[];
    points: readonly RoutePointInput[];
}): Promise<DrawGroupRouteResult> {
    const { db, ...rest } = args;
    return await transactionWithHistory(db, "drawGroupRoute", (tx) =>
        drawGroupRouteInTransaction({ tx, ...rest }),
    );
}

// ---------------------------------------------------------------------------
// AP-R1, group branch: point edits on the open group path
// ---------------------------------------------------------------------------

/**
 * AP-R1 on a group path: the reference line's points become `points` (ids kept, as step 2's
 * edits), so every lane moves; no offset changes. `from` is kept while the first point keeps its
 * id and position, else written as the mean of `A_m − o_m` over the members with a founding span
 * at the move's start (kept when none has one); `to` likewise with the last point and the mean of
 * `B_k − o_k` over the route's lanes' slots (spec J.8). A path edit, never refused for who holds
 * the spots: it moves every occupant of them (07 N3).
 */
export async function editGroupRoutePointsInTransaction({
    tx,
    routeId,
    points,
    drag = false,
    toBulge,
}: {
    tx: DbTransaction;
    routeId: number;
    points: readonly RoutePointInput[];
    /** A point drag: it stops short rather than crowd Adjust keys (AP-R11) */
    drag?: boolean;
    /** The last leg's bulge (R-14″): a number sets it, null clears it, undefined keeps it */
    toBulge?: number | null;
}): Promise<RehomeReport> {
    const current = await routeGeometryOf(tx, routeId);
    const walkers = await walkersOf(tx, routeId);
    const lanes = await lanesWithTransitions(tx, routeId);
    if (
        walkers.length === 0 ||
        lanes.some(({ lane }) => lane.offset_x === null)
    )
        refuse(`route ${routeId} is not a group path`);
    const routePoints = pointsToStore(points, current);
    const keepFrom = samePoint(current.points[0], routePoints[0]);
    const keepTo = samePoint(current.points.at(-1), routePoints.at(-1));
    let from = current.from;
    let to = current.to;
    if (!keepFrom || !keepTo) {
        const resolver = createResolver(
            (await readTimelineTables(tx)).snapshot,
        );
        const starts: XY[] = [];
        const ends: XY[] = [];
        // `from`: over the founding occupants; `to`: over the lanes' slots (spec J.8 AP-R1)
        for (const w of walkers) {
            const o = laneOffset(w.lane)!;
            const founding = resolver
                .spanInfos(w.row.marcher_id)
                .some(
                    (s) =>
                        s.assignmentId === w.row.id &&
                        s.start === w.transition.start_beat &&
                        s.kind === "founding",
                );
            if (founding) {
                const A = resolver.explain(
                    w.row.marcher_id,
                    w.transition.start_beat,
                ).origin;
                starts.push(sub([A[0], A[1]], o));
            }
        }
        for (const { lane, transition } of lanes)
            ends.push(
                sub(
                    await destinationOf(tx, transition, lane.slot_index),
                    laneOffset(lane)!,
                ),
            );
        if (!keepFrom && starts.length > 0) from = meanOf(starts);
        if (!keepTo) to = meanOf(ends);
    }
    const geometry: RouteGeometry = {
        v: 1,
        from,
        to,
        ...lastLegBulge(current, toBulge),
        points: routePoints,
    };
    return await mapDbErrors(() =>
        writeRouteGeometryInTransaction(tx, routeId, geometry, { drag }),
    );
}

/** AP-R1 on a group path as one undoable edit. */
export async function editGroupRoutePoints(args: {
    db: DbConnection;
    routeId: number;
    points: readonly RoutePointInput[];
}): Promise<RehomeReport> {
    const { db, ...rest } = args;
    return await transactionWithHistory(db, "editGroupRoute", (tx) =>
        editGroupRoutePointsInTransaction({ tx, ...rest }),
    );
}

// ---------------------------------------------------------------------------
// AP-R9: Detach
// ---------------------------------------------------------------------------

/** A marcher's first row in move `timelineId` and the lane on its slot, if any. */
async function rowAndLane(
    tx: DbTransaction,
    timelineId: number,
    marcherId: number,
): Promise<
    | {
          row: AssignmentRow;
          transition: TransitionRow;
          lane?: DatabaseTimelineLane;
      }
    | undefined
> {
    const T = schema.timeline_transitions;
    const A = schema.timeline_assignments;
    const found = await tx
        .select({ row: A, transition: T })
        .from(A)
        .innerJoin(T, eq(A.transition_id, T.id))
        .where(and(eq(T.timeline_id, timelineId), eq(A.marcher_id, marcherId)))
        .orderBy(asc(A.start_beat), asc(A.id))
        .get();
    if (!found) return undefined;
    const lane = await laneOn(tx, found.transition.id, found.row.slot_index);
    return lane ? { ...found, lane } : found;
}

/**
 * AP-R9 Detach (spec v0.10 J.8, owner Q3 and Q5): each of `marcherIds` on a group path in move
 * `timelineId` gets its own copy of the path. The copy is the group path's route verbatim (its
 * geometry text, so every point id, tension and bulge, and `from` and `to`), and the marcher's lane
 * moves to it keeping its offset and Adjust, so every position stays bit-identical: the marcher
 * passes each point on the group's counts until the copy (or the group path) is edited. A K6 link
 * (`detached_from`) remembers the group path for Rejoin. Group paths nobody walks any more go, with
 * the links naming them (AP-H3), so detaching every member leaves copies only. One copy per spot;
 * the marcher stays in its move. Refused when a marcher doesn't walk a group path there, walks the
 * only lane of its path already (a copy), or shares its spot (D-22).
 */
export async function detachInTransaction({
    tx,
    timelineId,
    marcherIds,
}: {
    tx: DbTransaction;
    timelineId: number;
    marcherIds: readonly number[];
}): Promise<{ routes: Record<number, number> }> {
    const ids = [...new Set(marcherIds)].sort((a, b) => a - b);
    if (ids.length === 0) refuse("name the marchers to detach");
    const plan: { lane: DatabaseTimelineLane; marcherId: number }[] = [];
    const geometries = new Map<number, string>();
    for (const marcherId of ids) {
        const found = await rowAndLane(tx, timelineId, marcherId);
        const lane = found?.lane;
        if (!found || !lane || !isGroupLane(lane))
            refuse(
                routeRefusal.notOnGroupPath(await marcherName(tx, marcherId)),
            );
        await refuseSharedSpot(
            tx,
            found.transition,
            lane.slot_index,
            marcherId,
        );
        if ((await lanesOfRoute(tx, lane.route_id)).length < 2)
            refuse(
                routeRefusal.alreadyDetached(await marcherName(tx, marcherId)),
            );
        if (!geometries.has(lane.route_id)) {
            const r = await tx
                .select({ geometry: schema.timeline_routes.geometry })
                .from(schema.timeline_routes)
                .where(eq(schema.timeline_routes.id, lane.route_id))
                .get();
            if (!r) refuse(`route ${lane.route_id} does not exist`);
            geometries.set(lane.route_id, r.geometry);
        }
        plan.push({ lane, marcherId });
    }
    return await mapDbErrors(async () => {
        const routes: Record<number, number> = {};
        for (const { lane, marcherId } of plan) {
            const copy = (await tx
                .insert(schema.timeline_routes)
                .values({ geometry: geometries.get(lane.route_id)! })
                .returning()
                .get())!;
            // Offset and Adjust stay: the same inputs walk the same positions
            await tx
                .update(schema.timeline_lanes)
                .set({ route_id: copy.id })
                .where(eq(schema.timeline_lanes.id, lane.id));
            await tx.insert(schema.timeline_route_sources).values({
                route_id: copy.id,
                kind: "detached_from",
                source_route_id: lane.route_id,
            });
            routes[marcherId] = copy.id;
        }
        await sweepOrphanRoutesInTransaction(tx);
        return { routes };
    });
}

/** AP-R9 Detach as one undoable edit (every marcher at once is one undo step). */
export async function detachFromGroupPath(args: {
    db: DbConnection;
    timelineId: number;
    marcherIds: readonly number[];
}): Promise<{ routes: Record<number, number> }> {
    const { db, ...rest } = args;
    return await transactionWithHistory(db, "detachPath", (tx) =>
        detachInTransaction({ tx, ...rest }),
    );
}

// ---------------------------------------------------------------------------
// AP-R10: Rejoin
// ---------------------------------------------------------------------------

/**
 * AP-R10: the marchers `marcherIds` in move `timelineId` follow the group path `routeId` there.
 *
 * - **Back from Detach** (K6 says the marcher's lane walks a copy `detached_from` this path): the
 *   lane goes back to the group path with its offset unchanged and its Adjust cleared, always
 *   (owner Q4); undo brings the Adjust back. An unadjusted spot whose group path wasn't edited
 *   since is bit-identical to before Detach. The copy goes with its link (AP-H3).
 * - **New to the path:** each with the offset of where it stands now (`A_j − R.from`), so a member
 *   that drew its own path gets a lane again and a marcher on a straight, arc or shape move joins
 *   the group. Nobody leaves their move.
 *
 * Marchers already on it are left as they are. Routes nobody walks any more go (AP-H3).
 */
export async function rejoinGroupPathInTransaction({
    tx,
    timelineId,
    routeId,
    marcherIds,
}: {
    tx: DbTransaction;
    timelineId: number;
    routeId: number;
    marcherIds: readonly number[];
}): Promise<{ transitions: Record<number, number> }> {
    const walkers = (await walkersOf(tx, routeId)).filter(
        (w) => w.transition.timeline_id === timelineId,
    );
    if (walkers.length === 0 || walkers.some((w) => w.lane.offset_x === null))
        refuse(routeRefusal.noGroupPath(await moveNameOf(tx, timelineId)));
    const on = new Set(walkers.map((w) => w.row.marcher_id));
    const joining = [...new Set(marcherIds)]
        .filter((id) => !on.has(id))
        .sort((a, b) => a - b);
    // Nothing to rejoin: refused, not an empty edit (review of #683)
    if (joining.length === 0) refuse(routeRefusal.alreadyOnGroupPath());
    const back: {
        marcherId: number;
        lane: DatabaseTimelineLane;
        transitionId: number;
    }[] = [];
    const newcomers: number[] = [];
    for (const marcherId of joining) {
        const found = await rowAndLane(tx, timelineId, marcherId);
        const lane = found?.lane;
        if (
            found &&
            lane &&
            isGroupLane(lane) &&
            (await detachedSourceOf(tx, lane.route_id)) === routeId
        ) {
            // A personal edit of the spot: refused while someone else holds it (D-22)
            await refuseSharedSpot(
                tx,
                found.transition,
                lane.slot_index,
                marcherId,
            );
            back.push({ marcherId, lane, transitionId: found.transition.id });
        } else newcomers.push(marcherId);
    }
    const members = await readMembers(tx, timelineId, newcomers);
    const R = await routeGeometryOf(tx, routeId);
    return await mapDbErrors(async () => {
        const transitions: Record<number, number> = {};
        for (const { marcherId, lane, transitionId } of back) {
            await tx
                .update(schema.timeline_lanes)
                .set({ route_id: routeId, adjust: null })
                .where(eq(schema.timeline_lanes.id, lane.id));
            transitions[marcherId] = transitionId;
        }
        for (const m of members) {
            await setLane(tx, m, routeId, sub(m.A, R.from));
            transitions[m.marcherId] = m.transition.id;
        }
        await sweepOrphanRoutesInTransaction(tx);
        return { transitions };
    });
}

/** AP-R10 as one undoable edit. */
export async function rejoinGroupPath(args: {
    db: DbConnection;
    timelineId: number;
    routeId: number;
    marcherIds: readonly number[];
}): Promise<{ transitions: Record<number, number> }> {
    const { db, ...rest } = args;
    return await transactionWithHistory(db, "rejoinPath", (tx) =>
        rejoinGroupPathInTransaction({ tx, ...rest }),
    );
}

/**
 * The group paths walked in move `timelineId`, each with its walkers' marcher ids, how many lanes
 * it has (vacant ones too) and the group path it was Detached from (K6), if any.
 */
export async function readGroupPaths(
    db: DbConnection | DbTransaction,
    timelineId: number,
): Promise<
    {
        routeId: number;
        marcherIds: number[];
        laneCount: number;
        detachedFrom: number | null;
    }[]
> {
    const T = schema.timeline_transitions;
    const A = schema.timeline_assignments;
    const L = schema.timeline_lanes;
    const rows = await db
        .select({ routeId: L.route_id, marcherId: A.marcher_id })
        .from(L)
        .innerJoin(T, eq(T.id, L.transition_id))
        .innerJoin(
            A,
            and(
                eq(A.transition_id, L.transition_id),
                eq(A.slot_index, L.slot_index),
            ),
        )
        .where(and(eq(T.timeline_id, timelineId), isNotNull(L.offset_x)))
        .orderBy(asc(L.route_id), asc(A.marcher_id))
        .all();
    const out = new Map<number, number[]>();
    for (const r of rows) {
        const list = out.get(r.routeId) ?? [];
        if (!list.includes(r.marcherId)) list.push(r.marcherId);
        out.set(r.routeId, list);
    }
    const result = [];
    for (const [routeId, marcherIds] of out)
        result.push({
            routeId,
            marcherIds,
            laneCount: (await lanesOfRoute(db, routeId)).length,
            detachedFrom: await detachedSourceOf(db, routeId),
        });
    return result;
}
