/**
 * The pathways drawings as the shared pen's subjects (`shapes/pen/penSubject.ts`, plan step 1): the
 * Path pen and the Follow tool's trail once an end is grabbed (`pathSubject`), and a stored trail's
 * head drawn on with clicks (`headSubject`, L.15 DC-5). The pen handles the gestures; these say
 * where a click lands on the session's points and write through the path pen's store.
 */
import type { ToolEnv } from "@/shapes/tool/toolKind";
import type { XY } from "@/shapes/types";
import { dragNewPoint, landCorner, pathPoints } from "@/shapes/pen/penPath";
import type { PenSubject } from "@/shapes/pen/penSubject";
import { goingRound } from "./followAround";
import {
    cancelFollowDrawing,
    intoEndSpots,
    rippleEndAt,
    ripplesIn,
} from "./followDrag";
import {
    addPoint,
    closePath,
    endNewPoint,
    finishDrawing,
    removeLastPoint,
    setPointer,
    shapeNewPoint,
    shapeOf,
    usePathPenStore,
    type PathSession,
} from "./pathPenStore";
import {
    clickHeadAt,
    endHeadPoint,
    finishHeadDrag,
    isHeadClicks,
    moveHeadDrag,
    shapeHeadPoint,
    showHeadPlaced,
} from "./trailHead";

const sessionNow = () => usePathPenStore.getState().session;

/**
 * Where a press at `at` lands, as the drawing's pointer does (`landCorner`): Ripple in tests an
 * end of the form with the same point the drawing shows the deal for (step 9 review)
 */
function landedAt(s: PathSession, at: XY, env: ToolEnv): XY {
    return landCorner(shapeOf(s), at, env);
}

/**
 * Whether `at` is on the end spot the path goes to: with Ripple in, on either end of the next
 * form, by the same reach the drawing shows it with (`rippleEndAt`, RP-4)
 */
export function onEndSpot(s: PathSession, at: XY, env: ToolEnv): boolean {
    if (s.follow && ripplesIn(s.follow))
        return rippleEndAt(s.follow, landedAt(s, at, env)) !== null;
    const points = pathPoints(shapeOf(s));
    const end = points[points.length - 1]!;
    return Math.hypot(end.x - at.x, end.y - at.y) <= env.hitRadius;
}

/**
 * Ripple in (step 9, RP-4): the marcher whose spot at an end of the next form is under `at`, so a
 * finish there enters there; null otherwise, and for any other drawing
 */
export function enterAt(
    s: PathSession,
    at: XY,
    env: ToolEnv | null,
): number | null {
    return s.follow && env ? rippleEndAt(s.follow, landedAt(s, at, env)) : null;
}

/** Whether `at` is on the drawing's last point or on the end spot the path goes to */
function onFinishSpot(s: PathSession, at: XY, env: ToolEnv): boolean {
    const points = pathPoints(shapeOf(s));
    const last = points[points.length - 2]!;
    const end = points[points.length - 1]!;
    const near = (q: XY) => Math.hypot(q.x - at.x, q.y - at.y) <= env.hitRadius;
    // Ripple in: on either end of the next form, by the drawing's own reach (RP-4)
    const onEnd =
        s.follow && ripplesIn(s.follow)
            ? rippleEndAt(s.follow, landedAt(s, at, env)) !== null
            : near(end);
    return (s.points.length > 0 && near(last)) || onEnd;
}

/**
 * The Path pen, and the Follow tool's trail once an end is grabbed (step 4b): the session's points
 * from the marcher's start (the leader's) to its end spot, or to the pointer for a trail whose
 * ends follow it. The Follow tool plans the whole line to the pointer, so its preview waits for a
 * frame (step 4d).
 */
function pathSubject(s: PathSession): PenSubject {
    return {
        // A new grab, a cancel or a finish is another drawing
        key: s.follow ?? s.target,
        perFrame: !!s.follow,
        count: () => sessionNow()?.points.length ?? 0,
        last: () => sessionNow()?.points.at(-1) ?? null,
        finishesAt: (at, env) => {
            const now = sessionNow();
            return !!now && onFinishSpot(now, at, env);
        },
        click(at, smooth, env) {
            const now = sessionNow();
            if (!now) return "finish";
            const landed = landCorner(shapeOf(now), at, env);
            // Landed on the last point: the same as clicking it
            const prev = now.points.at(-1)?.at;
            if (prev && prev.x === landed.x && prev.y === landed.y)
                return "finish";
            addPoint(landed, smooth);
            return "placed";
        },
        shapeLast(to, env) {
            const now = sessionNow();
            if (!now) return;
            shapeNewPoint(dragNewPoint(shapeOf(now), to, env));
            setPointer(null);
        },
        endShape: endNewPoint,
        // A lost press-and-drag takes back the point it was placing
        loseShape: () => void removeLastPoint(),
        preview(at, env) {
            const now = sessionNow();
            if (!now || now.phase !== "drawing") return;
            // Only while still drawing out a grabbed end: a cancel or finish in between wins
            if (now.follow && now.follow.grabbed === null) return;
            setPointer(at && env ? landCorner(shapeOf(now), at, env) : null);
        },
        // A trail that ends at its own last point (From trail ends) keeps it: there the drawing
        // ends where the double-click is (review of #900)
        dropsDoubleClickPoint: () => !s.follow || intoEndSpots(s.follow),
        removeLast: removeLastPoint,
        canRemoveLast: () => (sessionNow()?.points.length ?? 0) > 0,
        finish(at, env) {
            const now = sessionNow();
            if (!now) return;
            void finishDrawing(at ? enterAt(now, at, env ?? null) : null);
        },
        cancel() {
            // The Follow tool (step 4b): Escape cancels the trail drawn, then leaves the tool
            if (!cancelFollowDrawing()) closePath();
        },
        // With no point left, undo leaves the drawing
        undo() {
            if ((sessionNow()?.points.length ?? 0) > 0) removeLastPoint();
            else closePath();
        },
    };
}

/**
 * A stored trail's head drawn on with clicks (AP-T16, L.15 DC-5): a click places the trail as the
 * pointer has it there (a point added, the head slid on, or cut back), and the trail follows the
 * pointer between clicks, planned as a head drag plans it (once a frame). Nothing is written until
 * it finishes, one write (AP-T16).
 */
function headSubject(s: PathSession): PenSubject {
    const head = () => sessionNow()?.follow?.head ?? null;
    return {
        // Stable while clicks go on: each click makes a new follow, never a new drawing
        key: s.follow!.head!.restore,
        perFrame: true,
        count: () => head()?.prefix.length ?? 0,
        last: () => head()?.prefix.at(-1) ?? null,
        // The head itself finishes through a click (`clickHeadAt`), as the pen's last point does
        finishesAt: () => false,
        click: (at, smooth, env) =>
            clickHeadAt(at, env, smooth) === "placed" ? "placed" : "finish",
        shapeLast: shapeHeadPoint,
        endShape: endHeadPoint,
        // A point a lost press-and-drag placed stays, as shaped so far
        loseShape: endHeadPoint,
        preview(at, env) {
            if (!at) {
                showHeadPlaced();
                return;
            }
            // Not while a press-and-drag shapes the point just placed
            if (
                env &&
                isHeadClicks(sessionNow()) &&
                sessionNow()?.dragging == null
            )
                moveHeadDrag(at, env);
        },
        dropsDoubleClickPoint: () => false,
        removeLast: removeLastPoint,
        canRemoveLast: () => !!head()?.history?.length,
        finish: () => void finishHeadDrag(),
        cancel: () => void cancelFollowDrawing(),
        // Its clicks go back one by one, then the trail is as it was, nothing written
        undo() {
            if (head()?.history?.length) removeLastPoint();
            else cancelFollowDrawing();
        },
    };
}

/**
 * The pen's subject for the session now: the drawing it is, or null when nothing is drawn with
 * points (no drawing, the Follow tool's ends still pulsing, going round an outline)
 */
export function penSubjectOf(s: PathSession | null): PenSubject | null {
    if (!s || s.phase !== "drawing") return null;
    if (isHeadClicks(s)) return headSubject(s);
    if (s.follow && (s.follow.grabbed === null || goingRound(s.follow)))
        return null;
    return pathSubject(s);
}

/** The session's pen subject, read now (the pen asks on every event) */
export const currentPenSubject = (): PenSubject | null =>
    penSubjectOf(sessionNow());
