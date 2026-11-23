import { CLICK_SLOP, type FieldPointer } from "@/field/editor/fieldEditor";
import type { HonoredRoles } from "@/input/gestureChipStore";
import { rolesOf, type Roles } from "@/input/modifierRoles";
import { holdGesture, type HeldGesture } from "@/shapes/field/heldGesture";
import { currentShapeField } from "@/shapes/field/shapeField";
import { toolEnvFor } from "@/shapes/tool/toolEnv";
import type { ToolEnv } from "@/shapes/tool/toolKind";
import type { XY } from "@/shapes/types";
import { clickPlacesSmooth, holdsOtherKind, setOtherKindHeld } from "./penKind";
import type { PenSubject } from "./penSubject";

/** The env for the roles held, as the shape tool's (half steps, the field's lines, the Snap toggle) */
export const penEnv = (roles?: Roles): ToolEnv | null => {
    const field = currentShapeField();
    return field ? toolEnvFor(field, roles) : null;
};

/** What a drag while drawing reads, for the held-roles chip, as a shape drag names it */
const HONORED: HonoredRoles = { context: "shape", fine: "fine", snaps: true };

/**
 * Runs `fn` with the latest value on the next animation frame, once a frame at most (the pen's
 * preview, a trail's head dragged): the subject plans a whole line on it, which for a big line
 * costs a few milliseconds. Runs at once where there are no frames.
 */
export class FrameThrottle<T> {
    private pending: T | null = null;
    private frame: number | null = null;

    constructor(private readonly fn: (next: T) => void) {}

    push(next: T): void {
        if (typeof requestAnimationFrame !== "function") {
            this.fn(next);
            return;
        }
        this.pending = next;
        this.frame ??= requestAnimationFrame(() => {
            this.frame = null;
            const value = this.pending;
            this.pending = null;
            if (value !== null) this.fn(value);
        });
    }

    /** Drops what waits for its frame; with `flush`, runs it now instead */
    drop(flush = false): void {
        if (this.frame !== null) cancelAnimationFrame(this.frame);
        this.frame = null;
        const value = this.pending;
        this.pending = null;
        if (flush && value !== null) this.fn(value);
    }
}

/** A press while drawing, until its release */
interface PenHold {
    readonly start: FieldPointer;
    screen: XY;
    moved: boolean;
    readonly keys: HeldGesture<FieldPointer>;
    /** The press was on the last point or a fixed end: its release finishes, however far it moved */
    readonly finishes: boolean;
    /** Once a drag: what its press placed (a point then shaped smooth), or a finish */
    placed: "placed" | "finish" | null;
}

/**
 * The pen while a line is drawn (shared pen, plan step 1), over the subject the caller gives:
 *
 * - **A click** places the next point where it lands (on the half-step grid or a field line; off
 *   the grid with fine, at 45° from the last with constrain), a corner or a smooth point by the
 *   Straight | Curve switch, the other kind with Alt held (`penKind.ts`). A click on the last
 *   point, or on a fixed end, finishes.
 * - **A press-and-drag** places its point where it was pressed, and the drag turns it smooth, its
 *   roundness how far the drag went, in either mode.
 * - **A double-click** finishes; its first click placed its point, kept unless the subject drops it
 *   before a fixed end.
 * - **Between clicks** the leg follows the pointer with the roles its keys hold (once a frame for a
 *   subject that plans on it), and Alt pressed or let go changes the cue at once.
 * - A **lost press** gives a press-and-drag's point back to the subject (`loseShape`).
 *
 * Right-click, Backspace, undo and the bar take the last point back; Enter or the bar's Finish
 * finishes; Escape cancels (`usePenKeys`, `PenBar`). The pen keeps no points: they're the subject's.
 */
export class PenDrawing {
    private hold: PenHold | null = null;
    /**
     * The point a click just placed, and how many there were then: a double-click's second click
     * takes it back (sim round 3: "Double-click to finish" left a kink there)
     */
    private clickAdded: unknown = null;
    private clickAddedCount = 0;
    private readonly preview = new FrameThrottle<{
        subject: PenSubject;
        at: XY;
        roles: Roles;
    }>(({ subject, at, roles }) => {
        // Only while it's still the drawing it was asked for: a cancel or finish in between wins
        if (this.subject()?.key === subject.key)
            subject.preview(at, penEnv(roles));
    });

    /** `subject`: the line being drawn now, or null when none is */
    constructor(private readonly subject: () => PenSubject | null) {}

    /** A press is held */
    get holding(): boolean {
        return this.hold !== null;
    }

    press(pointer: FieldPointer, isMac: boolean): void {
        const subject = this.subject();
        this.endHold();
        if (!subject) return;
        const keys = holdGesture<FieldPointer>(
            pointer,
            (at, roles) => this.follow(at, roles),
            [],
            isMac,
            {
                honored: HONORED,
                screen: () => this.hold?.screen ?? pointer.screen,
            },
        );
        const env = penEnv(keys.roles());
        this.hold = {
            start: pointer,
            screen: pointer.screen,
            moved: false,
            keys,
            finishes: !!env && subject.finishesAt(pointer.field, env),
            placed: null,
        };
        this.show(subject, pointer.field, keys.roles());
    }

    move(pointer: FieldPointer): void {
        const subject = this.subject();
        if (!subject) return;
        // Alt held or let go shows on the next point's cue at once (the Straight | Curve switch)
        setOtherKindHeld(holdsOtherKind(pointer));
        const h = this.hold;
        if (!h) {
            this.show(subject, pointer.field, rolesOf(pointer, "shape"));
            return;
        }
        h.screen = pointer.screen;
        h.moved ||=
            Math.hypot(
                pointer.screen.x - h.start.screen.x,
                pointer.screen.y - h.start.screen.y,
            ) >= CLICK_SLOP;
        this.follow(pointer, h.keys.move(pointer, h.moved ? pointer : null));
    }

    /** The pointer with `roles`, the button down: within the slop, the preview; past it, the drag */
    private follow(pointer: FieldPointer, roles: Roles) {
        const h = this.hold;
        const subject = this.subject();
        if (!h || !subject) return;
        if (!h.moved || h.finishes) {
            this.show(subject, pointer.field, roles);
            return;
        }
        const env = penEnv(roles);
        if (!env) return;
        if (!h.placed) {
            this.preview.drop();
            h.placed = subject.click(h.start.field, false, env);
        }
        if (h.placed === "placed") subject.shapeLast(pointer.field, env);
    }

    release(pointer: FieldPointer, click: { double: boolean } | null): void {
        const h = this.hold;
        const roles = h?.keys.roles();
        this.endHold();
        // What the release does is read from where it is, not a move waiting for its frame
        this.preview.drop();
        const subject = this.subject();
        if (!h || !subject) return;
        const env = penEnv(roles);
        // Pressed on the last point or a fixed end and moved a little: still a finish
        if (h.moved && h.finishes) {
            subject.finish(pointer.field, env ?? undefined);
            return;
        }
        // A press-and-drag placed its smooth point as it went
        if (h.moved && h.placed) {
            subject.endShape();
            if (h.placed === "finish") subject.finish();
            return;
        }
        if (!env) return;
        // The double-click's second click finishes, and takes back the corner its first click
        // added where the subject's line ends at a fixed end anyway
        if (click?.double) {
            if (
                this.clickAdded !== null &&
                subject.last() === this.clickAdded &&
                subject.count() === this.clickAddedCount &&
                subject.dropsDoubleClickPoint()
            )
                subject.removeLast();
            this.clickAdded = null;
            subject.finish();
            return;
        }
        this.clickAdded = null;
        if (subject.finishesAt(pointer.field, env)) {
            subject.finish(pointer.field, env);
            return;
        }
        // A corner, or a smooth point: the Straight | Curve switch, Alt for the other
        if (
            subject.click(pointer.field, clickPlacesSmooth(pointer), env) ===
            "finish"
        ) {
            subject.finish();
            return;
        }
        this.clickAdded = subject.last();
        this.clickAddedCount = subject.count();
        subject.preview(pointer.field, env);
    }

    /** The press was lost: a press-and-drag's point is the subject's to keep or drop */
    cancel(): void {
        const h = this.hold;
        this.endHold();
        this.preview.drop();
        if (h?.moved && h.placed === "placed") this.subject()?.loseShape();
    }

    /** The cursor over `pointer` with no button down: the pen's cross, the leg following it */
    cursorAt(pointer: FieldPointer): "crosshair" {
        const subject = this.subject();
        if (subject && !this.hold)
            this.show(subject, pointer.field, rolesOf(pointer, "shape"));
        return "crosshair";
    }

    /** The pointer left the field: no leg to it, and Alt let go */
    leave(): void {
        setOtherKindHeld(false);
        this.preview.drop();
        const subject = this.subject();
        if (subject) subject.preview(null, null);
    }

    /**
     * The leg to `at` with `roles` for a press the caller holds (the Follow tool's first leg out
     * of an end)
     */
    pointAt(at: XY, roles: Roles): void {
        const subject = this.subject();
        if (subject) this.show(subject, at, roles);
    }

    /** Drops a preview waiting for its frame: a release reads where it is now */
    dropPreview(): void {
        this.preview.drop();
    }

    /** The leg to `at` with `roles`, once a frame for a subject that plans on it */
    private show(subject: PenSubject, at: XY, roles: Roles) {
        if (subject.perFrame) {
            this.preview.push({ subject, at, roles });
            return;
        }
        this.preview.drop();
        subject.preview(at, penEnv(roles));
    }

    private endHold() {
        this.hold?.keys.end();
        this.hold = null;
    }
}
