import { describe, expect, it } from "vitest";
import type { SpanInfo } from "@openmarch/core";
import {
    followingPages,
    keepToggle,
    marcherNamesText,
    pageChainWords,
    pageKeepStates,
    pagesText,
    type KeepPage,
} from "../timelineKeepLater";

/**
 * UI-18 keep later pages: the selection's keep state on each page box (follows after an earlier
 * move or from the start, kept), the pages that follow the current one, the chains' words (by
 * name up to three), and what K does (on the current page where they hold, else the next).
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
        // 1–3 move on page 2; 4 never moved, so it follows the start
        expect(p2).toMatchObject({
            pageId: 2,
            follows: [4],
            fromStart: [4],
            kept: [],
            from: [],
        });
        expect(p3).toMatchObject({
            pageId: 3,
            pageName: "3",
            box: { start: 9, end: 17 },
            follows: [1, 3, 4],
            fromStart: [4],
            kept: [2],
            from: ["2"],
            selected: 4,
        });
        // 3 moves on page 4; 1 and 2 follow page 2 and the kept spot (page 3)
        expect(p4).toMatchObject({
            follows: [1, 2, 4],
            kept: [],
            from: ["2", "3"],
        });
        expect(p5).toMatchObject({
            follows: [1, 2, 3, 4],
            from: ["2", "3", "4"],
        });
    });

    it("marchers that never moved follow the start on every box, so they can be kept ahead of a move", () => {
        for (const s of states([4])) {
            expect(s.follows).toEqual([4]);
            expect(s.fromStart).toEqual([4]);
            expect(s.kept).toEqual([]);
            expect(s.from).toEqual([]);
        }
        // Kept there before any move: kept, not following
        const spans: SpanInfo[] = [
            hold(5, -Infinity, 9),
            move(5, 9, 17, 500),
            hold(5, 17, Infinity),
        ];
        const [p2, p3] = pageKeepStates({
            pages: PAGES,
            marcherIds: [5],
            spansOf: () => spans,
            kept: new Set([500]),
        });
        expect(p2).toMatchObject({ follows: [5], fromStart: [5] });
        expect(p3).toMatchObject({ follows: [], kept: [5] });
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
        expect(followingPages([], 2)).toBeNull();
    });

    it("leaves out marchers that haven't moved yet: every page follows them", () => {
        expect(followingPages(states([4]), 2)).toBeNull();
        expect(followingPages(states([4]), 1, 1)).toBeNull();
        // With one that moved, it says some
        expect(followingPages(states([1, 4]), 2)).toEqual({
            names: ["3", "4", "5"],
            all: false,
        });
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

    it("a mixed chain counts the kept ones of the selection and a click keeps the rest", () => {
        const [, p3] = states([1, 2, 3]);
        expect(pageChainWords(p3!)).toMatchObject({
            kind: "mixed",
            label: "1 of the 3 selected is kept on Page 3",
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
        const [p2] = states([1, 2, 3]);
        expect(pageChainWords(p2!)).toBeNull();
    });

    it("names up to three marchers, then two and a count", () => {
        const name = (id: number) => `OT${id}`;
        const [, , p4] = states([1, 2, 3]);
        expect(pageChainWords(p4!, undefined, name)?.label).toBe(
            "Keep OT1 and OT2 on Page 4",
        );
        const [, kept] = states([2]);
        expect(pageChainWords(kept!, undefined, name)?.label).toBe(
            "OT2 kept on Page 3",
        );
        const [, mixed] = states([1, 2, 3]);
        expect(pageChainWords(mixed!, undefined, name)?.label).toBe(
            "1 of the 3 selected is kept on Page 3 (OT2)",
        );
        // A marcher that never moved: the start is the earlier page
        const [p2] = states([4]);
        expect(pageChainWords(p2!, undefined, name)).toMatchObject({
            label: "Keep OT4 on Page 2",
            hint: "They won't follow earlier pages any more",
        });
    });

    it("lists two kept marchers in a mixed chain", () => {
        const spans = (id: number, keptId?: number): SpanInfo[] => [
            hold(id, -Infinity, 1),
            move(id, 1, 9),
            ...(keptId ? [move(id, 9, 17, keptId)] : []),
            hold(id, keptId ? 17 : 9, Infinity),
        ];
        const all: Record<number, SpanInfo[]> = {
            1: spans(1, 201),
            8: spans(8, 208),
            ...Object.fromEntries(
                [2, 3, 4, 5, 6, 7].map((id) => [id, spans(id)]),
            ),
        };
        const [, p3] = pageKeepStates({
            pages: PAGES,
            marcherIds: [1, 2, 3, 4, 5, 6, 7, 8],
            spansOf: (id) => all[id]!,
            kept: new Set([201, 208]),
        });
        expect(pageChainWords(p3!, undefined, (id) => `OT${id}`)).toMatchObject(
            {
                label: "2 of the 8 selected are kept on Page 3 (OT1, OT8)",
                hint: "Click to keep the other 6 too",
            },
        );
    });
});

describe("marcherNamesText", () => {
    const name = (id: number) => `OT${id}`;
    it("names one, two or three marchers in drill order", () => {
        expect(marcherNamesText([8], name)).toBe("OT8");
        expect(marcherNamesText([8, 1], name)).toBe("OT1 and OT8");
        expect(marcherNamesText([10, 2, 1], name)).toBe("OT1, OT2 and OT10");
    });

    it("past three, names two and counts the others", () => {
        expect(marcherNamesText([1, 2, 3, 4, 5, 6], name)).toBe(
            "OT1, OT2 and 4 others",
        );
    });

    it("is null without names, or with one unknown", () => {
        expect(marcherNamesText([1], undefined)).toBeNull();
        expect(
            marcherNamesText([1, 2], (id) => (id === 1 ? "OT1" : undefined)),
        ).toBeNull();
        expect(marcherNamesText([], name)).toBeNull();
    });
});

describe("keepToggle (K)", () => {
    it("where they hold on the current page, toggles keep there", () => {
        // On page 3, 1 and 3 follow page 2, 2 was kept: keep the ones that follow
        expect(keepToggle(states([1, 2, 3]), 3, 1)).toEqual({
            action: "keep",
            pageId: 3,
            box: { start: 9, end: 17 },
            marcherIds: [1, 3],
        });
        // All kept there: let them follow again
        expect(keepToggle(states([2]), 3, 1)).toEqual({
            action: "follow",
            pageId: 3,
            box: { start: 9, end: 17 },
            marcherIds: [2],
        });
    });

    it("where they move on the current page, toggles keep on the next page", () => {
        expect(keepToggle(states([1, 3]), 2, 1)).toEqual({
            action: "keep",
            pageId: 3,
            box: { start: 9, end: 17 },
            marcherIds: [1, 3],
        });
        expect(keepToggle(states([2]), 2, 1)).toEqual({
            action: "follow",
            pageId: 3,
            box: { start: 9, end: 17 },
            marcherIds: [2],
        });
        // From home, the first box
        expect(keepToggle(states([1]), 1, 1)).toBeNull();
        expect(keepToggle(states([4]), 1, 1)?.pageId).toBe(2);
    });

    it("a mix: acts on the current page, for those that hold there", () => {
        // On page 4, 3 moves and 1 follows: keep 1 on page 4, not page 5
        expect(keepToggle(states([1, 3]), 4, 1)).toEqual({
            action: "keep",
            pageId: 4,
            box: { start: 17, end: 25 },
            marcherIds: [1],
        });
    });

    it("keeps a marcher that never moved on the current page", () => {
        expect(keepToggle(states([4]), 3, 1)).toEqual({
            action: "keep",
            pageId: 3,
            box: { start: 9, end: 17 },
            marcherIds: [4],
        });
    });

    it("does nothing on the last page they move on, or an unknown page", () => {
        const last: SpanInfo[] = [hold(9, -Infinity, 25), move(9, 25, 33)];
        const onlyLast = pageKeepStates({
            pages: PAGES,
            marcherIds: [9],
            spansOf: () => last,
            kept: new Set(),
        });
        expect(keepToggle(onlyLast, 5, 1)).toBeNull();
        expect(keepToggle(states([3]), 99, 1)).toBeNull();
    });
});

describe("pagesText", () => {
    it("names one page or a run", () => {
        expect(pagesText(["3"])).toBe("Page 3");
        expect(pagesText(["3", "4"])).toBe("Pages 3–4");
        expect(pagesText([])).toBe("");
    });
});
