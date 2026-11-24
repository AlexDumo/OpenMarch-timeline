/**
 * Why the band wears its preset though the venue names an imported uniform: the Assets view, the
 * uniform picker and the 3D View settings all ask `wornPackProblem`.
 */
import { describe, expect, it } from "vitest";
import { wornPackProblem } from "../wornPack";

const VALUE = `library:home@${"a".repeat(64)}`;
const PACK = { manifest: {} };

describe("wornPackProblem", () => {
    it("has nothing to say for a preset or a built-in", () => {
        expect(wornPackProblem(null, false, null)).toBeNull();
    });

    it("waits until it knows whether the show has the uniform", () => {
        expect(wornPackProblem(VALUE, undefined, null)).toBeNull();
    });

    it("says missing when the show doesn't have it, whatever the read says", () => {
        expect(wornPackProblem(VALUE, false, undefined)).toBe("missing");
        expect(wornPackProblem(VALUE, false, null)).toBe("missing");
    });

    it("says unreadable when the show has it but its file doesn't read", () => {
        expect(wornPackProblem(VALUE, true, null)).toBe("unreadable");
    });

    it("waits for the read, and is quiet once the pack reads", () => {
        expect(wornPackProblem(VALUE, true, undefined)).toBeNull();
        expect(wornPackProblem(VALUE, true, PACK)).toBeNull();
    });
});
