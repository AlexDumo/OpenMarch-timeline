import type { QueryClient } from "@tanstack/react-query";
import type { FieldMode, FieldPointer } from "@/field/editor/fieldEditor";
import { boxTool } from "../box/boxTool";
import {
    asCursor,
    boxOutline,
    keysOf,
    memoDrawing,
} from "../field/fieldModeBase";
import { currentShapeField, shapeContextFor } from "../field/shapeFieldContext";
import { blockKind } from "../kinds/block";
import { toolEnvFor } from "../tool/toolEnv";
import { commitBox } from "./commitBox";
import {
    moveLive,
    openLive,
    pressLive,
    releaseLive,
    type LiveBox,
} from "./liveBox";
import type { PlacedBox } from "./placedBox";
import { enterBox } from "./boxSelection";

const drawingOf = memoDrawing((live: LiveBox) => {
    const field = currentShapeField();
    const n = live.box.spots;
    return {
        outline: boxOutline(live.params, n),
        // While a gesture goes, where the marchers will stand
        spots:
            live.gesture && field
                ? blockKind.generate(live.params, n, shapeContextFor(field))
                : [],
        walks: [],
        handles: boxTool.handles(live.params, n).map((h) => h.at),
    };
});

/**
 * A selected placed box, edited in place (07-placed-boxes.md), as a field editor mode: it claims
 * presses on its handles and inside it. Handles on its corner and edge marchers stretch it, a drag
 * inside moves it on the half-step grid, and each gesture is saved when it ends, as one undo
 * step. A double click on a member goes inside the box. Other presses go through the editor's
 * rules as usual. The selection box's own handles (#198) are off while it's on.
 */
export class LiveBoxMode implements FieldMode {
    private live: LiveBox;
    private readonly listeners = new Set<() => void>();
    readonly ownsSelectionBox = true;
    // A box doesn't turn (box v1): a typed rotation would take its members off their spots
    readonly locksSelection = true;
    readonly gesture = { kind: "box", always: false } as const;

    constructor(
        box: PlacedBox,
        private readonly queryClient: QueryClient,
    ) {
        this.live = openLive(box);
    }

    /** The box was saved or changed elsewhere; mid-gesture, the gesture's own box stays */
    setBox(box: PlacedBox): void {
        if (this.live.gesture) return;
        this.live = openLive(box);
        this.emit();
    }

    claims(pointer: FieldPointer): boolean {
        return this.pressed(pointer) !== null;
    }

    press(pointer: FieldPointer): void {
        this.live = this.pressed(pointer) ?? this.live;
        this.emit();
    }

    move(pointer: FieldPointer): void {
        const field = currentShapeField();
        if (!field) return;
        this.live = moveLive(
            this.live,
            pointer.field,
            toolEnvFor(field, keysOf(pointer)),
        );
        this.emit();
    }

    release(pointer: FieldPointer, click: { double: boolean } | null): void {
        const before = this.live;
        const out = releaseLive(before);
        this.live = out.live;
        this.emit();
        if (out.changed)
            void commitBox(before.box, out.live.params, this.queryClient);
        else if (click?.double) this.enterAt(pointer);
    }

    cancel(): void {
        this.live = openLive(this.live.box);
        this.emit();
    }

    cursorAt(pointer: FieldPointer) {
        const pressed = this.pressed(pointer);
        if (!pressed?.gesture) return null;
        if (pressed.gesture.type === "move") return "move";
        const key = pressed.gesture.key;
        const handle = boxTool
            .handles(this.live.params, this.live.box.spots)
            .find((h) => h.key === key);
        return handle ? asCursor(handle.cursor) : null;
    }

    drawing() {
        return drawingOf(this.live);
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private pressed(pointer: FieldPointer): LiveBox | null {
        const field = currentShapeField();
        if (!field) return null;
        return pressLive(
            this.live,
            pointer.field,
            toolEnvFor(field, keysOf(pointer)),
        );
    }

    /** Goes inside the box at the member nearest `pointer` */
    private enterAt(pointer: FieldPointer): void {
        const at = pointer.field;
        let best: { id: number; d: number } | null = null;
        for (const m of this.live.box.recipe.members) {
            const d = Math.hypot(m.x - at.x, m.y - at.y);
            if (!best || d < best.d) best = { id: m.marcherId, d };
        }
        if (best) enterBox(best.id);
    }

    private emit(): void {
        for (const listener of this.listeners) listener();
    }
}
