import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useViewportExtent } from "../useViewportExtent";

/** How wide a screen is (EC-9), against a viewport whose width the test sets */

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
const resize = (next: number) => {
    width = next;
    observers[0]!.callback([], observers[0] as unknown as ResizeObserver);
};

beforeEach(() => {
    observers = [];
    created = 0;
    width = 1000;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});
afterEach(() => vi.unstubAllGlobals());

describe("useViewportExtent", () => {
    it("reports the width once, and re-renders don't report again or make observers", () => {
        const onExtent = vi.fn();
        const { rerender } = renderHook(() =>
            useViewportExtent(viewportRef, onExtent),
        );
        expect(onExtent).toHaveBeenCalledTimes(1);
        expect(onExtent).toHaveBeenLastCalledWith({ width: 1000 });
        for (let frame = 0; frame < 6; frame++) rerender();
        expect(onExtent).toHaveBeenCalledTimes(1);
        expect(created).toBe(1);
    });

    it("reports a resize by a tenth or more, not a smaller one", () => {
        const onExtent = vi.fn();
        renderHook(() => useViewportExtent(viewportRef, onExtent));
        resize(2000);
        expect(onExtent).toHaveBeenLastCalledWith({ width: 2000 });
        resize(2050);
        expect(onExtent).toHaveBeenCalledTimes(2);
        resize(1500);
        expect(onExtent).toHaveBeenLastCalledWith({ width: 1500 });
    });
});
