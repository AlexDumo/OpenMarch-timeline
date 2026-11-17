import { useBoxSelectionStore } from "@/shapes/placed/boxSelectionStore";
import {
    pathKey,
    pathShown,
    usePathPenStore,
    type PathSession,
} from "./pathPenStore";

/**
 * A selected trail and the placed shape its marchers stand in at the move's end (owner,
 * 2026-11-17). Right after a drag-out the end line is saved as a placed Line shape (DL-11), and a
 * trail into a form ends in that form's shape: selecting the trail then ran two editors on the same
 * marchers, the shape's bars, handles, move dot and rotate knob beside the path's bar. While the
 * trail is shown (selected, or open in Edit path) the shape keeps only its body (a drag inside
 * still moves it), and its controls are tucked away until the path bar's ··· shows them (Shape
 * controls, `trailShapeControls`). Precedent: Figma shows a selected vector's outline and one
 * toolbar, its points only in edit mode.
 */

/**
 * The trail shown now, stored and not being drawn, or null. While its head is dragged or drawn on
 * (AP-T16, L.15) it's still that stored trail (`restore`): its end shape stays tucked away, so the
 * shape's bar doesn't sit faded under the drawing.
 */
function trailShown(
    state: Pick<
        ReturnType<typeof usePathPenStore.getState>,
        "session" | "hidden"
    >,
): PathSession | null {
    const { hidden } = state;
    const session = state.session?.follow?.head?.restore ?? state.session;
    return pathShown(session, hidden) &&
        session.target.trail &&
        session.target.routeId !== null &&
        session.phase !== "drawing" &&
        !session.object
        ? session
        : null;
}

/** Whether `ids` are exactly the trail's marchers */
function sameMarchers(session: PathSession, ids: readonly number[]): boolean {
    const members = session.target.trail!.members;
    if (members.length !== ids.length) return false;
    const set = new Set(ids);
    return members.every((m) => set.has(m.marcherId));
}

/**
 * Whether a placed shape on exactly `ids` is a shown trail's end shape with its controls tucked
 * away: the trail is stored, shown and not being drawn, and Shape controls is off for it
 */
export function shapeTuckedUnderTrail(
    ids: readonly number[],
    state: Pick<
        ReturnType<typeof usePathPenStore.getState>,
        "session" | "hidden" | "shapeControlsFor"
    > = usePathPenStore.getState(),
): boolean {
    const session = trailShown(state);
    return (
        !!session &&
        sameMarchers(session, ids) &&
        state.shapeControlsFor !== pathKey(session.target)
    );
}

/** {@link shapeTuckedUnderTrail} as a hook */
export function useShapeTuckedUnderTrail(
    ids: readonly number[] | null,
): boolean {
    return usePathPenStore((s) => !!ids && shapeTuckedUnderTrail(ids, s));
}

/** Whether the trail shown has its end shape's controls on (Shape controls checked) */
export function useTrailShapeControls(): boolean {
    return usePathPenStore((s) => {
        const session = trailShown(s);
        return !!session && s.shapeControlsFor === pathKey(session.target);
    });
}

/** Shape controls (`trailShapeControls`): shows or tucks away the trail's end shape's controls */
export function toggleTrailShapeControls(): void {
    const state = usePathPenStore.getState();
    const session = trailShown(state);
    if (!session) return;
    const key = pathKey(session.target);
    usePathPenStore.setState({
        shapeControlsFor: state.shapeControlsFor === key ? null : key,
    });
}

/**
 * Whether the trail shown has an end shape here: the placed shape selected with it stands on
 * exactly its marchers (the move's end, where the shape is)
 */
export function useTrailEndShape(): boolean {
    const box = useBoxSelectionStore((s) => s.selected);
    return usePathPenStore((s) => {
        const session = trailShown(s);
        return (
            !!session &&
            !!box &&
            sameMarchers(
                session,
                box.recipe.members.map((m) => m.marcherId),
            )
        );
    });
}
