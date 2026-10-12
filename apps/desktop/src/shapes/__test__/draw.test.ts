import { beforeEach, describe, expect, it } from "vitest";
import { dist, xy } from "../geometry/vec";
import type { BlockParams } from "../kinds/block";
import type { CircleParams } from "../kinds/circle";
import type { LineParams } from "../kinds/line";
import { paramsFromDrag } from "../draw/gestures";
import { previewSession } from "../session";
import { useShapeToolStore } from "../shapeToolStore";
import type { ShapeContext } from "../types";

const STEP = 10;
const ctx: ShapeContext = { stepPx: STEP, snapPoint: (p) => p };
const row = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
        id: i + 1,
        at: xy(i * 30, 0),
        drillRank: i,
    }));

describe("drawing gestures", () => {
    it("draws a line end to end and a circle from its center", () => {
        const line = paramsFromDrag(
            "line",
            { a: xy(0, 0), b: xy(1, 0), spacing: { mode: "fit" } },
            xy(10, 10),
            xy(90, 10),
            5,
        ) as LineParams;
        expect([line.a, line.b]).toEqual([xy(10, 10), xy(90, 10)]);
        const circle = paramsFromDrag(
            "circle",
            { center: xy(0, 0), r: 1, start: 0, spacing: { mode: "fit" } },
            xy(50, 50),
            xy(50, 90),
            8,
        ) as CircleParams;
        expect(circle.center).toEqual(xy(50, 50));
        expect(circle.r).toBeCloseTo(40);
    });

    it("draws a box corner to corner, splitting ranks and files to its shape", () => {
        const base: BlockParams = {
            center: xy(0, 0),
            rotation: 0,
            files: 3,
            across: 20,
            deep: 20,
            pattern: "grid",
            shortRank: "start",
            keepIntervals: false,
        };
        // 12 marchers in a box three times as wide as deep: 6 files, 2 ranks
        const box = paramsFromDrag(
            "block",
            base,
            xy(0, 0),
            xy(150, 50),
            12,
        ) as BlockParams;
        expect(box.files).toBe(6);
        expect(box.center).toEqual(xy(75, 25));
        expect(box.across).toBeCloseTo(30);
        expect(box.deep).toBeCloseTo(50);
    });

    it("ignores a press that doesn't move", () => {
        expect(
            paramsFromDrag("line", {}, xy(1, 1), xy(1, 1), 4),
        ).toBeUndefined();
    });
});

describe("drawing with the tool open", () => {
    beforeEach(() =>
        useShapeToolStore.setState({
            session: null,
            last: null,
            past: [],
            future: [],
            drawing: null,
            clicked: null,
            strokes: [],
        }),
    );

    it("redraws the open line where it's dragged, as one undo step, and keeps the stroke", () => {
        const store = useShapeToolStore.getState();
        store.open("line", row(5), ctx);
        expect(store.beginDraw(xy(0, 100))).toBe(true);
        useShapeToolStore.getState().drawTo(xy(50, 100), ctx);
        useShapeToolStore.getState().drawTo(xy(100, 100), ctx);
        useShapeToolStore.getState().endDraw();
        const state = useShapeToolStore.getState();
        const p = state.session!.params as LineParams;
        expect([p.a, p.b]).toEqual([xy(0, 100), xy(100, 100)]);
        // The spots now lie on the drawn line
        for (const slot of previewSession(state.session!, ctx).slots)
            expect(slot.y).toBeCloseTo(100);
        expect(state.strokes).toHaveLength(1);
        expect(state.strokes[0]!.samples.length).toBe(3);
        state.undo();
        expect(
            (useShapeToolStore.getState().session!.params as LineParams).a.y,
        ).not.toBe(100);
    });

    it("keeps a locked interval: the drag sets the direction, the run its length", () => {
        const store = useShapeToolStore.getState();
        store.open("line", row(5), ctx);
        const p = useShapeToolStore.getState().session!.params as LineParams;
        store.setParams(
            {
                ...p,
                spacing: {
                    mode: "interval",
                    runs: [{ steps: 2, count: 0 }],
                    anchor: "start",
                    size: "follow",
                },
            },
            ctx,
        );
        useShapeToolStore.getState().beginDraw(xy(0, 0));
        useShapeToolStore.getState().drawTo(xy(0, 500), ctx);
        useShapeToolStore.getState().endDraw();
        const q = useShapeToolStore.getState().session!.params as LineParams;
        expect(q.a).toEqual(xy(0, 0));
        // 4 gaps of 2 steps, straight down
        expect(dist(q.a, q.b)).toBeCloseTo(8 * STEP);
        expect(q.b.x).toBeCloseTo(0);
    });

    it("draws a curve through clicked points", () => {
        const store = useShapeToolStore.getState();
        store.open("curve", row(6), ctx);
        store.clickPoint(xy(0, 0), ctx);
        useShapeToolStore.getState().clickPoint(xy(100, 50), ctx);
        useShapeToolStore.getState().clickPoint(xy(200, 0), ctx);
        const points = (
            useShapeToolStore.getState().session!.params as {
                points: { x: number; y: number }[];
            }
        ).points;
        expect(points).toEqual([xy(0, 0), xy(100, 50), xy(200, 0)]);
        useShapeToolStore.getState().finishClicks();
        expect(useShapeToolStore.getState().clicked).toBeNull();
    });
});
