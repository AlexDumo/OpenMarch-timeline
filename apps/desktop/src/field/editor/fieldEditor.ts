import type { FieldTestGesture } from "@/field/fieldTestApi";
import { hitRadius, marcherAt, type DrawnMarchers } from "./hitTest";
import {
    MoveGesture,
    type MarcherPosition,
    type MoveTransform,
} from "./moveGesture";
import { selectionAfterClick } from "./selectionRules";
import { isPanButton } from "./view";

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
    /**
     * Called once at the start of every edit press, before the editor does
     * anything with it. The app may act on the press here (story 60: the
     * first press after a paused preview clears the preview) and returns
     * true when it takes it, so the editor selects, drags and drops nothing.
     */
    takePress?(): boolean;
    /**
     * How far the selection box drawn around a multi-selection reaches past
     * its outermost marchers, in field units. A drag from inside it moves the
     * selection. 0 when omitted.
     */
    selectionBoxPadding?(): number;
    /**
     * Draws these marchers at these positions instead of where the show has
     * them (a drag, then a drop waiting to be saved); null draws the show.
     */
    showPositions(positions: ReadonlyMap<number, FieldPoint> | null): void;
    /**
     * Saves dropped marchers through the timeline's rules. Resolves "saved"
     * once the field can draw the show with the drop in it, or "refused" when
     * nothing was saved (the reason has been shown).
     */
    drop(positions: readonly MarcherPosition[]): Promise<DropResult>;
};

export type DropResult = "saved" | "refused";

export type FieldEditorOptions = {
    /** On a Mac, Ctrl+press is a right-click, which pans (navigation's, not the editor's). */
    isMac?: boolean;
    /** Where a drag puts the marchers for a pointer delta; snapping and locks are #197's. */
    moveTransform?: MoveTransform;
};

/**
 * A press that moves less than this far, in screen pixels, is a click: it
 * never moves anything. There's no time limit (rules table: Click vs drag).
 */
export const CLICK_SLOP = 4;

/** How long a drop may take to save before the editor logs that it hasn't settled. */
const DROP_SETTLE_WARNING_MS = 30_000;

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
    /**
     * Dropped marchers whose save hasn't settled: they're drawn where they
     * were dropped until it has (user story 42). `drop` counts drops, so only
     * the last one's answer clears them.
     */
    private pending: ReadonlyMap<number, FieldPoint> | null = null;
    private drops = 0;
    /** Where the marchers being dragged are drawn, or null with no drag. */
    private live: readonly MarcherPosition[] | null = null;
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
        if (this.ports.takePress?.()) {
            // Captured all the same, so its moves and release do nothing either
            this.press = null;
            this.ignoredButton = pointer.button;
            return true;
        }
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
        if (!this.gesture) {
            this.ignoredButton = press.start.button;
            return;
        }
        this.emit();
        this.gesture.move(pointer);
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
        // Over the slop since the last move event: a drag, not a click, that
        // ends where it starts
        if (isPastSlop(press.start, pointer)) {
            const gesture = this.startDrag(press, pointer);
            gesture?.move(pointer);
            gesture?.end(pointer);
            return;
        }
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

    /** Ctrl/Cmd+A: every marcher drawn that can be selected. */
    selectAll(): void {
        const { ids, hidden } = this.ports.marchers();
        this.write(
            ids.filter((id, i) => !hidden?.[i] && this.ports.canSelect(id)),
        );
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
     * when the press does nothing more. A move starts from a marcher, or from
     * empty field inside a multi-selection's box (owner decision, #196);
     * marquee and lasso (#195) start from the rest of the empty field.
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    protected startDrag(press: FieldPress, pointer: FieldPointer) {
        return this.startMove(press);
    }

    /**
     * Drags the marchers a press moves, or returns null when it moves none:
     *
     * - pressing a selected marcher moves the whole selection (narrowing to
     *   it happens only on a click);
     * - pressing another marcher selects it (Shift adds it) and moves the
     *   selection;
     * - pressing empty field inside a multi-selection's box moves the
     *   selection.
     */
    private startMove(press: FieldPress): FieldGesture | null {
        const selection = this.ports.selection.get();
        let ids: readonly number[];
        if (press.hit !== null) {
            ids = selection.includes(press.hit)
                ? selection
                : press.start.shift
                  ? [...selection, press.hit]
                  : [press.hit];
            this.write(ids);
        } else if (this.insideSelectionBox(selection, press.start.field)) {
            ids = selection;
        } else return null;

        const starts = this.drawnPositions(ids);
        if (starts.length === 0) return null;
        return new MoveGesture(
            press.start,
            starts,
            {
                show: (positions) => this.showLive(positions),
                drop: (positions) => this.drop(starts, positions),
                cancel: () => this.endLive(),
            },
            this.options.moveTransform,
        );
    }

    /** Where `ids` are drawn now, skipping any not drawn or hidden. */
    private drawnPositions(ids: readonly number[]): MarcherPosition[] {
        const { ids: drawn, positions, hidden } = this.ports.marchers();
        const wanted = new Set(ids);
        const starts: MarcherPosition[] = [];
        for (let i = 0; i < drawn.length; i++) {
            if (!wanted.has(drawn[i]) || hidden?.[i]) continue;
            starts.push({
                id: drawn[i],
                x: positions[i * 2],
                y: positions[i * 2 + 1],
            });
        }
        return starts;
    }

    /** Whether `point` is inside the box drawn around a selection of two or more. */
    private insideSelectionBox(
        selection: readonly number[],
        point: FieldPoint,
    ) {
        if (selection.length < 2) return false;
        const starts = this.drawnPositions(selection);
        if (starts.length < 2) return false;
        const pad = this.ports.selectionBoxPadding?.() ?? 0;
        const xs = starts.map((p) => p.x);
        const ys = starts.map((p) => p.y);
        return (
            point.x >= Math.min(...xs) - pad &&
            point.x <= Math.max(...xs) + pad &&
            point.y >= Math.min(...ys) - pad &&
            point.y <= Math.max(...ys) + pad
        );
    }

    /** Draws the dragged marchers live, over any earlier drop still saving. */
    private showLive(positions: readonly MarcherPosition[]) {
        this.live = positions;
        this.ports.showPositions(withPositions(this.pending, positions));
    }

    /** The drag is over with nothing dropped: only drops still saving are drawn. */
    private endLive() {
        this.live = null;
        this.ports.showPositions(this.pending);
    }

    /**
     * Saves a drop. The marchers stay where they were dropped until the save
     * settles, then the field draws the show again: with the drop in it, or
     * without it when it was refused (they snap back). A drop that moved
     * nothing saves nothing.
     */
    private drop(
        starts: readonly MarcherPosition[],
        positions: readonly MarcherPosition[],
    ) {
        const moved = positions.some(
            (p, i) => p.x !== starts[i].x || p.y !== starts[i].y,
        );
        if (!moved) {
            this.endLive();
            return;
        }
        this.live = null;
        const pending = withPositions(this.pending, positions);
        this.pending = pending;
        const drop = ++this.drops;
        this.ports.showPositions(pending);
        // The port must settle on every path; say so if it doesn't, since the
        // marchers stay drawn where they were dropped until it does
        const unsettled = setTimeout(
            () =>
                console.error(
                    "A drop hasn't settled after 30 s: its marchers stay where they were dropped",
                ),
            DROP_SETTLE_WARNING_MS,
        );
        const settle = () => {
            clearTimeout(unsettled);
            // A later drop is still saving: its answer clears both
            if (drop !== this.drops) return;
            this.pending = null;
            // A drag in progress stays under the pointer
            this.ports.showPositions(
                this.live && withPositions(null, this.live),
            );
        };
        this.ports.drop(positions).then(settle, settle);
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

    /** The primary button, unless the press pans (navigation's rule, `isPanButton`). */
    private isEditButton(pointer: FieldPointer) {
        return (
            pointer.button === 0 &&
            !isPanButton(
                { button: pointer.button, ctrlKey: pointer.ctrl },
                this.options.isMac ?? false,
            )
        );
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

/** `base` with `positions` written over it. */
const withPositions = (
    base: ReadonlyMap<number, FieldPoint> | null,
    positions: readonly MarcherPosition[],
): ReadonlyMap<number, FieldPoint> => {
    const merged = new Map(base);
    for (const { id, x, y } of positions) merged.set(id, { x, y });
    return merged;
};

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
