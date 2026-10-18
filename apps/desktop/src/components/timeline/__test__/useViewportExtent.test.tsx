import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useViewportExtent } from "../useViewportExtent";

/** How many counts a screen holds (EC-9), against a viewport whose width the test sets */

let observers: { callback: ResizeObserverCallback }[] = [];
let created = 0;
class FakeResizeObserver {
    constructor(public callback: ResizeObserverCallback) {
        created++;
        observers.push(this);
    }
    observe() {}
    unobserve() {}
    disconnect() {
        observers = observers.filter((o) => o !== this);
    }
}

let width = 1000;
const viewport = document.createElement("div");
Object.defineProperty(viewport, "clientWidth", { get: () => width });
const viewportRef = { current: viewport };

beforeEach(() => {
    observers = [];
    created = 0;
    width = 1000;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});
afterEach(() => vi.unstubAllGlobals());

describe("useViewportExtent", () => {
    it("adds up a zoom gesture's small frames and reports once they change the answer by a tenth", () => {
        const onExtent = vi.fn();
        const { rerender } = renderHook(
            ({ ppb }) => useViewportExtent(viewportRef, ppb, onExtent),
            { initialProps: { ppb: 10 } },
        );
        expect(onExtent).toHaveBeenCalledTimes(1);
        expect(onExtent).toHaveBeenLastCalledWith({ screenBeats: 100 });
        // Each frame zooms in by 2%: under a tenth alone, but six of them add up past it
        let ppb = 10;
        for (let frame = 0; frame < 6; frame++) {
            ppb *= 1.02;
            rerender({ ppb });
        }
        expect(onExtent).toHaveBeenCalledTimes(2);
        expect(onExtent.mock.lastCall![0].screenBeats).toBeCloseTo(1000 / ppb);
        // The observer is made once, not on each zoom frame
        expect(created).toBe(1);
    });

    it("reports a resize at the current zoom", () => {
        const onExtent = vi.fn();
        const { rerender } = renderHook(
            ({ ppb }) => useViewportExtent(viewportRef, ppb, onExtent),
            { initialProps: { ppb: 10 } },
        );
        rerender({ ppb: 20 });
        expect(onExtent).toHaveBeenLastCalledWith({ screenBeats: 50 });
        width = 2000;
        observers[0]!.callback([], observers[0] as unknown as ResizeObserver);
        expect(onExtent).toHaveBeenLastCalledWith({ screenBeats: 100 });
        // A resize too small to matter isn't reported
        width = 2050;
        observers[0]!.callback([], observers[0] as unknown as ResizeObserver);
        expect(onExtent).toHaveBeenCalledTimes(3);
    });
});
