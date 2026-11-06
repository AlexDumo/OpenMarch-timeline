import { describe, expect, it } from "vitest";
import { showCreditsFrom } from "../environment/brand";

describe("showCreditsFrom", () => {
    it("uses the show name, designer and client when set", () => {
        expect(
            showCreditsFrom(
                { projectName: " Fall ", designer: "Sam", client: "CHS" },
                "fall-v3",
            ),
        ).toEqual({ title: "Fall", designer: "Sam", client: "CHS" });
    });

    it("falls back to the file name and drops blank credits", () => {
        expect(
            showCreditsFrom(
                { projectName: "  ", designer: "", client: undefined },
                "fall-v3",
            ),
        ).toEqual({ title: "fall-v3" });
    });
});
