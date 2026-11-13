/**
 * Pins, pathways step 5 (spec Appendix M, J.2 K1): a point of a drawn path pinned to a count, so
 * every marcher on the path passes it on that count. Pins live on the route (`timeline_routes.
 * timing`), so a group path's lanes share them through the group clock (R-14′ item 2).
 *
 * - **AP-P1** `pinPointInTransaction`: pin a point to a whole count, or move its pin.
 * - **AP-P2** `pinAtPlayheadInTransaction`: the playhead marker dropped on a point, or on a
 *   straight stretch, where it adds a corner first.
 * - **AP-P3** `removePinInTransaction`.
 * - **AP-P4** `putCornersOnCountsInTransaction`: a pin on every corner, by length (M-COUNTS).
 * - **AP-P5** `scaleMovePinsInTransaction`: Scale pins instead, after a resize that kept them.
 *
 * What range edits and geometry writes do to pins is in `timelineRoutePinRetime`, which is
 * renderer-free: AP-R4 (`planPinRetime` for `setTimelineRangeInTransaction`, `planPinRipple` for
 * page-flag drags and counts inserted or deleted) and AP-H1 (`dropPinsOfMissingPointsInTransaction`,
 * for the one route geometry writer).
 *
 * Every write of a pin raises the file version to 15 (`markPinModelInTransaction`).
 */
import { asc, eq, inArray } from "drizzle-orm";
import {
    createResolver,
    groupSchedule,
    placeOfPoint,
    placeOnCounts,
    routePath,
    type RouteGeometry,
    type RoutePath,
    type RoutePin,
    type XY,
} from "@openmarch/core";
import { schema } from "@/global/database/db";
import { readTimelineTables } from "@/timeline/timelineRows";
import type { DbConnection, DbTransaction } from "./types";
import { transactionWithHistory } from "./history";
import { mapDbErrors, refuse } from "./timelineErrors";
import { markPinModelInTransaction } from "./timelineLanes";
import type { RoutePointInput } from "./timelineRoutes";
import { editPathPointsInTransaction } from "./timelinePathEdits";
import {
    pinRefusal,
    pinsOf,
    retimePins,
    timingJson,
    writePinRetime,
} from "./timelineRoutePinRetime";

export {
    pinRefusal,
    pinsOf,
    timingJson,
    retimePins,
    readMovePins,
    type PinRetime,
} from "./timelineRoutePinRetime";

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** What a pin procedure reads of a route: its row, geometry, move and whether it's a group's. */
interface RouteContext {
    routeId: number;
    geometry: RouteGeometry;
    pins: RoutePin[];
    /** The move's range (one for every lane of a route, I-LN5 and C-11) */
    start: number;
    end: number;
    group: boolean;
    trail: boolean;
    /** The lanes' transitions, by id */
    transitionIds: number[];
}

async function readRouteContext(
    tx: DbConnection | DbTransaction,
    routeId: number,
): Promise<RouteContext> {
    const R = schema.timeline_routes;
    const T = schema.timeline_transitions;
    const L = schema.timeline_lanes;
    const route = await tx.select().from(R).where(eq(R.id, routeId)).get();
    if (!route) refuse(`route ${routeId} does not exist`);
    const trailOf = await tx
        .select()
        .from(T)
        .where(eq(T.route_id, routeId))
        .get();
    const lanes = await tx
        .select()
        .from(L)
        .where(eq(L.route_id, routeId))
        .orderBy(asc(L.id))
        .all();
    const transitionIds = [...new Set(lanes.map((l) => l.transition_id))];
    const transitions =
        transitionIds.length === 0
            ? []
            : await tx
                  .select()
                  .from(T)
                  .where(inArray(T.id, transitionIds))
                  .all();
    const range = trailOf ?? transitions[0];
    if (!range) refuse(`route ${routeId} is walked by nobody`);
    return {
        routeId,
        geometry: JSON.parse(route.geometry) as RouteGeometry,
        pins: pinsOf(route.timing),
        start: range.start_beat,
        end: range.end_beat,
        group: lanes.some((l) => l.offset_x !== null),
        trail: !!trailOf,
        transitionIds,
    };
}

/**
 * The walk a route's pins are measured on (R-15): the reference walk W for a group path; for an
 * own path, its walk from where its marcher stands to its end spot, read from the resolver.
 */
async function knotPathOf(
    tx: DbConnection | DbTransaction,
    ctx: RouteContext,
): Promise<RoutePath> {
    const g = ctx.geometry;
    if (ctx.group) return groupSchedule(g).W;
    const L = schema.timeline_lanes;
    const A = schema.timeline_assignments;
    const lane = await tx
        .select()
        .from(L)
        .where(eq(L.route_id, ctx.routeId))
        .get();
    const row = lane
        ? await tx
              .select()
              .from(A)
              .where(eq(A.transition_id, lane.transition_id))
              .all()
        : [];
    const own = row.find((r) => r.slot_index === lane?.slot_index);
    if (!own) return routePath(g.from, g.points, g.to, g);
    const resolver = createResolver((await readTimelineTables(tx)).snapshot);
    const from: XY = resolver.positionAt(own.marcher_id, ctx.start);
    const to: XY = resolver.positionAt(own.marcher_id, ctx.end);
    return routePath(from, g.points, to, g);
}

// ---------------------------------------------------------------------------
// AP-P1, AP-P3: pin a point, remove a pin
// ---------------------------------------------------------------------------

/**
 * The pins `pins` with point `pointId` pinned on `count` (moved when it had one), in route
 * order. Refused when the count isn't whole or not inside the move, or out of order with the
 * pins either side of the point.
 */
export function withPin(
    geometry: RouteGeometry,
    pins: readonly RoutePin[],
    pointId: string,
    count: number,
    counts: number,
): RoutePin[] {
    const index = geometry.points.findIndex((p) => p.id === pointId);
    if (index < 0) refuse(pinRefusal.noPoint());
    if (!Number.isInteger(count) || count < 1 || count > counts - 1)
        refuse(pinRefusal.countRange(counts - 1));
    const order = (id: string) => geometry.points.findIndex((p) => p.id === id);
    const others = pins.filter(
        (p) => p.point !== pointId && order(p.point) >= 0,
    );
    const before = others
        .filter((p) => order(p.point) < index)
        .reduce<RoutePin | null>(
            (best, p) => (best === null || p.at > best.at ? p : best),
            null,
        );
    const after = others
        .filter((p) => order(p.point) > index)
        .reduce<RoutePin | null>(
            (best, p) => (best === null || p.at < best.at ? p : best),
            null,
        );
    if (before && !(count > before.at)) refuse(pinRefusal.afterPin(before.at));
    if (after && !(count < after.at)) refuse(pinRefusal.beforePin(after.at));
    return [...others, { point: pointId, at: count }].sort(
        (a, b) => order(a.point) - order(b.point),
    );
}

async function writePins(
    tx: DbTransaction,
    routeId: number,
    pins: readonly RoutePin[],
): Promise<void> {
    await mapDbErrors(async () => {
        await tx
            .update(schema.timeline_routes)
            .set({ timing: timingJson(pins) })
            .where(eq(schema.timeline_routes.id, routeId));
    });
    if (pins.length > 0) await markPinModelInTransaction(tx);
}

/** AP-P1: pins point `pointId` of route `routeId` on `count` (beats into the move). */
export async function pinPointInTransaction({
    tx,
    routeId,
    pointId,
    count,
}: {
    tx: DbTransaction;
    routeId: number;
    pointId: string;
    count: number;
}): Promise<RoutePin[]> {
    const ctx = await readRouteContext(tx, routeId);
    if (ctx.trail) refuse(pinRefusal.trail());
    const pins = withPin(
        ctx.geometry,
        ctx.pins,
        pointId,
        count,
        ctx.end - ctx.start,
    );
    await writePins(tx, routeId, pins);
    return pins;
}

/** AP-P1 as one undoable edit. */
export async function pinPoint(args: {
    db: DbConnection;
    routeId: number;
    pointId: string;
    count: number;
}): Promise<RoutePin[]> {
    const { db, ...rest } = args;
    return await transactionWithHistory(db, "pinPoint", (tx) =>
        pinPointInTransaction({ tx, ...rest }),
    );
}

/** AP-P3: takes the pin off point `pointId`; NULL timing when it was the last. */
export async function removePinInTransaction({
    tx,
    routeId,
    pointId,
}: {
    tx: DbTransaction;
    routeId: number;
    pointId: string;
}): Promise<void> {
    const ctx = await readRouteContext(tx, routeId);
    const pins = ctx.pins.filter((p) => p.point !== pointId);
    if (pins.length === ctx.pins.length) refuse(pinRefusal.noPoint());
    await writePins(tx, routeId, pins);
}

/** AP-P3 as one undoable edit. */
export async function removePin(args: {
    db: DbConnection;
    routeId: number;
    pointId: string;
}): Promise<void> {
    const { db, ...rest } = args;
    await transactionWithHistory(db, "removePin", (tx) =>
        removePinInTransaction({ tx, ...rest }),
    );
}

// ---------------------------------------------------------------------------
// AP-P2: pin at the playhead
// ---------------------------------------------------------------------------

/** Where the playhead marker was dropped: on a point, or on a straight stretch before point `before`. */
export type PinDrop =
    | { readonly kind: "point"; readonly pointId: string }
    | {
          readonly kind: "stretch";
          /** The new corner goes before stored point `before` (the points' length: after the last) */
          readonly before: number;
          readonly at: XY;
      };

/**
 * AP-P2: pins the drop to the playhead's count (`count`, beats into the move). On a stretch a
 * corner is added there first with `editPoints` (the path's point edit, so AP-H1 and the group's
 * rules run as for any added point), then pinned: one edit. The caller says the stretch is
 * straight; refused otherwise is the field's job, which knows the shape as drawn.
 */
export async function pinAtPlayheadInTransaction({
    tx,
    routeId,
    count,
    drop,
    editPoints,
}: {
    tx: DbTransaction;
    routeId: number;
    count: number;
    drop: PinDrop;
    /** The path's point edit (`editPathPointsInTransaction`); injectable for tests */
    editPoints?: (
        tx: DbTransaction,
        routeId: number,
        points: readonly RoutePointInput[],
    ) => Promise<unknown>;
}): Promise<string> {
    const ctx = await readRouteContext(tx, routeId);
    if (ctx.trail) refuse(pinRefusal.trail());
    if (
        !Number.isInteger(count) ||
        count < 1 ||
        count > ctx.end - ctx.start - 1
    )
        refuse(pinRefusal.playheadOff());
    if (drop.kind === "point") {
        await pinPointInTransaction({
            tx,
            routeId,
            pointId: drop.pointId,
            count,
        });
        return drop.pointId;
    }
    const points = ctx.geometry.points;
    if (drop.before < 0 || drop.before > points.length)
        refuse(pinRefusal.dropOnPoint());
    // A group path's legs onto and off it are each member's own: only between its points
    if (ctx.group && (drop.before === 0 || drop.before === points.length))
        refuse(pinRefusal.dropOnPoint());
    const inputs: RoutePointInput[] = points.map((p) => ({
        id: p.id,
        at: p.at,
        ...(p.tension === undefined ? {} : { tension: p.tension }),
        ...(p.bulge === undefined ? {} : { bulge: p.bulge }),
    }));
    inputs.splice(drop.before, 0, { at: drop.at });
    await (editPoints
        ? editPoints(tx, routeId, inputs)
        : editPathPointsInTransaction({ tx, routeId, points: inputs }));
    const after = await readRouteContext(tx, routeId);
    const added = after.geometry.points[drop.before];
    const known = new Set(points.map((p) => p.id));
    if (!added || known.has(added.id)) refuse(pinRefusal.dropOnPoint());
    await pinPointInTransaction({ tx, routeId, pointId: added.id, count });
    return added.id;
}

/** AP-P2 as one undoable edit; returns the pinned point's id. */
export async function pinAtPlayhead(args: {
    db: DbConnection;
    routeId: number;
    count: number;
    drop: PinDrop;
}): Promise<string> {
    const { db, ...rest } = args;
    return await transactionWithHistory(db, "pinAtPlayhead", (tx) =>
        pinAtPlayheadInTransaction({ tx, ...rest }),
    );
}

// ---------------------------------------------------------------------------
// AP-P4: Put corners on counts
// ---------------------------------------------------------------------------

/**
 * AP-P4's pins for a route: one on every corner (a kept inner point that isn't smooth), at the
 * whole count its share of the walk's length gives at one steady speed, placed by M-COUNTS.
 */
export function cornerPins(
    geometry: RouteGeometry,
    path: RoutePath,
    counts: number,
): RoutePin[] {
    const kept = new Set(path.source.filter((s) => s >= 0));
    const corners = geometry.points
        .map((p, i) => ({ p, i }))
        .filter(({ p, i }) => kept.has(i) && !(p.tension && p.tension > 0));
    if (corners.length === 0) refuse(pinRefusal.noCorners());
    if (!(path.L > 0)) refuse(pinRefusal.noCorners());
    const ideal = corners.map(
        ({ i }) => (counts * placeOfPoint(path, i)) / path.L,
    );
    const placed = placeOnCounts(ideal, counts);
    if (!placed) refuse(pinRefusal.tooManyCorners(corners.length, counts - 1));
    return corners.map(({ p }, k) => ({ point: p.id, at: placed[k]! }));
}

/** AP-P4: a pin on every corner of route `routeId`, replacing every other pin. */
export async function putCornersOnCountsInTransaction({
    tx,
    routeId,
}: {
    tx: DbTransaction;
    routeId: number;
}): Promise<RoutePin[]> {
    const ctx = await readRouteContext(tx, routeId);
    if (ctx.trail) refuse(pinRefusal.trail());
    const path = await knotPathOf(tx, ctx);
    const pins = cornerPins(ctx.geometry, path, ctx.end - ctx.start);
    if (JSON.stringify(pins) === JSON.stringify(ctx.pins))
        refuse(pinRefusal.alreadyOnCounts());
    await writePins(tx, routeId, pins);
    return pins;
}

/** AP-P4 as one undoable edit. */
export async function putCornersOnCounts(args: {
    db: DbConnection;
    routeId: number;
}): Promise<RoutePin[]> {
    const { db, ...rest } = args;
    return await transactionWithHistory(db, "putCornersOnCounts", (tx) =>
        putCornersOnCountsInTransaction({ tx, ...rest }),
    );
}

// ---------------------------------------------------------------------------
// AP-P5: Scale pins instead (after a resize that kept them)
// ---------------------------------------------------------------------------

/** Every pinned route of the move `timelineId` with its pins, read before a resize */
export async function readMovePinSets(
    db: DbConnection | DbTransaction,
    timelineId: number,
): Promise<{ routeId: number; pins: RoutePin[] }[]> {
    const T = schema.timeline_transitions;
    const L = schema.timeline_lanes;
    const R = schema.timeline_routes;
    const rows = await db
        .selectDistinct({ id: R.id, timing: R.timing })
        .from(L)
        .innerJoin(R, eq(R.id, L.route_id))
        .innerJoin(T, eq(T.id, L.transition_id))
        .where(eq(T.timeline_id, timelineId))
        .orderBy(asc(R.id))
        .all();
    return rows
        .map((r) => ({ routeId: r.id, pins: pinsOf(r.timing) }))
        .filter((r) => r.pins.length > 0);
}

/**
 * AP-P5's **Scale pins instead**: after a resize of `timelineId` from `before` that kept its pins
 * on their counts, scales `pinsBefore` (the pins read before it) with the move's length now, as
 * Alt would have, in an edit of its own. Refused, writing nothing, when the move or its pins
 * changed since (another edit came between), so it never acts on anything but that resize.
 */
export async function scaleMovePinsInTransaction({
    tx,
    timelineId,
    before,
    pinsBefore,
}: {
    tx: DbTransaction;
    timelineId: number;
    before: { start: number; end: number };
    pinsBefore: readonly { routeId: number; pins: RoutePin[] }[];
}): Promise<void> {
    const timeline = await tx
        .select()
        .from(schema.timelines)
        .where(eq(schema.timelines.id, timelineId))
        .get();
    if (!timeline) refuse(pinRefusal.moveChanged());
    const now = { start: timeline.start_beat, end: timeline.end_beat };
    const current = await readMovePinSets(tx, timelineId);
    const plan = pinsBefore.map(({ routeId, pins }) => {
        const kept = retimePins(pins, before, now, "keep");
        const stored = current.find((c) => c.routeId === routeId)?.pins;
        if (JSON.stringify(stored) !== JSON.stringify(kept))
            refuse(pinRefusal.moveChanged());
        return { routeId, pins: retimePins(pins, before, now, "scale") };
    });
    if (current.length !== pinsBefore.length) refuse(pinRefusal.moveChanged());
    await writePinRetime(tx, plan);
}

/** AP-P5 as one undoable edit. */
export async function scaleMovePins(args: {
    db: DbConnection;
    timelineId: number;
    before: { start: number; end: number };
    pinsBefore: readonly { routeId: number; pins: RoutePin[] }[];
}): Promise<void> {
    const { db, ...rest } = args;
    await transactionWithHistory(db, "scaleMovePins", (tx) =>
        scaleMovePinsInTransaction({ tx, ...rest }),
    );
}
