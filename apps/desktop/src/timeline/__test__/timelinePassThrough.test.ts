import { describe, expect, it } from "vitest";
import {
    keepStopsLabel,
    moveName,
    narrowingFlag,
    passThroughMessage,
    type PassThroughTranslate,
} from "../timelinePassThrough";

/** Fills `{name}` placeholders in the English default, as Tolgee does without a translation. */
const english: PassThroughTranslate = (_key, defaultMessage, params = {}) =>
    defaultMessage.replace(/\{(\w+)\}/g, (_, name: string) => params[name]!);

// Each box is named after the page whose flag ends it (`pageFlags`); page 1 is home
const boxes = [
    { start: 0, end: 16, name: "2" },
    { start: 16, end: 32, name: "3" },
    { start: 32, end: 48, name: "4" },
];

const pass = (flags: number[], extra = {}) => ({
    range: { start: 4, end: 48 },
    marcherIds: [3, 4],
    labels: ["T3", "T4"],
    overridden: [],
    caughtUp: [],
    flags,
    ...extra,
});

describe("timeline pass-through messages (research/ownership/10, defined-coordinates 08)", () => {
    it("names a page's box by its page, and any other move by its beats", () => {
        expect(moveName({ start: 16, end: 32 }, boxes)).toBe("Page 3");
        expect(moveName({ start: 20, end: 32 }, boxes)).toBe(
            "the move over beats [20, 32)",
        );
    });

    it("narrows to the last flag strictly inside the range", () => {
        expect(narrowingFlag({ start: 0, end: 48 }, boxes)).toBe(32);
        expect(narrowingFlag({ start: 4, end: 40 }, boxes)).toBe(32);
        expect(narrowingFlag({ start: 16, end: 32 }, boxes)).toBeNull();
    });

    it("says which pages are no longer stops, without marcher names", () => {
        expect(passThroughMessage(pass([16]), boxes, english)).toBe(
            "Page 2 is no longer a stop",
        );
        expect(passThroughMessage(pass([16, 32]), boxes, english)).toBe(
            "Pages 2–3 are no longer stops",
        );
        // What catches up after the window is ordinary carry-forward, not a lost stop
        expect(
            passThroughMessage(
                pass([16, 32], { caughtUp: [{ start: 32, end: 48 }] }),
                boxes,
                english,
            ),
        ).toBe("Pages 2–3 are no longer stops");
        // A flag with no named page
        expect(passThroughMessage(pass([20]), boxes, english)).toBe(
            "The sets inside this move are no longer stops",
        );
    });

    it("labels the action by what it restores: every flag inside the drag", () => {
        expect(keepStopsLabel(pass([16]), boxes, english)).toBe(
            "Keep Page 2 as a stop",
        );
        expect(keepStopsLabel(pass([16, 32]), boxes, english)).toBe(
            "Keep Pages 2–3 as stops",
        );
        expect(keepStopsLabel(pass([20]), boxes, english)).toBe(
            "Keep them as stops",
        );
    });

    it("without a page flag, says what it moves through and what catches up", () => {
        const clips = pass([], {
            overridden: [
                { start: 0, end: 16 },
                { start: 16, end: 32 },
            ],
            caughtUp: [{ start: 32, end: 48 }],
        });
        expect(passThroughMessage(clips, boxes, english)).toBe(
            "Moves straight through Page 2 and Page 3, then catches up to Page 4's set",
        );
        expect(
            passThroughMessage({ ...clips, caughtUp: [] }, boxes, english),
        ).toBe("Moves straight through Page 2 and Page 3");
        expect(
            passThroughMessage({ ...clips, overridden: [] }, boxes, english),
        ).toBe("Catches up to Page 4's set by its end");
    });
});
