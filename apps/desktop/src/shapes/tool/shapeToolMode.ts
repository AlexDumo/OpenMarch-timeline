import type { FieldMode } from "@/field/editor/fieldEditor";
import type { BoxParams } from "../box/boxGeometry";
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
import { toolEnvFor } from "./toolEnv";
import {
    cancelGesture,
    pointerMove,
    press,
    pressTarget,
    release,
    slotsOf,
    targetsOf,
    type ToolState,
} from "./toolMachine";
import { updateTool, useShapeToolStore } from "./shapeToolStore";

const drawingOf = memoDrawing((tool: ToolState) => {
    const field = currentShapeField();
    if (!field) return null;
    const ctx = shapeContextFor(field);
    const n = tool.marchers.length;
    const spots = slotsOf(tool, ctx);
    if (tool.params === null)
        return { outline: null, spots, walks: [], handles: [] };
    // While a drag draws a new shape: its spots and a dashed outline, no walks yet (06). Every
    // other gesture holds who goes where, so the walks follow it live.
    const drawing = tool.gesture?.type === "draw";
    const targets = drawing ? [] : targetsOf(tool, ctx);
    const names = drillNumbers(field);
    const env = toolEnvFor(field, { shift: false, alt: false });
    const g =
        tool.gesture &&
        tool.gesture.type !== "draw" &&
        tool.gesture.type !== "edit"
            ? tool.gesture
            : null;
    return {
        stage: drawing ? ("drawing" as const) : ("open" as const),
        outline: boxOutline(tool.params as BoxParams, n),
        spots,
        walks: targets.map((t) => ({ from: t.from, to: t.to })),
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
    };
});

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
        updateTool((t) =>
            press(t, pointer.field, toolEnvFor(field, keysOf(pointer))),
        );
    },
    move(pointer) {
        const field = currentShapeField();
        if (!field) return;
        updateTool((t) =>
            pointerMove(t, pointer.field, toolEnvFor(field, keysOf(pointer))),
        );
    },
    release() {
        const field = currentShapeField();
        if (!field) return;
        updateTool((t) => release(t, shapeContextFor(field)));
    },
    cancel() {
        updateTool(cancelGesture);
    },
    cursorAt(pointer) {
        const tool = useShapeToolStore.getState().tool;
        const field = currentShapeField();
        if (!tool || !field) return null;
        const target = pressTarget(
            tool,
            pointer.field,
            toolEnvFor(field, keysOf(pointer)),
        );
        if (target.type === "draw") return "crosshair";
        return shapeCursor(
            tool.kind,
            tool.params,
            tool.marchers.length,
            target,
        );
    },
    drawing: () => drawingOf(useShapeToolStore.getState().tool),
    subscribe: (listener) => useShapeToolStore.subscribe(listener),
    // The tool's handles move the shape; the marchers stay put until Place
    ownsSelectionBox: true,
    locksSelection: true,
    gesture: { kind: "shape", always: true },
};
