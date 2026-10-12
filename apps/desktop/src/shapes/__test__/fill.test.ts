import { describe, expect, it } from "vitest";
import { xy } from "../geometry/vec";
import {
    autoEdgeCount,
    boxOutline,
    circleOutline,
    naturalFill,
    typicalNeighborDistance,
} from "../geometry/naturalFill";
import { fillKind, type FillParams } from "../kinds/fill";
import { previewSession } from "../session";
import { useShapeToolStore } from "../shapeToolStore";
import { circleToFill, fillToBlock } from "../draw/convert";
import type { ShapeContext } from "../types";

const STEP = 10;
const ctx: ShapeContext = { stepPx: STEP, snapPoint: (p) => p };
const nearest = (spots: { x: number; y: number }[]) =>
    spots.map((p, i) =>
        Math.min(
            ...spots
                .filter((_, j) => j !== i)
                .map((q) => Math.hypot(p.x - q.x, p.y - q.y)),
        ),
    );

describe("natural fill", () => {
    const circle = circleOutline(xy(0, 0), 100);

    it("puts every marcher in the circle, some on its edge, evenly apart", () => {
        const spots = naturalFill(circle, 64, undefined, 1);
        expect(spots).toHaveLength(64);
        const edge = autoEdgeCount(circle, 64);
        expect(edge).toBeGreaterThan(10);
        expect(edge).toBeLessThan(40);
        spots.forEach((p) =>
            expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(100 + 1e-6),
        );
        spots
            .slice(0, edge)
            .forEach((p) => expect(Math.hypot(p.x, p.y)).toBeCloseTo(100));
        // Even: nobody much closer to a neighbor than is typical
        const typical = typicalNeighborDistance(spots);
        expect(Math.min(...nearest(spots))).toBeGreaterThan(0.55 * typical);
    });

    it("isn't a grid: neighbor distances vary", () => {
        const d = nearest(naturalFill(circle, 64, undefined, 1));
        const mean = d.reduce((a, b) => a + b, 0) / d.length;
        const spreadOf = Math.sqrt(
            d.reduce((a, b) => a + (b - mean) ** 2, 0) / d.length,
        );
        expect(spreadOf / mean).toBeGreaterThan(0.02);
    });

    it("repeats a layout, and another layout number gives another", () => {
        const a = naturalFill(circle, 30, undefined, 3);
        expect(naturalFill(circle, 30, undefined, 3)).toEqual(a);
        expect(naturalFill(circle, 30, undefined, 4)).not.toEqual(a);
    });

    it("moves marchers a little, not a reshuffle, when the circle grows a little", () => {
        const a = naturalFill(circle, 40, 14, 2);
        const b = naturalFill(circleOutline(xy(0, 0), 105), 40, 14, 2);
        const moved = a.map((p, i) => Math.hypot(p.x - b[i]!.x, p.y - b[i]!.y));
        const typical = typicalNeighborDistance(a);
        // Most marchers stay within a spacing of where they were
        const stayed = moved.filter((d) => d < typical).length;
        expect(stayed / moved.length).toBeGreaterThan(0.75);
    });

    it("fills a box, with the edge count set by hand", () => {
        const box = boxOutline(xy(0, 0), 200, 100, 0);
        const spots = naturalFill(box, 20, 8, 1);
        expect(spots).toHaveLength(20);
        spots.forEach((p) => {
            expect(Math.abs(p.x)).toBeLessThanOrEqual(100 + 1e-6);
            expect(Math.abs(p.y)).toBeLessThanOrEqual(50 + 1e-6);
        });
    });

    it("puts a small band all on the edge", () => {
        expect(autoEdgeCount(circle, 6)).toBe(6);
    });
});

describe("the filled shape", () => {
    const base: FillParams = {
        outline: "circle",
        center: xy(0, 0),
        r: 80,
        width: 160,
        height: 160,
        rotation: 0,
        edge: 0,
        layout: 1,
    };

    it("reads its spacing and edge count", () => {
        const readouts = fillKind.readouts!(base, 40, ctx);
        expect(readouts[0]!.value).toMatch(/steps apart$/);
        expect(readouts[1]!.value).toMatch(/\(auto\)$/);
    });

    it("switches a circle to filled and a filled box to ranks and files, keeping where it is", () => {
        const fill = circleToFill({
            center: xy(5, 5),
            r: 50,
            start: 0,
            spacing: { mode: "fit" },
        });
        expect([fill.outline, fill.center, fill.r]).toEqual([
            "circle",
            xy(5, 5),
            50,
        ]);
        const block = fillToBlock(
            { ...base, outline: "box", width: 200, height: 100 },
            18,
            "grid",
        );
        expect(block.files).toBe(6);
        expect(block.center).toEqual(xy(0, 0));
    });

    it("opens through the store and converts in place", () => {
        const marchers = Array.from({ length: 12 }, (_, i) => ({
            id: i + 1,
            at: xy((i % 4) * 20, Math.floor(i / 4) * 20),
            drillRank: i,
        }));
        useShapeToolStore.setState({ session: null, last: null, past: [] });
        useShapeToolStore.getState().open("circle", marchers, ctx);
        const circle = useShapeToolStore.getState().session!;
        useShapeToolStore
            .getState()
            .convert("fill", circleToFill(circle.params as never), ctx);
        const filled = useShapeToolStore.getState().session!;
        expect(filled.kindId).toBe("fill");
        expect(previewSession(filled, ctx).slots).toHaveLength(12);
        useShapeToolStore.getState().undo();
        expect(useShapeToolStore.getState().session!.kindId).toBe("circle");
    });
});
