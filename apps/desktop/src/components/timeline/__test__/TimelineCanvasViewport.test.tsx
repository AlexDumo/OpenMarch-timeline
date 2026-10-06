import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimelineGridCanvas } from "../TimelineCanvas";

/** A scroller `width` CSS pixels wide; `width.value` can change later */
const makeViewport = (initial: number) => {
    const viewport = document.createElement("div");
    const width = { value: initial };
    Object.defineProperty(viewport, "clientWidth", {
        configurable: true,
        get: () => width.value,
    });
    document.body.appendChild(viewport);
    return { viewport, width, ref: { current: viewport } };
};

/** The layer span the canvas was last drawn for, in CSS pixels */
const drawnSpan = (container: HTMLElement) => {
    const canvas = container.querySelector("canvas")!;
    return {
        left: parseFloat(canvas.style.left),
        right: parseFloat(canvas.style.left) + parseFloat(canvas.style.width),
        pixelWidth: canvas.width,
        cssWidth: parseFloat(canvas.style.width),
    };
};

const flushMicrotasks = () => act(async () => {});

let observers: { callback: ResizeObserverCallback }[] = [];
class FakeResizeObserver {
    constructor(public callback: ResizeObserverCallback) {
        observers.push(this);
    }
    observe() {}
    unobserve() {}
    disconnect() {
        observers = observers.filter((o) => o !== this);
    }
}

let ratio = 1;
let mediaListeners: (() => void)[] = [];

beforeEach(() => {
    observers = [];
    mediaListeners = [];
    ratio = 1;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    Object.defineProperty(window, "devicePixelRatio", {
        configurable: true,
        get: () => ratio,
    });
    vi.stubGlobal("matchMedia", (query: string) => ({
        matches: query.includes(`${ratio}dppx`),
        media: query,
        addEventListener: (_: string, listener: () => void) =>
            mediaListeners.push(listener),
        removeEventListener: (_: string, listener: () => void) => {
            mediaListeners = mediaListeners.filter((l) => l !== listener);
        },
        addListener: (listener: () => void) => mediaListeners.push(listener),
        removeListener: (listener: () => void) => {
            mediaListeners = mediaListeners.filter((l) => l !== listener);
        },
    }));
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
});

const grid = (ref: { current: HTMLElement }) => (
    <TimelineGridCanvas
        width={20_000}
        height={20}
        pixelsPerBeat={20}
        viewportRef={ref}
        measures={[]}
    />
);

describe("timeline viewport canvases", () => {
    it("redraws before a scroll reaches the edge of the drawn window", async () => {
        const { viewport, ref } = makeViewport(1000);
        const { container } = render(grid(ref));
        await flushMicrotasks();
        const first = drawnSpan(container);
        expect(first.left).toBe(0);
        // The view now ends 8 px short of the drawn window's right edge: a frame of edge-scroll
        // lag would show a blank strip there
        viewport.scrollLeft = first.right - 1000 - 8;
        act(() => {
            viewport.dispatchEvent(new Event("scroll"));
        });
        const next = drawnSpan(container);
        expect(next.left).toBeGreaterThan(0);
        expect(next.right - viewport.scrollLeft - 1000).toBeGreaterThan(250);
    });
});
