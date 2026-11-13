import { create } from "zustand";
import type { FieldLineRef } from "./lines";
import type { LineSelection } from "./lineSelection";

/**
 * The Field panel (#824) and its Edit lines mode. While the panel is open (`active`) the field
 * holds still, fitted beside it, and the drill can't be picked; the panel's tabs hold the field's
 * settings. Edit lines (`lines`, on the Lines tab only) is the mode where the field draws rulers,
 * its lines can be picked and dragged, and the line keys work; the marchers step back while it's
 * on. Everything either changes goes through the field edits (`src/field/edits`), one undo step
 * each.
 *
 * This store holds view state only (nothing here is saved): the tab, what's selected, what the
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

export type FieldPanelTab = "setup" | "lines" | "appearance";

export interface FieldEditModeState {
    /** The Field panel is open */
    readonly active: boolean;
    /** Edit lines is on: the field's lines can be picked, dragged and added */
    readonly lines: boolean;
    /** The Field panel's tab */
    readonly tab: FieldPanelTab;
    /** Edits on an X line also edit its twin across the 50 (on by default) */
    readonly mirror: boolean;
    readonly selection: LineSelection;
    /** The line under the pointer, on the field or in the Field panel's list */
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
    lines: false,
    tab: "setup",
    mirror: true,
    ...IDLE,
}));

export const fieldEditMode = {
    get: () => useFieldEditModeStore.getState(),
    isActive: () => useFieldEditModeStore.getState().active,
    isEditingLines: () => useFieldEditModeStore.getState().lines,
    /** Opens the panel on Setup, or with Edit lines on */
    enter: ({ lines = false }: { lines?: boolean } = {}) =>
        useFieldEditModeStore.setState({
            active: true,
            lines,
            tab: lines ? "lines" : "setup",
            ...IDLE,
        }),
    exit: () =>
        useFieldEditModeStore.setState({
            active: false,
            lines: false,
            ...IDLE,
        }),
    /** Edit lines on (on the Lines tab) or off; nothing stays picked, open or dragged */
    setLines: (lines: boolean) => {
        if (!useFieldEditModeStore.getState().active) return;
        useFieldEditModeStore.setState(
            lines ? { lines, tab: "lines", ...IDLE } : { lines, ...IDLE },
        );
    },
    /** Another tab: Edit lines belongs to the Lines tab, so it ends */
    setTab: (tab: FieldPanelTab) =>
        useFieldEditModeStore.setState(
            tab === "lines" ? { tab } : { tab, lines: false, ...IDLE },
        ),
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

/** The Field panel is open */
export const useIsFieldEditMode = () => useFieldEditModeStore((s) => s.active);
/** Edit lines is on */
export const useIsEditingFieldLines = () =>
    useFieldEditModeStore((s) => s.active && s.lines);
