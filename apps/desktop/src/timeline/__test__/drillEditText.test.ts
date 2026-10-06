import { describe, expect, it } from "vitest";
import { TimelineWriteError } from "@/db-functions/timelineErrors";
import type { DrillImpact } from "@/db-functions/drillEdits";
import {
    clipText,
    impactLines,
    isBigStep,
    refusalText,
    spanText,
    stepText,
    tolgeeTranslate as t,
} from "../drillEditText";
import { timelineErrorMessage } from "../timelineErrorMessages";
import { flagMoveReadout } from "@/components/timeline/TimelinePageFlagHandles";

/** E10: count edits and their refusals are worded in pages, counts and clip names */

describe("drill edit words", () => {
    it("names spans in pages and counts", () => {
        expect(
            spanText(
                { startPage: "6", startCount: 3, endPage: "6", endCount: 9 },
                t,
            ),
        ).toBe("Pg 6 counts 3–9");
        expect(
            spanText(
                { startPage: "6", startCount: 3, endPage: "6", endCount: 3 },
                t,
            ),
        ).toBe("Pg 6 count 3");
        expect(
            spanText(
                { startPage: "12", startCount: 3, endPage: "14", endCount: 8 },
                t,
            ),
        ).toBe("Pg 12 ct 3 – Pg 14 ct 8");
    });

    it("names clips by page, name or marchers", () => {
        expect(clipText({ kind: "page", page: "6" }, t)).toBe("Pg 6’s move");
        expect(clipText({ kind: "named", name: "Rifle break" }, t)).toBe(
            "“Rifle break”",
        );
        expect(
            clipText(
                { kind: "marchers", marchers: ["R1", "R2", "R3"], total: 8 },
                t,
            ),
        ).toBe("the move of R1, R2, R3 and 5 more");
    });

    it("words step sizes as N to 5", () => {
        expect(stepText(8, t)).toBe("8 to 5");
        expect(stepText(6.04, t)).toBe("6 to 5");
        expect(stepText(Infinity, t)).toBe("hold");
    });

    it("a ripple refusal toasts the clip and where it is, not beats or timeline ids", () => {
        const error = new TimelineWriteError(
            "E-ARGS",
            "this change would leave the move over beats [212, 228) in timeline 14 with no beats; delete or shorten it first",
            [],
            {
                subject: {
                    reason: "noCounts",
                    clip: { kind: "named", name: "Rifle break" },
                    span: {
                        startPage: "13",
                        startCount: 1,
                        endPage: "13",
                        endCount: 8,
                    },
                    timelineId: 14,
                },
            },
        );
        const message = timelineErrorMessage(error);
        expect(message).toContain("“Rifle break” (Pg 13 counts 1–8)");
        expect(message).not.toMatch(/beats|timeline 14|\[/);
        expect(
            refusalText(
                {
                    reason: "overlap",
                    marcher: "B4",
                    clip: { kind: "page", page: "3" },
                    span: {
                        startPage: "3",
                        startCount: 1,
                        endPage: "4",
                        endCount: 2,
                    },
                },
                t,
            ),
        ).toBe(
            "B4 would have two moves at once around Pg 3 ct 1 – Pg 4 ct 2 (Pg 3’s move). Move one of them first.",
        );
    });

    it("lists losses first, then lengths, pages and a summary of shifts", () => {
        const impact: DrillImpact = {
            countsBefore: 96,
            countsAfter: 88,
            pages: [{ id: 2, nameBefore: "2", countsBefore: 8 }],
            renumbered: { from: "3", to: "2" },
            moves: [
                {
                    timelineId: 9,
                    clip: { kind: "page", page: "1" },
                    pageMove: true,
                    change: "squeezed",
                    countsBefore: 8,
                    countsAfter: 6,
                    stepBefore: 8,
                    stepAfter: 6,
                },
                {
                    timelineId: 7,
                    clip: { kind: "named", name: "Rifle break" },
                    pageMove: false,
                    change: "deleted",
                    before: {
                        startPage: "2",
                        startCount: 3,
                        endPage: "2",
                        endCount: 4,
                    },
                    note: "onlyInCut",
                },
                ...[3, 4].map((id) => ({
                    timelineId: id,
                    clip: { kind: "page" as const, page: String(id) },
                    pageMove: true,
                    change: "shifted" as const,
                    shiftBy: -8,
                })),
            ],
            timing: [],
        };
        expect(impactLines(impact, t).map((l) => l.text)).toEqual([
            "“Rifle break” (Pg 2 counts 3–4) is only in these counts and is deleted with them",
            "Pg 1’s move: squeezed from 8 to 6 counts, same set · largest step 8 to 5 → 6 to 5",
            "Pg 2 goes: all of its counts are cut",
            "Later pages renumber: Pg 3 becomes Pg 2",
            "2 later moves move 8 counts earlier, unchanged",
            "Show: 96 → 88 counts",
        ]);
    });

    it("flags big steps and big tempo changes as warnings", () => {
        expect(isBigStep(8, 6)).toBe(false);
        // Bigger than 5 to 5
        expect(isBigStep(6, 4.5)).toBe(true);
        // Half as long again, while bigger than 8 to 5
        expect(isBigStep(6.6, 4.2)).toBe(true);
        expect(isBigStep(8, 5.5)).toBe(false);
        expect(isBigStep(9, 5.5)).toBe(true);
        expect(isBigStep(undefined, 6)).toBe(false);
        const impact: DrillImpact = {
            countsBefore: 96,
            countsAfter: 80,
            pages: [],
            renumbered: null,
            moves: [
                {
                    timelineId: 1,
                    clip: { kind: "named", name: "Guard feature" },
                    pageMove: false,
                    change: "squeezed",
                    countsBefore: 24,
                    countsAfter: 8,
                    stepBefore: 6.6,
                    stepAfter: 2.2,
                },
            ],
            timing: [{ page: "11", bpmBefore: 120, bpmAfter: 40 }],
        };
        const lines = impactLines(impact, t);
        expect(lines[0]).toEqual({
            tone: "warning",
            text: "“Guard feature”: squeezed from 24 to 8 counts, same set · largest step 6.6 to 5 → 2.2 to 5 · big steps, check this move",
        });
        expect(lines.find((l) => l.text.includes("BPM"))?.tone).toBe("warning");
    });

    it("says which marks go or move and how measures renumber, as summary lines", () => {
        const impact: DrillImpact = {
            countsBefore: 384,
            countsAfter: 320,
            pages: [],
            renumbered: null,
            moves: [],
            timing: [],
            measures: {
                removed: { from: 41, to: 56 },
                added: null,
                renumbered: {
                    before: { from: 57, to: 96 },
                    after: { from: 41, to: 80 },
                },
            },
            marks: [
                { mark: "F", before: 41, after: 41, change: "moved" },
                { mark: "E", before: 45, change: "removed" },
                { mark: "G", before: 65, after: 49, change: "renumbered" },
            ],
        };
        expect(
            impactLines(impact, t)
                .filter((l) => l.summary)
                .map((l) => [l.tone, l.text]),
        ).toEqual([
            [
                "notice",
                "Rehearsal F (m41) moves to the first measure after the cut, now m41",
            ],
            ["loss", "Rehearsal E (m45) is removed"],
            ["notice", "Later measures renumber: m57–96 become m41–80"],
            ["plain", "Rehearsal marks: G m65 → m49"],
            ["plain", "Show: 384 → 320 counts"],
        ]);
    });

    it("reads out a flag drag as both pages' counts", () => {
        const pages = [
            { id: 0, label: "0", atBeat: 0, isInitial: true },
            { id: 1, label: "23", atBeat: 0, endBeat: 16, isInitial: false },
            { id: 2, label: "24", atBeat: 16, endBeat: 32, isInitial: false },
        ];
        expect(
            flagMoveReadout({ pages, pageId: 1, toBeat: 18, beatCount: 40 }),
        ).toBe("Pg 23: 16 → 18 counts · Pg 24: 16 → 14");
        expect(
            flagMoveReadout({ pages, pageId: 2, toBeat: 30, beatCount: 40 }),
        ).toBe("Pg 24: 16 → 14 counts");
    });
});
