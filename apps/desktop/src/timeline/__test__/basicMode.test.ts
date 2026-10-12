import { describe, expect, it } from "vitest";
import {
    basicPageBox,
    neighborPageTarget,
    planCanvasEdit,
} from "../timelineCoordinateWrites";
import { basicEditSpot } from "@/components/timeline/TimelineIsolationBar";
import { describePages, withoutLockedMarchers } from "../basicLocks";

/** Basic mode's edit routing (UI-19, docs/timeline/research/basic-mode). */

const BOXES = [
    { start: 1, end: 9, name: "1" },
    { start: 9, end: 17, name: "2" },
];
const PAGES = [
    { id: 10, name: "0", beats: [{ index: 0 }] },
    {
        id: 11,
        name: "1",
        beats: Array.from({ length: 8 }, (_, i) => ({ index: i + 1 })),
    },
    {
        id: 12,
        name: "2",
        beats: Array.from({ length: 8 }, (_, i) => ({ index: i + 9 })),
    },
];

describe("planCanvasEdit in Basic", () => {
    const state = (end: number) => ({
        selection: { kind: "range" as const, start: 9, end },
        isolation: null,
        pageBoxes: BOXES,
    });

    it("edits at the playhead inside its page box (mid-page)", () => {
        expect(planCanvasEdit(state(13), true)).toEqual({
            ok: true,
            target: { kind: "point", beat: 13, box: { start: 9, end: 17 } },
            beat: 13,
        });
    });

    it("a page's flag edits that page, not the next", () => {
        expect(planCanvasEdit(state(9), true)).toMatchObject({
            target: { kind: "point", beat: 9, box: { start: 1, end: 9 } },
        });
    });

    it("Expert keeps the window", () => {
        expect(planCanvasEdit(state(13), false)).toMatchObject({
            target: { kind: "range", start: 9, end: 13 },
        });
    });

    it("home stays home", () => {
        expect(
            planCanvasEdit(
                {
                    selection: { kind: "home" },
                    isolation: null,
                    pageBoxes: BOXES,
                },
                true,
            ),
        ).toMatchObject({ target: { kind: "home" } });
    });

    it("falls back to the window before the boxes load", () => {
        expect(
            planCanvasEdit({ ...state(13), pageBoxes: [] }, true),
        ).toMatchObject({ target: { kind: "range" } });
    });
});

describe("basicPageBox", () => {
    it("is the box holding the beat, or ending on it", () => {
        expect(basicPageBox({ pageBoxes: BOXES }, 1)).toBeNull();
        expect(basicPageBox({ pageBoxes: BOXES }, 2)).toEqual({
            start: 1,
            end: 9,
        });
        expect(basicPageBox({ pageBoxes: BOXES }, 17)).toEqual({
            start: 9,
            end: 17,
        });
        expect(basicPageBox({ pageBoxes: BOXES }, 18)).toBeNull();
    });
});

describe("neighborPageTarget in Basic", () => {
    it("writes on the page's flag inside its box", () => {
        const page = { id: 12, previousPageId: 11, beats: PAGES[2]!.beats };
        expect(neighborPageTarget(page as never, true)).toEqual({
            kind: "point",
            beat: 17,
            box: { start: 9, end: 17 },
        });
        expect(neighborPageTarget(page as never, false)).toEqual({
            kind: "range",
            start: 9,
            end: 17,
        });
    });
});

describe("the field line in Basic", () => {
    it("names the page on a flag, and the count inside a page", () => {
        expect(basicEditSpot(17, PAGES)).toEqual({
            pageName: "2",
            count: null,
        });
        expect(basicEditSpot(13, PAGES)).toEqual({ pageName: "2", count: 4 });
        expect(basicEditSpot(40, PAGES)).toBeNull();
    });
});

describe("withoutLockedMarchers", () => {
    const locks = {
        boxes: BOXES,
        locked: new Map([[1, new Map([[2, "crossesFlag" as const]])]]),
    };
    const moves = [{ marcherId: 1 }, { marcherId: 2 }, { marcherId: 3 }];

    it("drops marchers locked on the edited box", () => {
        expect(
            withoutLockedMarchers(
                { kind: "point", beat: 13, box: { start: 9, end: 17 } },
                moves,
                locks,
            ),
        ).toEqual({ moves: [{ marcherId: 1 }, { marcherId: 3 }], locked: [2] });
    });

    it("leaves other boxes and Expert targets alone", () => {
        expect(
            withoutLockedMarchers(
                { kind: "point", beat: 5, box: { start: 1, end: 9 } },
                moves,
                locks,
            ).locked,
        ).toEqual([]);
        expect(
            withoutLockedMarchers(
                { kind: "range", start: 9, end: 17 },
                moves,
                locks,
            ).locked,
        ).toEqual([]);
    });

    it("describes pages", () => {
        expect(describePages(["4"])).toBe("Page 4");
        expect(describePages(["4", "5", "9"])).toBe("Pages 4, 5 and 9");
    });
});

describe("planCanvasEdit with simple defaults (study flag)", () => {
    const state = (start: number, end: number, startPinned = false) => ({
        selection: { kind: "range" as const, start, end },
        isolation: null,
        pageBoxes: BOXES,
        startPinned,
    });

    it("an unpinned edit mid-page is a point edit that windows the others", () => {
        expect(planCanvasEdit(state(9, 13), false, true)).toEqual({
            ok: true,
            target: {
                kind: "point",
                beat: 13,
                box: { start: 9, end: 17 },
                others: "window",
            },
            beat: 13,
        });
    });

    it("a pinned start flag keeps the window", () => {
        expect(planCanvasEdit(state(5, 13, true), false, true)).toMatchObject({
            target: { kind: "range", start: 5, end: 13 },
        });
    });

    it("flag off: the window as before", () => {
        expect(planCanvasEdit(state(9, 13), false, false)).toMatchObject({
            target: { kind: "range", start: 9, end: 13 },
        });
    });
});
