import { afterEach, describe, expect, it } from "vitest";
import { useGestureChipStore } from "../gestureChipStore";
import { NO_KEYS } from "../modifierRoles";
import { rolesOf } from "../modifierRoles";

afterEach(() => {
    useGestureChipStore.getState().clear();
});

describe("gestureChipStore", () => {
    it("show, update and clear drive active, roles, constrainWord and screen", () => {
        const roles = rolesOf({ ...NO_KEYS, shift: true }, "field", {
            isMac: false,
        });
        expect(useGestureChipStore.getState().active).toBe(false);

        useGestureChipStore.getState().show({
            roles,
            constrainWord: "one axis",
            screen: { x: 10, y: 20 },
        });
        expect(useGestureChipStore.getState()).toMatchObject({
            active: true,
            roles,
            constrainWord: "one axis",
            screen: { x: 10, y: 20 },
        });

        const next = rolesOf({ ...NO_KEYS, ctrl: true }, "field", {
            isMac: false,
        });
        useGestureChipStore.getState().update({
            roles: next,
            screen: { x: 30, y: 40 },
        });
        expect(useGestureChipStore.getState()).toMatchObject({
            active: true,
            roles: next,
            constrainWord: "one axis",
            screen: { x: 30, y: 40 },
        });

        useGestureChipStore.getState().clear();
        expect(useGestureChipStore.getState().active).toBe(false);
        expect(useGestureChipStore.getState().screen).toBeUndefined();
    });
});
