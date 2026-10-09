import { describe, expect, it } from "vitest";
import type { SpanInfo } from "@openmarch/core";
import {
    followingPages,
    nextPageToggle,
    pageChainWords,
    pageKeepStates,
    pagesText,
    type KeepPage,
} from "../timelineKeepLater";

/**
 * UI-18 keep later pages: the selection's keep state on each page box (follows after an earlier
 * move, kept), the pages that follow the current one, the chains' words, and what K does.
 *
 * Pages: home (1), page 2 [1, 9), page 3 [9, 17), page 4 [17, 25), page 5 [25, 33).
 */

const PAGES: KeepPage[] = [
    { id: 1, name: "1", flag: 0, range: null },
    { id: 2, name: "2", flag: 9, range: { start: 1, end: 9 } },
    { id: 3, name: "3", flag: 17, range: { start: 9, end: 17 } },
    { id: 4, name: "4", flag: 25, range: { start: 17, end: 25 } },
    { id: 5, name: "5", flag: 33, range: { start: 25, end: 33 } },
];

let nextId = 1;
const move = (marcherId: number, start: number, end: number, id?: number) =>
    ({
        marcherId,
        start,
        end,
        kind: "founding",
        assignmentId: id ?? nextId++,
        transitionId: null,
        slot: null,
    }) as SpanInfo;
const hold = (marcherId: number, start: number, end: number) =>
    ({
        marcherId,
        start,
        end,
        kind: "hold",
        assignmentId: null,
        transitionId: null,
        slot: null,
    }) as SpanInfo;

/**
 * 1 and 2 move on page 2 and hold after; 2 has a kept spot (assignment 100) on page 3; 3 moves on
 * page 2 and on page 4; 4 never moves.
 */
const SPANS: Record<number, SpanInfo[]> = {
    1: [hold(1, -Infinity, 1), move(1, 1, 9), hold(1, 9, Infinity)],
    2: [
        hold(2, -Infinity, 1),
        move(2, 1, 9),
        move(2, 9, 17, 100),
        hold(2, 17, Infinity),
    ],
    3: [
        hold(3, -Infinity, 1),
        move(3, 1, 9),
        hold(3, 9, 17),
        move(3, 17, 25),
        hold(3, 25, Infinity),
    ],
    4: [hold(4, -Infinity, Infinity)],
};
const KEPT = new Set([100]);

const states = (marcherIds: number[], kept: ReadonlySet<number> = KEPT) =>
    pageKeepStates({
        pages: PAGES,
        marcherIds,
        spansOf: (id) => SPANS[id] ?? [],
        kept,
    });

describe("pageKeepStates", () => {
    it("says who follows and who was kept on each box, and the page they follow", () => {
        const [p2, p3, p4, p5] = states([1, 2, 3, 4]);
        // Everyone moves on page 2 or never moved: nobody follows into it
        expect(p2).toMatchObject({ pageId: 2, follows: [], kept: [] });
        expect(p3).toMatchObject({
            pageId: 3,
            pageName: "3",
            box: { start: 9, end: 17 },
            follows: [1, 3],
            kept: [2],
            from: ["2"],
            selected: 4,
        });
        // 3 moves on page 4; 1 and 2 follow page 2 and the kept spot (page 3)
        expect(p4).toMatchObject({
            follows: [1, 2],
            kept: [],
            from: ["2", "3"],
        });
        expect(p5).toMatchObject({ follows: [1, 2, 3], from: ["2", "3", "4"] });
    });

    it("leaves out marchers that never moved: they hold from the start", () => {
        for (const s of states([4])) {
            expect(s.follows).toEqual([]);
            expect(s.kept).toEqual([]);
        }
    });

    it("an unmarked move that goes nowhere is the marcher's own, not kept", () => {
        const [, p3] = states([2], new Set());
        expect(p3).toMatchObject({ follows: [], kept: [] });
    });
});

describe("followingPages", () => {
    it("names the run of later pages that follow the current one", () => {
        expect(followingPages(states([1]), 2)).toEqual({
            names: ["3", "4", "5"],
            all: true,
        });
        // 3 follows into page 3 only; 1 into all of them
        expect(followingPages(states([1, 3]), 2)).toEqual({
            names: ["3", "4", "5"],
            all: false,
        });
    });

    it("stops a marcher at its kept spot or its own move", () => {
        expect(followingPages(states([2]), 2)).toBeNull();
        expect(followingPages(states([3]), 2)).toEqual({
            names: ["3"],
            all: true,
        });
    });

    it("is null on the last page or with nothing following", () => {
        expect(followingPages(states([1]), 5)).toBeNull();
        expect(followingPages(states([4]), 2)).toBeNull();
        expect(followingPages([], 2)).toBeNull();
    });

    it("from home, starts at the first box", () => {
        // Nobody follows into page 2 (they move there)
        expect(followingPages(states([1]), 1, 1)).toBeNull();
    });
});

describe("pageChainWords", () => {
    it("a linked chain names the count a click keeps and the page they stop following", () => {
        const [, , p4] = states([1, 2, 3]);
        expect(pageChainWords(p4!)).toMatchObject({
            kind: "follows",
            label: "Keep 2 marchers on Page 4",
            hint: "They won't follow earlier pages any more",
            action: "keep",
            marcherIds: [1, 2],
        });
        const [, one] = states([1]);
        expect(pageChainWords(one!)).toMatchObject({
            label: "Keep 1 marcher on Page 3",
            hint: "It won't follow Page 2 any more",
        });
        const [, two] = states([1, 3]);
        expect(pageChainWords(two!)).toMatchObject({
            label: "Keep 2 marchers on Page 3",
            hint: "They won't follow Page 2 any more",
        });
    });

    it("a kept chain names the count kept and offers to follow again", () => {
        const [, p3] = states([2]);
        expect(pageChainWords(p3!)).toMatchObject({
            kind: "kept",
            label: "1 marcher kept on Page 3",
            hint: "Click to follow Page 2 again",
            action: "follow",
            marcherIds: [2],
            keptCount: 1,
        });
    });

    it("a mixed chain counts the kept ones and a click keeps the rest", () => {
        const [, p3] = states([1, 2, 3]);
        expect(pageChainWords(p3!)).toMatchObject({
            kind: "mixed",
            label: "1 of 3 kept on Page 3",
            hint: "Click to keep the other 2 too",
            action: "keep",
            marcherIds: [1, 3],
            keptCount: 1,
        });
        const [, pair] = states([1, 2]);
        expect(pageChainWords(pair!)?.hint).toBe(
            "Click to keep the other one too",
        );
    });

    it("no chain where nobody follows or was kept", () => {
        const [p2] = states([1, 2, 3, 4]);
        expect(pageChainWords(p2!)).toBeNull();
    });
});

describe("nextPageToggle (K)", () => {
    it("keeps the followers on the next page, else lets the kept ones follow again", () => {
        expect(nextPageToggle(states([1, 2, 3]), 2, 1)).toEqual({
            action: "keep",
            box: { start: 9, end: 17 },
            marcherIds: [1, 3],
        });
        expect(nextPageToggle(states([2]), 2, 1)).toEqual({
            action: "follow",
            box: { start: 9, end: 17 },
            marcherIds: [2],
        });
    });

    it("does nothing on the last page, or where nobody follows or was kept", () => {
        expect(nextPageToggle(states([1]), 5, 1)).toBeNull();
        expect(nextPageToggle(states([3]), 3, 1)).toBeNull();
        expect(nextPageToggle(states([1]), 99, 1)).toBeNull();
    });
});

describe("pagesText", () => {
    it("names one page or a run", () => {
        expect(pagesText(["3"])).toBe("Page 3");
        expect(pagesText(["3", "4"])).toBe("Pages 3–4");
        expect(pagesText([])).toBe("");
    });
});
