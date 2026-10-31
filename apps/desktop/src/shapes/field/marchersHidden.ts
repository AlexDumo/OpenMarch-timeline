import { create } from "zustand";
import type { FieldModeDrawing } from "@/field/editor/fieldEditor";
import { useBoxSelectionStore } from "../placed/boxSelectionStore";
import {
    isShapeHidden,
    useShapeHidden,
    useShapeToolStore,
} from "../tool/shapeToolStore";

/** A release of the key sooner than this after its press is a tap, which latches (#558) */
export const HIDE_MARCHERS_TAP_MS = 250;

/**
 * Seeing a shape on its own (#558): while a shape is edited, holding H hides the marchers, the
 * shape's spots and its walks, and letting go shows them again; a tap keeps them hidden until the
 * next tap. Only the drawing changes, so it is no edit, undo step or selection change. Not saved:
 * every shape session starts with the marchers shown (owner).
 */
export interface MarchersHiddenState {
    /** The key is down */
    readonly held: boolean;
    /** A tap (or the editor's eye button) hid them until the next one */
    readonly latched: boolean;
    /** When the key went down, while held */
    readonly pressedAt: number | null;
}

export const SHOWN: MarchersHiddenState = {
    held: false,
    latched: false,
    pressedAt: null,
};

/** The key went down at `now`; a repeat while held changes nothing */
export function pressHide(
    state: MarchersHiddenState,
    now: number,
): MarchersHiddenState {
    return state.held ? state : { ...state, held: true, pressedAt: now };
}

/**
 * The key came up at `now`: a tap (under {@link HIDE_MARCHERS_TAP_MS}) turns the latch over, a
 * longer hold leaves it as it was. `lost` (the window lost focus while it was down) lets go
 * without counting a tap.
 */
export function releaseHide(
    state: MarchersHiddenState,
    now: number,
    lost = false,
): MarchersHiddenState {
    if (!state.held) return state;
    const tap =
        !lost &&
        state.pressedAt !== null &&
        now - state.pressedAt < HIDE_MARCHERS_TAP_MS;
    return {
        held: false,
        pressedAt: null,
        latched: tap ? !state.latched : state.latched,
    };
}

/** The eye button and the command palette, which have no key to let go: turn the latch over */
export function toggleHide(state: MarchersHiddenState): MarchersHiddenState {
    return { ...state, latched: !state.latched };
}

/** Whether the marchers are hidden by this state: held or latched */
export const isHiding = (state: MarchersHiddenState): boolean =>
    state.held || state.latched;

export const useMarchersHiddenStore = create<MarchersHiddenState>(() => SHOWN);

const change = (next: (s: MarchersHiddenState) => MarchersHiddenState) =>
    useMarchersHiddenStore.setState(next(useMarchersHiddenStore.getState()));

export const pressHideMarchers = (now = Date.now()): void =>
    change((s) => pressHide(s, now));
export const releaseHideMarchers = (now = Date.now(), lost = false): void =>
    change((s) => releaseHide(s, now, lost));
export const toggleHideMarchers = (): void => change(toggleHide);

/** Shows the marchers again: a shape session starts or ends with them shown */
export function showMarchers(): void {
    if (useMarchersHiddenStore.getState() !== SHOWN)
        useMarchersHiddenStore.setState(SHOWN, true);
}

// An open shape's session starts when a tool opens at a moment (the Shapes tab, a kind's key, the
// ring, the command bar, undo after Escape) and ends when it closes; turning it into another kind
// keeps both, and the marchers as they were. A placed shape's starts when it is selected and ends
// when it isn't any more.
useShapeToolStore.subscribe((state, prev) => {
    if (
        (state.tool === null) !== (prev.tool === null) ||
        state.moment !== prev.moment
    )
        showMarchers();
});
useBoxSelectionStore.subscribe((state, prev) => {
    if (state.selected?.recipe.id !== prev.selected?.recipe.id) showMarchers();
});

/**
 * Whether the field hides the marchers, the shape's spots and its walks now. A shape waiting out
 * of sight (playing, away from its moment, Visuals or Preview, #416) shows them, whatever the key.
 */
export function useMarchersHidden(): boolean {
    const hiding = useMarchersHiddenStore(isHiding);
    const shapeAway = useShapeHidden();
    return hiding && !shapeAway;
}

/** {@link useMarchersHidden} outside React (the field test API) */
export const marchersHiddenNow = (): boolean =>
    isHiding(useMarchersHiddenStore.getState()) && !isShapeHidden();

/**
 * The shape's drawing on its own: its outline, handles and guides, without its spots (on a guide,
 * left empty or labelled), its marchers' start ghosts or their walks
 */
export function shapeAlone(drawing: FieldModeDrawing): FieldModeDrawing {
    return {
        ...drawing,
        spots: [],
        walks: [],
        rings: undefined,
        ringIds: undefined,
        gaps: undefined,
        labels: undefined,
        onGuides: undefined,
    };
}
