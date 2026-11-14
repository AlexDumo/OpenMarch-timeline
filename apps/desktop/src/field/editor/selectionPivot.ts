import type { FieldTestGesture } from "@/field/fieldTestApi";
import type { HonoredRoles } from "@/input/gestureChipStore";
import type { Roles } from "@/input/modifierRoles";
import type { FieldGesture, FieldPoint, FieldPointer } from "./fieldEditor";
import { FieldDrag, type FieldKeys } from "./fieldKeys";
import { centerOf } from "./groupTransform";
import type { MarcherPosition } from "./moveGesture";
import type { FieldRect } from "./selectionArea";

/**
 * A plain selection's pivot: what the rotate knob and the inspector's typed rotation turn it
 * around. It's the center of the selection's box until it's dragged out of it by the crosshair the
 * field draws there; dragged back onto the center, it's the center again. It lasts while the
 * selection does, and follows the marchers when they all move by the same amount (a drag, a nudge,
 * undoing either); a turn or a scale leaves it where it is. A shape keeps its own pivot (#350).
 * Everything here but {@link PivotGesture} is pure.
 */

/** How near the crosshair a press must be to take it, and a drag to snap, in CSS px */
export const PIVOT_REACH_PX = 10;

/**
 * How far `after` moved from `before` when every marcher moved by the same amount, or null when
 * they moved apart (a turn, a scale) or aren't the same marchers.
 */
export function uniformShift(
    before: readonly MarcherPosition[],
    after: readonly MarcherPosition[],
): FieldPoint | null {
    if (before.length !== after.length || before.length === 0) return null;
    const dx = after[0].x - before[0].x;
    const dy = after[0].y - before[0].y;
    for (let i = 0; i < before.length; i++) {
        if (before[i].id !== after[i].id) return null;
        if (
            Math.abs(after[i].x - before[i].x - dx) > 1e-6 ||
            Math.abs(after[i].y - before[i].y - dy) > 1e-6
        )
            return null;
    }
    return { x: dx, y: dy };
}

/** The box's corners, edge middles and center, center first */
export function boxPoints(box: FieldRect): FieldPoint[] {
    const c = centerOf(box);
    return [
        c,
        { x: box.left, y: box.top },
        { x: c.x, y: box.top },
        { x: box.right, y: box.top },
        { x: box.right, y: c.y },
        { x: box.right, y: box.bottom },
        { x: c.x, y: box.bottom },
        { x: box.left, y: box.bottom },
        { x: box.left, y: c.y },
    ];
}

/**
 * Where the pivot dragged to `at` goes: onto the nearest of `targets` (the box's 9 points, then
 * the marchers) within `reach` field units, a box point winning a tie; else onto the grid.
 */
export function snapPivot(
    at: FieldPoint,
    targets: readonly FieldPoint[],
    reach: number,
    grid: (p: FieldPoint) => FieldPoint,
): FieldPoint {
    let best: { p: FieldPoint; d: number } | null = null;
    for (const p of targets) {
        const d = Math.hypot(p.x - at.x, p.y - at.y);
        if (d <= reach && (!best || d < best.d - 1e-9)) best = { p, d };
    }
    return best ? { ...best.p } : grid(at);
}

/** Dragging the pivot reads fine (off the snaps) and snaps; nothing else */
export const PIVOT_HONORS: HonoredRoles = {
    context: "field",
    fine: "fine",
    snaps: true,
};

/**
 * Dragging the pivot's crosshair: it follows the pointer, snapped by `place`, and is set where
 * it's drawn at the release. Nothing is saved: the pivot isn't part of the show.
 */
export class PivotGesture implements FieldGesture {
    readonly kind: FieldTestGesture = "pivot";
    private readonly drag: FieldDrag<FieldPoint>;

    constructor(
        keys: FieldKeys,
        /** Where the pivot goes for the pointer at `at`, with these roles held */
        place: (at: FieldPoint, roles: Roles) => FieldPoint,
        private readonly host: {
            show(at: FieldPoint): void;
            set(at: FieldPoint): void;
            cancel(): void;
        },
    ) {
        this.drag = new FieldDrag(
            keys,
            place,
            (at) => host.show(at),
            PIVOT_HONORS,
        );
    }

    move(pointer: FieldPointer): void {
        this.drag.move(pointer);
    }

    end(pointer: FieldPointer): void {
        this.host.set(this.drag.end(pointer));
    }

    cancel(): void {
        this.drag.cancel();
        this.host.cancel();
    }
}
