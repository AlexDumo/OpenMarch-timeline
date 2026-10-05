import { describe, expect, it } from "vitest";
import {
    marcherList,
    moveName,
    narrowingFlag,
    narrowingLabel,
    passThroughMessage,
    type PassThroughTranslate,
} from "../timelinePassThrough";

/** Fills `{name}` placeholders in the English default, as Tolgee does without a translation. */
const english: PassThroughTranslate = (_key, defaultMessage, params = {}) =>
    defaultMessage.replace(/\{(\w+)\}/g, (_, name: string) => params[name]!);

const boxes = [
    { start: 0, end: 16, name: "1" },
    { start: 16, end: 32, name: "2" },
    { start: 32, end: 48, name: "3" },
];

describe("timeline pass-through messages (research/ownership/10)", () => {
    it("lists marchers, counting past four", () => {
        expect(marcherList(["T1"])).toBe("T1");
        expect(marcherList(["T1", "T2"])).toBe("T1 and T2");
        expect(marcherList(["T1", "T2", "T3", "T4"])).toBe("T1, T2, T3 and T4");
        expect(marcherList(["T1", "T2", "T3", "T4", "T5"])).toBe(
            "T1, T2, T3, T4 and 1 other",
        );
        expect(marcherList(["T1", "T2", "T3", "T4", "T5", "T6"])).toBe(
            "T1, T2, T3, T4 and 2 others",
        );
    });

    it("names a page's box by its page, and any other move by its beats", () => {
        expect(moveName({ start: 16, end: 32 }, boxes)).toBe("Page 2");
        expect(moveName({ start: 20, end: 32 }, boxes)).toBe(
            "the move over beats [20, 32)",
        );
    });

    it("narrows to the last flag strictly inside the range", () => {
        expect(narrowingFlag({ start: 0, end: 48 }, boxes)).toEqual({
            beat: 32,
            name: "3",
        });
        expect(narrowingFlag({ start: 4, end: 40 }, boxes)).toEqual({
            beat: 32,
            name: "3",
        });
        expect(narrowingFlag({ start: 16, end: 32 }, boxes)).toBeNull();
        expect(narrowingLabel({ beat: 32, name: "3" }, english)).toBe(
            "Only change Page 3",
        );
        expect(narrowingLabel({ beat: 32 }, english)).toBe(
            "Only change from beat 32",
        );
    });

    it("says what was passed through and what catches up", () => {
        const pass = {
            range: { start: 0, end: 40 },
            marcherIds: [3, 4],
            labels: ["T3", "T4"],
            overridden: [
                { start: 0, end: 16 },
                { start: 16, end: 32 },
            ],
            caughtUp: [{ start: 32, end: 48 }],
        };
        expect(passThroughMessage(pass, boxes, english)).toBe(
            "T3 and T4 now move straight through Page 1 and Page 2, then catch up to Page 3's set by its end.",
        );
        expect(
            passThroughMessage({ ...pass, caughtUp: [] }, boxes, english),
        ).toBe("T3 and T4 now move straight through Page 1 and Page 2.");
        expect(
            passThroughMessage({ ...pass, overridden: [] }, boxes, english),
        ).toBe("T3 and T4 now catch up to Page 3's set by its end.");
    });
});
