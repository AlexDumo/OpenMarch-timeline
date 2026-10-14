import { describe, expect, it } from "vitest";
import { buildKeymap, normalizeOverrides } from "../keymap";
import { spacePlayKey, withSpacePlayKey } from "../playKeys";

/** Settings' Space while playing (docs/timeline/ui.md UI-22), kept as the play keys' bindings */
describe("the play keys (UI-22)", () => {
    it("Space stops by default, and Shift+Space pauses", () => {
        expect(spacePlayKey({})).toBe("stop");
        const keymap = buildKeymap({}, undefined, false);
        expect(
            keymap.filter((e) => e.binding.endsWith("Space")).map((e) => e.id),
        ).toEqual(expect.arrayContaining(["playStop", "playPause"]));
    });

    it("swaps the two bindings, and back to the defaults", () => {
        const swapped = withSpacePlayKey({ lockX: ["X"] }, "pause");
        expect(swapped).toEqual({
            lockX: ["X"],
            playStop: ["Shift+Space"],
            playPause: ["Space"],
        });
        expect(spacePlayKey(swapped)).toBe("pause");
        // Saved and loaded again, the swap stays
        expect(spacePlayKey(normalizeOverrides(swapped))).toBe("pause");
        const back = withSpacePlayKey(swapped, "stop");
        expect(back).toEqual({ lockX: ["X"] });
        expect(spacePlayKey(back)).toBe("stop");
    });

    it("reads Space as stopping when both or neither play action has it", () => {
        expect(spacePlayKey({ playPause: ["Space"] })).toBe("stop");
        expect(spacePlayKey({ playStop: ["K"], playPause: ["J"] })).toBe(
            "stop",
        );
    });
});
