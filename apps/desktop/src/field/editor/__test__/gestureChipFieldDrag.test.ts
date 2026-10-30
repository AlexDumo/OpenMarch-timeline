import { afterEach, describe, expect, it, vi } from "vitest";
import { startGestureKeys } from "@/input/gestureKeys";
import { NO_KEYS } from "@/input/modifierRoles";
import { useGestureChipStore } from "@/input/gestureChipStore";
import { FieldDrag } from "../fieldKeys";

afterEach(() => {
    useGestureChipStore.getState().clear();
});

describe("gesture chip in FieldDrag", () => {
    it("shows on move, updates on a role change, and clears on cancel", () => {
        const keys = (changed: (roles: typeof NO_KEYS) => void) =>
            startGestureKeys({
                context: "field",
                press: NO_KEYS,
                isMac: false,
                onRolesChange: changed,
            });
        const drag = new FieldDrag(
            keys,
            (_at, roles) => roles,
            vi.fn(),
            "one axis",
        );
        drag.move({
            field: { x: 0, y: 0 },
            screen: { x: 50, y: 60 },
            button: 0,
            ...NO_KEYS,
        });
        expect(useGestureChipStore.getState()).toMatchObject({
            active: true,
            constrainWord: "one axis",
            screen: { x: 50, y: 60 },
        });

        window.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Shift", shiftKey: true }),
        );
        expect(useGestureChipStore.getState().roles.fine).toBe(true);

        drag.cancel();
        expect(useGestureChipStore.getState().active).toBe(false);
    });
});
