import { beforeAll, describe, expect, it } from "vitest";
import tolgee from "@/global/singletons/Tolgee";
import type { TapTheBeatPlan } from "@/timeline/tempo";
import {
    countLabel,
    musicPastCountsSentence,
    tapPlanSentence,
    type Translate,
} from "../tapTheBeatText";

beforeAll(async () => {
    await tolgee.run();
});
const t: Translate = (key, params) => tolgee.t(key, params);

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
        // As the transport reads them: a flag is the last count of the page it closes
        expect(countLabel(t, PAGES, 2)).toBe("Pg 2 ct 1");
        expect(countLabel(t, PAGES, 9)).toBe("Pg 2 ct 8");
        expect(countLabel(t, PAGES, 11)).toBe("Pg 3 ct 2");
        expect(countLabel(t, PAGES, 1)).toBe("the start");
        expect(countLabel(t, PAGES, 40)).toBe("count 40");
    });
});

describe("tapPlanSentence", () => {
    it("says where count 1 lands in the music, before and after", () => {
        const p = plan({ originShift: 1.84 });
        expect(
            tapPlanSentence({ t, plan: p, pages: PAGES, applied: false }),
        ).toBe(
            "Count 1 will start at 0:01.84 in the music, and counts will run at about 132 per minute.",
        );
        expect(
            tapPlanSentence({ t, plan: p, pages: PAGES, applied: true }),
        ).toBe(
            "Count 1 is at 0:01.84 in the music, and counts run at about 132 per minute.",
        );
    });
    it("counts music time from an existing offset", () => {
        const p = plan({ originShift: 2 });
        expect(
            tapPlanSentence({
                t,
                plan: p,
                pages: PAGES,
                applied: false,
                audioOffsetSeconds: 0.5,
            }),
        ).toContain("0:01.50 in the music");
    });
    it("names the count tapping started from, and what stays put", () => {
        const text = tapPlanSentence({
            t,
            plan: plan({ fromCount: 11, heldFrom: 14, clamped: true }),
            pages: PAGES,
            applied: false,
        });
        expect(text).toContain("From Pg 3 ct 2, counts will run");
        expect(text).toContain(
            "The synced count at Pg 3 ct 5 and everything after it stay on the music.",
        );
        expect(text).toContain("kept within limits");
    });
});

describe("musicPastCountsSentence", () => {
    it("speaks up only when the music outlasts the counts by more than a count", () => {
        expect(musicPastCountsSentence(t, null, 10, 0.5)).toBeNull();
        expect(musicPastCountsSentence(t, 10.3, 10, 0.5)).toBeNull();
        expect(musicPastCountsSentence(t, 52, 10, 0.5)).toBe(
            "The music goes on for 0:42 after the last count.",
        );
    });
});
