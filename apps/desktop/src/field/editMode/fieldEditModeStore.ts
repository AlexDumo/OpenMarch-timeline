import { create } from "zustand";
import type { FieldLineRef } from "./lines";
import type { LineSelection } from "./lineSelection";

/**
 * The Edit field mode (#824): the main canvas edits the field's lines instead of the drill.
 * While it's on, the field draws rulers and its lines can be picked and dragged, marchers dim
 * and can't be picked, and the inspector holds the field's settings. Everything it changes goes
 * through the field edits (`src/field/edits`), one undo step each.
 *
 * This store holds the mode's view state only (nothing here is saved): what's selected, what the
 * pointer is over, which line's popover is open, and whether edits mirror across the 50.
 */
export interface FieldEditDrag {
    /** "add": out of a ruler; "move": a line (or the selection) dragged */
    readonly kind: "add" | "move";
    readonly axis: "x" | "y";
    /** Where it would go, in steps */
    readonly steps: number;
    /** Over its ruler: letting go deletes the dragged lines (move) or adds nothing (add) */
    readonly overRuler: boolean;
    /** The lines being moved */
    readonly lines: readonly FieldLineRef[];
}

export interface FieldEditModeState {
    readonly active: boolean;
    /** Edits on an X line also edit its twin across the 50 (on by default) */
    readonly mirror: boolean;
    readonly selection: LineSelection;
    /** The line under the pointer, on the field or in the inspector's list */
    readonly hover: FieldLineRef | null;
    /** The line whose exact-values popover is open */
    readonly editing: FieldLineRef | null;
    /** The line menu (right-click, long press), where, in element px */
    readonly menu: {
        readonly line: FieldLineRef;
        readonly at: { readonly x: number; readonly y: number };
    } | null;
    /** A drag in progress, for the readout and the field test API */
    readonly drag: FieldEditDrag | null;
    /** Taps add to the selection (the touch layout's Select many) */
    readonly selectMany: boolean;
    /** Where the pointer last was over the field, in steps on each axis; X and Y add there */
    readonly pointer: { readonly x: number; readonly y: number } | null;
}

const IDLE = {
    selection: [],
    hover: null,
    editing: null,
    menu: null,
    drag: null,
    selectMany: false,
    pointer: null,
} as const;

export const useFieldEditModeStore = create<FieldEditModeState>(() => ({
    active: false,
    mirror: true,
    ...IDLE,
}));

export const fieldEditMode = {
    get: () => useFieldEditModeStore.getState(),
    isActive: () => useFieldEditModeStore.getState().active,
    enter: () => useFieldEditModeStore.setState({ active: true, ...IDLE }),
    exit: () => useFieldEditModeStore.setState({ active: false, ...IDLE }),
    select: (selection: LineSelection) =>
        useFieldEditModeStore.setState({ selection }),
    setHover: (hover: FieldLineRef | null) =>
        useFieldEditModeStore.setState({ hover }),
    setMirror: (mirror: boolean) => useFieldEditModeStore.setState({ mirror }),
    edit: (editing: FieldLineRef | null) =>
        useFieldEditModeStore.setState({ editing, menu: null }),
    openMenu: (menu: FieldEditModeState["menu"]) =>
        useFieldEditModeStore.setState({ menu }),
    setDrag: (drag: FieldEditDrag | null) =>
        useFieldEditModeStore.setState({ drag }),
    setSelectMany: (selectMany: boolean) =>
        useFieldEditModeStore.setState({ selectMany }),
    setPointer: (pointer: FieldEditModeState["pointer"]) =>
        useFieldEditModeStore.setState({ pointer }),
};

export const useIsFieldEditMode = () => useFieldEditModeStore((s) => s.active);
