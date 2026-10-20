import { planCanvasEdit } from "@/timeline/timelineCoordinateWrites";
import {
    currentShapeField,
    marchersOnField,
    shapeContextFor,
} from "../field/shapeFieldContext";
import { shapeSelectionGate } from "./selectionGate";
import { toolEnvFor } from "./toolEnv";
import type { AnyToolKind } from "./toolKind";
import { openTool, switchKind } from "./toolMachine";
import { openShapeTool, updateTool, useShapeToolStore } from "./shapeToolStore";

export type KindPickGate =
    | { readonly ok: true }
    | { readonly ok: false; readonly reason: string };

/**
 * Whether a kind can be picked now, and why not: with a shape open it always can (the shape turns
 * into it); otherwise it opens on the selection, so the selection gate decides
 */
export function kindPickGate(
    shapeOpen: boolean,
    selected: readonly { readonly id: number }[],
): KindPickGate {
    if (shapeOpen) return { ok: true };
    const gate = shapeSelectionGate(selected);
    return gate.ok ? { ok: true } : { ok: false, reason: gate.reason };
}

/**
 * The host's way to pick a shape kind (#344), for the Shapes tab, the kind's key, the ring and the
 * command bar alike. With no shape open it arms `kind` on the selected performers, ready to draw.
 * With one open, the open shape turns into `kind` keeping its frame (center, size, turn and flip)
 * as one undo step. False when nothing happened (no field, or nobody selected).
 */
export function pickShapeKind(
    kind: AnyToolKind,
    selected: readonly { readonly id: number }[],
): boolean {
    const field = currentShapeField();
    if (!field) return false;
    if (useShapeToolStore.getState().tool) {
        updateTool((tool) =>
            switchKind(
                tool,
                kind,
                shapeContextFor(field),
                toolEnvFor(field, { shift: false, alt: false }),
            ),
        );
        return true;
    }
    const gate = shapeSelectionGate(selected);
    if (!gate.ok) return false;
    openShapeTool(
        openTool(kind, marchersOnField(field, gate.ids)),
        planCanvasEdit(),
    );
    return true;
}
