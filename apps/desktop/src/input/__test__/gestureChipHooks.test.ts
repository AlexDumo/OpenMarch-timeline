import { afterEach, describe, expect, it, vi } from "vitest";
import { holdGesture } from "@/shapes/field/heldGesture";
import { NO_KEYS } from "../modifierRoles";
import { useGestureChipStore } from "../gestureChipStore";

afterEach(() => {
    useGestureChipStore.getState().clear();
});

describe("gesture chip in holdGesture", () => {
    it("shows on drag, updates on a role change, and clears on end", () => {
        const held = holdGesture(NO_KEYS, vi.fn(), [], false, {
            constrainWord: "equal spacings",
        });
        held.move({ ...NO_KEYS, shift: true }, null);
        expect(useGestureChipStore.getState().active).toBe(false);

        held.move({ ...NO_KEYS, shift: true }, { x: 3, y: 4 });
        expect(useGestureChipStore.getState()).toMatchObject({
            active: true,
            roles: { fine: true, constrain: false, fromCenter: false },
            constrainWord: "equal spacings",
        });

        window.dispatchEvent(
            new KeyboardEvent("keydown", {
                key: "Control",
                shiftKey: true,
                ctrlKey: true,
            }),
        );
        expect(useGestureChipStore.getState().roles).toEqual({
            fine: true,
            constrain: true,
            fromCenter: false,
        });

        held.end();
        expect(useGestureChipStore.getState().active).toBe(false);
    });
});
