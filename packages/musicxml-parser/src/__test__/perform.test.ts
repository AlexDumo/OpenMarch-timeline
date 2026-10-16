import { describe, expect, it } from "vitest";
import { performanceOrder, type MeasureNavigation } from "../perform";

/** The order as 1-based written measure numbers, which reads like a score. */
const play = (navigation: MeasureNavigation[]) =>
    performanceOrder(navigation).order.map((m) => m.index + 1);

const plain = (n: number): MeasureNavigation[] =>
    Array.from({ length: n }, () => ({}));

/** `n` plain measures with the given measures (1-based) replaced. */
const nav = (n: number, at: Record<number, MeasureNavigation>) =>
    plain(n).map((m, i) => at[i + 1] ?? m);

const ending = (numbers: number[], start = true) => ({
    ending: { numbers, start },
});

describe("performanceOrder", () => {
    it("plays a score without repeats once, in order", () => {
        expect(play(plain(3))).toEqual([1, 2, 3]);
    });

    it("plays an empty score as nothing", () => {
        expect(play([])).toEqual([]);
    });

    it("repeats from the start when there is no forward repeat", () => {
        expect(play(nav(3, { 2: { backwardRepeat: { times: 2 } } }))).toEqual([
            1, 2, 1, 2, 3,
        ]);
    });

    it("repeats from the forward repeat", () => {
        expect(
            play(
                nav(4, {
                    2: { forwardRepeat: true },
                    3: { backwardRepeat: { times: 2 } },
                }),
            ),
        ).toEqual([1, 2, 3, 2, 3, 4]);
    });

    it("plays a section as often as `times` says", () => {
        expect(play(nav(2, { 1: { backwardRepeat: { times: 3 } } }))).toEqual([
            1, 1, 1, 2,
        ]);
    });

    it("plays a repeat that starts and ends in one measure", () => {
        expect(
            play(
                nav(3, {
                    2: { forwardRepeat: true, backwardRepeat: { times: 2 } },
                }),
            ),
        ).toEqual([1, 2, 2, 3]);
    });

    it("starts a second repeat without a forward repeat after the first one", () => {
        // ||: 1 2 :|| 3 4 :||  — the second repeat goes back to 3, not the start
        expect(
            play(
                nav(5, {
                    2: { backwardRepeat: { times: 2 } },
                    4: { backwardRepeat: { times: 2 } },
                }),
            ),
        ).toEqual([1, 2, 1, 2, 3, 4, 3, 4, 5]);
    });

    it("plays first and second endings", () => {
        // 1 ||: 2 |1. 3 :||2. 4 | 5
        expect(
            play(
                nav(5, {
                    2: { forwardRepeat: true },
                    3: { ...ending([1]), backwardRepeat: { times: 2 } },
                    4: ending([2]),
                }),
            ),
        ).toEqual([1, 2, 3, 2, 4, 5]);
    });

    it("plays an ending that spans several measures", () => {
        expect(
            play(
                nav(6, {
                    2: ending([1]),
                    3: { ...ending([1], false), backwardRepeat: { times: 2 } },
                    4: ending([2]),
                    5: ending([2], false),
                }),
            ),
        ).toEqual([1, 2, 3, 1, 4, 5, 6]);
    });

    it("plays an ending on every pass it lists", () => {
        // |1.2. 2 :||3. 3
        expect(
            play(
                nav(3, {
                    2: { ...ending([1, 2]), backwardRepeat: { times: 3 } },
                    3: ending([3]),
                }),
            ),
        ).toEqual([1, 2, 1, 2, 1, 3]);
    });

    it("plays a later ending that no repeat reaches, and says so", () => {
        // A first ending with its backward repeat missing
        const navigation = nav(3, { 2: ending([1]), 3: ending([2]) });
        expect(play(navigation)).toEqual([1, 2, 3]);
        expect(performanceOrder(navigation).issues).toEqual([
            { code: "unreachable-ending", index: 2, numbers: [2] },
        ]);
    });

    it("counts how many times each written measure is played", () => {
        const { order } = performanceOrder(
            nav(2, { 1: { backwardRepeat: { times: 2 } } }),
        );
        expect(order).toEqual([
            { index: 0, time: 1 },
            { index: 0, time: 2 },
            { index: 1, time: 1 },
        ]);
    });

    it("plays D.C. al Fine", () => {
        expect(
            play(nav(4, { 2: { fine: true }, 4: { daCapo: true } })),
        ).toEqual([1, 2, 3, 4, 1, 2]);
    });

    it("plays D.C. to the end when there is no Fine", () => {
        expect(play(nav(2, { 2: { daCapo: true } }))).toEqual([1, 2, 1, 2]);
    });

    it("plays D.S. al Coda", () => {
        // 1 | §2 | 3 To Coda | 4 D.S. | ⊕5 | 6
        expect(
            play(
                nav(6, {
                    2: { segno: "segno" },
                    3: { toCoda: "coda" },
                    4: { dalSegno: "segno" },
                    5: { coda: "coda" },
                }),
            ),
        ).toEqual([1, 2, 3, 4, 2, 3, 5, 6]);
    });

    it("ignores To Coda before the jump", () => {
        expect(
            play(nav(3, { 1: { toCoda: "coda" }, 3: { coda: "coda" } })),
        ).toEqual([1, 2, 3]);
    });

    it("goes to the segno with the right name", () => {
        expect(
            play(
                nav(4, {
                    1: { segno: "segno" },
                    2: { segno: "segno2" },
                    4: { dalSegno: "segno2" },
                }),
            ),
        ).toEqual([1, 2, 3, 4, 2, 3, 4]);
    });

    it("skips repeats after a jump and plays the last ending", () => {
        // ||: 1 |1. 2 :||2. 3 | 4 D.C.
        expect(
            play(
                nav(4, {
                    1: { forwardRepeat: true },
                    2: { ...ending([1]), backwardRepeat: { times: 2 } },
                    3: ending([2]),
                    4: { daCapo: true },
                }),
            ),
        ).toEqual([1, 2, 1, 3, 4, 1, 3, 4]);
    });

    it("ignores D.S. with no segno, and says so", () => {
        const navigation = nav(2, { 2: { dalSegno: "segno" } });
        expect(play(navigation)).toEqual([1, 2]);
        expect(performanceOrder(navigation).issues).toEqual([
            { code: "missing-segno", index: 1, name: "segno" },
        ]);
    });

    it("plays on past To Coda with no coda, and says so", () => {
        const navigation = nav(3, {
            1: { toCoda: "coda" },
            3: { daCapo: true },
        });
        expect(play(navigation)).toEqual([1, 2, 3, 1, 2, 3]);
        expect(performanceOrder(navigation).issues).toEqual([
            { code: "missing-coda", index: 0, name: "coda" },
        ]);
    });

    it("stops a file whose marks loop forever", () => {
        // A D.S. inside a repeat whose segno comes after it would not loop, but a huge
        // `times` would play for a long time; the limit stops it
        const { order, issues } = performanceOrder([
            { backwardRepeat: { times: 1000 } },
        ]);
        expect(order).toHaveLength(16);
        expect(issues).toEqual([{ code: "endless", index: 0, played: 16 }]);
    });

    it("doesn't repeat a section marked to play once", () => {
        expect(play(nav(2, { 1: { backwardRepeat: { times: 1 } } }))).toEqual([
            1, 2,
        ]);
    });

    it("repeats until every ending of the group has played", () => {
        // |1. 2 :|2. 3 :|3.5. 4 :|4. 5 :|6. 6 — LilyPond suite 45d, shortened
        expect(
            play(
                nav(7, {
                    2: { ...ending([1]), backwardRepeat: { times: 2 } },
                    3: { ...ending([2]), backwardRepeat: { times: 2 } },
                    4: { ...ending([3, 5]), backwardRepeat: { times: 2 } },
                    5: { ...ending([4]), backwardRepeat: { times: 2 } },
                    6: ending([6]),
                }),
            ),
        ).toEqual([1, 2, 1, 3, 1, 4, 1, 5, 1, 4, 1, 6, 7]);
    });

    it("plays a repeat nested in a first ending, then the outer repeat", () => {
        // 1 |1. ||:2:|| 3 :|2. ||:4:|| 5 — LilyPond suite 45i
        expect(
            play(
                nav(6, {
                    2: ending([1]),
                    3: {
                        ...ending([1], false),
                        forwardRepeat: true,
                        backwardRepeat: { times: 2 },
                    },
                    4: { ...ending([1], false), backwardRepeat: { times: 2 } },
                    5: {
                        ...ending([2]),
                        forwardRepeat: true,
                        backwardRepeat: { times: 2 },
                    },
                    6: ending([2], false),
                }),
            ),
        ).toEqual([1, 2, 3, 3, 4, 1, 5, 5, 6]);
    });

    it("starts a new section after an ending group", () => {
        // ||: 1 |1. 2 :||2. 3 | 4 :|| — the last repeat goes back to 4, not 1
        expect(
            play(
                nav(5, {
                    1: { forwardRepeat: true },
                    2: { ...ending([1]), backwardRepeat: { times: 2 } },
                    3: ending([2]),
                    4: { backwardRepeat: { times: 2 } },
                }),
            ),
        ).toEqual([1, 2, 1, 3, 4, 4, 5]);
    });

    it("repeats a first ending that has no second ending", () => {
        // 1 ||: 2 |1. 3 :|| 4
        expect(
            play(
                nav(4, {
                    2: { forwardRepeat: true },
                    3: { ...ending([1]), backwardRepeat: { times: 2 } },
                }),
            ),
        ).toEqual([1, 2, 3, 2, 4]);
    });
});
