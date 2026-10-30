import type { FieldTestGesture } from "@/field/fieldTestApi";
import type { GestureKeys } from "@/input/gestureKeys";
import type { Roles } from "@/input/modifierRoles";
import type { FieldGesture, FieldPoint, FieldPointer } from "./fieldEditor";
import { fieldKeys, type FieldKeys } from "./fieldKeys";
import {
    rotatePoint,
    snapRotation,
    turnBetween,
    type HandleId,
    type SelectionFrame,
} from "./groupTransform";

/**
 * Resizing and turning one item's Outline with its handles (C2.1, props-spec
 * section 5). An Outline's size and turn are its own, beat-keyed and apart
 * from its moves, so the handles change only them: a side or corner resizes
 * about the center, the rotate handle turns it about the center, and the
 * item never moves. The release saves the new size and turn at the playhead.
 */

/** An item's Outline as drawn: its center, size in field units, and turn in degrees clockwise. */
export type ItemFrame = {
    center: FieldPoint;
    width: number;
    depth: number;
    rotation: number;
};

/** An Outline's size in field units and turn in degrees, as a handle leaves it. */
export type ItemSize = { width: number; depth: number; rotation: number };

/** No handle resizes an Outline below this, in field units: it would vanish. */
export const MIN_ITEM_SIZE = 2;

/** The item's frame as the selection box draws it: around its Outline, turned with it. */
export function itemSelectionFrame(frame: ItemFrame): SelectionFrame {
    const { center, width, depth, rotation } = frame;
    return {
        box: {
            left: center.x - width / 2,
            right: center.x + width / 2,
            top: center.y - depth / 2,
            bottom: center.y + depth / 2,
        },
        pad: 0,
        angle: rotation,
    };
}

/** What an item handle drags: the size drawn, and the save at the release. */
export interface ItemTransformHost {
    show(size: ItemSize): void;
    save(size: ItemSize): void;
    cancel(): void;
}

/** Which of the Outline's own axes a scale handle pulls: -1, 0 (not this axis) or 1. */
const PULLS: Record<Exclude<HandleId, "rot">, FieldPoint> = {
    nw: { x: -1, y: -1 },
    n: { x: 0, y: -1 },
    ne: { x: 1, y: -1 },
    e: { x: 1, y: 0 },
    se: { x: 1, y: 1 },
    s: { x: 0, y: 1 },
    sw: { x: -1, y: 1 },
    w: { x: -1, y: 0 },
};

/** A role key pressed or released mid-drag redraws the Outline at the last pointer. */
abstract class ItemHandleGesture implements FieldGesture {
    abstract readonly kind: FieldTestGesture;
    private readonly keys: GestureKeys;
    /** Where the pointer was at the last move. */
    private last: FieldPoint | null = null;

    constructor(
        protected readonly frame: ItemFrame,
        private readonly host: ItemTransformHost,
        press: FieldPointer,
        keys: FieldKeys = fieldKeys(press),
    ) {
        this.keys = keys(() => {
            if (this.last) this.show(this.last);
        });
    }

    move(pointer: FieldPointer): void {
        this.keys.update(pointer);
        this.show(pointer.field);
    }

    end(pointer: FieldPointer): void {
        this.keys.update(pointer);
        this.keys.dispose();
        this.host.save(this.sizeAt(pointer.field, this.keys.roles()));
    }

    cancel(): void {
        this.keys.dispose();
        this.host.cancel();
    }

    private show(at: FieldPoint) {
        this.last = at;
        this.host.show(this.sizeAt(at, this.keys.roles()));
    }

    protected abstract sizeAt(at: FieldPoint, roles: Roles): ItemSize;
}

/**
 * A side or corner: the Outline's sides it pulls follow the pointer, the
 * opposite ones following too, so the center stays where it is.
 */
export class ItemResizeGesture extends ItemHandleGesture {
    readonly kind: FieldTestGesture = "scale";

    constructor(
        origin: FieldPointer,
        frame: ItemFrame,
        host: ItemTransformHost,
        private readonly handle: Exclude<HandleId, "rot">,
        keys?: FieldKeys,
    ) {
        super(frame, host, origin, keys);
    }

    protected sizeAt(at: FieldPoint): ItemSize {
        const { center, width, depth, rotation } = this.frame;
        // The pointer in the Outline's own frame, unturned about its center
        const local = rotatePoint(at, center, -rotation);
        const pulls = PULLS[this.handle];
        const half = (offset: number, pull: number, size: number) =>
            pull === 0
                ? size
                : Math.max(MIN_ITEM_SIZE, 2 * Math.max(0, offset * pull));
        return {
            width: half(local.x - center.x, pulls.x, width),
            depth: half(local.y - center.y, pulls.y, depth),
            rotation,
        };
    }
}

/**
 * The rotate handle: turns the Outline about its center by the angle the
 * pointer turns through, snapped to 15°, or to whole degrees with fine.
 */
export class ItemRotateGesture extends ItemHandleGesture {
    readonly kind: FieldTestGesture = "rotate";
    private turned = 0;
    private lastPoint: FieldPoint;

    constructor(
        origin: FieldPointer,
        frame: ItemFrame,
        host: ItemTransformHost,
        keys?: FieldKeys,
    ) {
        super(frame, host, origin, keys);
        this.lastPoint = origin.field;
    }

    protected sizeAt(at: FieldPoint, roles: Roles): ItemSize {
        const { center, width, depth, rotation } = this.frame;
        this.turned += turnBetween(center, this.lastPoint, at);
        this.lastPoint = at;
        const turn = snapRotation(this.turned, roles);
        // Raw, not wrapped to [0, 360): an Outline change eases through the raw angle (so a
        // spin can be drawn), and 350° turned 20° must ease 20°, not back 340°
        return { width, depth, rotation: rotation + turn };
    }
}
