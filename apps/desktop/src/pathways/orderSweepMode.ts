/**
 * Set order on the field (pathways step 4g, DL-27): while it's on, it takes every edit press. Two
 * gestures (owner, 2026-11-17), which mirror the pen's click-to-draw (DC-1 to DC-7):
 *
 * - **Press, hold and drag** through the selected marchers: it picks each the pointer passes, in
 *   that order, and the release keeps the order. A drag that passes no one leaves it on.
 * - **Click, then move** with the button up: the click picks the marcher under it (within the same
 *   reach) and the sweep then follows the pointer, picking whoever it passes, until a second click
 *   (or Enter) keeps the order.
 *
 * Either way it keeps the order once every one is picked. Backspace takes the newest pick back
 * (`takeBackLastPick`); a marcher taken back isn't picked again until the pointer has left it.
 * Nothing selects, moves or opens a menu.
 *
 * The picks are worked out once a frame from the pointer's moves since the last frame, so a fast
 * drag still passes everyone between, and the line redraws at most once a frame.
 */
import type {
    FieldCursor,
    FieldMode,
    FieldPointer,
} from "@/field/editor/fieldEditor";
import { useFieldViewStore } from "@/field/three/fieldView";
import { currentShapeField } from "@/shapes/field/shapeField";
import {
    updateOrderSweep,
    useMarcherOrderStore,
    type OrderSweep,
} from "./marcherOrderStore";
import { sweepThrough, sweepTolerance, type XY } from "./orderSweep";

/** How Set order ends once it has picked: kept (the caller writes it) */
type Finish = () => void;

export class OrderSweepMode implements FieldMode {
    readonly ownsSelectionBox = true;
    readonly locksSelection = true;
    readonly blocksFieldMenu = true;
    readonly gesture = { kind: "order" as const, always: false };

    /** Where the pointer was when picks were last worked out */
    private last: XY | null = null;
    /** How many were picked when the press went down */
    private pickedAtPress = 0;
    /** The pointer's moves since then, worked out on the next frame */
    private pending: XY[] = [];
    private frame: number | null = null;

    constructor(private readonly finish: Finish) {}

    claims(): boolean {
        return useMarcherOrderStore.getState().sweep !== null;
    }

    press(pointer: FieldPointer): void {
        // Following, the moves up to the press are picked first; the press itself picks only what's
        // under it, never the jump from the last point (a finger lifted and put down elsewhere)
        if (this.followingNow()) this.flush();
        this.pickedAtPress =
            useMarcherOrderStore.getState().sweep?.picked.length ?? 0;
        this.last = pointer.field;
        this.pending = [];
        this.pick(pointer.field, pointer.field);
    }

    move(pointer: FieldPointer): void {
        if (!this.last) return;
        this.follow(pointer);
    }

    /** A move to work out on the next frame */
    private follow(pointer: FieldPointer): void {
        if (!this.last) return;
        this.pending.push(pointer.field);
        if (typeof requestAnimationFrame !== "function") {
            this.flush();
            return;
        }
        this.frame ??= requestAnimationFrame(() => {
            this.frame = null;
            this.flush();
        });
    }

    release(
        pointer: FieldPointer,
        click: { double: boolean; ownFirst: boolean } | null,
    ): void {
        if (this.last) this.pending.push(pointer.field);
        this.flush();
        const sweep = useMarcherOrderStore.getState().sweep;
        if (!sweep) {
            this.last = null;
            return;
        }
        // Everyone picked keeps the order; so does a drag that picked someone, and a click while
        // following (the second click). A first click starts following; a drag that picked no one
        // leaves it waiting, as it was
        const dragPicked =
            click === null && sweep.picked.length > this.pickedAtPress;
        if (
            dragPicked ||
            sweep.picked.length === sweep.ids.length ||
            (click !== null && sweep.following)
        ) {
            this.last = null;
            updateOrderSweep({ pointer: null, following: false });
            this.finish();
            return;
        }
        if (click !== null) {
            this.last = pointer.field;
            updateOrderSweep({ pointer: pointer.field, following: true });
            return;
        }
        this.last = sweep.following ? pointer.field : null;
        if (!sweep.following) updateOrderSweep({ pointer: null });
    }

    cancel(): void {
        this.dropFrame();
        this.last = null;
        this.pending = [];
        updateOrderSweep({ pointer: null, following: false });
    }

    /** Following with the button up: the pointer's moves pick as a drag's do */
    cursorAt(pointer: FieldPointer): FieldCursor {
        if (this.followingNow()) {
            this.last ??= pointer.field;
            this.follow(pointer);
        }
        return "crosshair";
    }

    /** Whether the sweep follows the pointer with the button up now */
    private followingNow(): boolean {
        return useMarcherOrderStore.getState().sweep?.following ?? false;
    }

    drawing(): null {
        return null;
    }

    subscribe(): () => void {
        return () => {};
    }

    /** A click on empty field changes nothing while it's on */
    takeClick(): boolean {
        return true;
    }

    /** Works out the picks for the moves since the last frame */
    private flush(): void {
        this.dropFrame();
        const moves = this.pending;
        this.pending = [];
        let from = this.last;
        if (!from || moves.length === 0) return;
        for (const to of moves) {
            this.pick(from, to);
            from = to;
        }
        this.last = from;
    }

    private dropFrame(): void {
        if (this.frame !== null && typeof cancelAnimationFrame === "function")
            cancelAnimationFrame(this.frame);
        this.frame = null;
    }

    /**
     * Picks those the way `from`→`to` passes, and puts the line's end at `to`. Those taken back
     * (Backspace) aren't picked until the pointer has left them.
     */
    private pick(from: XY, to: XY): void {
        const sweep = useMarcherOrderStore.getState().sweep;
        if (!sweep) return;
        const tolerance = toleranceNow();
        const picked = sweepThrough({
            picked: sweep.picked,
            from,
            to,
            candidates: candidatesOf(sweep),
            tolerance,
        });
        const takenBack = sweep.takenBack.filter((id) => {
            const p = sweep.at.get(id);
            return !!p && Math.hypot(p.x - to.x, p.y - to.y) <= tolerance;
        });
        updateOrderSweep({
            pointer: to,
            ...(picked.length !== sweep.picked.length ? { picked } : {}),
            ...(takenBack.length !== sweep.takenBack.length
                ? { takenBack }
                : {}),
        });
    }
}

/** Who the sweep can pick: everyone selected but those taken back and not yet left */
const candidatesOf = (sweep: OrderSweep): ReadonlyMap<number, XY> => {
    if (sweep.takenBack.length === 0) return sweep.at;
    const waiting = new Set(sweep.takenBack);
    return new Map([...sweep.at].filter(([id]) => !waiting.has(id)));
};

/** Half a step, or a few pixels on screen when zoomed out */
function toleranceNow(): number {
    const step = currentShapeField()?.fieldProperties.pixelsPerStep ?? 12;
    return sweepTolerance(step, useFieldViewStore.getState().zoom);
}
