import { create } from "zustand";
import type { FieldMode, FieldPointer } from "@/field/editor/fieldEditor";
import type { ShapeField } from "../field/shapeField";
import type { XY } from "../types";
import { shapeOutline } from "../frame/gestures";
import { outlineGapAt } from "../distribute/outlineGap";
import {
    drillNumbers,
    frameDrawing,
    keysOf,
    memoDrawing,
    shapeCursor,
    SPOT_LABEL_LIMIT,
} from "../field/fieldModeBase";
import { currentShapeField, shapeContextFor } from "../field/shapeFieldContext";
import { toolEnvFor } from "./toolEnv";
import {
    cancelGesture,
    pointerMove,
    press,
    pressTarget,
    release,
    slotsOf,
    startsOf,
    targetsOf,
    type ToolState,
} from "./toolMachine";
import { updateTool, useShapeToolStore } from "./shapeToolStore";

/**
 * The spot the pointer rests on, with who will stand there, on shapes too big to label every spot
 * (sims, F1: with 64 nobody could tell who goes where). Null otherwise.
 */
const useSpotHover = create<{ hover: { at: XY; text: string } | null }>(() => ({
    hover: null,
}));

interface Shown {
    readonly tool: ToolState;
    readonly hover: { at: XY; text: string } | null;
}
let shown: Shown | null = null;
const shownNow = (): Shown | null => {
    const { tool } = useShapeToolStore.getState();
    if (!tool) return null;
    const { hover } = useSpotHover.getState();
    if (shown?.tool !== tool || shown.hover !== hover) shown = { tool, hover };
    return shown;
};

/** Notes the spot under the pointer, on a shape that doesn't label every spot */
function hoverAt(tool: ToolState, at: XY, radius: number): void {
    const field = currentShapeField();
    let hover: { at: XY; text: string } | null = null;
    if (
        field &&
        !tool.gesture &&
        tool.params !== null &&
        tool.marchers.length > SPOT_LABEL_LIMIT
    ) {
        const names = drillNumbers(field);
        let best = radius;
        for (const t of targetsOf(tool, shapeContextFor(field))) {
            const d = Math.hypot(t.to.x - at.x, t.to.y - at.y);
            if (d <= best) {
                best = d;
                hover = { at: t.to, text: names.get(t.id) ?? "" };
            }
        }
    }
    const was = useSpotHover.getState().hover;
    if (was?.text !== hover?.text || was?.at !== hover?.at)
        useSpotHover.setState({ hover });
}

const drawingOf = memoDrawing(({ tool, hover }: Shown) => {
    const field = currentShapeField();
    if (!field) return null;
    const ctx = shapeContextFor(field);
    const n = tool.spots;
    const spots = slotsOf(tool, ctx);
    // The marchers' hollow rings stand where they start the move: at the start flag (#346)
    const rings = startsOf(tool);
    if (tool.params === null)
        return { outline: null, spots, walks: [], handles: [], rings };
    // While a drag draws a new shape: its spots and a dashed outline, no walks yet (06). Every
    // other gesture holds who goes where, so the walks follow it live.
    const drawing = tool.gesture?.type === "draw";
    const targets = drawing ? [] : targetsOf(tool, ctx);
    const names = drillNumbers(field);
    const env = toolEnvFor(field, { shift: false, alt: false });
    const gap = drawing ? null : outlineGapAt(tool.kind, tool.params, n);
    const g =
        tool.gesture &&
        tool.gesture.type !== "draw" &&
        tool.gesture.type !== "edit"
            ? tool.gesture
            : null;
    return {
        stage: drawing ? ("drawing" as const) : ("open" as const),
        outline: shapeOutline(tool.kind, tool.params, n),
        spots,
        walks: targets.map((t) => ({ from: t.from, to: t.to })),
        rings,
        gaps: gap ? [gap] : [],
        labels:
            n <= SPOT_LABEL_LIMIT
                ? targets.map((t) => ({
                      at: t.to,
                      text: names.get(t.id) ?? "",
                  }))
                : [],
        handles: drawing
            ? []
            : tool.kind.handles(tool.params, n).map((h) => h.at),
        ...(drawing
            ? {}
            : frameDrawing(
                  tool.kind,
                  tool.params,
                  n,
                  g,
                  tool.pointer ?? null,
                  env,
              )),
        ...(hover && !tool.gesture
            ? { labels: [{ at: hover.at, text: hover.text }] }
            : {}),
    };
});

/** The env for a pointer event: a dragged pivot also snaps to the open shape's spots (#350) */
const envOf = (field: ShapeField, tool: ToolState, pointer: FieldPointer) =>
    toolEnvFor(field, keysOf(pointer), () =>
        slotsOf(tool, shapeContextFor(field)),
    );

/**
 * The open shape tool on the field (docs/timeline/research/shapes/06-box-v1.md): a field editor
 * mode that takes every edit press while the tool is open and hands it to the tool's state
 * machine, so nothing selects, drags or lassos underneath. Navigation keeps its presses (right and
 * middle drags, the wheel). Alt is the tool's "don't snap", not a pan, on this field.
 */
export const shapeToolMode: FieldMode = {
    claims: () => useShapeToolStore.getState().tool !== null,
    press(pointer) {
        const field = currentShapeField();
        if (!field) return;
        updateTool((t) => press(t, pointer.field, envOf(field, t, pointer)));
    },
    move(pointer) {
        const field = currentShapeField();
        if (!field) return;
        updateTool((t) =>
            pointerMove(t, pointer.field, envOf(field, t, pointer)),
        );
    },
    release(_pointer, click) {
        const field = currentShapeField();
        if (!field) return;
        updateTool((t) => release(t, shapeContextFor(field), click));
    },
    cancel() {
        updateTool(cancelGesture);
    },
    cursorAt(pointer) {
        const tool = useShapeToolStore.getState().tool;
        const field = currentShapeField();
        if (!tool || !field) return null;
        const env = envOf(field, tool, pointer);
        // The editor asks for the cursor as the pointer moves, so this is where hovering is seen
        hoverAt(tool, pointer.field, env.hitRadius);
        const target = pressTarget(tool, pointer.field, env);
        if (target.type === "draw") return "crosshair";
        return shapeCursor(tool.kind, tool.params, tool.spots, target);
    },
    drawing: () => drawingOf(shownNow()),
    subscribe: (listener) => {
        const offTool = useShapeToolStore.subscribe(listener);
        const offHover = useSpotHover.subscribe(listener);
        return () => {
            offTool();
            offHover();
        };
    },
    // The tool's handles move the shape; the marchers stay put until Place
    ownsSelectionBox: true,
    locksSelection: true,
    gesture: { kind: "shape", always: true },
};
