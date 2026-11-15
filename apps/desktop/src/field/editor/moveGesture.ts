import type { FieldTestGesture } from "@/field/fieldTestApi";
import type { HonoredRoles } from "@/input/gestureChipStore";
import type { Roles } from "@/input/modifierRoles";
import type { FieldGesture, FieldPoint, FieldPointer } from "./fieldEditor";
import { FieldDrag, type FieldKeys } from "./fieldKeys";

/** A marcher's position, in field units. */
export type MarcherPosition = { id: number; x: number; y: number };

/**
 * Where the dragged marchers go for a pointer delta, in field units. The seam
 * for snapping and Lock X/Y (#197, `ruledMove` in `moveRules.ts`): it gets the
 * delta from the press to the pointer, the held roles and where the marchers
 * started, and returns their positions. {@link followPointer} moves them by the delta as
 * it is. It must return one position per start, in the same order: a drop
 * compares them by index to tell whether anything moved.
 */
export type MoveTransform = (
    delta: FieldPoint,
    roles: Roles,
    starts: readonly MarcherPosition[],
) => MarcherPosition[];

/** Every marcher moves by the pointer's delta, unchanged. */
export const followPointer: MoveTransform = (delta, _roles, starts) =>
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

/** A move reads fine and constrain (one axis), and snaps to the rounding grid; not from center */
const MOVE_HONORS: HonoredRoles = {
    context: "field",
    fine: "fine",
    constrain: "oneAxis",
    snaps: true,
};

/**
 * Dragging marchers (#196, user story 34): they follow the pointer from where
 * the press started, through {@link MoveTransform}, and are dropped where it's
 * released. The editor saves the drop and owns what's drawn meanwhile. Fine
 * only turns snapping off (in the transform); the marchers keep the pointer's
 * speed. Constrain filters that drag afterwards: it keeps an axis while it's
 * held and leaves no offset once it's released. A role key pressed or
 * released mid-drag redraws them at the last pointer, with no pointer move.
 */
export class MoveGesture implements FieldGesture {
    readonly kind: FieldTestGesture = "move";
    private readonly drag: FieldDrag<MarcherPosition[]>;

    constructor(
        private readonly origin: FieldPointer,
        private readonly starts: readonly MarcherPosition[],
        private readonly host: MoveGestureHost,
        private readonly transform: MoveTransform = followPointer,
        keys: FieldKeys,
    ) {
        this.drag = new FieldDrag(
            keys,
            (at, roles) => this.positionsAt(at, roles),
            (positions) => host.show(positions),
            MOVE_HONORS,
        );
    }

    move(pointer: FieldPointer): void {
        this.drag.move(pointer);
    }

    /** Drops the marchers; a release where the last move left the pointer drops what's drawn. */
    end(pointer: FieldPointer): void {
        this.host.drop(this.drag.end(pointer));
    }

    cancel(): void {
        this.drag.cancel();
        this.host.cancel();
    }

    private positionsAt(at: FieldPoint, roles: Roles) {
        const delta = {
            x: at.x - this.origin.field.x,
            y: at.y - this.origin.field.y,
        };
        return this.transform(delta, roles, this.starts);
    }
}
