import { FieldProperties } from "@openmarch/core";
import type {
    FieldTestApi,
    FieldTestGesture,
    FieldTestHandle,
    ScreenPoint,
} from "@/field/fieldTestApi";
import type OpenMarchCanvas from "@/global/classes/canvasObjects/OpenMarchCanvas";
import CanvasMarcher from "@/global/classes/canvasObjects/CanvasMarcher";
import DefaultListeners from "./listeners/DefaultListeners";
import LineListeners from "./listeners/LineListeners";

/** Fabric's control keys for each handle. */
const HANDLE_CONTROLS: Record<FieldTestHandle, string> = {
    nw: "tl",
    n: "mt",
    ne: "tr",
    e: "mr",
    se: "br",
    s: "mb",
    sw: "bl",
    w: "ml",
    rot: "mtr",
};

/** Fabric internals the API reads. It never writes to them. */
type FabricInternals = {
    _currentTransform?: { action?: string } | null;
    _groupSelector?: unknown;
};

/**
 * The field test API over the Fabric field. Read-only: nothing here changes
 * the canvas, its objects or its state.
 */
export function createFabricFieldTestApi(
    canvas: OpenMarchCanvas,
): FieldTestApi {
    const toScreen = () => screenMapping(canvas);
    const transform = () => canvas.viewportTransform ?? [1, 0, 0, 1, 0, 0];

    return {
        marchers() {
            const { rect, point } = toScreen();
            const [scaleX, , , scaleY, panX, panY] = transform();
            return canvas.getCanvasMarchers().map((marcher) => {
                // The dot's own center, also right inside a selection, where
                // the marcher's position is relative to the selection.
                const center = marcher.getAbsoluteCoords();
                const screen = point(
                    center.x * scaleX + panX,
                    center.y * scaleY + panY,
                );
                return {
                    id: marcher.marcherObj.id,
                    label: marcher.marcherObj.drill_number,
                    ...marcher.getDatabaseCoords(),
                    screen,
                    onScreen:
                        screen.x > rect.left &&
                        screen.x < rect.right &&
                        screen.y > rect.top &&
                        screen.y < rect.bottom,
                };
            });
        },

        selection() {
            return canvas
                .getActiveObjects()
                .filter(
                    (object): object is CanvasMarcher =>
                        object instanceof CanvasMarcher,
                )
                .map((marcher) => marcher.marcherObj.id)
                .sort((a, b) => a - b);
        },

        viewport() {
            const { cssScale } = toScreen();
            const [zoom, , , , panX, panY] = transform();
            // Fabric's (0, 0) is half a grid line off the field's: marchers are
            // drawn at their field position plus this (`CanvasMarcher.gridOffset`).
            const offset = (FieldProperties.GRID_STROKE_WIDTH / 2) * zoom;
            return {
                zoom: zoom * cssScale,
                pan: {
                    x: (panX + offset) * cssScale,
                    y: (panY + offset) * cssScale,
                },
            };
        },

        handles() {
            const active = canvas.getActiveObject();
            if (!active?.hasControls) return null;
            const { point } = toScreen();
            // Computed fresh rather than read from `oCoords`, which Fabric only
            // updates when it next draws or hit-tests.
            const coords = (
                active as unknown as {
                    calcOCoords(): Record<string, { x: number; y: number }>;
                }
            ).calcOCoords();
            const handles = {} as Record<FieldTestHandle, ScreenPoint>;
            for (const [handle, control] of Object.entries(HANDLE_CONTROLS)) {
                const { x, y } = coords[control];
                handles[handle as FieldTestHandle] = point(x, y);
            }
            return handles;
        },

        activeGesture: () => activeGesture(canvas),

        pageId() {
            return canvas.currentPage?.id ?? null;
        },
    };
}

/** The gesture in progress on the Fabric field, from the listeners' and Fabric's state. */
function activeGesture(canvas: OpenMarchCanvas): FieldTestGesture | null {
    const listeners = canvas.listeners;
    if (listeners instanceof LineListeners) return "line";
    if (listeners instanceof DefaultListeners) {
        const gesture = listeners.activeGesture;
        if (gesture) return gesture;
    }
    if (canvas.isAltPanning) return "pan";
    const internals = canvas as unknown as FabricInternals;
    const action = internals._currentTransform?.action;
    if (action === "drag") return "move";
    if (action === "rotate") return "rotate";
    if (action?.startsWith("scale")) return "scale";
    if (internals._groupSelector) return "marquee";
    return null;
}

/** Maps points in canvas pixels (after the viewport transform) to the viewport. */
function screenMapping(canvas: OpenMarchCanvas) {
    const rect = (
        canvas as unknown as { upperCanvasEl: HTMLCanvasElement }
    ).upperCanvasEl.getBoundingClientRect();
    const cssScale = rect.width / canvas.getWidth();
    return {
        rect,
        cssScale,
        point: (x: number, y: number): ScreenPoint => ({
            x: rect.x + x * cssScale,
            y: rect.y + y * cssScale,
        }),
    };
}
