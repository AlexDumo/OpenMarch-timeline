import { afterEach, describe, expect, it, vi } from "vitest";
import { cancelFieldPoint, requestFieldPoint } from "../fieldPointPick";
import { takeFieldPress } from "../takeFieldPress";

const press = (x: number, y: number) => ({
    field: { x, y },
    screen: { x: 0, y: 0 },
    button: 0,
    shift: false,
    alt: false,
    ctrl: false,
    meta: false,
});

afterEach(() => cancelFieldPoint());

describe("picking a field point", () => {
    it("gives the next press on the field to the asker, once", () => {
        const onPoint = vi.fn();
        requestFieldPoint(onPoint);
        expect(takeFieldPress(press(12, 34))).toBe(true);
        expect(onPoint).toHaveBeenCalledWith({ x: 12, y: 34 });
        // the next press is the editor's again
        expect(takeFieldPress(press(1, 2))).toBe(false);
        expect(onPoint).toHaveBeenCalledOnce();
    });

    it("leaves presses alone once cancelled", () => {
        const onPoint = vi.fn();
        requestFieldPoint(onPoint);
        cancelFieldPoint();
        expect(takeFieldPress(press(1, 2))).toBe(false);
        expect(onPoint).not.toHaveBeenCalled();
    });
});
