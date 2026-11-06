import { create } from "zustand";
import { db } from "@/global/database/db";
import { toast } from "sonner";
import { drawRoute, removeRoute } from "@/db-functions/timelineRoutes";
import { editPathPoints, redrawPath } from "@/db-functions/timelinePathEdits";
import {
    drawGroupRoute,
    ownPath,
    rejoinGroupPath,
} from "@/db-functions/timelineGroupRoutes";
import { subscribeHistoryChanges } from "@/db-functions/history";
import { runAction } from "@/shortcuts/registry";
import { toastTimelineError } from "@/timeline/timelineErrorMessages";
import tolgee from "@/global/singletons/Tolgee";
import type { XY } from "@/shapes/types";
import { SMOOTH } from "@/shapes/line/lineGeometry";
import type { PathTarget } from "./pathTarget";
import {
    isSmooth,
    pointKey,
    splitLeg,
    withTension,
    type PathPoint,
    type PathShape,
} from "./pathEdit";

export type { PathPoint } from "./pathEdit";

/**
 * The pen's session (pathways steps 1 and 2): a path being drawn for one marcher (`drawing`), the
 * selected marcher's stored path shown on the field (`closed`: drawn, nothing to grab), or opened
 * for editing (`open`) with its points to drag and its floating editor. A double-click or the
 * right-click menu on the path opens it (owner, 2026-11-04). Each write is one app procedure
 * (AP-R1, AP-R2) and one undo step.
 */
export interface PathSession {
    readonly phase: "drawing" | "closed" | "open";
    readonly target: PathTarget;
    /** The marcher's drill number, as the drawing banner names it */
    readonly drill: string;
    readonly points: readonly PathPoint[];
    /**
     * While drawing, where a click now would put the next point, landed as a Line's next point
     * is: the preview's leg goes there
     */
    readonly pointer: XY | null;
    /** The point's handle a click picked (open, `p<i>`), which Backspace deletes */
    readonly selected: string | null;
    /**
     * The point being dragged, or whose roundness is (the points shown are the drag's, not yet
     * saved), or null. While drawing, the point a press-and-drag is making smooth.
     */
    readonly dragging: number | null;
    /**
     * The path is selected as an object (step 3a, spec I.10 AP-O3): picked by a click on its line,
     * not shown because its marchers are selected. Then the marcher selection is empty, the path
     * is read again by its route (`findRouteTarget`), it is drawn selected whatever the paths level,
     * Delete removes it (AP-O6), and Escape lets it go (from open, back to selected first).
     */
    readonly object: boolean;
    /**
     * While drawing: the path drawn again by its route id (AP-O8, J.8 AP-R1, 07 N3), a path edit
     * that keeps the id and is never refused for who holds its spots. Set when P draws the
     * selected path or the open path again, however it was opened.
     */
    readonly byRoute?: boolean;
}

/**
 * A path Paths **All** draws in a move at the playhead (step 3a, AP-O2, AP-O7), which a click
 * selects with nothing selected. `walk` gives an own path's drawn line, its marcher's walk inside
 * the start flag window (the start flag positions' path, which is what's drawn for it), sampled
 * only when a click or the pointer tests it; null for a group path, drawn as its reference line
 * and faint lanes.
 */
export interface PathObject {
    readonly target: PathTarget;
    readonly drill: string;
    readonly walk: (() => readonly XY[]) | null;
}

interface PathPenState {
    session: PathSession | null;
    /** A save is under way: the pen takes no new edit until it settles */
    saving: boolean;
    /**
     * Counts the saves: the open path reads its move again after each, so a path just finished
     * learns its route (and Remove path shows) even when the timeline caught up during the save
     */
    saved: number;
    /**
     * The closed path isn't drawn and takes no click: start flag positions' paths level in effect
     * is off (owner, 2026-11-04: a path shows by the same rules as the straight ones, the
     * setting and N). An open or drawn path always shows.
     */
    hidden: boolean;
    /**
     * After Own path for one marcher (step 15): that marcher's own path opens once it's read
     * again, as the spec's "its own path is then shown, open" says; null otherwise
     */
    openNext: number | null;
    /** Selected marchers on the shown group path, whom Own path gives a lane each (step 15) */
    ownable: readonly number[];
    /** Whom Rejoin puts on which group path, or null when it isn't offered (step 15) */
    rejoin: RejoinTarget | null;
    /** The paths Paths All draws as objects at the playhead, or none (step 3a, AP-O2) */
    objects: readonly PathObject[];
}

/** Rejoin's target (AP-R10): the group path in a move, and the selected marchers off it */
export interface RejoinTarget {
    timelineId: number;
    routeId: number;
    marcherIds: readonly number[];
}

/** What Own path and Rejoin act on for the selection now (spec Appendix I.8) */
export function setGroupCommands(
    ownable: readonly number[],
    rejoin: RejoinTarget | null,
): void {
    const s = usePathPenStore.getState();
    if (
        s.ownable.join(",") === ownable.join(",") &&
        JSON.stringify(s.rejoin) === JSON.stringify(rejoin)
    )
        return;
    usePathPenStore.setState({ ownable, rejoin });
}

/** Whether the session's path is drawn on the field now: a selected path always is (AP-O4) */
export const pathShown = (
    session: PathSession | null,
    hidden: boolean,
): session is PathSession =>
    session !== null &&
    (session.phase !== "closed" || session.object || !hidden);

/**
 * Sets the paths Paths All draws as objects. The same objects (by identity: a route's object is
 * kept while its target is) keep the list as it was, so a playhead step that changes no path sets
 * nothing and nothing is drawn again.
 */
export function setPathObjects(objects: readonly PathObject[]): void {
    const now = usePathPenStore.getState().objects;
    if (now.length === objects.length && now.every((o, i) => o === objects[i]))
        return;
    usePathPenStore.setState({ objects });
}

/**
 * The group path objects drawn now (AP-O7): every one but the session's own path, and none while
 * the pen draws or an open shape has the field
 */
export const objectsDrawn = (
    objects: readonly PathObject[],
    session: PathSession | null,
    shapeOpen: boolean,
): readonly PathObject[] =>
    shapeOpen || session?.phase === "drawing"
        ? []
        : objects.filter(
              (o) =>
                  o.target.routeId === null ||
                  o.target.routeId !== session?.target.routeId,
          );

/**
 * The marchers whose path the pen draws now (the one marcher, or every member of the group path),
 * or an empty list. Their start flag positions give way to the pen's line, lanes and ghosts while
 * it shows, as an open shape's marchers' do (#417): otherwise each member's lane is drawn twice
 * over the line being edited (owner, 2026-11-05).
 */
export const pathMarcherIds = (
    session: PathSession | null,
    hidden: boolean,
    /**
     * An open shape has the field (`useShapeFieldModes`), so a closed path isn't drawn and its
     * marchers keep their start flag positions (owner on #683). Under a selected placed box it
     * still is, as the field's underlay (`useShapeFieldModes`)
     */
    closedUnder: boolean,
    /** Paths All's group path objects (step 3a): their members give way to the line and lanes */
    objects: readonly PathObject[] = [],
): readonly number[] => {
    const own =
        !pathShown(session, hidden) ||
        (session.phase === "closed" && closedUnder)
            ? []
            : session.target.group
              ? session.target.group.members.map((m) => m.marcherId)
              : [session.target.marcherId];
    const drawn = objectsDrawn(objects, session, closedUnder).flatMap((o) =>
        o.target.group ? o.target.group.members.map((m) => m.marcherId) : [],
    );
    return drawn.length === 0 ? own : [...new Set([...own, ...drawn])];
};

/** Hides or shows the closed path, as start flag positions' paths level in effect says */
export function setPathHidden(hidden: boolean): void {
    if (usePathPenStore.getState().hidden !== hidden)
        usePathPenStore.setState({ hidden });
}

export const usePathPenStore = create<PathPenState>(() => ({
    hidden: false,
    objects: [],
    openNext: null,
    ownable: [],
    rejoin: null,
    session: null,
    saving: false,
    saved: 0,
}));

/**
 * The move a path is for: the same key is the same marcher's same move, or the same group path
 * in the same move (step 15)
 */
export const pathKey = (
    t: Pick<
        PathTarget,
        "timelineId" | "transitionId" | "marcherId" | "group" | "routeId"
    >,
) =>
    t.group
        ? `${t.timelineId}:g${t.routeId ?? "new"}`
        : `${t.timelineId}:${t.transitionId}:${t.marcherId}`;

/** The same path object: the same route (AP-O1), whoever walks it now */
const sameRoute = (a: PathTarget, b: PathTarget) =>
    a.routeId !== null && a.routeId === b.routeId;

export const pointsOf = (target: PathTarget): PathPoint[] =>
    target.points.map((p) => ({
        id: p.id,
        at: { x: p.at[0], y: p.at[1] },
        ...(p.tension === undefined ? {} : { tension: p.tension }),
    }));

/** Whether `p` is the route's stored point `i`, in the same place */
const storedAt = (target: PathTarget, i: number, p: PathPoint | undefined) => {
    const q = target.points[i];
    return (
        !!p && !!q && p.id === q.id && p.at.x === q.at[0] && p.at.y === q.at[1]
    );
};

const shapes = new WeakMap<PathSession, PathShape>();

/**
 * The session's path as the handles work on it. Its tangent ends are the ones the route will have
 * once saved (AP-R1): the stored `from` while the first point is the stored first point, in the
 * same place, else where the marcher starts; likewise `to` with the last point.
 */
export function shapeOf(s: PathSession): PathShape {
    let shape = shapes.get(s);
    if (shape) return shape;
    const { target, points } = s;
    const ends = target.ends;
    const last = target.points.length - 1;
    shape = {
        from: target.from,
        to: target.to,
        points,
        ends: {
            from:
                ends && last >= 0 && storedAt(target, 0, points[0])
                    ? ends.from
                    : target.from,
            to:
                ends && last >= 0 && storedAt(target, last, points.at(-1))
                    ? ends.to
                    : target.to,
        },
    };
    shapes.set(s, shape);
    return shape;
}

const update = (fn: (s: PathSession) => PathSession) => {
    const { session } = usePathPenStore.getState();
    if (session) usePathPenStore.setState({ session: fn(session) });
};

/**
 * Starts drawing a new path for `target` (the old one stays until Enter replaces it). `object`:
 * drawing the selected path again, which stays the selection. `byRoute`: drawing the selected or
 * the open path again, a path edit by its route (AP-O8); always so for the selected path.
 */
export function startDrawing(
    target: PathTarget,
    drill: string,
    object = false,
    byRoute = object,
): void {
    usePathPenStore.setState({
        session: {
            phase: "drawing",
            target,
            drill,
            points: [],
            pointer: null,
            selected: null,
            dragging: null,
            object,
            byRoute,
        },
    });
}

/**
 * Selects the path `target` as an object (a click, a tap or a right-click on its line, AP-O3):
 * drawn selected, closed. The marcher selection is let go of by `usePathPenActions`. Already
 * selected or open, it stays as it is.
 */
export function selectPathObject(target: PathTarget, drill: string): void {
    const { session } = usePathPenStore.getState();
    if (
        session?.object &&
        session.phase !== "drawing" &&
        sameRoute(session.target, target)
    )
        return;
    usePathPenStore.setState({
        session: {
            phase: "closed",
            target,
            drill,
            points: pointsOf(target),
            pointer: null,
            selected: null,
            dragging: null,
            object: true,
        },
    });
}

/**
 * Escape on a selected path (AP-O4): an open one goes back to selected, as leaving a vector's
 * edit mode does; a selected one is let go of. False when no path object is selected.
 */
export function escapePathObject(): boolean {
    const { session } = usePathPenStore.getState();
    if (!session?.object || session.phase === "drawing") return false;
    if (session.phase === "open")
        usePathPenStore.setState({
            session: {
                ...session,
                phase: "closed",
                selected: null,
                dragging: null,
            },
        });
    else clearPath();
    return true;
}

/** Lets go of a selected path object (a click on empty field, AP-O4); false when there's none. */
export function deselectPathObject(): boolean {
    if (!usePathPenStore.getState().session?.object) return false;
    clearPath();
    return true;
}

/**
 * Shows `target`'s stored path on the field, closed, or refreshes it after a save or a move of the
 * playhead. A path already open for the same move stays open, keeping its selected point.
 */
export function showPath(
    target: PathTarget,
    drill: string,
    object = false,
): void {
    const { session } = usePathPenStore.getState();
    const points = pointsOf(target);
    const { openNext } = usePathPenStore.getState();
    const next =
        openNext !== null && !target.group && target.marcherId === openNext;
    if (next) usePathPenStore.setState({ openNext: null });
    // A path object is the same path while it's the same route (AP-O1)
    const same =
        session !== null &&
        (object
            ? session.object && sameRoute(session.target, target)
            : !session.object && pathKey(session.target) === pathKey(target));
    const open = next || (session?.phase === "open" && same);
    const kept =
        open && session && session.selected !== null
            ? Number(session.selected.slice(1)) < points.length
                ? session.selected
                : null
            : null;
    usePathPenStore.setState({
        session: {
            phase: open ? "open" : "closed",
            target,
            drill,
            points,
            pointer: null,
            selected: kept,
            dragging: null,
            object,
        },
    });
}

/** Opens the path shown for editing (a double-click on it, or Edit path); false when none is. */
export function openPath(): boolean {
    const { session } = usePathPenStore.getState();
    if (!session || session.phase === "drawing") return false;
    if (session.phase === "closed")
        usePathPenStore.setState({
            session: { ...session, phase: "open", selected: null },
        });
    return true;
}

/**
 * Closes the open path (Escape), leaving it drawn, or cancels a drawing: the path it would have
 * replaced, if any, is shown again.
 */
export function closePath(): void {
    const { session } = usePathPenStore.getState();
    if (!session || session.phase === "closed") return;
    if (session.phase === "drawing" && session.target.routeId === null) {
        clearPath();
        return;
    }
    usePathPenStore.setState({
        session: {
            ...session,
            phase: "closed",
            points:
                session.phase === "drawing"
                    ? pointsOf(session.target)
                    : session.points,
            pointer: null,
            selected: null,
            dragging: null,
        },
    });
}

/** Takes the path off the field: no marcher with a path selected, or playback. */
export function clearPath(): void {
    if (usePathPenStore.getState().session)
        usePathPenStore.setState({ session: null });
}

export const isDrawing = () =>
    usePathPenStore.getState().session?.phase === "drawing";

/** While drawing, a corner placed at `at` */
export function addPoint(at: XY): void {
    update((s) => ({ ...s, points: [...s.points, { at }] }));
}

/**
 * While drawing, the points as a press-and-drag has them: the point just placed smooth (or a corner
 * again), shown with its tangent bar until the release (`endNewPoint`)
 */
export function shapeNewPoint(points: readonly PathPoint[]): void {
    update((s) => ({ ...s, points, dragging: points.length - 1 }));
}

/** The press-and-drag that shaped the point just placed is let go */
export function endNewPoint(): void {
    update((s) => (s.dragging === null ? s : { ...s, dragging: null }));
}

/** Takes the last point back while drawing; false when not drawing. */
export function removeLastPoint(): boolean {
    const { session } = usePathPenStore.getState();
    if (!session || session.phase !== "drawing") return false;
    if (session.points.length > 0)
        update((s) => ({
            ...s,
            points: s.points.slice(0, -1),
            dragging: null,
        }));
    return true;
}

export function setPointer(pointer: XY | null): void {
    const { session } = usePathPenStore.getState();
    const was = session?.pointer ?? null;
    if (
        was === pointer ||
        (was && pointer && was.x === pointer.x && was.y === pointer.y)
    )
        return;
    update((s) => ({ ...s, pointer }));
}

export function selectPoint(key: string | null): void {
    update((s) => (s.selected === key ? s : { ...s, selected: key }));
}

/** The points as a drag has them, shown live and saved on release ({@link commitPoints}) */
export function dragPoints(points: readonly PathPoint[], index: number): void {
    update((s) => ({ ...s, dragging: index, points }));
}

/** A drag that was lost puts the points back. */
export function cancelDrag(before: readonly PathPoint[]): void {
    update((s) => ({ ...s, dragging: null, points: before }));
}

/** Writes `points` as the session's path (AP-R1), smooth ones with their roundness. */
async function save(points: readonly PathPoint[]): Promise<boolean> {
    const { session, saving } = usePathPenStore.getState();
    if (!session || saving) return false;
    usePathPenStore.setState({ saving: true });
    const stored = points.map((c) => ({
        ...(c.id === undefined ? {} : { id: c.id }),
        at: [c.at.x, c.at.y] as [number, number],
        ...((c.tension ?? 0) > 0 ? { tension: c.tension } : {}),
    }));
    const { target } = session;
    try {
        if (session.phase === "open" && target.routeId !== null)
            // Point edits on the open path are path edits, by its route (AP-O8, 07 N3); on a group
            // path they move every lane (AP-R1)
            await editPathPoints({
                db,
                routeId: target.routeId,
                points: stored,
            });
        else if (session.byRoute && target.routeId !== null)
            // The selected or open path drawn again: a path edit too, keeping its id (AP-O8)
            await redrawPath({
                db,
                routeId: target.routeId,
                points: stored,
            });
        else if (target.group)
            // The pen with several marchers: a group path (AP-R8)
            await drawGroupRoute({
                db,
                timelineId: target.timelineId,
                marcherIds: target.group.members.map((m) => m.marcherId),
                points: stored,
            });
        else
            await drawRoute({
                db,
                timelineId: target.timelineId,
                marcherId: target.marcherId,
                points: stored,
            });
        return true;
    } catch (error) {
        toastTimelineError(
            error,
            tolgee.t("pathways.errors.save", "Couldn't save the path"),
        );
        return false;
    } finally {
        usePathPenStore.setState({ saving: false });
    }
}

/**
 * Enter, a double-click or a click on the last point: the path drawn so far becomes the marcher's
 * (AP-R1). With no point placed it's the same as Escape, as a Line with too few points is. The
 * path is left shown and closed, read again once the timeline has it (`usePathPen`).
 */
export async function finishDrawing(): Promise<void> {
    const { session } = usePathPenStore.getState();
    if (!session || session.phase !== "drawing") return;
    if (session.points.length === 0) {
        closePath();
        return;
    }
    const ok = await save(session.points);
    if (ok)
        usePathPenStore.setState((state) => ({
            session: {
                ...session,
                phase: "closed",
                pointer: null,
                dragging: null,
            },
            saved: state.saved + 1,
        }));
    else closePath();
}

/**
 * The open path's points changed by a drag, a click on a midpoint or a menu: saved with every
 * point's id (AP-R1), one undo step, the points as they were when it fails. `selected` is the
 * point selected after it, when that changes.
 */
export async function commitPoints(
    points: readonly PathPoint[],
    before: readonly PathPoint[],
    selected?: string | null,
): Promise<void> {
    const { session } = usePathPenStore.getState();
    if (!session || session.phase !== "open") return;
    update((s) => ({
        ...s,
        dragging: null,
        points,
        ...(selected === undefined ? {} : { selected }),
    }));
    if (await save(points))
        usePathPenStore.setState((state) => ({ saved: state.saved + 1 }));
    else cancelDrag(before);
}

/** A new point in the middle of leg `leg` of the open path, selected (a Line's Add point here) */
export async function insertPoint(leg: number): Promise<void> {
    const { session } = usePathPenStore.getState();
    if (!session || session.phase !== "open") return;
    await commitPoints(
        splitLeg(shapeOf(session), leg),
        session.points,
        pointKey(leg),
    );
}

/**
 * Deletes point `index`. On the open path that's AP-R1 without it, one undo step; its last point
 * removes the path instead (AP-R2), so no path with no point is left behind. While drawing, the
 * point just goes.
 */
export async function deletePoint(
    index: number,
    { selectNeighbor = false }: { selectNeighbor?: boolean } = {},
): Promise<void> {
    const { session } = usePathPenStore.getState();
    if (!session || !session.points[index]) return;
    const points = session.points.filter((_, i) => i !== index);
    if (session.phase === "drawing") {
        update((s) => ({ ...s, selected: null, points }));
        return;
    }
    if (points.length === 0) {
        await removePath();
        return;
    }
    // From the keyboard, the point before it is selected next (the first, when it was the first),
    // so pressing on deletes point after point, and only the last removes the path
    await commitPoints(
        points,
        session.points,
        selectNeighbor ? pointKey(Math.max(0, index - 1)) : null,
    );
}

/**
 * Point `index` of the open path made a corner, or smooth at the plain roundness (Corner | Smooth,
 * a double-click, the editor bar): one undo step; nothing when it already is. Smooth selects it,
 * so its tangent bar shows, as a Line's Smooth does.
 */
export async function setPointSmooth(
    index: number,
    smooth: boolean,
): Promise<void> {
    const { session } = usePathPenStore.getState();
    if (!session || session.phase !== "open" || !session.points[index]) return;
    const shape = shapeOf(session);
    if (isSmooth(shape, index) === smooth) {
        if (smooth) selectPoint(pointKey(index));
        return;
    }
    await commitPoints(
        withTension(shape, index, smooth ? SMOOTH : 0),
        session.points,
        smooth ? pointKey(index) : undefined,
    );
}

/** How long the Remove path toast with Undo stays, unless the next history change closes it */
const TOAST_MS = 8000;

/** A success toast with Undo that closes on the next history change, as split and merge's do */
function toastWithUndo(message: string): void {
    let unsubscribe = () => {};
    const id = toast.success(message, {
        duration: TOAST_MS,
        action: {
            label: tolgee.t("actions.edit.undo", "Undo"),
            onClick: () => runAction("performUndo"),
        },
        onDismiss: () => unsubscribe(),
        onAutoClose: () => unsubscribe(),
    });
    unsubscribe = subscribeHistoryChanges(() => {
        unsubscribe();
        toast.dismiss(id);
    });
}

/**
 * Remove path (AP-R2), open or closed: the move goes straight again, one undo step. On a group
 * path the whole group's path goes, and the toast says for how many marchers (step 15).
 */
export async function removePath(): Promise<void> {
    const { session, saving } = usePathPenStore.getState();
    if (
        !session ||
        session.phase === "drawing" ||
        saving ||
        session.target.routeId === null
    )
        return;
    usePathPenStore.setState({ saving: true });
    try {
        const { marcherIds } = await removeRoute({
            db,
            routeId: session.target.routeId,
        });
        clearPath();
        if (session.target.group)
            toastWithUndo(
                tolgee.t(
                    "pathways.toasts.removedGroup",
                    "Removed the path for {count, plural, one {# marcher} other {# marchers}}",
                    { count: marcherIds.length },
                ),
            );
    } catch (error) {
        toastTimelineError(
            error,
            tolgee.t("pathways.errors.remove", "Couldn't remove the path"),
        );
    } finally {
        usePathPenStore.setState({ saving: false });
    }
}

/**
 * Own path (AP-R9, step 15): the selected marchers on the shown group path each get a copy of
 * their lane, one undo step. With one marcher, its own path is then shown, open (the hook reads
 * it again after the save and keeps it open).
 */
export async function ownPathFor(marcherIds: readonly number[]): Promise<void> {
    const { session, saving } = usePathPenStore.getState();
    if (!session?.target.group || saving || marcherIds.length === 0) return;
    // Opened again after the save (`openNext`), not kept open as the group path
    if (marcherIds.length === 1) clearPath();
    usePathPenStore.setState({ saving: true });
    try {
        await ownPath({
            db,
            timelineId: session.target.timelineId,
            marcherIds,
        });
        usePathPenStore.setState((state) => ({
            saved: state.saved + 1,
            openNext: marcherIds.length === 1 ? marcherIds[0]! : null,
        }));
    } catch (error) {
        toastTimelineError(
            error,
            tolgee.t("pathways.errors.save", "Couldn't save the path"),
        );
    } finally {
        usePathPenStore.setState({ saving: false });
    }
}

/**
 * Rejoin (AP-R10, step 15): the selected marchers off the group path follow it, one undo step: a
 * member that took Own path gets its lane back, another marcher joins the group. The group path
 * is the one shown, or with only marchers off any group path selected, the move's only one.
 */
export async function rejoinFor(target: RejoinTarget | null): Promise<void> {
    const { saving } = usePathPenStore.getState();
    if (!target || saving || target.marcherIds.length === 0) return;
    usePathPenStore.setState({ saving: true });
    try {
        await rejoinGroupPath({
            db,
            timelineId: target.timelineId,
            routeId: target.routeId,
            marcherIds: target.marcherIds,
        });
        usePathPenStore.setState((state) => ({ saved: state.saved + 1 }));
    } catch (error) {
        toastTimelineError(
            error,
            tolgee.t("pathways.errors.save", "Couldn't save the path"),
        );
    } finally {
        usePathPenStore.setState({ saving: false });
    }
}
