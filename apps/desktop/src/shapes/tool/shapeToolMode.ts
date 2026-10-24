import type { FieldMode } from "@/field/editor/fieldEditor";
import type { BoxParams } from "../box/boxGeometry";
import {
    asCursor,
    boxOutline,
    keysOf,
    memoDrawing,
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
    return {
        outline:
            tool.params === null
                ? null
                : boxOutline(tool.params as BoxParams, tool.marchers.length),
        spots: slotsOf(tool, ctx),
        // The walks show once a gesture ends and who goes where is worked out
        walks: tool.gesture
            ? []
            : targetsOf(tool, ctx).map((t) => ({ from: t.from, to: t.to })),
        handles:
            tool.params === null
                ? []
                : tool.kind
                      .handles(tool.params, tool.marchers.length)
                      .map((h) => h.at),
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
        if (target.type === "move") return "move";
        if (target.type === "draw") return "crosshair";
        const handle = tool.kind
            .handles(tool.params, tool.marchers.length)
            .find((h) => h.key === target.key);
        return handle ? asCursor(handle.cursor) : "default";
    },
    drawing: () => drawingOf(useShapeToolStore.getState().tool),
    subscribe: (listener) => useShapeToolStore.subscribe(listener),
    // The tool's handles move the shape; the marchers stay put until Place
    ownsSelectionBox: true,
    locksSelection: true,
    gesture: { kind: "shape", always: true },
};
