import { afterEach, describe, expect, it, vi } from "vitest";
import {
    attachTimelineGestures,
    fingerDragSlop,
    TimelineGestures,
    timelineNavigation,
    timelineTouchRegion,
    type TimelineGestureEnv,
    type TimelineGestureEvent,
    type TimelineNavigationStep,
    type TimelineTouchRegion,
} from "../timelineGestures";
import {
    TIMELINE_RANGE_DRAG_PX,
    timelineDragSlop,
} from "../TimelinePrimitives";

describe("timelineTouchRegion", () => {
    it("gives a control its own press, wherever it is", () => {
        expect(
            timelineTouchRegion({
                onControl: true,
                offsetY: 5,
                headerHeight: 60,
            }),
        ).toBe("control");
        expect(
            timelineTouchRegion({
                onControl: true,
                offsetY: 200,
                headerHeight: 60,
            }),
        ).toBe("control");
    });

    it("scrubs on the bare ruler and page row, pans on bare track space", () => {
        expect(
            timelineTouchRegion({
                onControl: false,
                offsetY: 59,
                headerHeight: 60,
            }),
        ).toBe("ruler");
        expect(
            timelineTouchRegion({
                onControl: false,
                offsetY: 60,
                headerHeight: 60,
            }),
        ).toBe("body");
    });
});

describe("timelineNavigation", () => {
    const start = { scrollLeft: 100, scrollTop: 40, pixelsPerBeat: 10 };

    it("pans: the beat under the fingers stays under them, and the tracks scroll with them", () => {
        const step = timelineNavigation({
            start,
            from: { mid: { x: 200, y: 100 }, distance: null },
            current: { mid: { x: 150, y: 80 }, distance: null },
            leadingInset: 40,
        });
        // Beat (100 + 200 - 40) / 10 = 26 was under x 200; it's now under x 150
        expect(step.anchorBeat).toBe(26);
        expect(step.pixelsPerBeat).toBe(10);
        expect(step.scrollLeft).toBe(40 + 26 * 10 - 150);
        expect(step.scrollTop).toBe(60);
        expect(step.anchorPx).toBe(150);
    });

    it("pinches about the midpoint, within the limits", () => {
        const step = timelineNavigation({
            start,
            from: { mid: { x: 200, y: 100 }, distance: 100 },
            current: { mid: { x: 200, y: 100 }, distance: 200 },
            leadingInset: 40,
            clampZoom: (z) => Math.min(z, 15),
        });
        expect(step.pixelsPerBeat).toBe(15);
        // Beat 26 stays at x 200
        expect(40 + step.anchorBeat * 15 - step.scrollLeft).toBe(200);
    });

    it("keeps the zoom without a zoom seam, or with one finger", () => {
        expect(
            timelineNavigation({
                start,
                from: { mid: { x: 0, y: 0 }, distance: 100 },
                current: { mid: { x: 0, y: 0 }, distance: 300 },
                leadingInset: 0,
            }).pixelsPerBeat,
        ).toBe(10);
        expect(
            timelineNavigation({
                start,
                from: { mid: { x: 0, y: 0 }, distance: null },
                current: { mid: { x: 0, y: 0 }, distance: null },
                leadingInset: 0,
                clampZoom: (z) => z * 2,
            }).pixelsPerBeat,
        ).toBe(10);
    });
});

describe("timelineDragSlop", () => {
    it("keeps the mouse's threshold and widens a finger's", () => {
        expect(timelineDragSlop("mouse")).toBe(TIMELINE_RANGE_DRAG_PX);
        expect(timelineDragSlop("pen")).toBe(TIMELINE_RANGE_DRAG_PX);
        expect(timelineDragSlop("touch")).toBe(12);
    });

    it("never narrows a control's own threshold for a finger", () => {
        expect(fingerDragSlop("touch", 4)).toBe(12);
        expect(fingerDragSlop("touch", 20)).toBe(20);
        expect(fingerDragSlop("mouse", 6)).toBe(6);
        expect(fingerDragSlop("pen", 6)).toBe(6);
    });
});

/** A gesture adapter on a fake timeline whose viewport sits at the page's top left */
function setup(regions: (x: number, y: number) => TimelineTouchRegion) {
    const view = { scrollLeft: 0, scrollTop: 0, pixelsPerBeat: 10 };
    const navigate = vi.fn((step: TimelineNavigationStep) => {
        view.scrollLeft = step.scrollLeft;
        view.scrollTop = step.scrollTop;
        view.pixelsPerBeat = step.pixelsPerBeat;
    });
    const env = {
        region: (event: TimelineGestureEvent) =>
            regions(event.clientX, event.clientY),
        local: (x: number, y: number) => ({ x, y }),
        view: () => ({ ...view }),
        navigate,
        leadingInset: () => 0,
        clampZoom: (z: number) => Math.min(Math.max(z, 1), 100),
        tap: vi.fn(),
        cancelPress: vi.fn(),
    } satisfies TimelineGestureEnv;
    const gestures = new TimelineGestures(env);
    let t = 0;
    const send = (
        type: string,
        pointerId: number,
        clientX: number,
        clientY: number,
        pointerType = "touch",
    ) =>
        gestures.handle({
            type,
            pointerId,
            pointerType,
            clientX,
            clientY,
            timeStamp: (t += 16),
            target: null,
        });
    return { gestures, env, view, navigate, send };
}

describe("TimelineGestures", () => {
    it("never takes a mouse or pen press", () => {
        const { send, navigate, env } = setup(() => "body");
        for (const kind of ["mouse", "pen"]) {
            expect(send("pointerdown", 1, 100, 100, kind)).toBe(false);
            expect(send("pointermove", 1, 50, 100, kind)).toBe(false);
            expect(send("pointerup", 1, 50, 100, kind)).toBe(false);
        }
        expect(navigate).not.toHaveBeenCalled();
        expect(env.tap).not.toHaveBeenCalled();
    });

    it("pans with one finger on bare track space, from where it went down", () => {
        const { send, view } = setup(() => "body");
        view.scrollLeft = 300;
        expect(send("pointerdown", 1, 200, 150)).toBe(true);
        // Inside the tap slop: nothing moves yet
        expect(send("pointermove", 1, 195, 150)).toBe(true);
        expect(view.scrollLeft).toBe(300);
        // Past it, the view catches up with the whole drag
        expect(send("pointermove", 1, 180, 150)).toBe(true);
        expect(view.scrollLeft).toBe(320);
        send("pointermove", 1, 100, 130);
        expect(view.scrollLeft).toBe(400);
        expect(view.scrollTop).toBe(20);
        expect(send("pointerup", 1, 100, 130)).toBe(true);
    });

    it("seeks on a tap on bare track space, never on a pan", () => {
        const { send, env } = setup(() => "body");
        send("pointerdown", 1, 200, 150);
        send("pointermove", 1, 204, 151);
        send("pointerup", 1, 204, 151);
        expect(env.tap).toHaveBeenCalledTimes(1);
        expect(env.tap).toHaveBeenCalledWith(204);
        send("pointerdown", 2, 200, 150);
        send("pointermove", 2, 150, 150);
        send("pointerup", 2, 150, 150);
        expect(env.tap).toHaveBeenCalledTimes(1);
    });

    it.each(["control", "ruler"] as const)(
        "leaves a single finger on the %s to the timeline's own handlers",
        (region) => {
            const { send, navigate, env } = setup(() => region);
            expect(send("pointerdown", 1, 200, 20)).toBe(false);
            expect(send("pointermove", 1, 100, 20)).toBe(false);
            expect(send("pointerup", 1, 100, 20)).toBe(false);
            expect(navigate).not.toHaveBeenCalled();
            expect(env.tap).not.toHaveBeenCalled();
            expect(env.cancelPress).not.toHaveBeenCalled();
        },
    );

    it("cancels the first finger's drag when a second lands, then both fingers navigate", () => {
        const { send, navigate, env, view } = setup((_, y) =>
            y < 50 ? "ruler" : "control",
        );
        expect(send("pointerdown", 1, 200, 100)).toBe(false);
        expect(send("pointermove", 1, 230, 100)).toBe(false);
        // The second finger: the clip's drag is cancelled with its own down event
        expect(send("pointerdown", 2, 300, 100)).toBe(true);
        expect(env.cancelPress).toHaveBeenCalledTimes(1);
        expect(env.cancelPress.mock.calls[0][0]).toMatchObject({
            pointerId: 1,
            clientX: 200,
        });
        // From here every finger's events are the navigation's
        expect(send("pointermove", 1, 210, 100)).toBe(true);
        expect(send("pointermove", 2, 280, 100)).toBe(true);
        expect(navigate).toHaveBeenCalled();
        // Both moved 20 px left, the spread unchanged: panned 20 px at the same zoom
        expect(view.pixelsPerBeat).toBe(10);
        expect(view.scrollLeft).toBeCloseTo(20);
        expect(send("pointerup", 1, 210, 100)).toBe(true);
        // Down to one finger it keeps navigating, and never resumes the drag
        expect(send("pointermove", 2, 280, 100)).toBe(true);
        expect(send("pointerup", 2, 280, 100)).toBe(true);
        expect(env.cancelPress).toHaveBeenCalledTimes(1);
    });

    it("pinches with two fingers through the zoom seam", () => {
        const { send, view } = setup(() => "body");
        send("pointerdown", 1, 100, 100);
        send("pointerdown", 2, 200, 100);
        send("pointermove", 2, 300, 100);
        // Spread 100 → 200: twice the zoom
        expect(view.pixelsPerBeat).toBe(20);
        // The beat under the start midpoint (15) is under the new midpoint (200)
        expect(15 * view.pixelsPerBeat - view.scrollLeft).toBe(200);
    });

    it("doesn't cancel a panning finger's press, which moved nothing", () => {
        const { send, env } = setup(() => "body");
        send("pointerdown", 1, 100, 100);
        send("pointermove", 1, 60, 100);
        send("pointerdown", 2, 200, 100);
        expect(env.cancelPress).not.toHaveBeenCalled();
    });

    it("leaves a browser's cancel of a control's press to the control", () => {
        const { send, env } = setup(() => "control");
        send("pointerdown", 1, 100, 100);
        expect(send("pointercancel", 1, 100, 100)).toBe(false);
        expect(env.cancelPress).not.toHaveBeenCalled();
    });
});

describe("a finger the adapter never hears lift", () => {
    it("holds the gesture open until it's dropped, then lets the next press through", () => {
        const { gestures, send, env } = setup(() => "control");
        send("pointerdown", 1, 100, 100);
        send("pointerdown", 2, 200, 100);
        expect(env.cancelPress).toHaveBeenCalledTimes(1);
        send("pointerup", 2, 200, 100);
        // Finger 1 lifted off the pane: its release never came. A new press is swallowed
        expect(gestures.tracks(1)).toBe(true);
        expect(send("pointerdown", 3, 100, 100)).toBe(true);
        send("pointerup", 3, 100, 100);
        // Forgotten, the next press goes to its control again
        gestures.drop(1, 1_000);
        expect(gestures.tracks(1)).toBe(false);
        expect(gestures.active).toBe(false);
        expect(send("pointerdown", 4, 100, 100)).toBe(false);
        expect(env.cancelPress).toHaveBeenCalledTimes(1);
    });

    it("keeps the fingers it owns: a panning one, then every navigating one", () => {
        const { gestures, send } = setup((x) => (x < 150 ? "control" : "body"));
        send("pointerdown", 1, 100, 100);
        // A control's finger is the control's
        expect(gestures.owned()).toEqual([]);
        send("pointerdown", 2, 200, 100);
        // Taken from its control by the second finger, it's the adapter's too
        expect(gestures.owned()).toEqual([1, 2]);
        send("pointerup", 1, 100, 100);
        send("pointerup", 2, 200, 100);
        send("pointerdown", 3, 200, 100);
        expect(gestures.owned()).toEqual([3]);
    });

    it("drops nothing it isn't following", () => {
        const { gestures, navigate, env } = setup(() => "body");
        gestures.drop(7, 0);
        expect(navigate).not.toHaveBeenCalled();
        expect(env.tap).not.toHaveBeenCalled();
    });
});

/** A finger's pointer event in jsdom, which has no `PointerEvent` */
function fingerEvent(
    type: string,
    pointerId: number,
    clientX: number,
    clientY = 100,
    pointerType = "touch",
) {
    const event = new MouseEvent(type, { bubbles: true, clientX, clientY });
    Object.defineProperties(event, {
        pointerId: { value: pointerId },
        pointerType: { value: pointerType },
    });
    return event;
}

describe("attachTimelineGestures", () => {
    afterEach(() => {
        vi.useRealTimers();
        document.body.replaceChildren();
    });

    /** A viewport holding a control and bare track space, with pointer capture stubbed */
    function mount() {
        const viewport = document.createElement("div");
        const control = document.createElement("button");
        control.setAttribute("data-timeline-interactive", "true");
        const bare = document.createElement("div");
        viewport.append(control, bare);
        document.body.append(viewport);
        const held = new Set<number>();
        const capture = vi.fn((id: number) => void held.add(id));
        Object.assign(viewport, {
            setPointerCapture: capture,
            hasPointerCapture: (id: number) => held.has(id),
        });
        // What reaches the timeline's own handlers, past the adapter
        const reached: string[] = [];
        document.body.addEventListener("pointerdown", (event) =>
            reached.push(`down ${(event as PointerEvent).pointerId}`),
        );
        const cancelled: Element[] = [];
        document.body.addEventListener("pointercancel", (event) => {
            if (event.target instanceof Element) cancelled.push(event.target);
        });
        const detach = attachTimelineGestures(viewport, {
            region: (event) => (event.target === control ? "control" : "body"),
            view: () => ({ scrollLeft: 0, scrollTop: 0, pixelsPerBeat: 10 }),
            navigate: () => {},
            leadingInset: () => 0,
        });
        return { viewport, control, bare, capture, reached, cancelled, detach };
    }

    it("captures a panning finger, and the first finger once a second takes it", () => {
        const { control, bare, capture, reached, detach } = mount();
        bare.dispatchEvent(fingerEvent("pointerdown", 1, 50));
        expect(capture).toHaveBeenCalledWith(1);
        // Kept from the timeline's own handlers
        expect(reached).toEqual([]);
        bare.dispatchEvent(fingerEvent("pointerup", 1, 50));
        capture.mockClear();
        control.dispatchEvent(fingerEvent("pointerdown", 2, 50));
        expect(capture).not.toHaveBeenCalled();
        expect(reached).toEqual(["down 2"]);
        bare.dispatchEvent(fingerEvent("pointerdown", 3, 150));
        expect(capture.mock.calls.map(([id]) => id).sort()).toEqual([2, 3]);
        detach();
    });

    it("never takes a mouse's press", () => {
        const { bare, capture, reached, detach } = mount();
        bare.dispatchEvent(fingerEvent("pointerdown", 1, 50, 100, "mouse"));
        expect(capture).not.toHaveBeenCalled();
        expect(reached).toEqual(["down 1"]);
        detach();
    });

    it("forgets a finger that lifted outside the timeline", () => {
        vi.useFakeTimers();
        const { control, bare, reached, detach } = mount();
        control.dispatchEvent(fingerEvent("pointerdown", 1, 50));
        bare.dispatchEvent(fingerEvent("pointerdown", 2, 150));
        bare.dispatchEvent(fingerEvent("pointerup", 2, 150));
        // Finger 1 lifts over the field: the viewport never hears it
        document.body.dispatchEvent(fingerEvent("pointerup", 1, 900));
        vi.runAllTimers();
        reached.length = 0;
        control.dispatchEvent(fingerEvent("pointerdown", 3, 50));
        expect(reached).toEqual(["down 3"]);
        detach();
    });

    it("cancels on the element holding the capture when the pressed one went", () => {
        const { viewport, control, bare, cancelled, detach } = mount();
        const holder = document.createElement("div");
        viewport.append(holder);
        control.dispatchEvent(fingerEvent("pointerdown", 1, 50));
        holder.dispatchEvent(fingerEvent("gotpointercapture", 1, 50));
        // The control re-renders away mid-drag
        control.remove();
        bare.dispatchEvent(fingerEvent("pointerdown", 2, 150));
        expect(cancelled).toEqual([holder]);
        detach();
    });
});
