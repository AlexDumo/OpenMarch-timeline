import { describe, expect, it } from "vitest";
import { carriedOnto, sameParams } from "../placed/commitBox";
import type { PlacedBox } from "../placed/placedBox";
import type { CanvasEditPlan } from "@/timeline/timelineCoordinateWrites";

/** A box placed by a move ending at beat 16 (Page 1) */
const box = { endBeat: 16 } as PlacedBox;
const range = (start: number, end: number): CanvasEditPlan => ({
    ok: true,
    target: { kind: "range", start, end },
    beat: end,
});

describe("carriedOnto", () => {
    it("is true for a window wholly past the box's own move (the next page)", () => {
        expect(carriedOnto(range(16, 32), box)).toBe(true);
    });

    it("is false on the box's own page", () => {
        expect(carriedOnto(range(0, 16), box)).toBe(false);
    });

    it("is false for a window reaching back over the box's own move (Expert's start flag on Page 1)", () => {
        expect(carriedOnto(range(0, 32), box)).toBe(false);
        expect(carriedOnto(range(8, 32), box)).toBe(false);
    });

    it("reads Basic's page box, and is false for isolation (its writes set no one left in place)", () => {
        const point = (start: number, end: number): CanvasEditPlan => ({
            ok: true,
            target: { kind: "point", beat: end, box: { start, end } },
            beat: end,
        });
        expect(carriedOnto(point(16, 32), box)).toBe(true);
        expect(carriedOnto(point(0, 16), box)).toBe(false);
        const isolated = (end: number): CanvasEditPlan => ({
            ok: true,
            target: { kind: "timeline", timelineId: 1, ghosts: true },
            beat: end,
        });
        expect(carriedOnto(isolated(32), box)).toBe(false);
        expect(carriedOnto(isolated(16), box)).toBe(false);
    });

    it("is false for a box from homes edited at home, and for no plan", () => {
        const home = { endBeat: 0 } as PlacedBox;
        expect(
            carriedOnto({ ok: true, target: { kind: "home" }, beat: 0 }, home),
        ).toBe(false);
        expect(carriedOnto(range(0, 16), home)).toBe(true);
        expect(carriedOnto(range(0, 16), box)).toBe(false);
        expect(
            carriedOnto(
                { ok: false, error: new Error("not ready") as never },
                box,
            ),
        ).toBe(false);
    });
});

describe("sameParams", () => {
    it("ignores key order and keys set to undefined", () => {
        expect(
            sameParams(
                { center: { x: 1, y: 2 }, pivot: undefined, spots: 8 },
                { spots: 8, center: { y: 2, x: 1 } },
            ),
        ).toBe(true);
    });

    it("sees a changed pivot, a new key, and changed arrays", () => {
        expect(sameParams({ pivot: "nw" }, { pivot: "se" })).toBe(false);
        expect(sameParams({ spots: 8 }, { spots: 8, pivot: "nw" })).toBe(false);
        expect(sameParams({ gaps: [1, 2] }, { gaps: [1, 2, 3] })).toBe(false);
        expect(sameParams({ gaps: [1, 2] }, { gaps: { 0: 1, 1: 2 } })).toBe(
            false,
        );
    });
});
