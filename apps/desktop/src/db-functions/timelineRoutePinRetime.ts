/**
 * Pins, pathways step 5 (spec Appendix M): what range edits and geometry writes do to a route's
 * pins (AP-R4, AP-H1), and the pins' refusals. Renderer-free and history-free, like
 * `timelineTransitionsInTransaction`, which runs AP-R4 inside every range edit; the pin
 * procedures themselves are in `timelineRoutePins`.
 */
import { asc, eq, inArray, sql } from "drizzle-orm";
import {
    placeOnCounts,
    type RouteGeometry,
    type RoutePin,
    type RouteTiming,
} from "@openmarch/core";
import * as schema from "@om-electron/database/migrations/schema";
import { text } from "@/timeline/timelineText";
import type { DbConnection, DbTransaction } from "./types";
import { refuse } from "./timelineErrors";

/** The refusals' texts, translated where they are shown. */
export const pinRefusal = {
    /** AP-P1: a count that isn't whole, or not strictly inside the move */
    countRange: (last: number) =>
        text.t("timeline.refusals.pin.countRange", { last }),
    /** AP-P1: a count not after the pin before the point */
    afterPin: (count: number) =>
        text.t("timeline.refusals.pin.afterPin", { count }),
    /** AP-P1: a count not before the pin after the point */
    beforePin: (count: number) =>
        text.t("timeline.refusals.pin.beforePin", { count }),
    /** AP-P1: trails get corner counts (step 6), not pins */
    trail: () => text.t("timeline.refusals.pin.trail"),
    /** AP-P1: the point isn't on the path (gone in another edit) */
    noPoint: () => text.t("timeline.refusals.pin.noPoint"),
    /** AP-P2: dropped on a curve, an arc or off the path's shared part */
    dropOnPoint: () => text.t("timeline.refusals.pin.dropOnPoint"),
    /** AP-P2: the playhead isn't on a whole count inside the move */
    playheadOff: () => text.t("timeline.refusals.pin.playheadOff"),
    /** AP-P4 */
    noCorners: () => text.t("timeline.refusals.pin.noCorners"),
    tooManyCorners: (corners: number, counts: number) =>
        text.t("timeline.refusals.pin.tooManyCorners", { corners, counts }),
    alreadyOnCounts: () => text.t("timeline.refusals.pin.alreadyOnCounts"),
    /** AP-R4: a range edit that would end the move on or before a pin */
    pastPin: (count: number) =>
        text.t("timeline.refusals.pin.pastPin", { count }),
    /** AP-R4: a range edit that would start the move on or after a pin */
    pastPinStart: (count: number) =>
        text.t("timeline.refusals.pin.pastPinStart", { count }),
    /** AP-R4 (ripple): deleted counts that would put two pins on one count */
    pinsCollide: () => text.t("timeline.refusals.pin.collide"),
    /** AP-P5: Scale pins instead after the move changed again */
    moveChanged: () => text.t("timeline.refusals.pin.moveChanged"),
    /** AP-R4 scale: more pins than counts in the new length */
    noRoomToScale: () => text.t("timeline.refusals.pin.noRoomToScale"),
};

/** A route's stored pins, in stored order; none for NULL timing. */
export const pinsOf = (timing: string | null | undefined): RoutePin[] => {
    if (!timing) return [];
    const parsed = JSON.parse(timing) as RouteTiming;
    return Array.isArray(parsed.pins) ? parsed.pins : [];
};

/** The JSON a route's `timing` column takes for `pins`: NULL for none (K1). */
export const timingJson = (pins: readonly RoutePin[]): string | null =>
    pins.length === 0
        ? null
        : JSON.stringify({ v: 1, pins: [...pins] } satisfies RouteTiming);

// ---------------------------------------------------------------------------
// AP-R4: range edits
// ---------------------------------------------------------------------------

/** How a range edit treats pins (AP-R4): keep their counts, or scale them with the move */
export type PinRetime = "keep" | "scale";

/**
 * AP-R4's pins after a range edit from `[s0, e0)` to `[s1, e1)`. **Keep:** an edit moving both
 * edges alike changes nothing; otherwise `at` less the change of the start, so each pin keeps its count from the edge
 * that didn't move. **Scale:** `at × c′ / c`, placed on whole counts (M-COUNTS). Refused when a
 * pin would leave the move, or the scaled pins don't fit.
 */
export function retimePins(
    pins: readonly RoutePin[],
    from: { start: number; end: number },
    to: { start: number; end: number },
    mode: PinRetime,
): RoutePin[] {
    if (pins.length === 0) return [];
    const c0 = from.end - from.start;
    const c1 = to.end - to.start;
    const ds = to.start - from.start;
    const de = to.end - from.end;
    if (mode === "scale") {
        if (c1 === c0) return [...pins];
        const placed = placeOnCounts(
            pins.map((p) => (p.at * c1) / c0),
            c1,
        );
        if (!placed) refuse(pinRefusal.noRoomToScale());
        return pins.map((p, i) => ({ ...p, at: placed[i]! }));
    }
    if (ds === de) return [...pins];
    const out = pins.map((p) => ({ ...p, at: p.at - ds }));
    const early = out.find((p) => !(p.at > 0));
    if (early) refuse(pinRefusal.pastPinStart(early.at + ds));
    const late = out.find((p) => !(p.at < c1));
    if (late) refuse(pinRefusal.pastPin(late.at + ds));
    return out;
}

// ---------------------------------------------------------------------------
// AP-R4 in the page and count ripple (page-flag drags, counts inserted or deleted)
// ---------------------------------------------------------------------------

/** A pinned route as the ripple reads it: its pins and the transitions its lanes are on */
export interface RipplePinnedRoute {
    routeId: number;
    pins: RoutePin[];
    transitionIds: number[];
}

/**
 * Every route with pins and the transitions its lanes are on. None in a file without lanes or the
 * `timing` column (a page-era file being converted reads none).
 */
export async function readPinnedRoutes(
    tx: DbConnection | DbTransaction,
): Promise<RipplePinnedRoute[]> {
    const has = (await tx.all(sql`
        SELECT (SELECT COUNT(*) FROM pragma_table_info('timeline_routes') WHERE name = 'timing')
             + (SELECT COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'timeline_lanes')
               AS n`)) as unknown[];
    const first = has[0];
    const n = Number(
        Array.isArray(first) ? first[0] : (first as { n: number }).n,
    );
    if (n < 2) return [];
    const rows = (await tx.all(sql`
        SELECT r.id AS id, r.timing AS timing, l.transition_id AS transition_id
          FROM timeline_routes r JOIN timeline_lanes l ON l.route_id = r.id
         WHERE r.timing IS NOT NULL
         ORDER BY r.id, l.transition_id`)) as unknown[];
    const byRoute = new Map<number, RipplePinnedRoute>();
    for (const row of rows) {
        const [id, timing, transition] = Array.isArray(row)
            ? row
            : [
                  (row as { id: number }).id,
                  (row as { timing: string }).timing,
                  (row as { transition_id: number }).transition_id,
              ];
        const routeId = Number(id);
        let entry = byRoute.get(routeId);
        if (!entry) {
            entry = {
                routeId,
                pins: pinsOf(String(timing)),
                transitionIds: [],
            };
            byRoute.set(routeId, entry);
        }
        if (!entry.transitionIds.includes(Number(transition)))
            entry.transitionIds.push(Number(transition));
    }
    return [...byRoute.values()].filter((r) => r.pins.length > 0);
}

/** Why the ripple can't keep a route's pins: the move and the pin's count, and what to say */
export interface PinRippleProblem {
    routeId: number;
    transitionId: number;
    /** The pin's count in the move before the edit */
    count: number;
    message: ReturnType<typeof pinRefusal.pastPin>;
}

/**
 * AP-R4 for the page and count ripple (spec Appendix M): each pin keeps its **beat**, mapped from
 * the old grid to the new one as a row's end edge is (`beatEnd`: the end of its count). A
 * page-flag drag renumbers no beats, so a pin keeps its count from the edge that didn't move, as a
 * clip resize does; counts inserted before a pin inside its move move it with its beat; a deleted
 * count takes the pin to the end of the count before it. `transitions` are the old ranges and
 * `newRange` the planned ones. A pin that would leave its move, or land on another pin's count,
 * is the plan's problem (the ripple refuses it, a flag drag stops before it).
 */
export function planPinRipple(
    routes: readonly RipplePinnedRoute[],
    transitions: ReadonlyMap<number, readonly [number, number]>,
    newRange: (transitionId: number) => readonly [number, number] | undefined,
    beatEnd: (beat: number) => number,
): {
    newPins: Map<number, RoutePin[]>;
    problem: PinRippleProblem | null;
} {
    const newPins = new Map<number, RoutePin[]>();
    for (const route of routes) {
        const tid = route.transitionIds.find((t) => transitions.has(t));
        if (tid === undefined) continue;
        const [s0] = transitions.get(tid)!;
        const next = newRange(tid);
        if (!next) continue;
        const [s1, e1] = next;
        const moved = route.pins.map((p) => ({
            ...p,
            at: beatEnd(s0 + p.at) - s1,
        }));
        const bad = (message: PinRippleProblem["message"], count: number) => ({
            newPins,
            problem: {
                routeId: route.routeId,
                transitionId: tid,
                count,
                message,
            },
        });
        for (let i = 0; i < moved.length; i++) {
            const was = route.pins[i]!.at;
            if (!(moved[i]!.at > 0))
                return bad(pinRefusal.pastPinStart(was), was);
            if (!(moved[i]!.at < e1 - s1))
                return bad(pinRefusal.pastPin(was), was);
        }
        const sorted = [...moved].sort((a, b) => a.at - b.at);
        for (let i = 1; i < sorted.length; i++)
            if (sorted[i]!.at === sorted[i - 1]!.at)
                return bad(pinRefusal.pinsCollide(), route.pins[i]!.at);
        if (moved.some((p, i) => p.at !== route.pins[i]!.at))
            newPins.set(route.routeId, moved);
    }
    return { newPins, problem: null };
}

/**
 * AP-R4: re-times the pins of every route with a lane on `transitionIds` (one move's), for a range
 * edit from `from` to `to`. Run by `setTimelineRangeInTransaction`, so every range edit takes it;
 * planned before any write by `planPinRetime`, which refuses.
 */
export async function planPinRetime(
    tx: DbTransaction,
    transitionIds: readonly number[],
    from: { start: number; end: number },
    to: { start: number; end: number },
    mode: PinRetime,
): Promise<{ routeId: number; pins: RoutePin[] }[]> {
    if (transitionIds.length === 0) return [];
    const L = schema.timeline_lanes;
    const R = schema.timeline_routes;
    const routes = await tx
        .selectDistinct({ id: R.id, timing: R.timing })
        .from(L)
        .innerJoin(R, eq(R.id, L.route_id))
        .where(inArray(L.transition_id, [...transitionIds]))
        .orderBy(asc(R.id))
        .all();
    const out: { routeId: number; pins: RoutePin[] }[] = [];
    for (const r of routes) {
        const pins = pinsOf(r.timing);
        if (pins.length === 0) continue;
        const next = retimePins(pins, from, to, mode);
        if (JSON.stringify(next) !== JSON.stringify(pins))
            out.push({ routeId: r.id, pins: next });
    }
    return out;
}

/** Writes `planPinRetime`'s result. */
export async function writePinRetime(
    tx: DbTransaction,
    plan: readonly { routeId: number; pins: RoutePin[] }[],
): Promise<void> {
    for (const { routeId, pins } of plan)
        await tx
            .update(schema.timeline_routes)
            .set({ timing: timingJson(pins) })
            .where(eq(schema.timeline_routes.id, routeId));
}

/**
 * What the resize limits read (spec Appendix M "Resize limits"): for each pinned route of the
 * move, its first and last pinned counts and how many pins it has.
 */
export async function readMovePins(
    db: DbConnection | DbTransaction,
    transitionIds: readonly number[],
): Promise<{ first: number; last: number; count: number }[]> {
    if (transitionIds.length === 0) return [];
    const L = schema.timeline_lanes;
    const R = schema.timeline_routes;
    const routes = await db
        .selectDistinct({ id: R.id, timing: R.timing })
        .from(L)
        .innerJoin(R, eq(R.id, L.route_id))
        .where(inArray(L.transition_id, [...transitionIds]))
        .all();
    return routes.flatMap((r) => {
        const ats = pinsOf(r.timing).map((p) => p.at);
        return ats.length === 0
            ? []
            : [
                  {
                      first: Math.min(...ats),
                      last: Math.max(...ats),
                      count: ats.length,
                  },
              ];
    });
}

// ---------------------------------------------------------------------------
// AP-H1: pins on points that went
// ---------------------------------------------------------------------------

/**
 * AP-H1 (pins): drops the pins of route `routeId` on points `geometry` doesn't have. Run by the one
 * route geometry writer, in the same edit. Returns how many went.
 */
export async function dropPinsOfMissingPointsInTransaction(
    tx: DbTransaction,
    routeId: number,
    timing: string | null,
    geometry: RouteGeometry,
): Promise<number> {
    const pins = pinsOf(timing);
    if (pins.length === 0) return 0;
    const ids = new Set(geometry.points.map((p) => p.id));
    const kept = pins.filter((p) => ids.has(p.point));
    if (kept.length === pins.length) return 0;
    await tx
        .update(schema.timeline_routes)
        .set({ timing: timingJson(kept) })
        .where(eq(schema.timeline_routes.id, routeId));
    return pins.length - kept.length;
}
