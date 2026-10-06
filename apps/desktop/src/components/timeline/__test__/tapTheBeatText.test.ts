import { describe, expect, it } from "vitest";
import type { TapTheBeatPlan } from "@/timeline/tempo";
import {
    countLabel,
    musicPastCountsSentence,
    tapPlanSentence,
} from "../tapTheBeatText";

const page = (id: number, name: string, indexes: number[]) => ({
    id,
    name,
    beats: indexes.map((index) => ({ index })),
});
// Page 1 holds beat 0; page 2 counts 1–8; page 3 counts 9–16
const PAGES = [
    page(1, "1", [0]),
    page(2, "2", [1, 2, 3, 4, 5, 6, 7, 8]),
    page(3, "3", [9, 10, 11, 12, 13, 14, 15, 16]),
];

const plan = (over: Partial<TapTheBeatPlan>): TapTheBeatPlan => ({
    durations: [],
    originShift: 0,
    bpm: 131.6,
    fromCount: 1,
    tapped: { from: 1, to: 9 },
    heldFrom: null,
    unsynced: [],
    clamped: false,
    ...over,
});

describe("countLabel", () => {
    it("names counts by page", () => {
        expect(countLabel(PAGES, 1)).toBe("page 2, count 1");
        expect(countLabel(PAGES, 11)).toBe("page 3, count 3");
        expect(countLabel(PAGES, 40)).toBe("count 40");
    });
});

describe("tapPlanSentence", () => {
    it("says where count 1 lands in the music, before and after", () => {
        const p = plan({ originShift: 1.84 });
        expect(tapPlanSentence({ plan: p, pages: PAGES, applied: false })).toBe(
            "Count 1 will start at 0:01.84 in the music, and counts will run at about 132 per minute.",
        );
        expect(tapPlanSentence({ plan: p, pages: PAGES, applied: true })).toBe(
            "Count 1 is at 0:01.84 in the music, and counts run at about 132 per minute.",
        );
    });
    it("counts music time from an existing offset", () => {
        const p = plan({ originShift: 2 });
        expect(
            tapPlanSentence({
                plan: p,
                pages: PAGES,
                applied: false,
                audioOffsetSeconds: 0.5,
            }),
        ).toContain("0:01.50 in the music");
    });
    it("names the count tapping started from, and what stays put", () => {
        const text = tapPlanSentence({
            plan: plan({ fromCount: 11, heldFrom: 14, clamped: true }),
            pages: PAGES,
            applied: false,
        });
        expect(text).toContain("From page 3, count 3, counts will run");
        expect(text).toContain("Page 3, count 6 is synced");
        expect(text).toContain("kept within limits");
    });
});

describe("musicPastCountsSentence", () => {
    it("speaks up only when the music outlasts the counts by more than a count", () => {
        expect(musicPastCountsSentence(null, 10, 0.5)).toBeNull();
        expect(musicPastCountsSentence(10.3, 10, 0.5)).toBeNull();
        expect(musicPastCountsSentence(52, 10, 0.5)).toBe(
            "The music goes on for 0:42 after the last count.",
        );
    });
});
