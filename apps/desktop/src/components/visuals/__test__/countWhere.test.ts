import { describe, expect, it } from "vitest";
import { countWords, pasteBeat } from "../countWhere";
import { countIndex } from "../visualsLanes";

// Beat 0 is the zero-length start; then 16 counted beats. Page 0 is home, page 1 runs to beat 9
// (8 counts), page 2 to beat 17 (8 counts)
const beats = [
    { id: 100, position: 0, duration: 0 },
    ...Array.from({ length: 16 }, (_, i) => ({
        id: 101 + i,
        position: i + 1,
        duration: 0.5,
    })),
];
const page = (id: number, name: string, from: number, to: number) => ({
    id,
    name,
    beats: Array.from({ length: to - from }, (_, i) => ({ index: from + i })),
});
const pages = [page(0, "0", 0, 1), page(1, "1", 1, 9), page(2, "2", 9, 17)];
const counts = countIndex(beats);

describe("countWords", () => {
    const where = countWords(beats, pages, counts);

    it("names a count as the transport names the playhead on its beat", () => {
        // count 1 is beat 2: the playhead there reads "Pg 1 · ct 1"
        expect(where(1)).toBe("Page 1 count 1");
        // count 8 is beat 9, page 1's flag
        expect(where(8)).toBe("Page 1 count 8");
        expect(where(9)).toBe("Page 2 count 1");
        expect(where(15)).toBe("Page 2 count 7");
    });

    it("calls the first click the start, where the transport says Home", () => {
        expect(where(0)).toBe("the start");
    });
});

describe("pasteBeat", () => {
    it("goes to a page's first count after its page box", () => {
        expect(pasteBeat(17, { kind: "range", start: 9, end: 17 }, pages)).toBe(
            10,
        );
    });

    it("stays on the playhead anywhere else", () => {
        // a window that isn't a page box
        expect(pasteBeat(12, { kind: "range", start: 9, end: 12 }, pages)).toBe(
            12,
        );
        // the playhead moved off the page box's end
        expect(pasteBeat(5, { kind: "range", start: 9, end: 17 }, pages)).toBe(
            5,
        );
        expect(pasteBeat(0, { kind: "home" }, pages)).toBe(0);
    });
});
