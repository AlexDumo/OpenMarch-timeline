import { describe, expect, it } from "vitest";
import { TRANSPORT_SHORTCUTS } from "../TimelinePrimitives";
import { RegisteredActionsObjects } from "@/utilities/RegisteredActionsHandler";

/**
 * The transport tooltips show the same shortcuts as the registered actions (UI-17).
 * `TimelinePrimitives` doesn't import the action registry; this test is the link.
 */
describe("transport shortcuts (UI-17)", () => {
    it("matches the registered playback and page shortcuts", () => {
        expect(TRANSPORT_SHORTCUTS.playFromHere).toBe(
            RegisteredActionsObjects.playPause.keyboardShortcut!.toString(),
        );
        expect(TRANSPORT_SHORTCUTS.playFromFlag).toBe(
            RegisteredActionsObjects.playFromStartFlag.keyboardShortcut!.toString(),
        );
        expect(TRANSPORT_SHORTCUTS.previousPage).toBe(
            RegisteredActionsObjects.previousPage.keyboardShortcut!.toString(),
        );
        expect(TRANSPORT_SHORTCUTS.nextPage).toBe(
            RegisteredActionsObjects.nextPage.keyboardShortcut!.toString(),
        );
    });
});
