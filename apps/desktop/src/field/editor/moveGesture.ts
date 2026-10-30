import type { FieldTestGesture } from "@/field/fieldTestApi";
import type { GestureKeys } from "@/input/gestureKeys";
import type { Roles } from "@/input/modifierRoles";
import type { FieldGesture, FieldPoint, FieldPointer } from "./fieldEditor";
import { fieldKeys, type FieldKeys } from "./fieldKeys";
import { PRECISION_START, anchorAt, precisionDelta } from "./moveRules";

/** A marcher's position, in field units. */
export type MarcherPosition = { id: number; x: number; y: number };

/**
 * Where the dragged marchers go for a pointer delta, in field units. The seam
 * for snapping and Lock X/Y (#197, `ruledMove` in `moveRules.ts`): it gets the
 * delta from the press to the pointer (slowed while fine is on, see
 * `precisionDelta`), the held roles and where the marchers started, and
 * returns their positions. {@link followPointer} moves them by the delta as
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

/**
 * Dragging marchers (#196, user story 34): they follow the pointer from where
 * the press started, through {@link MoveTransform}, and are dropped where it's
 * released. The editor saves the drop and owns what's drawn meanwhile. While
 * fine is on they move at a quarter of the pointer's speed (#197, user story
 * 39), carrying on from where they're drawn when fine turns on (snapped,
 * when rounding is on) or off. A role key pressed or released mid-drag
 * redraws them at the last pointer, with no pointer move.
 */
export class MoveGesture implements FieldGesture {
    readonly kind: FieldTestGesture = "move";
    private track = PRECISION_START;
    private fine: boolean;
    private readonly keys: GestureKeys;
    /**
     * How far the first marcher was drawn from its start, at the last event.
     * On a locked axis it's 0, so unlocking mid-drag with fine on trails the
     * pointer by the whole distance dragged along that axis.
     */
    private drawn: FieldPoint = { x: 0, y: 0 };
    /** The last positions shown, and where the pointer was for them. */
    private shown: {
        at: FieldPoint;
        positions: MarcherPosition[];
    } | null = null;

    constructor(
        private readonly origin: FieldPointer,
        private readonly starts: readonly MarcherPosition[],
        private readonly host: MoveGestureHost,
        private readonly transform: MoveTransform = followPointer,
        keys: FieldKeys = fieldKeys(origin),
    ) {
        this.keys = keys(() => {
            if (this.shown) this.show(this.shown.at);
        });
        this.fine = this.keys.roles().fine;
    }

    move(pointer: FieldPointer): void {
        this.keys.update(pointer);
        this.show(pointer.field);
    }

    /**
     * Drops the marchers. A release where the last move left the pointer
     * drops them where they're drawn: a key pressed or released since then
     * has redrawn them already, and one the release reports that no keyboard
     * event did mustn't change the drop (user stories 41 and 42).
     */
    end(pointer: FieldPointer): void {
        const still =
            this.shown !== null &&
            this.shown.at.x === pointer.field.x &&
            this.shown.at.y === pointer.field.y;
        if (!still) this.keys.update(pointer);
        this.keys.dispose();
        this.host.drop(
            still ? this.shown!.positions : this.positionsAt(pointer.field),
        );
    }

    cancel(): void {
        this.keys.dispose();
        this.host.cancel();
    }

    private show(at: FieldPoint) {
        const positions = this.positionsAt(at);
        this.shown = { at, positions };
        this.host.show(positions);
    }

    private positionsAt(at: FieldPoint) {
        const roles = this.keys.roles();
        // Fine on: the slow drag starts from where the marchers are drawn
        if (roles.fine && !this.fine)
            this.track = anchorAt(this.track, this.drawn);
        this.fine = roles.fine;
        const moved = precisionDelta(
            this.track,
            { x: at.x - this.origin.field.x, y: at.y - this.origin.field.y },
            roles.fine,
        );
        this.track = moved.track;
        const positions = this.transform(moved.delta, roles, this.starts);
        this.drawn = {
            x: positions[0].x - this.starts[0].x,
            y: positions[0].y - this.starts[0].y,
        };
        return positions;
    }
}
