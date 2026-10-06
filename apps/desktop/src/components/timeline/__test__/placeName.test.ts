import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
    formatPlace,
    musicAt,
    placeAt,
    placeName,
    spokenPlace,
    type PlaceMeasure,
    type PlacePage,
} from "../placeName";

// Pages 1–3 of 16 counts from line 0; page 1's flag is line 16
const PAGES: PlacePage[] = [
    { label: "1", start: 0, end: 16 },
    { label: "2", start: 16, end: 32 },
    { label: "3", start: 32, end: 48 },
];
// 4/4 measures from line 0; C is on m5's downbeat (line 16), D on m7's (line 24)
const MEASURES: PlaceMeasure[] = Array.from({ length: 12 }, (_, i) => ({
    at: i * 4,
    number: String(i + 1),
    rehearsalMark: i === 4 ? "C" : i === 6 ? "D" : null,
}));

describe("placeName (D6)", () => {
    it("names a flag as the end of its page and where the next starts", () => {
        expect(placeName(PAGES, 32)).toBe("end of Pg 2 · Pg 3 starts");
        expect(placeName(PAGES, 32, { style: "compact" })).toBe(
            "Pg 2 ct 16 → 3",
        );
    });

    it("puts the rehearsal letter on the flag's downbeat first", () => {
        expect(placeName(PAGES, 16, { measures: MEASURES })).toBe(
            "C · end of Pg 1 · Pg 2 starts",
        );
        expect(
            placeName(PAGES, 16, { measures: MEASURES, style: "compact" }),
        ).toBe("C · Pg 1 ct 16 → 2");
        // A page's own flagMark does when there are no measures to pass
        expect(
            placeName(
                [{ ...PAGES[0]!, flagMark: "C" }, PAGES[1]!, PAGES[2]!],
                16,
            ),
        ).toBe("C · end of Pg 1 · Pg 2 starts");
    });

    it("leaves a mark off inside a page: mid-page is unchanged", () => {
        expect(placeName(PAGES, 24, { measures: MEASURES })).toBe(
            "Pg 2 · ct 8/16",
        );
        expect(placeName(PAGES, 23, { style: "compact" })).toBe("Pg 2 ct 7");
    });

    it("names the last flag, the start, and past the end", () => {
        expect(placeName(PAGES, 48)).toBe("end of Pg 3");
        expect(placeName(PAGES, 48, { style: "compact" })).toBe("Pg 3 ct 16");
        expect(placeName(PAGES, 0)).toBe("the start");
        expect(placeName(PAGES, 52)).toBe("After pg 3 · +4");
        expect(placeName(PAGES, 52, { style: "compact" })).toBe("Pg 3 +4");
    });

    it("spells a place out for screen readers", () => {
        expect(spokenPlace(placeAt(PAGES, 16, MEASURES))).toBe(
            "Rehearsal C, end of page 1, count 16, page 2 starts",
        );
        expect(spokenPlace(placeAt(PAGES, 20))).toBe("Page 2, count 4 of 16");
    });

    it("names a beat by the music", () => {
        expect(musicAt(MEASURES, 19)).toBe("m5 beat 4");
        expect(musicAt(MEASURES, 16)).toBe("m5 beat 1");
        expect(musicAt([], 3)).toBeNull();
        expect(musicAt(MEASURES.slice(1), 2)).toBeNull();
    });

    it("says the same page and count in both styles, on every line", () => {
        fc.assert(
            fc.property(
                fc.array(fc.integer({ min: 1, max: 20 }), {
                    minLength: 1,
                    maxLength: 8,
                }),
                fc.nat({ max: 200 }),
                (lengths, line) => {
                    let start = 0;
                    const pages = lengths.map((length, i) => {
                        const page = {
                            label: String(i + 1),
                            start,
                            end: start + length,
                        };
                        start += length;
                        return page;
                    });
                    const place = placeAt(pages, line);
                    const full = formatPlace(place);
                    const compact = formatPlace(place, "compact");
                    if (place.kind === "count" || place.kind === "flag") {
                        expect(compact).toContain(
                            `Pg ${place.page} ct ${place.count}`,
                        );
                        expect(full).toContain(`Pg ${place.page}`);
                        const page = pages.find((p) => p.label === place.page)!;
                        expect(page.start + place.count).toBe(line);
                    }
                    if (place.kind === "flag")
                        expect(full.startsWith("end of Pg")).toBe(true);
                },
            ),
        );
    });
});
