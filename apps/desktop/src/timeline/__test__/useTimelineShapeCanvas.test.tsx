import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { fabric } from "fabric";
import { DEFAULT_FIELD_THEME, type ShapeRow } from "@openmarch/core";
import TimelineShapeOverlay from "@/global/classes/canvasObjects/TimelineShapeOverlay";
import {
    useTimelineShapeCanvasStore,
    type TimelineShapeCanvasState,
} from "../timelineShapeCanvas";
import type { ShapeEditTarget } from "../timelineShapeEditor";
import {
    useTimelineShapeCanvas,
    type ShapeOverlayCanvas,
} from "../useTimelineShapeCanvas";

/**
 * P7.11: the picked spec shape on the canvas. The overlay draws it and its handles, redraws it
 * locally on every mouse move and commits once on release; the hook keeps the dragged shape while
 * the edit is pending and redraws from the editor's rows once it settles.
 */

const OFFSET = TimelineShapeOverlay.gridOffset;

const BOX: ShapeRow = {
    kind: "box",
    geometry: { origin: [10, 20], width: 80, height: 40 },
};
const MOVED: ShapeRow = {
    kind: "box",
    geometry: { origin: [10, 20], width: 100, height: 60 },
};
const BLOCK: ShapeRow = {
    kind: "block",
    geometry: { origin: [0, 0], rows: 2, cols: 2, spacing: [10, 10] },
};

const makeCanvas = () => {
    const canvas = new fabric.Canvas(null) as ShapeOverlayCanvas;
    canvas.fieldProperties = { theme: DEFAULT_FIELD_THEME };
    return canvas;
};

const target = (shape: ShapeRow, version = 1): ShapeEditTarget => ({
    id: 3,
    name: null,
    shape,
    version,
    usedBy: [],
    minCells: 0,
});

/** Drags a handle object to field point (x, y): every mouse move, then the release. */
const drag = (
    object: fabric.Object,
    moves: readonly (readonly [number, number])[],
    release = true,
) => {
    for (const [x, y] of moves) {
        object.set({ left: x + OFFSET, top: y + OFFSET });
        object.fire("moving", {});
    }
    if (release) object.fire("modified", {});
};

const outlineOf = (canvas: fabric.Canvas) =>
    canvas.getObjects().find((o) => o instanceof fabric.Polyline) as
        | fabric.Polyline
        | undefined;

const setStore = (state: Partial<TimelineShapeCanvasState>) =>
    act(() => {
        useTimelineShapeCanvasStore.setState(state);
    });

afterEach(() => {
    useTimelineShapeCanvasStore.setState({
        target: null,
        pending: false,
        commit: null,
    });
});

describe("TimelineShapeOverlay", () => {
    it("draws the outline, a block's cells and a handle per shapeHandles", () => {
        const canvas = makeCanvas();
        const overlay = new TimelineShapeOverlay(
            canvas,
            { shape: "red", handleFill: "white" },
            vi.fn(),
        );
        overlay.show(BLOCK, true);
        // outline + 4 cells + move and spacing handles
        expect(canvas.getObjects()).toHaveLength(7);
        expect(overlay.handleObjects).toHaveLength(2);
        overlay.show(BOX, false);
        expect(canvas.getObjects()).toHaveLength(1);
        expect(overlay.handleObjects).toHaveLength(0);
        overlay.clear();
        expect(canvas.getObjects()).toHaveLength(0);
        expect(overlay.shown).toBeNull();
    });

    it("redraws on every mouse move and commits once, on release", () => {
        const canvas = makeCanvas();
        const onCommit = vi.fn();
        const overlay = new TimelineShapeOverlay(
            canvas,
            { shape: "red", handleFill: "white" },
            onCommit,
        );
        overlay.show(BOX, true);
        const corner = overlay.handleObjects[1]!;
        const move = overlay.handleObjects[2]!;
        drag(
            corner,
            [
                [95, 65],
                [105, 75],
                [110, 80],
            ],
            false,
        );
        expect(onCommit).not.toHaveBeenCalled();
        expect(overlay.shown).toEqual(MOVED);
        // The move handle follows to the new middle; the outline's right edge moved
        expect(move.left).toBeCloseTo(60 + OFFSET, 9);
        expect(move.top).toBeCloseTo(50 + OFFSET, 9);
        const outline = outlineOf(canvas)!;
        expect(
            Math.max(...outline.points!.map((p) => p.x)) - OFFSET,
        ).toBeCloseTo(110, 9);
        corner.fire("modified", {});
        expect(onCommit).toHaveBeenCalledTimes(1);
        expect(onCommit).toHaveBeenCalledWith(MOVED);
    });

    it("a move handle drag commits the translated shape", () => {
        const canvas = makeCanvas();
        const onCommit = vi.fn();
        const overlay = new TimelineShapeOverlay(
            canvas,
            { shape: "red", handleFill: "white" },
            onCommit,
        );
        overlay.show(BOX, true);
        drag(overlay.handleObjects[2]!, [
            [55, 45],
            [60, 50],
        ]);
        expect(onCommit).toHaveBeenCalledTimes(1);
        expect(onCommit).toHaveBeenCalledWith({
            kind: "box",
            geometry: { origin: [20, 30], width: 80, height: 40 },
        });
    });

    it("handles that aren't interactive take no drags", () => {
        const canvas = makeCanvas();
        const overlay = new TimelineShapeOverlay(
            canvas,
            { shape: "red", handleFill: "white" },
            vi.fn(),
        );
        overlay.show(BOX, true);
        overlay.setInteractive(false);
        for (const handle of overlay.handleObjects) {
            expect(handle.evented).toBe(false);
            expect(handle.selectable).toBe(false);
        }
    });
});

describe("useTimelineShapeCanvas", () => {
    it("draws the picked shape with handles, and nothing in page mode or while playing", () => {
        const canvas = makeCanvas();
        setStore({ target: target(BOX), pending: false, commit: vi.fn() });
        const { rerender } = renderHook(
            (props: { enabled: boolean; isPlaying: boolean }) =>
                useTimelineShapeCanvas({ canvas, ...props }),
            { initialProps: { enabled: false, isPlaying: false } },
        );
        expect(canvas.getObjects()).toHaveLength(0);
        rerender({ enabled: true, isPlaying: false });
        expect(canvas.timelineShapeOverlay?.shown).toEqual(BOX);
        expect(canvas.timelineShapeOverlay?.handleObjects).toHaveLength(3);
        rerender({ enabled: true, isPlaying: true });
        expect(canvas.getObjects()).toHaveLength(0);
        expect(canvas.timelineShapeOverlay).toBeNull();
    });

    it("commits a drag through the editor once, keeps it while pending, then draws the editor's rows", () => {
        const canvas = makeCanvas();
        const commit = vi.fn();
        setStore({ target: target(BOX), pending: false, commit });
        renderHook(() =>
            useTimelineShapeCanvas({ canvas, enabled: true, isPlaying: false }),
        );
        const overlay = canvas.timelineShapeOverlay!;
        drag(overlay.handleObjects[1]!, [
            [100, 70],
            [110, 80],
        ]);
        expect(commit).toHaveBeenCalledTimes(1);
        expect(commit).toHaveBeenCalledWith(MOVED);
        // The editor is planning and writing: the dragged shape stays, and takes no drags
        setStore({ pending: true });
        expect(overlay.shown).toEqual(MOVED);
        expect(overlay.handleObjects[0]!.evented).toBe(false);
        // The edit's rows arrive
        setStore({ target: target(MOVED, 2), pending: false });
        expect(overlay.shown).toEqual(MOVED);
        expect(overlay.handleObjects[0]!.evented).not.toBe(false);
    });

    it("a refused drag snaps back to the editor's shape", () => {
        const canvas = makeCanvas();
        setStore({ target: target(BOX), pending: false, commit: vi.fn() });
        renderHook(() =>
            useTimelineShapeCanvas({ canvas, enabled: true, isPlaying: false }),
        );
        const overlay = canvas.timelineShapeOverlay!;
        drag(overlay.handleObjects[1]!, [[0, 0]]);
        setStore({ pending: true });
        // Refused: nothing was written, so the shown rows are the old ones
        setStore({ pending: false });
        expect(overlay.shown).toEqual(BOX);
    });

    it("doesn't commit while an edit is pending", () => {
        const canvas = makeCanvas();
        const commit = vi.fn();
        setStore({ target: target(BOX), pending: true, commit });
        renderHook(() =>
            useTimelineShapeCanvas({ canvas, enabled: true, isPlaying: false }),
        );
        const overlay = canvas.timelineShapeOverlay!;
        // Drawn while pending: no handles at all
        expect(overlay.handleObjects).toHaveLength(0);
        setStore({ pending: false });
        setStore({ pending: true });
        drag(overlay.handleObjects[1]!, [[100, 70]]);
        expect(commit).not.toHaveBeenCalled();
    });

    it("clears when the editor has no shape picked", () => {
        const canvas = makeCanvas();
        setStore({ target: target(BOX), pending: false, commit: vi.fn() });
        renderHook(() =>
            useTimelineShapeCanvas({ canvas, enabled: true, isPlaying: false }),
        );
        expect(canvas.getObjects().length).toBeGreaterThan(0);
        setStore({ target: null, commit: null });
        expect(canvas.getObjects()).toHaveLength(0);
    });
});
