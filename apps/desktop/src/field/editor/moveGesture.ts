import type { FieldTestGesture } from "@/field/fieldTestApi";
import type { FieldGesture, FieldPoint, FieldPointer } from "./fieldEditor";

/** A marcher's position, in field units. */
export type MarcherPosition = { id: number; x: number; y: number };

/**
 * Where the dragged marchers go for a pointer delta, in field units. The seam
 * for snapping, Alt precision and Lock X/Y (#197): it gets the raw delta from
 * the press to the pointer, the pointer (its modifiers) and where the marchers
 * started, and returns their positions. {@link followPointer} moves them by
 * the delta as it is.
 */
export type MoveTransform = (
    delta: FieldPoint,
    pointer: FieldPointer,
    starts: readonly MarcherPosition[],
) => MarcherPosition[];

/** Every marcher moves by the pointer's delta, unchanged. */
export const followPointer: MoveTransform = (delta, _pointer, starts) =>
    starts.map(({ id, x, y }) => ({ id, x: x + delta.x, y: y + delta.y }));

/** What a move gesture reports to the editor. */
export type MoveGestureHost = {
    /** The marchers' live positions, while the pointer moves. */
    show(positions: readonly MarcherPosition[]): void;
    /** The pointer was released: the marchers were dropped here. */
    drop(positions: readonly MarcherPosition[]): void;
    /** Nothing is dropped: the marchers go back. */
    cancel(): void;
};

/**
 * Dragging marchers (#196, user story 34): they follow the pointer from where
 * the press started, through {@link MoveTransform}, and are dropped where it's
 * released. The editor saves the drop and owns what's drawn meanwhile.
 */
export class MoveGesture implements FieldGesture {
    readonly kind: FieldTestGesture = "move";

    constructor(
        private readonly origin: FieldPointer,
        private readonly starts: readonly MarcherPosition[],
        private readonly host: MoveGestureHost,
        private readonly transform: MoveTransform = followPointer,
    ) {}

    move(pointer: FieldPointer): void {
        this.host.show(this.positionsAt(pointer));
    }

    end(pointer: FieldPointer): void {
        this.host.drop(this.positionsAt(pointer));
    }

    cancel(): void {
        this.host.cancel();
    }

    private positionsAt(pointer: FieldPointer) {
        const delta = {
            x: pointer.field.x - this.origin.field.x,
            y: pointer.field.y - this.origin.field.y,
        };
        return this.transform(delta, pointer, this.starts);
    }
}
