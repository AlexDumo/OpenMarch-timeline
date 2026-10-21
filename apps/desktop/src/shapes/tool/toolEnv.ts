import { getRoundCoordinates2 } from "@/utilities/CoordinateActions";
import type { ShapeField } from "../field/shapeField";
import { useShapeEditorStore } from "../frame/shapeEditorStore";
import type { XY } from "../types";
import type { ToolEnv } from "./toolKind";

/** How far from a handle a press still takes it, in screen pixels */
export const HANDLE_REACH_PX = 10;

/** Marchers drawn by the shape tool stand on half steps from the center front point */
const HALF_STEP_ROUNDING = {
    coordinateRounding: { nearestXSteps: 0.5, nearestYSteps: 0.5 },
} as const;

/**
 * The tool's view of the field for one pointer event, with the keys held then. A dragged pivot
 * snaps to every marcher drawn, and to `spots` (an open shape's, where its marchers will stand).
 */
export function toolEnvFor(
    field: ShapeField,
    keys: { shift: boolean; alt: boolean; mod?: boolean },
    spots?: () => readonly XY[],
): ToolEnv {
    const { fieldProperties } = field;
    const editor = useShapeEditorStore.getState();
    return {
        stepPx: fieldProperties.pixelsPerStep,
        snap: !keys.alt,
        shift: keys.shift,
        mod: keys.mod ?? false,
        gridSnap: (p) => {
            if (keys.alt) return p;
            const r = getRoundCoordinates2({
                coordinate: { xPixels: p.x, yPixels: p.y },
                fieldProperties,
                uiSettings: HALF_STEP_ROUNDING,
            });
            return { x: r.xPixels, y: r.yPixels };
        },
        hitRadius: HANDLE_REACH_PX / (field.zoom() || 1),
        ratioLocked: editor.ratioLocked,
        pivotSnaps: () => [
            ...field.drawn(field.marchers().map((m) => m.id)).values(),
            ...(spots?.() ?? []),
        ],
    };
}
