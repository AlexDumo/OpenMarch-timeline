import {
    initialGestureState,
    stepGesture,
    type GestureEffect,
    type GestureInput,
    type GestureState,
    type NavigationGeometry,
} from "@/components/canvas/touch/touchGestures";

/**
 * The timeline's gesture adapter (tablet plan 3.1): where a finger's press on the timeline goes.
 * Like the field's (`field/three/fieldGestures.ts`) it feeds finger presses to the pure gesture
 * rules (`touchGestures.ts` `stepGesture`) and carries out the effects they return.
 *
 * - A finger on a control (a clip, a flag, a page box, a grip, the tempo band, a button) is the
 *   control's: the press goes on to it untouched, so one finger on a clip moves it and one finger
 *   on a page box scrubs, as a mouse does.
 * - A finger on bare ruler or page row (the pinned header) scrubs, through the timeline surface's
 *   own pointer handlers, as a mouse does.
 * - A finger on bare track space pans the timeline once it leaves the tap slop (sideways and,
 *   when the tracks overflow, up and down). A tap there seeks, as a click does.
 * - Two fingers pan and pinch anywhere ({@link timelineNavigation}).
 * - A second finger cancels whatever the first one started: the first press gets a
 *   `pointercancel`, and every timeline drag puts its state back on one.
 *
 * Mouse and pen presses never come here: desktop behavior is unchanged.
 */

/** What a single finger does, decided where it goes down (see {@link timelineTouchRegion}). */
export type TimelineTouchRegion =
    /** A control takes its own presses */
    | "control"
    /** Bare ruler or page row: the surface scrubs */
    | "ruler"
    /** Bare track space: the finger pans */
    | "body";

/**
 * What takes its own presses on the timeline: anything marked `data-timeline-interactive` (clips,
 * flags, grips, hold edges, keyframes, the loop bar, the tempo band), the playhead's grab area,
 * and plain controls.
 */
export const TIMELINE_CONTROL_SELECTOR = [
    "[data-timeline-interactive]",
    "[data-timeline-scrub]",
    "button",
    "a[href]",
    "input",
    "select",
    "textarea",
    "[role='button']",
    "[role='slider']",
    "[role='menuitem']",
    "[contenteditable='true']",
].join(", ");

/**
 * The region a finger lands in. `onControl`: the press is on a control
 * ({@link TIMELINE_CONTROL_SELECTOR}). `offsetY`: its distance below the viewport's top, where the
 * pinned header (ruler and page row, `headerHeight` tall) always sits.
 */
export function timelineTouchRegion({
    onControl,
    offsetY,
    headerHeight,
}: {
    onControl: boolean;
    offsetY: number;
    headerHeight: number;
}): TimelineTouchRegion {
    if (onControl) return "control";
    return offsetY < headerHeight ? "ruler" : "body";
}

/** The timeline's scroll and zoom: what navigation moves. */
export type TimelineNavigationView = {
    scrollLeft: number;
    scrollTop: number;
    pixelsPerBeat: number;
};

/** Finger geometry in the viewport's own pixels (from its top left corner). */
export type TimelineGeometry = NavigationGeometry;

/** Where a navigation went: the view, and the beat kept under the fingers' midpoint. */
export type TimelineNavigationStep = TimelineNavigationView & {
    /** The beat that was under the midpoint at the start, and is under it now */
    anchorBeat: number;
    /** The midpoint's distance from the viewport's left edge */
    anchorPx: number;
};

/**
 * The view for the fingers' `current` geometry, from the view and geometry when the navigation
 * (re)started: the beat under the start midpoint stays under the current midpoint, and the tracks
 * scroll with it up and down. With two fingers the zoom scales with their spread, limited by
 * `clampZoom`; without `clampZoom` (no zoom to change), or with one finger, it only pans.
 *
 * `leadingInset` is where beat 0 sits in the scrolled content. Scroll positions are not limited
 * here; the viewport limits them.
 */
export function timelineNavigation({
    start,
    from,
    current,
    leadingInset,
    clampZoom,
}: {
    start: TimelineNavigationView;
    from: TimelineGeometry;
    current: TimelineGeometry;
    leadingInset: number;
    clampZoom?: (pixelsPerBeat: number) => number;
}): TimelineNavigationStep {
    const anchorBeat =
        start.pixelsPerBeat > 0
            ? (start.scrollLeft + from.mid.x - leadingInset) /
              start.pixelsPerBeat
            : 0;
    const pinching =
        clampZoom !== undefined &&
        from.distance !== null &&
        current.distance !== null &&
        from.distance > 0;
    const pixelsPerBeat = pinching
        ? clampZoom((start.pixelsPerBeat * current.distance!) / from.distance!)
        : start.pixelsPerBeat;
    return {
        pixelsPerBeat,
        scrollLeft: leadingInset + anchorBeat * pixelsPerBeat - current.mid.x,
        scrollTop: start.scrollTop + from.mid.y - current.mid.y,
        anchorBeat,
        anchorPx: current.mid.x,
    };
}

/** The parts of a pointer event the adapter reads; a `PointerEvent` is one. */
export type TimelineGestureEvent = Pick<
    PointerEvent,
    "type" | "pointerId" | "pointerType" | "clientX" | "clientY" | "timeStamp"
> & { target: EventTarget | null };

/** What the adapter needs from around it. */
export type TimelineGestureEnv = {
    /** Where a press lands (see {@link timelineTouchRegion}). */
    region: (event: TimelineGestureEvent) => TimelineTouchRegion;
    /** A client point in the viewport's own pixels. */
    local: (clientX: number, clientY: number) => { x: number; y: number };
    /** The scroll and zoom now. */
    view: () => TimelineNavigationView;
    /** Moves the view to a navigation step. */
    navigate: (step: TimelineNavigationStep) => void;
    /** Where beat 0 sits in the scrolled content. */
    leadingInset: () => number;
    /**
     * Limits a pinched zoom; the seam pinch zoom fills (tablet plan 3.2). Without it two fingers
     * only pan.
     */
    clampZoom?: (pixelsPerBeat: number) => number;
    /** A finger tapped bare track space at `clientX`: the click there (a seek). */
    tap?: (clientX: number) => void;
    /**
     * A second finger landed while the first one's press belonged to a control or the ruler:
     * end that press as a cancelled one, so whatever it was dragging goes back.
     */
    cancelPress: (down: TimelineGestureEvent) => void;
};

const INPUT_TYPES: Record<string, "down" | "move" | "up" | "cancel"> = {
    pointerdown: "down",
    pointermove: "move",
    pointerup: "up",
    pointercancel: "cancel",
};

/** Finger presses are the adapter's; mouse and pen presses never are. */
export const timelineGesturesOwn = (event: Pick<PointerEvent, "pointerType">) =>
    event.pointerType === "touch";

/**
 * The adapter itself, without the DOM: events in, view changes and cancels out.
 * {@link attachTimelineGestures} puts it on the timeline's viewport.
 */
export class TimelineGestures {
    private state: GestureState = initialGestureState();
    /** The single finger's press: whether it pans, and its down event */
    private single: {
        id: number;
        pans: boolean;
        down: TimelineGestureEvent;
    } | null = null;
    /** The view and geometry when the navigation (re)started */
    private navigation: {
        view: TimelineNavigationView;
        from: TimelineGeometry;
    } | null = null;

    constructor(private readonly env: TimelineGestureEnv) {}

    /**
     * Takes a pointer event on the timeline. Returns whether the event is the adapter's alone: the
     * caller then keeps it from the timeline's own handlers. A finger's press on a control or the
     * ruler (and its later events) goes on to them, until a second finger lands.
     */
    handle(event: TimelineGestureEvent): boolean {
        if (!timelineGesturesOwn(event)) return false;
        const type = INPUT_TYPES[event.type];
        if (!type) return false;
        const input = {
            type,
            id: event.pointerId,
            kind: "touch",
            x: event.clientX,
            y: event.clientY,
            t: event.timeStamp,
        } as GestureInput;
        // Decided before the step, so a single finger's own release still goes on to its control
        const single = this.single;
        const result = stepGesture(this.state, input);
        this.state = result.state;
        for (const effect of result.effects) this.apply(effect, event);
        if (!result.passThrough) return true;
        // A single finger: its control's or the ruler's, unless it pans
        const own = this.single ?? single;
        return own?.id === event.pointerId && own.pans;
    }

    /** Whether a gesture is under way. */
    get active(): boolean {
        return this.state.mode !== "idle";
    }

    /** Stops: drops anything under way. */
    dispose(): void {
        this.single = null;
        this.navigation = null;
        this.state = initialGestureState();
    }

    private apply(effect: GestureEffect, event: TimelineGestureEvent) {
        switch (effect.type) {
            case "singleStart":
                this.single = {
                    id: effect.id,
                    pans: this.env.region(event) === "body",
                    down: event,
                };
                break;
            case "singleDragged":
                if (this.single?.pans) this.panSingle();
                break;
            case "singleEnd": {
                const single = this.single;
                this.single = null;
                if (single?.id === effect.id && single.pans && effect.tap)
                    this.env.tap?.(effect.point.x);
                break;
            }
            case "cancelSingle": {
                const single = this.single;
                this.single = null;
                // A second finger (or the browser) took the press from its control: put back what
                // it was dragging. A panning finger had nothing to put back.
                if (single && !single.pans && event.type !== "pointercancel")
                    this.env.cancelPress(single.down);
                break;
            }
            case "navigationStart":
                this.navigation = {
                    view: this.env.view(),
                    from: this.local(effect.geometry),
                };
                break;
            case "navigate": {
                const navigation = this.navigation;
                if (!navigation) break;
                this.env.navigate(
                    timelineNavigation({
                        start: navigation.view,
                        from: navigation.from,
                        current: this.local(effect.geometry),
                        leadingInset: this.env.leadingInset(),
                        clampZoom: this.env.clampZoom,
                    }),
                );
                break;
            }
            case "navigationEnd":
                this.navigation = null;
                break;
            // No long press (no timer is ever sent) and no multi-finger tap history on the
            // timeline yet
            case "longPressArmed":
            case "longPressMoved":
            case "longPressCancelled":
            case "longPressCommit":
            case "undo":
            case "redo":
                break;
        }
    }

    /** The panning finger left the tap slop: the rest of its press pans, from where it went down. */
    private panSingle() {
        const result = stepGesture(this.state, { type: "panSingle" });
        this.state = result.state;
        for (const effect of result.effects)
            if (effect.type === "navigationStart")
                this.navigation = {
                    view: this.env.view(),
                    from: this.local(effect.geometry),
                };
        const finger = this.state.pointers[0];
        const navigation = this.navigation;
        if (finger && navigation)
            this.env.navigate(
                timelineNavigation({
                    start: navigation.view,
                    from: navigation.from,
                    current: this.local({
                        mid: { ...finger.current },
                        distance: null,
                    }),
                    leadingInset: this.env.leadingInset(),
                }),
            );
    }

    private local(geometry: NavigationGeometry): TimelineGeometry {
        return {
            mid: this.env.local(geometry.mid.x, geometry.mid.y),
            distance: geometry.distance,
        };
    }
}

const POINTER_TYPES = [
    "pointerdown",
    "pointermove",
    "pointerup",
    "pointercancel",
] as const;

/**
 * Puts the gesture adapter on `viewport`, the timeline's scroller, before the timeline's own
 * handlers see any event (capture phase). The finger events the adapter keeps don't reach them.
 * Also makes the viewport `touch-action: none`, so the browser never scrolls it itself (which
 * would cancel the press). Returns the detach.
 */
export function attachTimelineGestures(
    viewport: HTMLElement,
    env: Omit<TimelineGestureEnv, "cancelPress" | "local">,
): () => void {
    /** Set while the adapter sends its own cancel, which it mustn't step on */
    let cancelling = false;
    const gestures = new TimelineGestures({
        ...env,
        local: (clientX, clientY) => {
            const rect = viewport.getBoundingClientRect();
            return { x: clientX - rect.left, y: clientY - rect.top };
        },
        cancelPress: (down) => {
            const target = down.target;
            if (!(target instanceof Element) || !target.isConnected) return;
            cancelling = true;
            try {
                // Each drag on the timeline puts back what it moved on a cancel
                target.dispatchEvent(
                    new PointerEvent("pointercancel", {
                        bubbles: true,
                        pointerId: down.pointerId,
                        pointerType: "touch",
                        clientX: down.clientX,
                        clientY: down.clientY,
                    }),
                );
            } finally {
                cancelling = false;
            }
            // Its later moves and release are the navigation's
            for (const element of [
                target,
                ...ancestorsUpTo(target, viewport),
            ]) {
                if (element.hasPointerCapture?.(down.pointerId))
                    element.releasePointerCapture(down.pointerId);
            }
        },
    });
    const onPointer = (event: PointerEvent) => {
        if (cancelling) return;
        if (gestures.handle(event)) event.stopPropagation();
    };
    for (const type of POINTER_TYPES)
        viewport.addEventListener(type, onPointer, { capture: true });
    const { style } = viewport;
    const before = {
        touchAction: style.touchAction,
        callout: style.getPropertyValue("-webkit-touch-callout"),
    };
    style.touchAction = "none";
    style.setProperty("-webkit-touch-callout", "none");
    return () => {
        for (const type of POINTER_TYPES)
            viewport.removeEventListener(type, onPointer, { capture: true });
        style.touchAction = before.touchAction;
        style.setProperty("-webkit-touch-callout", before.callout);
        gestures.dispose();
    };
}

function ancestorsUpTo(element: Element, stop: Element): Element[] {
    const found: Element[] = [];
    for (
        let current = element.parentElement;
        current && current !== stop;
        current = current.parentElement
    )
        found.push(current);
    return found;
}
