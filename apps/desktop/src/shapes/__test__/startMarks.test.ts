import { describe, expect, it } from "vitest";
import { startMarkStyle } from "../field/startMarks";

/** The lab's three looks for where an open shape's marchers start (#417), and the default */
describe("start mark style", () => {
    it("reads the lab version, rings by default", () => {
        expect(startMarkStyle(null)).toBe("rings");
        expect(startMarkStyle("rings")).toBe("rings");
        expect(startMarkStyle("ghost")).toBe("ghost");
        expect(startMarkStyle("ghost-labels")).toBe("ghost-labels");
        // Another test's version, or a typo
        expect(startMarkStyle("glide")).toBe("rings");
    });
});
