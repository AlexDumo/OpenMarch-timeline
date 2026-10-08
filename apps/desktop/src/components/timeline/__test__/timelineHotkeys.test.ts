import { afterEach, describe, expect, it } from "vitest";
import { isTimelineOwnKey, spaceStaysPlay } from "../timelineHotkeys";

/**
 * UI-14 round-2 review: on the timeline's move controls Enter and the arrows are theirs, never the
 * app's shortcuts; Space always plays, without pressing the focused control.
 */

afterEach(() => {
    document.body.innerHTML = "";
});

const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({
    key: k,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...mods,
});

describe("isTimelineOwnKey", () => {
    it("takes Enter, the arrows and WASD inside a move control, and nothing else", () => {
        document.body.innerHTML = `<section data-timeline-own-keys="true"><button id="in">Delete move</button></section><button id="out">Other</button>`;
        const inside = document.getElementById("in");
        const outside = document.getElementById("out");
        for (const k of ["Enter", "ArrowUp", "ArrowLeft", "w", "D"])
            expect(isTimelineOwnKey(key(k), inside)).toBe(true);
        // Space plays, and the app's other shortcuts still work there
        for (const k of [" ", "g", "Delete", "z"])
            expect(isTimelineOwnKey(key(k), inside)).toBe(false);
        // Ctrl+S, Cmd+A: shortcuts, not nudges
        expect(isTimelineOwnKey(key("s", { ctrlKey: true }), inside)).toBe(
            false,
        );
        expect(isTimelineOwnKey(key("a", { metaKey: true }), inside)).toBe(
            false,
        );
        // Elsewhere, the app keeps all of them
        expect(isTimelineOwnKey(key("Enter"), outside)).toBe(false);
        expect(isTimelineOwnKey(key("Enter"), null)).toBe(false);
    });
});

describe("spaceStaysPlay", () => {
    it("cancels Space's click on a control, but not typing in a field", () => {
        document.body.innerHTML = `<button id="b">x</button><input id="i" />`;
        const event = (target: Element, k = " ") => {
            let prevented = false;
            spaceStaysPlay({
                key: k,
                target,
                preventDefault: () => {
                    prevented = true;
                },
            });
            return prevented;
        };
        expect(event(document.getElementById("b")!)).toBe(true);
        expect(event(document.getElementById("i")!)).toBe(false);
        expect(event(document.getElementById("b")!, "Enter")).toBe(false);
    });
});
