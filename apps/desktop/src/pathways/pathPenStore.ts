import { create } from "zustand";
import { db } from "@/global/database/db";
import { drawRoute, removeRoute } from "@/db-functions/timelineRoutes";
import { toastTimelineError } from "@/timeline/timelineErrorMessages";
import tolgee from "@/global/singletons/Tolgee";
import type { XY } from "@/shapes/types";
import type { PathTarget } from "./pathTarget";
import {
    cornerKey,
    splitLeg,
    type PathCorner,
    type PathShape,
} from "./pathEdit";

export type { PathCorner } from "./pathEdit";

/**
 * The pen's session (pathways step 1): a path being drawn for one marcher (`drawing`), the
 * selected marcher's stored path shown on the field (`closed`: drawn, nothing to grab), or opened
 * for editing (`open`) with its corners to drag and its floating editor. A double-click or the
 * right-click menu on the path opens it (owner, 2026-11-04). Each write is one app procedure
 * (AP-R1, AP-R2) and one undo step.
 */
export interface PathSession {
    readonly phase: "drawing" | "closed" | "open";
    readonly target: PathTarget;
    /** The marcher's drill number, as the drawing banner names it */
    readonly drill: string;
    readonly corners: readonly PathCorner[];
    /**
     * While drawing, where a click now would put the next corner, landed as a Line's next point
     * is: the preview's leg goes there
     */
    readonly pointer: XY | null;
    /** The corner's handle a click picked (open, `p<i>`), which Backspace deletes */
    readonly selected: string | null;
    /** The corner being dragged (the corners shown are the drag's, not yet saved), or null */
    readonly dragging: number | null;
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
}

export const usePathPenStore = create<PathPenState>(() => ({
    session: null,
    saving: false,
    saved: 0,
}));

/** The move a path is for: the same key is the same marcher's same move */
export const pathKey = (
    t: Pick<PathTarget, "timelineId" | "transitionId" | "marcherId">,
) => `${t.timelineId}:${t.transitionId}:${t.marcherId}`;

const cornersOf = (target: PathTarget): PathCorner[] =>
    target.points.map((p) => ({ id: p.id, at: { x: p.at[0], y: p.at[1] } }));

/** The session's path as the handles work on it */
export const shapeOf = (s: PathSession): PathShape => ({
    from: s.target.from,
    to: s.target.to,
    corners: s.corners,
});

const update = (fn: (s: PathSession) => PathSession) => {
    const { session } = usePathPenStore.getState();
    if (session) usePathPenStore.setState({ session: fn(session) });
};

/** Starts drawing a new path for `target` (the old one stays until Enter replaces it). */
export function startDrawing(target: PathTarget, drill: string): void {
    usePathPenStore.setState({
        session: {
            phase: "drawing",
            target,
            drill,
            corners: [],
            pointer: null,
            selected: null,
            dragging: null,
        },
    });
}

/**
 * Shows `target`'s stored path on the field, closed, or refreshes it after a save or a move of the
 * playhead. A path already open for the same move stays open, keeping its selected corner.
 */
export function showPath(target: PathTarget, drill: string): void {
    const { session } = usePathPenStore.getState();
    const corners = cornersOf(target);
    const open =
        session?.phase === "open" &&
        pathKey(session.target) === pathKey(target);
    const kept =
        open && session.selected !== null
            ? Number(session.selected.slice(1)) < corners.length
                ? session.selected
                : null
            : null;
    usePathPenStore.setState({
        session: {
            phase: open ? "open" : "closed",
            target,
            drill,
            corners,
            pointer: null,
            selected: kept,
            dragging: null,
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
            corners:
                session.phase === "drawing"
                    ? cornersOf(session.target)
                    : session.corners,
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

export function addCorner(at: XY): void {
    update((s) => ({ ...s, corners: [...s.corners, { at }] }));
}

/** Takes the last corner back while drawing; false when not drawing. */
export function removeLastCorner(): boolean {
    const { session } = usePathPenStore.getState();
    if (!session || session.phase !== "drawing") return false;
    if (session.corners.length > 0)
        update((s) => ({ ...s, corners: s.corners.slice(0, -1) }));
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

export function selectCorner(key: string | null): void {
    update((s) => (s.selected === key ? s : { ...s, selected: key }));
}

/** The corners as a drag has them, shown live and saved on release ({@link commitCorners}) */
export function dragCorners(
    corners: readonly PathCorner[],
    index: number,
): void {
    update((s) => ({ ...s, dragging: index, corners }));
}

/** A drag that was lost puts the corners back. */
export function cancelDrag(before: readonly PathCorner[]): void {
    update((s) => ({ ...s, dragging: null, corners: before }));
}

/** Writes `corners` as the session's path (AP-R1). */
async function save(corners: readonly PathCorner[]): Promise<boolean> {
    const { session, saving } = usePathPenStore.getState();
    if (!session || saving) return false;
    usePathPenStore.setState({ saving: true });
    try {
        await drawRoute({
            db,
            timelineId: session.target.timelineId,
            marcherId: session.target.marcherId,
            points: corners.map((c) => ({
                ...(c.id === undefined ? {} : { id: c.id }),
                at: [c.at.x, c.at.y],
            })),
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
 * Enter, a double-click or a click on the last corner: the path drawn so far becomes the marcher's
 * (AP-R1). With no corner placed it's the same as Escape, as a Line with too few points is. The
 * path is left shown and closed, read again once the timeline has it (`usePathPen`).
 */
export async function finishDrawing(): Promise<void> {
    const { session } = usePathPenStore.getState();
    if (!session || session.phase !== "drawing") return;
    if (session.corners.length === 0) {
        closePath();
        return;
    }
    const ok = await save(session.corners);
    if (ok)
        usePathPenStore.setState((state) => ({
            session: { ...session, phase: "closed", pointer: null },
            saved: state.saved + 1,
        }));
    else closePath();
}

/**
 * The open path's corners changed by a drag, a click on a midpoint or a menu: saved with every
 * corner's id (AP-R1), one undo step, the corners as they were when it fails. `selected` is the
 * corner selected after it, when that changes.
 */
export async function commitCorners(
    corners: readonly PathCorner[],
    before: readonly PathCorner[],
    selected?: string | null,
): Promise<void> {
    const { session } = usePathPenStore.getState();
    if (!session || session.phase !== "open") return;
    update((s) => ({
        ...s,
        dragging: null,
        corners,
        ...(selected === undefined ? {} : { selected }),
    }));
    if (await save(corners))
        usePathPenStore.setState((state) => ({ saved: state.saved + 1 }));
    else cancelDrag(before);
}

/** A new corner in the middle of leg `leg` of the open path, selected (a Line's Add point here) */
export async function insertCorner(leg: number): Promise<void> {
    const { session } = usePathPenStore.getState();
    if (!session || session.phase !== "open") return;
    await commitCorners(
        splitLeg(shapeOf(session), leg),
        session.corners,
        cornerKey(leg),
    );
}

/**
 * Deletes corner `index`. On the open path that's AP-R1 without it, one undo step; its last corner
 * removes the path instead (AP-R2), so no path with no corner is left behind. While drawing, the
 * corner just goes.
 */
export async function deleteCorner(index: number): Promise<void> {
    const { session } = usePathPenStore.getState();
    if (!session || !session.corners[index]) return;
    const corners = session.corners.filter((_, i) => i !== index);
    if (session.phase === "drawing") {
        update((s) => ({ ...s, selected: null, corners }));
        return;
    }
    if (corners.length === 0) {
        await removePath();
        return;
    }
    await commitCorners(corners, session.corners, null);
}

/** Remove path (AP-R2), open or closed: the move goes straight again, one undo step. */
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
        await removeRoute({ db, transitionId: session.target.transitionId });
        clearPath();
    } catch (error) {
        toastTimelineError(
            error,
            tolgee.t("pathways.errors.remove", "Couldn't remove the path"),
        );
    } finally {
        usePathPenStore.setState({ saving: false });
    }
}
