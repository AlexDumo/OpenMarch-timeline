import { create } from "zustand";
import { db } from "@/global/database/db";
import { drawRoute, removeRoute } from "@/db-functions/timelineRoutes";
import { toastTimelineError } from "@/timeline/timelineErrorMessages";
import tolgee from "@/global/singletons/Tolgee";
import type { XY } from "@/shapes/types";
import type { PathTarget } from "./pathTarget";

/** A corner as the pen holds it: a stored corner keeps its `id`, a new one has none yet. */
export interface PathCorner {
    readonly id?: string;
    readonly at: XY;
}

/**
 * The pen's session (pathways step 1): a path being drawn for one marcher (`drawing`), or one
 * marcher's stored path open on the field (`open`) with its corners to drag. Each write is one
 * app procedure (AP-R1, AP-R2) and one undo step.
 */
export interface PathSession {
    readonly phase: "drawing" | "open";
    readonly target: PathTarget;
    /** The marcher's drill number, as the banner and the editor name it */
    readonly drill: string;
    readonly corners: readonly PathCorner[];
    /** Where the pointer is while drawing, for the leg to it */
    readonly pointer: XY | null;
    /** The corner a click picked (open), which Backspace deletes */
    readonly selected: number | null;
    /** The corner being dragged */
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
}

export const usePathPenStore = create<PathPenState>(() => ({
    session: null,
    saving: false,
    dismissed: null,
}));

export const pathKey = (t: Pick<PathTarget, "timelineId" | "marcherId">) =>
    `${t.timelineId}:${t.marcherId}`;

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

/** Opens `target`'s stored path on the field, or refreshes it after a save. */
export function openPath(target: PathTarget, drill: string): void {
    usePathPenStore.setState({
        session: {
            phase: "open",
            target,
            drill,
            corners: target.points.map((p) => ({
                id: p.id,
                at: { x: p.at[0], y: p.at[1] },
            })),
            pointer: null,
            selected: null,
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

/** Takes the last corner back while drawing; false when there is none. */
export function removeLastCorner(): boolean {
    const { session } = usePathPenStore.getState();
    if (!session || session.phase !== "drawing" || session.corners.length === 0)
        return false;
    update((s) => ({ ...s, corners: s.corners.slice(0, -1) }));
    return true;
}

export function setPointer(pointer: XY | null): void {
    update((s) => ({ ...s, pointer }));
}

export function selectCorner(index: number | null): void {
    update((s) => ({ ...s, selected: index }));
}

export function dragCorner(index: number, at: XY): void {
    update((s) => ({
        ...s,
        dragging: index,
        corners: s.corners.map((c, i) => (i === index ? { ...c, at } : c)),
    }));
}

/** A drag that was lost puts the corners back. */
export function cancelDrag(before: readonly PathCorner[]): void {
    update((s) => ({ ...s, dragging: null, corners: before }));
}

/** Writes `corners` as the session's path (AP-R1), then opens it as stored. */
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
 * Enter: the path drawn so far becomes the marcher's (AP-R1). The pen closes; the stored path
 * opens again once the timeline has it (`usePathPen`).
 */
export async function finishDrawing(): Promise<void> {
    const { session } = usePathPenStore.getState();
    if (!session || session.phase !== "drawing") return;
    // No corner placed: nothing to keep, the move stays as it was
    if (session.corners.length === 0) {
        closePath();
        return;
    }
    const ok = await save(session.corners);
    if (ok)
        usePathPenStore.setState({
            session: { ...session, phase: "open", pointer: null },
        });
    else closePath();
}

/** A dragged corner let go on an open path: saved with every corner's id (AP-R1). */
export async function commitDrag(before: readonly PathCorner[]): Promise<void> {
    const { session } = usePathPenStore.getState();
    if (!session) return;
    update((s) => ({ ...s, dragging: null }));
    if (session.phase === "drawing") return;
    if (!(await save(session.corners))) cancelDrag(before);
}

/** Deletes corner `index` of the open path (AP-R1 without it). */
export async function deleteCorner(index: number): Promise<void> {
    const { session } = usePathPenStore.getState();
    if (!session || !session.corners[index]) return;
    if (session.phase === "drawing") {
        update((s) => ({
            ...s,
            selected: null,
            corners: s.corners.filter((_, i) => i !== index),
        }));
        return;
    }
    const corners = session.corners.filter((_, i) => i !== index);
    update((s) => ({ ...s, selected: null, corners }));
    if (!(await save(corners)))
        update((s) => ({ ...s, corners: session.corners }));
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
