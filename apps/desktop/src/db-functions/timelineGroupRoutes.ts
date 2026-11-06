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
 * - **AP-R9** `ownPathInTransaction`: members break off with a copy of their lane, as an own path
 *   (step 15's Own path; Detach, which keeps the group's counts, is step 3).
 * - **AP-R10** `rejoinGroupPathInTransaction`: marchers follow the group path (back, or new).
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
    routeRefusal,
    samePoint,
    storedPoint,
    type RoutePointInput,
} from "./timelineRoutes";
import {
    laneOffset,
    laneOn,
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
interface Walker {
    lane: DatabaseTimelineLane;
    transition: TransitionRow;
    row: AssignmentRow;
}

/** Every lane of `routeId` with a marcher on its slot, by marcher id. */
async function walkersOf(
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

async function routeGeometryOf(
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
 * one. No transition or row is written (AP-R8, AP-R10).
 */
async function setLane(
    tx: DbTransaction,
    m: Member,
    routeId: number,
    offset: XY,
): Promise<void> {
    const L = schema.timeline_lanes;
    const columns = offsetColumns(offset);
    if (m.lane)
        await tx
            .update(L)
            .set({ route_id: routeId, ...columns })
            .where(eq(L.id, m.lane.id));
    else
        await tx.insert(L).values({
            transition_id: m.transition.id,
            slot_index: m.row.slot_index,
            route_id: routeId,
            ...columns,
        });
}

/** Points to store: kept ids stay (refused when not `current`'s), new points get fresh ids. */
function pointsToStore(
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
        return storedPoint(id, p.at, p.tension);
    });
}

// ---------------------------------------------------------------------------
// AP-R8: draw a group path, or draw it again
// ---------------------------------------------------------------------------

export interface DrawGroupRouteResult {
    routeId: number;
    /** Each member's transition, by marcher id (its own move's, unchanged) */
    transitions: Record<number, number>;
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
            await tx
                .update(schema.timeline_routes)
                .set({ geometry: json })
                .where(eq(schema.timeline_routes.id, again.routeId));
            for (const m of members)
                await setLane(tx, m, again.routeId, offsets.get(m.marcherId)!);
            return { routeId: again.routeId, transitions };
        }
        const route = (await tx
            .insert(schema.timeline_routes)
            .values({ geometry: json })
            .returning()
            .get())!;
        for (const m of members)
            await setLane(tx, m, route.id, offsets.get(m.marcherId)!);
        await sweepOrphanRoutesInTransaction(tx);
        await markLaneModelInTransaction(tx);
        return { routeId: route.id, transitions };
    });
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
}: {
    tx: DbTransaction;
    routeId: number;
    points: readonly RoutePointInput[];
}): Promise<void> {
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
    const geometry: RouteGeometry = { v: 1, from, to, points: routePoints };
    assertValid(validateRouteGeometry(geometry), "route");
    await mapDbErrors(async () => {
        await tx
            .update(schema.timeline_routes)
            .set({ geometry: JSON.stringify(geometry) })
            .where(eq(schema.timeline_routes.id, routeId));
    });
}

/** AP-R1 on a group path as one undoable edit. */
export async function editGroupRoutePoints(args: {
    db: DbConnection;
    routeId: number;
    points: readonly RoutePointInput[];
}): Promise<void> {
    const { db, ...rest } = args;
    await transactionWithHistory(db, "editGroupRoute", (tx) =>
        editGroupRoutePointsInTransaction({ tx, ...rest }),
    );
}

// ---------------------------------------------------------------------------
// AP-R9: Own path
// ---------------------------------------------------------------------------

/**
 * AP-R9 (step 15's Own path): each of `marcherIds` on a group path in move `timelineId` gets its
 * own copy of its lane: a route with `from`, `to` and every point placed by its offset (ids and
 * tensions kept), and its slot's lane then walks it with no offset (an own lane, I-LN4). Group
 * paths nobody walks any more go (AP-H3). It walks the same line, at its own steady speed from now
 * on. The marcher stays in its move.
 */
export async function ownPathInTransaction({
    tx,
    timelineId,
    marcherIds,
}: {
    tx: DbTransaction;
    timelineId: number;
    marcherIds: readonly number[];
}): Promise<{ routes: Record<number, number> }> {
    const T = schema.timeline_transitions;
    const A = schema.timeline_assignments;
    const L = schema.timeline_lanes;
    const ids = [...new Set(marcherIds)].sort((a, b) => a - b);
    const plan: {
        lane: DatabaseTimelineLane;
        geometry: RouteGeometry;
        marcherId: number;
    }[] = [];
    for (const marcherId of ids) {
        const found = await tx
            .select({ lane: L })
            .from(A)
            .innerJoin(T, eq(A.transition_id, T.id))
            .innerJoin(
                L,
                and(
                    eq(L.transition_id, A.transition_id),
                    eq(L.slot_index, A.slot_index),
                ),
            )
            .where(
                and(
                    eq(T.timeline_id, timelineId),
                    eq(A.marcher_id, marcherId),
                    isNotNull(L.offset_x),
                ),
            )
            .orderBy(asc(A.start_beat), asc(A.id))
            .get();
        if (!found)
            refuse(
                routeRefusal.notOnGroupPath(await marcherName(tx, marcherId)),
            );
        const { lane } = found;
        const o = laneOffset(lane)!;
        const g = await routeGeometryOf(tx, lane.route_id);
        const add = (q: XY): XY => [q[0] + o[0], q[1] + o[1]];
        const geometry: RouteGeometry = {
            v: 1,
            from: add(g.from),
            to: add(g.to),
            points: g.points.map((p) =>
                storedPoint(p.id, add(p.at), p.tension),
            ),
        };
        assertValid(validateRouteGeometry(geometry), "route");
        plan.push({ lane, geometry, marcherId });
    }
    return await mapDbErrors(async () => {
        const routes: Record<number, number> = {};
        for (const { lane, geometry, marcherId } of plan) {
            const route = (await tx
                .insert(schema.timeline_routes)
                .values({ geometry: JSON.stringify(geometry) })
                .returning()
                .get())!;
            await tx
                .update(L)
                .set({ route_id: route.id, offset_x: null, offset_y: null })
                .where(eq(L.id, lane.id));
            routes[marcherId] = route.id;
        }
        await sweepOrphanRoutesInTransaction(tx);
        return { routes };
    });
}

/** AP-R9 as one undoable edit. */
export async function ownPath(args: {
    db: DbConnection;
    timelineId: number;
    marcherIds: readonly number[];
}): Promise<{ routes: Record<number, number> }> {
    const { db, ...rest } = args;
    return await transactionWithHistory(db, "ownPath", (tx) =>
        ownPathInTransaction({ tx, ...rest }),
    );
}

// ---------------------------------------------------------------------------
// AP-R10: Rejoin
// ---------------------------------------------------------------------------

/**
 * AP-R10: the marchers `marcherIds` in move `timelineId` follow the group path `routeId` there,
 * each with the offset of where it stands now (`A_j − R.from`), so a member that took Own path
 * gets back its old lane while nothing moved. A marcher on a straight, arc or shape move gets a
 * lane on its slot, so Rejoin also adds a marcher to the group, and nobody leaves their move.
 * Marchers already on it are left as they are. The routes they leave go once nobody walks them
 * (AP-H3).
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
    const joining = marcherIds.filter((id) => !on.has(id));
    // Nothing to rejoin: refused, not an empty edit (review of #683)
    if (joining.length === 0) refuse(routeRefusal.alreadyOnGroupPath());
    const members = await readMembers(tx, timelineId, joining);
    const R = await routeGeometryOf(tx, routeId);
    return await mapDbErrors(async () => {
        const transitions: Record<number, number> = {};
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

/** The group paths walked in move `timelineId`, each with its walkers' marcher ids. */
export async function readGroupPaths(
    db: DbConnection | DbTransaction,
    timelineId: number,
): Promise<{ routeId: number; marcherIds: number[] }[]> {
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
    return [...out].map(([routeId, marcherIds]) => ({ routeId, marcherIds }));
}
