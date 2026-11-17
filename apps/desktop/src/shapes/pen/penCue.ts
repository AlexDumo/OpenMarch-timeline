import type { FieldModeDrawing } from "@/field/editor/fieldEditor";
import type { XY } from "@/shapes/types";
import { clickPlacesSmooth } from "./penKind";

/**
 * The cue for the point a click would place (owner, 2026-11-17, the Straight | Curve switch): a
 * smooth point shows a short tangent bar through where it would land, along the leg coming in, as
 * a press-and-drag's smooth point shows its own; a corner shows none. `prev` is the point before.
 */
export function smoothCue(
    prev: XY | undefined,
    at: XY | null,
    step: number | undefined,
): NonNullable<FieldModeDrawing["barHandles"]> {
    if (!prev || !at || !step || !clickPlacesSmooth()) return [];
    const d = Math.hypot(at.x - prev.x, at.y - prev.y);
    if (!(d > 0)) return [];
    const reach = Math.min(SMOOTH_CUE_STEPS * step, d / 2);
    const u = {
        x: ((at.x - prev.x) / d) * reach,
        y: ((at.y - prev.y) / d) * reach,
    };
    return [
        { at: { x: at.x + u.x, y: at.y + u.y }, from: at },
        { at: { x: at.x - u.x, y: at.y - u.y }, from: at },
    ];
}

/** Half the next point's tangent bar cue, in steps */
const SMOOTH_CUE_STEPS = 1.5;
