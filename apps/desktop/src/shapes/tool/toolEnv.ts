import { getRoundCoordinates2 } from "@/utilities/CoordinateActions";
import type { ShapeField } from "../field/shapeField";
import { useShapeEditorStore } from "../frame/shapeEditorStore";
import { isBasicMode } from "@/stores/EditorModeStore";
import type { ToolEnv } from "./toolKind";

/** How far from a handle a press still takes it, in screen pixels */
export const HANDLE_REACH_PX = 10;

/** Marchers drawn by the shape tool stand on half steps from the center front point */
const HALF_STEP_ROUNDING = {
    coordinateRounding: { nearestXSteps: 0.5, nearestYSteps: 0.5 },
} as const;

/** The tool's view of the field for one pointer event, with the keys held then */
export function toolEnvFor(
    field: ShapeField,
    keys: { shift: boolean; alt: boolean },
): ToolEnv {
    const { fieldProperties } = field;
    const editor = useShapeEditorStore.getState();
    return {
        stepPx: fieldProperties.pixelsPerStep,
        snap: !keys.alt,
        shift: keys.shift,
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
        // Basic has no pivot grid: it always turns around the center
        pivot: isBasicMode() ? "c" : editor.pivot,
        ratioLocked: editor.ratioLocked,
    };
}
