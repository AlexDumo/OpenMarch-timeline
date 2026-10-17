import type { QueryClient } from "@tanstack/react-query";
import type { FieldMode, FieldPointer } from "@/field/editor/fieldEditor";
import { boxTool } from "../box/boxTool";
import {
    boxOutline,
    drillNumbers,
    frameDrawing,
    keysOf,
    memoDrawing,
    shapeCursor,
    SPOT_LABEL_LIMIT,
} from "../field/fieldModeBase";
import { currentShapeField, shapeContextFor } from "../field/shapeFieldContext";
import { shapeTargetAt } from "../frame/gestures";
import { toolEnvFor } from "../tool/toolEnv";
import { commitBox } from "./commitBox";
import {
    liveTargets,
    moveLive,
    openLive,
    pressLive,
    releaseLive,
    type LiveBox,
} from "./liveBox";
import type { PlacedBox } from "./placedBox";
import type { BoxParams } from "../box/boxGeometry";
import { enterBox } from "./boxSelection";
import { usePlacedBoxPreviewStore } from "./boxSelectionStore";

/** The box as drawn: mid-gesture, or as a number dragged in its floating editor has it */
interface Shown {
    readonly live: LiveBox;
    readonly preview: BoxParams | null;
}

const drawingOf = memoDrawing(({ live: saved, preview }: Shown) => {
    const live =
        preview && !saved.gesture ? { ...saved, params: preview } : saved;
    const changing = live.gesture !== null || preview !== null;
    const field = currentShapeField();
    if (!field) return null;
    const n = live.box.spots;
    const ctx = shapeContextFor(field);
    // Each member keeps their spot (or the box is laid out again for a new count across)
    const targets = changing
        ? liveTargets(live.box, live.params, ctx).members
        : [];
    const names = drillNumbers(field);
    return {
        stage: "open" as const,
        outline: boxOutline(live.params, n),
        // While a gesture goes, where the marchers will stand, and who
        spots: targets,
        walks: [],
        labels:
            targets.length <= SPOT_LABEL_LIMIT
                ? targets.map((t) => ({
                      at: t,
                      text: names.get(t.marcherId) ?? "",
                  }))
                : [],
        handles: boxTool.handles(live.params, n).map((h) => h.at),
        ...frameDrawing(
            boxTool,
            live.params,
            n,
            live.gesture,
            live.pointer ?? null,
            toolEnvFor(field, { shift: false, alt: false }),
        ),
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
    // The box turns with its own knob; the selection's typed rotation would take its members off
    // their spots
    readonly locksSelection = true;
    readonly gesture = { kind: "box", always: false } as const;

    private shown: Shown | null = null;

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
        const field = currentShapeField();
        if (!field) return null;
        const target = shapeTargetAt(
            boxTool,
            this.live.params,
            this.live.box.spots,
            pointer.field,
            toolEnvFor(field, keysOf(pointer)),
        );
        return target
            ? shapeCursor(
                  boxTool,
                  this.live.params,
                  this.live.box.spots,
                  target,
              )
            : null;
    }

    drawing() {
        const preview = usePlacedBoxPreviewStore.getState().params;
        if (this.shown?.live !== this.live || this.shown.preview !== preview)
            this.shown = { live: this.live, preview };
        return drawingOf(this.shown);
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        const unsubscribe = usePlacedBoxPreviewStore.subscribe(listener);
        return () => {
            this.listeners.delete(listener);
            unsubscribe();
        };
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
