import { describe, expect, it } from "vitest";
import {
    keepPagePivots,
    pagePivotsOf,
    pivotAtBeat,
    pivotPageAt,
    withoutPagePivots,
    withPagePivot,
    type PivotPage,
} from "../pagePivot";

// Page 1 is home (beat 0); Pages 2–4 are the boxes between flags at 16, 32 and 48
const PAGES: readonly PivotPage[] = [
    { id: 2, start: 0, end: 16 },
    { id: 3, start: 16, end: 32 },
    { id: 4, start: 32, end: 48 },
];

describe("the page a pivot is saved for", () => {
    it("is the later page holding the beat, its flag included", () => {
        // A recipe on Page 2's move (ends at 16)
        expect(pivotPageAt(PAGES, 16, 32)).toBe(3);
        expect(pivotPageAt(PAGES, 16, 20)).toBe(3);
        expect(pivotPageAt(PAGES, 16, 48)).toBe(4);
    });

    it("is none on the recipe's own page, before it, or past the last flag", () => {
        expect(pivotPageAt(PAGES, 16, 16)).toBeNull();
        expect(pivotPageAt(PAGES, 16, 10)).toBeNull();
        expect(pivotPageAt(PAGES, 16, 60)).toBeNull();
        // A move ending inside a page owns the rest of it
        expect(pivotPageAt(PAGES, 20, 32)).toBeNull();
    });

    it("counts every page after the homes for a recipe on the homes", () => {
        expect(pivotPageAt(PAGES, 0, 16)).toBe(2);
        expect(pivotPageAt(PAGES, 0, 0)).toBeNull();
    });
});

describe("the pivot shown at a beat", () => {
    const params = { pivot: "nw", pagePivots: { "3": "se" } };

    it("is the recipe's own until a page with its own pivot", () => {
        expect(pivotAtBeat(params, PAGES, 16, 16)).toBe("nw");
        expect(pivotAtBeat(params, PAGES, 16, 32)).toBe("se");
    });

    it("carries forward to later pages without one", () => {
        expect(pivotAtBeat(params, PAGES, 16, 48)).toBe("se");
        expect(pivotAtBeat(params, PAGES, 16, 60)).toBe("se");
    });

    it("takes the latest earlier page's", () => {
        const both = { pivot: "nw", pagePivots: { "3": "se", "4": "e" } };
        expect(pivotAtBeat(both, PAGES, 16, 32)).toBe("se");
        expect(pivotAtBeat(both, PAGES, 16, 48)).toBe("e");
    });

    it("is the center when nothing is set", () => {
        expect(pivotAtBeat({}, PAGES, 16, 48)).toBe("c");
        // A page set back to the center overrides a recipe's own
        expect(
            pivotAtBeat(
                { pivot: "nw", pagePivots: { "3": "c" } },
                PAGES,
                16,
                32,
            ),
        ).toBe("c");
    });

    it("ignores pages at or before the recipe's own, gone pages and broken entries", () => {
        const odd = {
            pivot: "nw",
            pagePivots: { "2": "se", "99": "e", "4": { x: "no" } },
        };
        expect(pivotAtBeat(odd, PAGES, 16, 48)).toBe("nw");
        expect(pagePivotsOf(odd)).toEqual({ "2": "se", "99": "e" });
        expect(pagePivotsOf({ pagePivots: "x" })).toEqual({});
    });

    it("keeps a free pivot as stored", () => {
        const free = { x: 0.5, y: -1 };
        expect(
            pivotAtBeat({ pagePivots: { "3": free } }, PAGES, 16, 32),
        ).toEqual(free);
    });
});

describe("saving a page's pivot", () => {
    it("sets that page only, keeping the recipe's own and other pages'", () => {
        const stored = { across: 2, pivot: "nw", pagePivots: { "4": "e" } };
        // The editor's params: the page's pivot shown as the shape's
        const edited = { across: 2, pivot: "sw" };
        expect(withPagePivot(edited, stored, 3)).toEqual({
            across: 2,
            pivot: "nw",
            pagePivots: { "4": "e", "3": "sw" },
        });
    });

    it("stores the center explicitly, so it overrides the recipe's own", () => {
        const out = withPagePivot({ pivot: undefined }, { pivot: "nw" }, 3);
        expect(out.pagePivots).toEqual({ "3": "c" });
        expect(pivotAtBeat(out, PAGES, 16, 32)).toBe("c");
        expect(pivotAtBeat(out, PAGES, 16, 16)).toBe("nw");
    });

    it("keeps the stored page pivots through an edit on the recipe's own page", () => {
        const stored = { pivot: "nw", pagePivots: { "3": "se" } };
        expect(keepPagePivots(stored, { pivot: "n", across: 3 })).toEqual({
            pivot: "n",
            across: 3,
            pagePivots: { "3": "se" },
        });
        expect(keepPagePivots({}, { pivot: "n", pagePivots: {} })).toEqual({
            pivot: "n",
        });
        expect(withoutPagePivots(stored)).toEqual({ pivot: "nw" });
    });
});
