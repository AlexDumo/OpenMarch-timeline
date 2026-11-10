/**
 * The one place a route's geometry is rewritten (pathways step 3b, spec v0.10 AP-H1): every path
 * edit, redraw, cut and Re-fit goes through `writeRouteGeometryInTransaction`, so a key anchored on
 * a point that went is re-homed in the same edit and never dropped silently. A new route has
 * nothing anchored on it, so inserting one doesn't come here.
 *
 * What AP-H1 also names and doesn't exist yet plugs in here beside the lanes' profiles: handoff
 * ramps (step 25), pins and holds (step 5) and linked Adjusts (step 26). AP-R21's merge and join
 * (still refused, AP-R6) write through this helper when they arrive.
 */
import {
    limitRouteEdit,
    rehomeProfile,
    validateRouteGeometry,
    type AdjustProfile,
    type RouteGeometry,
} from "@openmarch/core";
import { eq } from "drizzle-orm";
import { schema } from "@/global/database/db";
import type { DbTransaction } from "./types";
import { assertValid, refuse } from "./timelineErrors";
import { lanesOfRoute } from "./timelineLanes";

/** What a geometry edit did to the Adjusts on the route, for the badge and the toast. */
export interface RehomeReport {
    /** Spots whose Adjust had a key re-homed or dropped and still has keys */
    rehomedSpots: number;
    /** Keys dropped, over every spot */
    droppedKeys: number;
    /** Spots whose Adjust went altogether */
    clearedSpots: number;
    /** A point drag stopped short to keep keys a step apart (AP-R11) */
    stoppedShort: boolean;
}

export const NOTHING_REHOMED: RehomeReport = {
    rehomedSpots: 0,
    droppedKeys: 0,
    clearedSpots: 0,
    stoppedShort: false,
};

/** Reads a lane's stored profile. */
export const profileOfLane = (lane: {
    adjust: string | null;
}): AdjustProfile | null =>
    lane.adjust === null ? null : (JSON.parse(lane.adjust) as AdjustProfile);

/**
 * Writes route `routeId`'s geometry, then AP-H1 on every Adjust of its lanes. With `drag`, the
 * edit is a point drag: it goes only as far as keeps every profile's keys a step apart (AP-R11).
 * Any other edit re-homes, and drops by AP-H1's rule.
 */
export async function writeRouteGeometryInTransaction(
    tx: DbTransaction,
    routeId: number,
    next: RouteGeometry,
    { drag = false }: { drag?: boolean } = {},
): Promise<RehomeReport> {
    const R = schema.timeline_routes;
    const L = schema.timeline_lanes;
    const row = await tx.select().from(R).where(eq(R.id, routeId)).get();
    if (!row) refuse(`route ${routeId} does not exist`);
    const old = JSON.parse(row.geometry) as RouteGeometry;
    const adjusted = (await lanesOfRoute(tx, routeId)).flatMap((lane) => {
        const profile = profileOfLane(lane);
        return profile ? [{ lane, profile }] : [];
    });
    const limited = drag
        ? limitRouteEdit(
              old,
              next,
              adjusted.map((a) => a.profile),
          )
        : { geometry: next, stopped: false };
    assertValid(validateRouteGeometry(limited.geometry), "route");
    await tx
        .update(R)
        .set({ geometry: JSON.stringify(limited.geometry) })
        .where(eq(R.id, routeId));
    const report = { ...NOTHING_REHOMED, stoppedShort: limited.stopped };
    for (const { lane, profile } of adjusted) {
        const out = rehomeProfile(old, limited.geometry, profile);
        if (!out.changed) continue;
        await tx
            .update(L)
            .set({ adjust: out.profile ? JSON.stringify(out.profile) : null })
            .where(eq(L.id, lane.id));
        report.droppedKeys += out.dropped;
        if (out.profile) report.rehomedSpots++;
        else report.clearedSpots++;
    }
    return report;
}
