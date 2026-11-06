/**
 * Group paths, pathways step 15 (spec v0.9 R-14 "Group schedule", Appendix I.8): several marchers
 * of one move walk one route, each on its own lane (the route's reference line moved by its
 * offset, `path_params.offset`), and every member passes its copy of each point at the same moment.
 *
 * - **AP-R8** `drawGroupRouteInTransaction`: draw a group path for two or more marchers, or again.
 * - **AP-R1** (group branch) `editGroupRoutePointsInTransaction`: point edits on the open group
 *   path move every lane; no offset changes.
 * - **AP-R9** `ownPathInTransaction`: members break off with a copy of their lane.
 * - **AP-R10** `rejoinGroupPathInTransaction`: marchers follow the group path (back, or new).
 *
 * AP-R2 (Remove path removes the whole group's) and AP-R3 (a route goes once nobody walks it)
 * live with the step 1 procedures; AP-R7 refuses a group path in `timelineSplitAtBeat`.
 */
import { and, asc, eq, isNotNull } from "drizzle-orm";
import {
    createResolver,
    validatePathParams,
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
    deleteOrphanRoutesInTransaction,
    destinationOf,
    freshPointId,
    giveOwnTransition,
    marcherName,
    markRouteModelInTransaction,
    moveNameOf,
    routeRefusal,
    samePoint,
    storedPoint,
    type RoutePointInput,
} from "./timelineRoutes";

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
}

/** `path_params` of a group member: its offset (spec 5.2, I-R4), validated (`E-P1`). */
export function offsetParams(offset: XY): string {
    const params = { offset: [offset[0], offset[1]] as XY };
    assertValid(validatePathParams("route", params), "path params");
    return JSON.stringify(params);
}

/** A group member's offset from its `path_params`, or null for an own path or none. */
export function offsetOf(pathParams: string | null): XY | null {
    if (pathParams === null) return null;
    const p = JSON.parse(pathParams) as { offset?: XY };
    return p.offset ?? null;
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
            .orderBy(asc(A.start_beat))
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
        });
    }
    return out;
}

/** Every transition walking `routeId`, in ascending id, with its one row's marcher. */
async function walkersOf(tx: DbTransaction, routeId: number) {
    const T = schema.timeline_transitions;
    const A = schema.timeline_assignments;
    return await tx
        .select({ transition: T, row: A })
        .from(T)
        .innerJoin(A, eq(A.transition_id, T.id))
        .where(eq(T.route_id, routeId))
        .orderBy(asc(A.marcher_id))
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

/** The move's members' transition, made its own one-slot shapeless one first if needed (AP-R1). */
async function ownTransitionOf(tx: DbTransaction, m: Member): Promise<number> {
    const T = schema.timeline_transitions;
    // Re-read: an earlier member leaving a shared transition may have changed nothing here, but
    // the row may now be the transition's only one
    const t = (await tx
        .select()
        .from(T)
        .where(eq(T.id, m.transition.id))
        .get())!;
    if (t.dest_shape_id === null && t.slot_count === 1) return t.id;
    return await giveOwnTransition(tx, {
        transition: t,
        row: m.row,
        point: m.B,
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
    /** Each member's transition, by marcher id */
    transitions: Record<number, number>;
}

/**
 * AP-R8: the marchers `marcherIds` (two or more) in move `timelineId` walk one group path through
 * `points` (the reference line). `from` and `to` are the means of the members' starts and
 * destinations, and each member's offset is its start less `from`, so every member starts on its
 * lane. When the marchers are exactly the walkers of one group path in the move, that route is
 * updated in place and the offsets rewritten (draw it again); otherwise a new route is inserted,
 * and routes nobody walks any more are deleted. A group path keeping members outside the
 * selection stays as it is.
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
            .filter(
                (m) =>
                    m.transition.path_style === "route" &&
                    m.transition.path_params !== null,
            )
            .map((m) => m.transition.route_id!),
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
    const T = schema.timeline_transitions;

    return await mapDbErrors(async () => {
        const transitions: Record<number, number> = {};
        if (again) {
            await tx
                .update(schema.timeline_routes)
                .set({ geometry: json })
                .where(eq(schema.timeline_routes.id, again.routeId));
            for (const m of members) {
                await tx
                    .update(T)
                    .set({
                        path_params: offsetParams(offsets.get(m.marcherId)!),
                    })
                    .where(eq(T.id, m.transition.id));
                transitions[m.marcherId] = m.transition.id;
            }
            return { routeId: again.routeId, transitions };
        }
        const own: number[] = [];
        for (const m of members) own.push(await ownTransitionOf(tx, m));
        const route = (await tx
            .insert(schema.timeline_routes)
            .values({ geometry: json })
            .returning()
            .get())!;
        const old: number[] = [];
        for (const [i, m] of members.entries()) {
            if (m.transition.route_id !== null) old.push(m.transition.route_id);
            // One UPDATE: any two-statement order breaks the I-R2 CHECK
            await tx
                .update(T)
                .set({
                    path_style: "route",
                    route_id: route.id,
                    path_params: offsetParams(offsets.get(m.marcherId)!),
                })
                .where(eq(T.id, own[i]!));
            transitions[m.marcherId] = own[i]!;
        }
        await deleteOrphanRoutesInTransaction(tx, old);
        await markRouteModelInTransaction(tx);
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
 * `B_m − o_m` over every member.
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
    if (
        walkers.length === 0 ||
        walkers.some((w) => w.transition.path_params === null)
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
        for (const w of walkers) {
            const o = offsetOf(w.transition.path_params)!;
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
            ends.push(
                sub(await destinationOf(tx, w.transition, w.row.slot_index), o),
            );
        }
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
 * AP-R9: each of `marcherIds` on a group path in move `timelineId` gets its own copy of its lane:
 * a route with `from`, `to` and every point placed by its offset (ids and tensions kept), and its
 * transition then walks it with `path_params` NULL. Group paths nobody walks any more go. It walks
 * the same line, at its own steady speed from now on.
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
    const ids = [...new Set(marcherIds)].sort((a, b) => a - b);
    const plan: {
        transition: TransitionRow;
        geometry: RouteGeometry;
        marcherId: number;
    }[] = [];
    for (const marcherId of ids) {
        const found = await tx
            .select({ transition: T })
            .from(A)
            .innerJoin(T, eq(A.transition_id, T.id))
            .where(
                and(
                    eq(T.timeline_id, timelineId),
                    eq(A.marcher_id, marcherId),
                    isNotNull(T.route_id),
                    isNotNull(T.path_params),
                ),
            )
            .get();
        if (!found)
            refuse(
                routeRefusal.notOnGroupPath(await marcherName(tx, marcherId)),
            );
        const { transition } = found;
        const o = offsetOf(transition.path_params)!;
        const g = await routeGeometryOf(tx, transition.route_id!);
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
        plan.push({ transition, geometry, marcherId });
    }
    return await mapDbErrors(async () => {
        const routes: Record<number, number> = {};
        for (const { transition, geometry, marcherId } of plan) {
            const route = (await tx
                .insert(schema.timeline_routes)
                .values({ geometry: JSON.stringify(geometry) })
                .returning()
                .get())!;
            await tx
                .update(T)
                .set({ route_id: route.id, path_params: null })
                .where(eq(T.id, transition.id));
            routes[marcherId] = route.id;
        }
        await deleteOrphanRoutesInTransaction(
            tx,
            plan.map((p) => p.transition.route_id!),
        );
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
 * gets back its old lane while nothing moved. A marcher on a straight, arc or shape move first
 * gets its own one-slot transition (AP-R1), so Rejoin also adds a marcher to the group. Marchers
 * already on it are left as they are. The routes they leave go once nobody walks them.
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
    const T = schema.timeline_transitions;
    const walkers = (await walkersOf(tx, routeId)).filter(
        (w) => w.transition.timeline_id === timelineId,
    );
    if (
        walkers.length === 0 ||
        walkers.some((w) => w.transition.path_params === null)
    )
        refuse(routeRefusal.noGroupPath(await moveNameOf(tx, timelineId)));
    const on = new Set(walkers.map((w) => w.row.marcher_id));
    const joining = marcherIds.filter((id) => !on.has(id));
    // Nothing to rejoin: refused, not an empty edit (review of #683)
    if (joining.length === 0) refuse(routeRefusal.alreadyOnGroupPath());
    const members = await readMembers(tx, timelineId, joining);
    const R = await routeGeometryOf(tx, routeId);
    return await mapDbErrors(async () => {
        const transitions: Record<number, number> = {};
        const old: number[] = [];
        for (const m of members) {
            const tid = await ownTransitionOf(tx, m);
            if (m.transition.route_id !== null) old.push(m.transition.route_id);
            await tx
                .update(T)
                .set({
                    path_style: "route",
                    route_id: routeId,
                    path_params: offsetParams(sub(m.A, R.from)),
                })
                .where(eq(T.id, tid));
            transitions[m.marcherId] = tid;
        }
        await deleteOrphanRoutesInTransaction(tx, old);
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
    const rows = await db
        .select({ routeId: T.route_id, marcherId: A.marcher_id })
        .from(T)
        .innerJoin(A, eq(A.transition_id, T.id))
        .where(
            and(
                eq(T.timeline_id, timelineId),
                isNotNull(T.route_id),
                isNotNull(T.path_params),
            ),
        )
        .orderBy(asc(T.route_id), asc(A.marcher_id))
        .all();
    const out = new Map<number, number[]>();
    for (const r of rows) {
        const list = out.get(r.routeId!) ?? [];
        list.push(r.marcherId);
        out.set(r.routeId!, list);
    }
    return [...out].map(([routeId, marcherIds]) => ({ routeId, marcherIds }));
}
