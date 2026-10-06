import { describe, expect, it } from "vitest";
import {
    RegisteredActionsEnum,
    RegisteredActionsObjects,
} from "@/utilities/RegisteredActionsHandler";
import { VIEW3D_PLAYBACK_ACTIONS } from "@/view3d/sync/protocol";
import { playbackActionForKey } from "../playback";

/** The `code` the editor's key handler maps back to each shortcut key. */
const codeForKey = (key: string) =>
    key === " " ? "Space" : `Key${key.toUpperCase()}`;

describe("3D View playback shortcuts", () => {
    it.each(VIEW3D_PLAYBACK_ACTIONS)(
        "%s is an editor action with the same shortcut",
        (action) => {
            expect(RegisteredActionsEnum[action]).toBe(action);
            const shortcut = RegisteredActionsObjects[action].keyboardShortcut!;
            expect(shortcut.control || shortcut.alt).toBe(false);
            expect(
                playbackActionForKey({
                    code: codeForKey(shortcut.key),
                    shiftKey: shortcut.shift,
                    ctrlKey: false,
                    metaKey: false,
                    altKey: false,
                }),
            ).toBe(action);
        },
    );
});
