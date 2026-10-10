import type OpenMarchCanvas from "@/global/classes/canvasObjects/OpenMarchCanvas";
import { compare as compareMarchers } from "@/global/classes/Marcher";
import { getRoundCoordinates2 } from "@/utilities/CoordinateActions";
import type { AssignMarcher } from "../assign";
import type { ShapeContext } from "../types";
import { originsAtStart } from "./previewContext";

/** The canvas the shape tool reads; `window.canvas` while a show is open. */
export function currentCanvas(): OpenMarchCanvas | undefined {
    return window.canvas as OpenMarchCanvas | undefined;
}

/**
 * The field as shape kinds see it. Points snap to the canvas's coordinate rounding, like a marcher
 * drag, unless `snap` is false (Alt held, the timeline's no-snap modifier).
 */
export function shapeContextFor(
    canvas: OpenMarchCanvas,
    snap = true,
): ShapeContext {
    const { fieldProperties, uiSettings } = canvas;
    return {
        stepPx: fieldProperties.pixelsPerStep,
        snapPoint: (p) => {
            if (!snap) return p;
            const rounded = getRoundCoordinates2({
                coordinate: { xPixels: p.x, yPixels: p.y },
                fieldProperties,
                uiSettings,
            });
            return { x: rounded.xPixels, y: rounded.yPixels };
        },
    };
}

/**
 * The marchers with these ids where the canvas draws them now (the edit window's arrival in
 * timeline mode, the selected page in page mode), in `ids` order, ranked by drill number, with
 * where each starts the move being edited when that's somewhere else.
 */
export function marchersOnCanvas(
    canvas: OpenMarchCanvas,
    ids: readonly number[],
): AssignMarcher[] {
    const byId = new Map(canvas.getCanvasMarchers().map((m) => [m.id, m]));
    const present = ids.flatMap((id) => {
        const canvasMarcher = byId.get(id);
        return canvasMarcher ? [canvasMarcher] : [];
    });
    const ranked = [...present].sort((a, b) =>
        compareMarchers(a.marcherObj, b.marcherObj),
    );
    const rank = new Map(ranked.map((m, i) => [m.id, i]));
    const origins = originsAtStart(present.map((m) => m.id));
    return present.map((m) => {
        const at = m.getMarcherCoords();
        const from = origins.get(m.id);
        return {
            id: m.id,
            at,
            drillRank: rank.get(m.id)!,
            ...(from && Math.hypot(from.x - at.x, from.y - at.y) > 1e-6
                ? { from }
                : {}),
        };
    });
}
