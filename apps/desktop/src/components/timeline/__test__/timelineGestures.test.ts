import { describe, expect, it, vi } from "vitest";
import {
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
