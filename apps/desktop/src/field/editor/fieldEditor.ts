import type { FieldTestGesture } from "@/field/fieldTestApi";
import { hitRadius, marcherAt, type DrawnMarchers } from "./hitTest";
import { selectionAfterClick } from "./selectionRules";

/**
 * The field editor (ADR 0005 D-1): what a press, click or drag on the field
 * does. Plain TypeScript, with no React and no renderer. A field renderer
 * reports pointer events to it and draws what it says; the editor never
 * draws.
 *
 * It owns no copy of the selection: it reads and writes the app's (the
 * inspector's and the timeline's) through {@link FieldEditorPorts.selection}.
 */

/** A point in field units, as the timeline stores positions. */
export type FieldPoint = { x: number; y: number };

/**
 * One pointer event, as the renderer reports it: where it is on the field and
 * on screen, and which button and modifiers are down.
 */
export type FieldPointer = {
    /** Field units. */
    field: FieldPoint;
    /** CSS pixels from the field element's top-left. Distances on screen (the click slop) use these. */
    screen: FieldPoint;
    /** The button that changed (`PointerEvent.button`): 0 is the primary button. */
    button: number;
    shift: boolean;
    alt: boolean;
    ctrl: boolean;
    meta: boolean;
};

/** What the editor reads from, and writes to, the rest of the app. */
export type FieldEditorPorts = {
    /** The app's marcher selection: the one selection, shared with the inspector and timeline. */
    selection: {
        get(): readonly number[];
        set(ids: readonly number[]): void;
    };
    /** The marchers drawn, where they're drawn. */
    marchers(): DrawnMarchers;
    /** The view's zoom, in CSS pixels per field unit. */
    zoom(): number;
    /** False for a marcher that can't be selected or hit (one dimmed outside the isolated move). */
    canSelect(id: number): boolean;
};

export type FieldEditorOptions = {
    /** On a Mac, Ctrl+press is a right-click, which pans (navigation's, not the editor's). */
    isMac?: boolean;
};

/**
 * A press that moves less than this far, in screen pixels, is a click: it
 * never moves anything. There's no time limit (rules table: Click vs drag).
 */
export const CLICK_SLOP = 4;

/**
 * A gesture the editor runs once a press becomes a drag: marquee, lasso
 * (#195), move (#196), scale and rotate (#198), line (#203).
 */
export interface FieldGesture {
    readonly kind: FieldTestGesture;
    move(pointer: FieldPointer): void;
    end(pointer: FieldPointer): void;
    cancel(): void;
}

/** A primary-button press that hasn't become a drag (yet). */
export type FieldPress = {
    start: FieldPointer;
    /** The marcher pressed on, or null on empty field. */
    hit: number | null;
};

export type FieldCursor = "default" | "pointer";

export class FieldEditor {
    private press: FieldPress | null = null;
    /** The button of a drag that became no gesture: its moves and release do nothing. */
    private ignoredButton: number | null = null;
    private gesture: FieldGesture | null = null;
    private gestureButton = 0;
    private hover: FieldCursor = "default";
    private readonly listeners = new Set<() => void>();

    constructor(
        private readonly ports: FieldEditorPorts,
        private readonly options: FieldEditorOptions = {},
    ) {}

    /**
     * A button went down on the field. Returns true when the editor takes the
     * press, so the renderer captures the pointer and sends the rest of it
     * here; false leaves it to navigation (right, middle, Ctrl on a Mac).
     */
    pointerDown(pointer: FieldPointer): boolean {
        if (!this.isEditButton(pointer)) return false;
        this.cancelGesture();
        this.ignoredButton = null;
        this.press = { start: pointer, hit: this.marcherAt(pointer.field) };
        return true;
    }

    pointerMove(pointer: FieldPointer): void {
        if (this.gesture) {
            this.gesture.move(pointer);
            return;
        }
        if (this.ignoredButton !== null) return;
        const press = this.press;
        if (!press) {
            this.setHover(
                this.marcherAt(pointer.field) === null ? "default" : "pointer",
            );
            return;
        }
        if (!isPastSlop(press.start, pointer)) return;
        // A drag: the press is no longer a click, whatever comes of it
        this.press = null;
        this.gesture = this.startDrag(press, pointer);
        this.gestureButton = press.start.button;
        if (this.gesture) this.emit();
        else this.ignoredButton = press.start.button;
    }

    pointerUp(pointer: FieldPointer): void {
        if (this.ignoredButton !== null) {
            if (pointer.button === this.ignoredButton)
                this.ignoredButton = null;
            return;
        }
        if (this.gesture) {
            if (pointer.button !== this.gestureButton) return;
            const gesture = this.gesture;
            this.gesture = null;
            gesture.end(pointer);
            this.emit();
            return;
        }
        const press = this.press;
        if (!press || pointer.button !== press.start.button) return;
        this.press = null;
        // Over the slop since the last move event: a drag, not a click
        if (isPastSlop(press.start, pointer)) return;
        this.click(press, pointer.shift);
    }

    /** The pointer was lost (capture lost, the window lost focus): nothing is clicked or dropped. */
    pointerCancel(): void {
        this.press = null;
        this.ignoredButton = null;
        this.cancelGesture();
    }

    /** The pointer left the field with no button down. */
    pointerLeave(): void {
        this.setHover("default");
    }

    /** Ctrl/Cmd+A: every marcher that can be selected. */
    selectAll(): void {
        const { ids } = this.ports.marchers();
        this.write(ids.filter((id) => this.ports.canSelect(id)));
    }

    /** The gesture in progress, for the field test API and the overlay; a press that's still a click has none. */
    activeGesture(): FieldTestGesture | null {
        return this.gesture?.kind ?? null;
    }

    /** The cursor the field shows. */
    cursor(): FieldCursor {
        return this.hover;
    }

    /** Calls `listener` whenever the gesture or cursor changes. Returns the unsubscribe. */
    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /**
     * The gesture a press becomes once it moves past the click slop, or null
     * when the press does nothing more. #193 has no drags yet: marquee and
     * lasso (#195) start from `press.hit === null`, a move (#196) from a hit.
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    protected startDrag(press: FieldPress, pointer: FieldPointer) {
        return null as FieldGesture | null;
    }

    private click(press: FieldPress, shift: boolean) {
        this.write(
            selectionAfterClick(this.ports.selection.get(), press.hit, shift),
        );
    }

    private write(ids: readonly number[]) {
        if (!sameIds(ids, this.ports.selection.get()))
            this.ports.selection.set(ids);
    }

    private marcherAt(point: FieldPoint) {
        return marcherAt(
            this.ports.marchers(),
            point,
            hitRadius(this.ports.zoom()),
            (id) => this.ports.canSelect(id),
        );
    }

    private isEditButton(pointer: FieldPointer) {
        return pointer.button === 0 && !(this.options.isMac && pointer.ctrl);
    }

    private cancelGesture() {
        if (!this.gesture) return;
        const gesture = this.gesture;
        this.gesture = null;
        gesture.cancel();
        this.emit();
    }

    private setHover(cursor: FieldCursor) {
        if (cursor === this.hover) return;
        this.hover = cursor;
        this.emit();
    }

    private emit() {
        for (const listener of this.listeners) listener();
    }
}

const isPastSlop = (start: FieldPointer, pointer: FieldPointer) =>
    Math.hypot(
        pointer.screen.x - start.screen.x,
        pointer.screen.y - start.screen.y,
    ) >= CLICK_SLOP;

/** The same ids, in any order. */
const sameIds = (a: readonly number[], b: readonly number[]) => {
    if (a.length !== b.length) return false;
    const set = new Set(b);
    return a.every((id) => set.has(id));
};
