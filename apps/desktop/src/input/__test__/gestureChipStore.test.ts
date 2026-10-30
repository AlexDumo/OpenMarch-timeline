import { afterEach, describe, expect, it } from "vitest";
import { useGestureChipStore, type HonoredRoles } from "../gestureChipStore";
import { clearGestureChip, syncGestureChip } from "../gestureChipSync";
import { NO_KEYS, rolesOf } from "../modifierRoles";

afterEach(() => {
    clearGestureChip();
});

const MOVE: HonoredRoles = {
    context: "field",
    fine: "fine",
    constrain: "oneAxis",
    snaps: true,
};

describe("gestureChipStore", () => {
    it("the first sync shows the gesture's honored roles, later ones follow its roles and pointer, and clear hides it", () => {
        const fine = rolesOf({ ...NO_KEYS, shift: true }, "field", {
            isMac: false,
        });
        expect(useGestureChipStore.getState().active).toBe(false);

        syncGestureChip(MOVE, fine, { x: 10, y: 20 });
        expect(useGestureChipStore.getState()).toMatchObject({
            active: true,
            honored: MOVE,
            roles: fine,
            screen: { x: 10, y: 20 },
        });

        const constrain = rolesOf({ ...NO_KEYS, ctrl: true }, "field", {
            isMac: false,
        });
        syncGestureChip(MOVE, constrain, { x: 30, y: 40 });
        expect(useGestureChipStore.getState()).toMatchObject({
            active: true,
            honored: MOVE,
            roles: constrain,
            screen: { x: 30, y: 40 },
        });

        clearGestureChip();
        expect(useGestureChipStore.getState().active).toBe(false);
        expect(useGestureChipStore.getState().screen).toBeUndefined();
    });

    it("keeps the same roles object while the roles don't change, so the chip doesn't render again", () => {
        syncGestureChip(
            MOVE,
            { fine: true, constrain: false, fromCenter: false },
            {
                x: 0,
                y: 0,
            },
        );
        const shown = useGestureChipStore.getState().roles;
        syncGestureChip(
            MOVE,
            { fine: true, constrain: false, fromCenter: false },
            {
                x: 5,
                y: 5,
            },
        );
        expect(useGestureChipStore.getState().roles).toBe(shown);
    });
});
