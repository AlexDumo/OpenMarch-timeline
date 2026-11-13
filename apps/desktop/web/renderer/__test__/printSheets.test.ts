import { describe, expect, it } from "vitest";
import { printTitle, supportsNativeMarginBoxes } from "../printSheets";

describe("supportsNativeMarginBoxes", () => {
    it("is true for Chromium 131 and later", () => {
        expect(
            supportsNativeMarginBoxes(
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
            ),
        ).toBe(true);
        expect(
            supportsNativeMarginBoxes(
                "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
            ),
        ).toBe(false);
    });
    it("is false for Safari, Firefox and Chrome on iPad (WebKit)", () => {
        expect(
            supportsNativeMarginBoxes(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
            ),
        ).toBe(false);
        expect(
            supportsNativeMarginBoxes(
                "Mozilla/5.0 (X11; Linux x86_64; rv:150.0) Gecko/20100101 Firefox/150.0",
            ),
        ).toBe(false);
        expect(
            supportsNativeMarginBoxes(
                "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1",
            ),
        ).toBe(false);
    });
});

describe("printTitle", () => {
    it("names the file after the show and the local date", () => {
        expect(printTitle("Fall Show", new Date(2026, 10, 12, 23, 30))).toBe(
            "Fall Show - coordinate sheets - 2026-11-12",
        );
        expect(printTitle("  ", new Date(2026, 0, 2))).toBe(
            "OpenMarch - coordinate sheets - 2026-01-02",
        );
    });
});
