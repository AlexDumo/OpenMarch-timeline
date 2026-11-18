/**
 * The pen's Straight | Curve switch: what a click places while a path is drawn (owner, 2026-11-17: "while drawing these
 * paths, i want to be able to switch easily between curve and straight"): the path bar's
 * **Straight | Curve** switch, for every drawing (the Path pen, the Follow tool's trail, a trail's
 * head drawn on). Straight places a corner, Curve a smooth point at the plain roundness; holding
 * Alt (`PEN_KEYS.otherKind`) places the other kind while it's held. A press-and-drag still places
 * a smooth point, its roundness the drag's. The choice is the user's, not the show's: it's kept
 * with the app's other per-user settings and starts Straight.
 */
import { create } from "zustand";
import { SMOOTH } from "@/shapes/line/lineGeometry";
import { isRoleKeyHeld, PEN_KEYS, type HeldKeys } from "@/input/modifierRoles";
import type { XY } from "@/shapes/types";
import type { PathPoint } from "./penPath";

export type DrawKind = "straight" | "curve";

export const DRAW_KIND_STORAGE_KEY = "openmarch:pathDrawKind";

interface DrawKindState {
    /** The switch: what a plain click places */
    readonly kind: DrawKind;
    /** The other-kind key is held now (Alt): the point placed while it is, the other kind */
    readonly otherHeld: boolean;
}

const load = (): DrawKind => {
    try {
        return localStorage.getItem(DRAW_KIND_STORAGE_KEY) === "curve"
            ? "curve"
            : "straight";
    } catch {
        return "straight";
    }
};

export const useDrawKindStore = create<DrawKindState>(() => ({
    kind: load(),
    otherHeld: false,
}));

/** The switch set to `kind`, remembered for the next drawing and the next time the app opens */
export function setDrawKind(kind: DrawKind): void {
    try {
        localStorage.setItem(DRAW_KIND_STORAGE_KEY, kind);
    } catch {
        // Storage may be unavailable (private window); keep it in memory
    }
    if (useDrawKindStore.getState().kind !== kind)
        useDrawKindStore.setState({ kind });
}

/** Whether the other-kind key is down among `keys` (Alt) */
export const holdsOtherKind = (keys: HeldKeys): boolean =>
    isRoleKeyHeld(PEN_KEYS.otherKind, keys);

/** The other-kind key went down or up (a key event, or a pointer event's keys) */
export function setOtherKindHeld(held: boolean): void {
    if (useDrawKindStore.getState().otherHeld !== held)
        useDrawKindStore.setState({ otherHeld: held });
}

/**
 * Whether a click now places a smooth point: Curve, unless the other-kind key is held; Straight,
 * only while it is. `keys`: the click's own keys, else the ones last seen.
 */
export function clickPlacesSmooth(keys?: HeldKeys): boolean {
    const { kind, otherHeld } = useDrawKindStore.getState();
    const other = keys ? holdsOtherKind(keys) : otherHeld;
    return (kind === "curve") !== other;
}

/** A point clicked at `at`: a corner, or smooth at the plain roundness */
export const clickedPoint = (at: XY, smooth: boolean): PathPoint =>
    smooth ? { at, tension: SMOOTH } : { at };
