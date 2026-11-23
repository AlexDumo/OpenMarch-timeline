/**
 * A trail's path is the only truth (owner, 2026-11-17, spec L.18, TM-2): while a point of a trail
 * dragged out of a line is dragged in Edit path (or its roundness or an arc leg's bend is), the
 * form and the marchers at the playhead follow the path live: every end spot where the new path
 * puts it, spaced back from the head as before (`planTrailEdit`, the write's own plan), and the
 * line where it is at the playhead's share of the move (R-13″). Nothing is written until the
 * release, which writes the route and the spots once (`editTrailPoints`); Escape or a lost press
 * puts the points back and the marchers back where the show has them.
 */
import { trailDragPreview } from "@/db-functions/timelineTrailDrag";
import { planTrailEdit } from "@/db-functions/timelineTrailDerive";
import type { FieldModeDrawing } from "@/field/editor/fieldEditor";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import type { XY } from "@/shapes/types";
import { storedPoints, type PathSession } from "./pathPenStore";

const tuple = (p: XY): [number, number] => [p.x, p.y];
const xy = (p: readonly number[]): XY => ({ x: p[0]!, y: p[1]! });

/** Whether `a` and `b` are the same route points (ids, places, roundness and bends) */
const samePoints = (
    a: ReturnType<typeof storedPoints>,
    b: PathSession["target"]["points"],
) =>
    a.length === b.length &&
    a.every(
        (p, i) =>
            p.at[0] === b[i]!.at[0] &&
            p.at[1] === b[i]!.at[1] &&
            (p.tension ?? 0) === (b[i]!.tension ?? 0) &&
            (p.bulge ?? 0) === (b[i]!.bulge ?? 0),
    );

/**
 * The live end spots and marchers of a dragged-out trail whose points are being dragged (TM-2), or
 * null: no point dragged, the points as stored, or a trail that doesn't derive its spots
 */
export function liveTrailOf(
    session: PathSession,
): Pick<FieldModeDrawing, "marchersAt" | "spots"> | null {
    const { target } = session;
    const trail = target.trail;
    if (
        session.phase !== "open" ||
        session.dragging === null ||
        !trail?.along ||
        trail.around ||
        trail.unfounded ||
        trail.members.length < 2
    )
        return null;
    const points = storedPoints(session.points);
    if (samePoints(points, target.points)) return null;
    const plan = planTrailEdit(
        trail.members.map((m) => tuple(m.from)),
        target.points,
        trail.members.map((m) => tuple(m.to)),
        points,
    );
    const span = target.end - target.start;
    const beat = useTimelineSelectionStore.getState().playheadBeat;
    const p =
        span > 0 ? Math.min(1, Math.max(0, (beat - target.start) / span)) : 1;
    return {
        marchersAt: {
            ids: trail.members.map((m) => m.marcherId),
            spots: trailDragPreview(plan, p).map(xy),
            keepSpots: true,
        },
        spots: plan.spots.map(xy),
    };
}
