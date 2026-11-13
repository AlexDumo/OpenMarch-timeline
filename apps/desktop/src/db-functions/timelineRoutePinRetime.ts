/**
 * Pins, pathways step 5 (spec Appendix M): what range edits and geometry writes do to a route's
 * pins (AP-R4, AP-H1), and the pins' refusals. Renderer-free and history-free, like
 * `timelineTransitionsInTransaction`, which runs AP-R4 inside every range edit; the pin
 * procedures themselves are in `timelineRoutePins`.
 */
import { asc, eq, inArray } from "drizzle-orm";
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
    /** AP-R4: a range edit that would put a pin outside the move */
    pastPin: (count: number) =>
        text.t("timeline.refusals.pin.pastPin", { count }),
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
    const out0 = out.find((p) => !(p.at > 0 && p.at < c1));
    if (out0) refuse(pinRefusal.pastPin(out0.at + ds));
    return out;
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
