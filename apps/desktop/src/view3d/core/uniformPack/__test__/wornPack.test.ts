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

    it("says newer when the file was refused as made by a newer OpenMarch", () => {
        expect(wornPackProblem(VALUE, true, null, true)).toBe("newer");
        // a missing uniform is missing, and a pack that reads is fine
        expect(wornPackProblem(VALUE, false, null, true)).toBe("missing");
        expect(wornPackProblem(VALUE, true, PACK, true)).toBeNull();
    });

    it("says loadFailed when the read failed with nothing read, apart from a damaged file", () => {
        expect(wornPackProblem(VALUE, true, undefined, false, true)).toBe(
            "loadFailed",
        );
        // the list failed too: still the read's failure
        expect(wornPackProblem(VALUE, undefined, undefined, false, true)).toBe(
            "loadFailed",
        );
        // what is known wins: missing, damaged, newer, or a pack that reads
        expect(wornPackProblem(VALUE, false, undefined, false, true)).toBe(
            "missing",
        );
        expect(wornPackProblem(VALUE, true, null, false, true)).toBe(
            "unreadable",
        );
        expect(wornPackProblem(VALUE, true, null, true, true)).toBe("newer");
        expect(wornPackProblem(VALUE, true, PACK, false, true)).toBeNull();
        expect(
            wornPackProblem(null, undefined, undefined, false, true),
        ).toBeNull();
    });

    it("has nothing to say about the band's uniform when only the list failed", () => {
        // the list is unknown (failed), the uniform reads: the band wears it
        expect(wornPackProblem(VALUE, undefined, PACK)).toBeNull();
        // and while it's still being read
        expect(wornPackProblem(VALUE, undefined, undefined)).toBeNull();
    });

    it("waits for the read, and is quiet once the pack reads", () => {
        expect(wornPackProblem(VALUE, true, undefined)).toBeNull();
        expect(wornPackProblem(VALUE, true, PACK)).toBeNull();
    });
});
