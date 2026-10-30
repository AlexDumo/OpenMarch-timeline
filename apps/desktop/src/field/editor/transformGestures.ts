import type { FieldTestGesture } from "@/field/fieldTestApi";
import type { GestureKeys } from "@/input/gestureKeys";
import type { Roles } from "@/input/modifierRoles";
import type { FieldGesture, FieldPoint, FieldPointer } from "./fieldEditor";
import { fieldKeys, type FieldKeys } from "./fieldKeys";
import {
    centerOf,
    rotatePositions,
    scaleFor,
    scalePositions,
    snapRotation,
    turnBetween,
    type HandleId,
} from "./groupTransform";
import type { MarcherPosition, MoveGestureHost } from "./moveGesture";
import { PRECISION_START, anchorAt, precisionDelta } from "./moveRules";
import type { FieldRect } from "./selectionArea";

/**
 * Dragging a handle of the selection box (#198): the marchers scale or
 * rotate from where they were at the press, and are dropped where they're
 * drawn at the release, through the same host as a move (#196): live
 * positions, the drop and its pending save, snap-back, one undo step.
 *
 * Lock X and Lock Y don't apply to handles (rules table: Lock X / Lock Y).
 * While fine is on the pointer counts at a quarter of its speed
 * (`precisionDelta`, #197). As in a move, a role key pressed or released
 * mid-drag redraws the marchers at the last pointer.
 */
abstract class HandleGesture implements FieldGesture {
    abstract readonly kind: FieldTestGesture;
    protected track = PRECISION_START;
    private readonly keys: GestureKeys;
    /** The last positions shown, and where the pointer was for them. */
    private shown: { at: FieldPoint; positions: MarcherPosition[] } | null =
        null;

    constructor(
        protected readonly origin: FieldPointer,
        protected readonly starts: readonly MarcherPosition[],
        private readonly host: MoveGestureHost,
        keys: FieldKeys = fieldKeys(origin),
    ) {
        this.keys = keys(() => {
            if (this.shown) this.show(this.shown.at);
        });
    }

    move(pointer: FieldPointer): void {
        this.keys.update(pointer);
        this.show(pointer.field);
    }

    /**
     * Drops the marchers. As a move does: a release where the last move left
     * the pointer drops them where they're drawn, whatever keys changed since.
     */
    end(pointer: FieldPointer): void {
        const still =
            this.shown !== null &&
            this.shown.at.x === pointer.field.x &&
            this.shown.at.y === pointer.field.y;
        if (!still) this.keys.update(pointer);
        this.keys.dispose();
        this.host.drop(
            still
                ? this.shown!.positions
                : this.positionsAt(pointer.field, this.keys.roles()),
        );
    }

    cancel(): void {
        this.keys.dispose();
        this.host.cancel();
    }

    /** The held roles at the press, before any move. */
    protected pressRoles(): Roles {
        return this.keys.roles();
    }

    private show(at: FieldPoint) {
        const positions = this.positionsAt(at, this.keys.roles());
        this.shown = { at, positions };
        this.host.show(positions);
    }

    /** Where the marchers go for the pointer at `at`, with these roles held. */
    protected abstract positionsAt(
        at: FieldPoint,
        roles: Roles,
    ): MarcherPosition[];
}

/** A corner or middle handle: scales the selection from the opposite side. */
export class ScaleGesture extends HandleGesture {
    readonly kind: FieldTestGesture = "scale";

    constructor(
        origin: FieldPointer,
        starts: readonly MarcherPosition[],
        host: MoveGestureHost,
        private readonly handle: Exclude<HandleId, "rot">,
        /** The marchers' bounds at the press. */
        private readonly box: FieldRect,
        keys?: FieldKeys,
    ) {
        super(origin, starts, host, keys);
    }

    protected positionsAt(at: FieldPoint, roles: Roles) {
        // Nothing snaps, so fine needs no re-anchoring: the slow drag goes on
        // from wherever the pointer had taken the marchers
        const moved = precisionDelta(
            this.track,
            { x: at.x - this.origin.field.x, y: at.y - this.origin.field.y },
            roles.fine,
        );
        this.track = moved.track;
        // A corner scales proportionally; constrain flips that, freeing each axis
        return scalePositions(
            this.starts,
            scaleFor(this.handle, this.box, moved.delta, roles.constrain),
        );
    }
}

/**
 * The rotate handle: turns the selection about its box's center by the angle
 * the pointer turns through, snapped to 15°, or with fine to whole degrees at
 * a quarter speed. Fine turning on goes on slowly from the angle drawn
 * (snapped), with no jump.
 */
export class RotateGesture extends HandleGesture {
    readonly kind: FieldTestGesture = "rotate";
    readonly center: FieldPoint;
    /** The angle the pointer has turned through, at full speed. */
    private turned = 0;
    private last: FieldPoint;
    private fine: boolean;
    /** The angle drawn at the last event, in degrees. */
    private drawn = 0;

    constructor(
        origin: FieldPointer,
        starts: readonly MarcherPosition[],
        host: MoveGestureHost,
        /** The marchers' bounds at the press. */
        readonly box: FieldRect,
        keys?: FieldKeys,
    ) {
        super(origin, starts, host, keys);
        this.center = centerOf(box);
        this.last = origin.field;
        this.fine = this.pressRoles().fine;
    }

    /** The angle drawn, in degrees clockwise: the overlay turns the box by it until the release. */
    angle(): number {
        return this.drawn;
    }

    protected positionsAt(at: FieldPoint, roles: Roles) {
        this.turned += turnBetween(this.center, this.last, at);
        this.last = at;
        if (roles.fine && !this.fine)
            this.track = anchorAt(this.track, { x: this.drawn, y: 0 });
        this.fine = roles.fine;
        const moved = precisionDelta(
            this.track,
            { x: this.turned, y: 0 },
            roles.fine,
        );
        this.track = moved.track;
        this.drawn = snapRotation(moved.delta.x, roles);
        return rotatePositions(this.starts, this.center, this.drawn);
    }
}
