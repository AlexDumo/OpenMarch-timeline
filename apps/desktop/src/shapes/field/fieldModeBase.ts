import type {
    FieldCursor,
    FieldModeDrawing,
    FieldPointer,
} from "@/field/editor/fieldEditor";
import type { XY } from "../types";
import { footprintOf, type BoxParams } from "../box/boxGeometry";

/** The keys a shape gesture reads from a pointer event */
export const keysOf = (pointer: FieldPointer) => ({
    shift: pointer.shift,
    alt: pointer.alt,
});

/** A handle's cursor from a shape kind, as the field shows it */
export const asCursor = (cursor: string): FieldCursor => cursor as FieldCursor;

/** The outline through a box's edge marchers */
export function boxOutline(params: BoxParams, spots: number): XY[] {
    const f = footprintOf(params, spots);
    return [
        { x: f.left, y: f.top },
        { x: f.right, y: f.top },
        { x: f.right, y: f.bottom },
        { x: f.left, y: f.bottom },
    ];
}

/**
 * A drawing worked out once per state: the overlay reads it as a snapshot, so the same state
 * must give the same object.
 */
export function memoDrawing<S>(
    draw: (state: S) => FieldModeDrawing | null,
): (state: S | null) => FieldModeDrawing | null {
    let last: { state: S; drawing: FieldModeDrawing | null } | null = null;
    return (state) => {
        if (state === null) return null;
        if (last?.state !== state) last = { state, drawing: draw(state) };
        return last.drawing;
    };
}
