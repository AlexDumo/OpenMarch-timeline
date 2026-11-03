import type {
    FieldCursor,
    FieldMode,
    FieldModeDrawing,
    FieldPointer,
} from "@/field/editor/fieldEditor";
import { snapToRounding } from "@/field/fieldPropTool";
import { useFieldViewStore } from "@/field/three/fieldView";
import { currentShapeField } from "@/shapes/field/shapeField";
import { useHandleMenuStore } from "@/shapes/field/handleMenu";
import { drillTerms } from "@/shapes/field/fieldModeBase";
import tolgee from "@/global/singletons/Tolgee";
import type { XY } from "@/shapes/types";
import {
    addCorner,
    cancelDrag,
    commitDrag,
    deleteCorner,
    dragCorner,
    selectCorner,
    setPointer,
    usePathPenStore,
    type PathCorner,
    type PathSession,
} from "./pathPenStore";

/** How far from a corner a press grabs it, in CSS px (a finger needs more than a mouse) */
export const CORNER_REACH_PX = 12;

/** The corner of `session` within reach of `pointer`, nearest first, or null */
export function cornerAt(
    session: PathSession,
    pointer: Pick<FieldPointer, "field">,
): number | null {
    const zoom = useFieldViewStore.getState().zoom || 1;
    const reach = CORNER_REACH_PX / zoom;
    let best: number | null = null;
    let bestD = Infinity;
    session.corners.forEach((c, i) => {
        const d = Math.hypot(
            c.at.x - pointer.field.x,
            c.at.y - pointer.field.y,
        );
        if (d <= reach && d < bestD) {
            best = i;
            bestD = d;
        }
    });
    return best;
}

/** A corner where the pointer is: snapped as marchers' coordinates are, Alt places it freely */
function placed(pointer: FieldPointer): XY {
    const at = { x: pointer.field.x, y: pointer.field.y };
    if (pointer.alt) return at;
    return snapToRounding(at, currentShapeField()?.fieldProperties);
}

/**
 * The path pen on the field (pathways step 1). While drawing it takes every primary press: a click
 * places a corner, a press on a corner drags it. With a stored path open it takes only presses on
 * its corners, so the marchers stay selectable and draggable; a click picks a corner, a drag moves
 * it (saved on release, one undo step), and a right-click or long press opens its menu.
 */
class PathPenMode implements FieldMode {
    private held: {
        start: FieldPointer;
        corner: number | null;
        before: readonly PathCorner[];
        moved: boolean;
    } | null = null;
    private listeners = new Set<() => void>();

    constructor() {
        usePathPenStore.subscribe(() => {
            for (const l of this.listeners) l();
        });
    }

    private get session() {
        return usePathPenStore.getState().session;
    }

    get ownsSelectionBox() {
        return this.session?.phase === "drawing";
    }
    get locksSelection() {
        return this.session?.phase === "drawing";
    }
    get blocksFieldMenu() {
        return this.session?.phase === "drawing";
    }
    get gesture() {
        return {
            kind: "path" as const,
            always: this.session?.phase === "drawing",
        };
    }

    claims(pointer: FieldPointer): boolean {
        const s = this.session;
        if (!s || pointer.button !== 0) return false;
        if (usePathPenStore.getState().saving) return s.phase === "drawing";
        return s.phase === "drawing" || cornerAt(s, pointer) !== null;
    }

    press(pointer: FieldPointer): void {
        const s = this.session;
        if (!s) return;
        this.held = {
            start: pointer,
            corner: cornerAt(s, pointer),
            before: s.corners,
            moved: false,
        };
    }

    move(pointer: FieldPointer): void {
        const s = this.session;
        if (!s) return;
        const p = this.held;
        if (!p) {
            if (s.phase === "drawing") setPointer(placed(pointer));
            return;
        }
        if (p.corner === null) {
            if (s.phase === "drawing") setPointer(placed(pointer));
            return;
        }
        const dx = pointer.screen.x - p.start.screen.x;
        const dy = pointer.screen.y - p.start.screen.y;
        if (!p.moved && Math.hypot(dx, dy) < 4) return;
        p.moved = true;
        dragCorner(p.corner, placed(pointer));
    }

    release(pointer: FieldPointer): void {
        const p = this.held;
        this.held = null;
        const s = this.session;
        if (!p || !s) return;
        if (p.corner !== null && p.moved) {
            void commitDrag(p.before);
            return;
        }
        if (p.corner !== null) {
            selectCorner(p.corner === s.selected ? null : p.corner);
            return;
        }
        if (s.phase === "drawing") addCorner(placed(pointer));
    }

    cancel(): void {
        const p = this.held;
        this.held = null;
        if (p?.moved) cancelDrag(p.before);
    }

    cursorAt(pointer: FieldPointer): FieldCursor | null {
        const s = this.session;
        if (!s) return null;
        if (s.phase === "drawing") {
            setPointer(placed(pointer));
            return cornerAt(s, pointer) === null ? "crosshair" : "move";
        }
        return cornerAt(s, pointer) === null ? null : "move";
    }

    leave(): void {
        if (this.session?.phase === "drawing") setPointer(null);
    }

    openMenu(pointer: FieldPointer): boolean {
        const s = this.session;
        if (!s) return false;
        const index = cornerAt(s, pointer);
        if (index === null) return false;
        selectCorner(index);
        useHandleMenuStore.setState({
            menu: {
                at: { x: pointer.screen.x, y: pointer.screen.y },
                key: `path-corner-${index}`,
                sections: [
                    {
                        items: [
                            {
                                value: "delete",
                                label: tolgee.t(
                                    "pathways.menu.deleteCorner",
                                    "Delete corner",
                                ),
                                icon: "trash",
                                destructive: true,
                            },
                        ],
                    },
                ],
                pick: (value) => {
                    useHandleMenuStore.setState({ menu: null });
                    if (value === "delete") void deleteCorner(index);
                },
            },
        });
        return true;
    }

    drawing(): FieldModeDrawing | null {
        return drawingOf(this.session);
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
}

let last: { session: PathSession | null; drawing: FieldModeDrawing | null } = {
    session: null,
    drawing: null,
};

/**
 * What the pen draws: the path from where the marcher starts (its ghost) through the corners to
 * its end spot, the corners as handles (the picked one filled), and while drawing a leg to the
 * pointer and where it is in drill terms. Worked out once per session state: the overlay reads it
 * as a snapshot.
 */
export function drawingOf(
    session: PathSession | null,
): FieldModeDrawing | null {
    if (session === last.session) return last.drawing;
    let drawing: FieldModeDrawing | null = null;
    if (session) {
        const { target, corners, pointer, selected } = session;
        const drawingNow = session.phase === "drawing";
        const middle = corners.map((c) => c.at);
        const outline = [
            target.from,
            ...middle,
            ...(drawingNow && pointer ? [pointer] : []),
            target.to,
        ];
        const tipText = drawingNow && pointer ? drillTerms(pointer) : null;
        drawing = {
            outline,
            openOutline: true,
            stage: drawingNow ? "drawing" : "open",
            spots: [target.to],
            walks: [],
            handles: middle,
            selectedHandles:
                selected !== null && middle[selected] ? [middle[selected]] : [],
            rings: [target.from],
            ringIds: [target.marcherId],
            ...(tipText && pointer
                ? { tip: { at: pointer, text: tipText } }
                : {}),
        };
    }
    last = { session, drawing };
    return drawing;
}

/** The one pen mode the field editor is given while a path is drawn or open. */
export const pathPenMode = new PathPenMode();
