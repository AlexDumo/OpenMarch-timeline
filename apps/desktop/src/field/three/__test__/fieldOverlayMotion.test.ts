import { afterEach, describe, expect, it, vi } from "vitest";
import { controlsStyle } from "../FieldOverlay";

/** The shape's controls fade away from the pointer (#403); with less motion they change at once */

const prefers = (reduce: boolean) =>
    vi.stubGlobal(
        "matchMedia",
        (query: string) =>
            ({
                matches: reduce && query === "(prefers-reduced-motion: reduce)",
            }) as MediaQueryList,
    );

afterEach(() => vi.unstubAllGlobals());

describe("the shape's controls fade", () => {
    it("eases in 150 ms", () => {
        prefers(false);
        expect(controlsStyle(true).transition).toBe("opacity 150ms ease-out");
    });

    it("is immediate for people who ask for less motion", () => {
        prefers(true);
        expect(controlsStyle(true)).toEqual({
            opacity: expect.any(Number),
        });
    });
});
