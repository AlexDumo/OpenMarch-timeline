import { and, desc, eq, gt, lte } from "drizzle-orm";
import type { Resolver, RoutePoint } from "@openmarch/core";
import { schema } from "@/global/database/db";
import type { DbConnection } from "@/db-functions/types";
import { readRoutes } from "@/db-functions/timelineRoutes";
import type { XY } from "@/shapes/types";

/**
 * Who a path is drawn for and between which spots (pathways step 1, spec v0.9 R-14): one marcher's
 * move at the playhead, from where it starts (`from`) to its end spot (`to`), and the route it
 * walks there now, if any.
 */
export interface PathTarget {
    timelineId: number;
    transitionId: number;
    marcherId: number;
    /** The move's counts, in beats */
    start: number;
    end: number;
    /** Where the marcher stands at the move's start (R-14's A) */
    from: XY;
    /** Its end spot (R-14's B) */
    to: XY;
    /** The route it walks now, or null for a straight (or arc) move */
    routeId: number | null;
    /** The route's corners, in walking order (none without a route) */
    points: readonly RoutePoint[];
}

const xy = (p: readonly [number, number]): XY => ({ x: p[0], y: p[1] });

/**
 * The move of `marcherId` at `beat` that a path is drawn on: the row that holds the beat, the one
 * arriving there when the beat is on its end (a page flag shows where the page arrives), the top
 * layer when rows overlap. Null when the marcher has no move there.
 */
export async function findPathTarget(
    db: DbConnection,
    resolver: Pick<Resolver, "explain" | "positionAt">,
    marcherId: number,
    beat: number,
): Promise<PathTarget | null> {
    const A = schema.timeline_assignments;
    const T = schema.timeline_transitions;
    const row = await db
        .select({ row: A, transition: T })
        .from(A)
        .innerJoin(T, eq(A.transition_id, T.id))
        .where(
            and(
                eq(A.marcher_id, marcherId),
                lte(A.start_beat, beat),
                gt(A.end_beat, beat - 1e-9),
            ),
        )
        .orderBy(desc(A.layer), desc(A.start_beat))
        .all();
    // On a row's end the arriving one wins; inside one, the one holding the beat
    const pick =
        row.find((r) => r.row.start_beat < beat && beat <= r.row.end_beat) ??
        row.find((r) => r.row.start_beat <= beat && beat < r.row.end_beat);
    if (!pick) return null;
    const { transition } = pick;
    const route =
        transition.route_id === null
            ? undefined
            : (await readRoutes(db, transition.timeline_id)).find(
                  (r) => r.routeId === transition.route_id,
              );
    return {
        timelineId: transition.timeline_id,
        transitionId: transition.id,
        marcherId,
        start: transition.start_beat,
        end: transition.end_beat,
        from: xy(resolver.explain(marcherId, transition.start_beat).origin),
        to: xy(resolver.positionAt(marcherId, transition.end_beat)),
        routeId: transition.route_id,
        points: route?.geometry.points ?? [],
    };
}
