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
 * The pen's session (pathways step 1): a path being drawn for one marcher (`drawing`), or one
 * marcher's stored path open on the field (`open`) with its corners to drag. Each write is one
 * app procedure (AP-R1, AP-R2) and one undo step.
 */
export interface PathSession {
    readonly phase: "drawing" | "open";
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
     * The open path Escape closed (`timelineId:marcherId`), kept closed until the selection or the
     * move changes
     */
    dismissed: string | null;
    /**
     * Counts the saves: the open path reads its move again after each, so a path just finished
     * learns its route (and Remove path shows) even when the timeline caught up during the save
     */
    saved: number;
}

export const usePathPenStore = create<PathPenState>(() => ({
    session: null,
    saving: false,
    dismissed: null,
    saved: 0,
}));

export const pathKey = (t: Pick<PathTarget, "timelineId" | "marcherId">) =>
    `${t.timelineId}:${t.marcherId}`;

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
        dismissed: null,
    });
}

/** Opens `target`'s stored path on the field, or refreshes it after a save, keeping the selection */
export function openPath(target: PathTarget, drill: string): void {
    const { session } = usePathPenStore.getState();
    const corners = target.points.map((p) => ({
        id: p.id,
        at: { x: p.at[0], y: p.at[1] },
    }));
    const same =
        session?.phase === "open" &&
        pathKey(session.target) === pathKey(target);
    const kept =
        same && session.selected !== null
            ? Number(session.selected.slice(1)) < corners.length
                ? session.selected
                : null
            : null;
    usePathPenStore.setState({
        session: {
            phase: "open",
            target,
            drill,
            corners,
            pointer: null,
            selected: kept,
            dragging: null,
        },
    });
}

/** Closes the pen and any open path; `dismiss` keeps an open path closed (Escape). */
export function closePath(dismiss = false): void {
    const { session } = usePathPenStore.getState();
    usePathPenStore.setState({
        session: null,
        dismissed:
            dismiss && session?.phase === "open"
                ? pathKey(session.target)
                : null,
    });
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
 * stored path opens again once the timeline has it (`usePathPen`).
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
            session: { ...session, phase: "open", pointer: null },
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
        await removeOpenPath();
        return;
    }
    await commitCorners(corners, session.corners, null);
}

/** Remove path (AP-R2): the move goes straight again, one undo step. */
export async function removeOpenPath(): Promise<void> {
    const { session, saving } = usePathPenStore.getState();
    if (!session || saving || session.target.routeId === null) return;
    usePathPenStore.setState({ saving: true });
    try {
        await removeRoute({ db, transitionId: session.target.transitionId });
        closePath();
    } catch (error) {
        toastTimelineError(
            error,
            tolgee.t("pathways.errors.remove", "Couldn't remove the path"),
        );
    } finally {
        usePathPenStore.setState({ saving: false });
    }
}
