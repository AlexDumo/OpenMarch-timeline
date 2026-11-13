import { describe, expect, it } from "vitest";
import {
    FINGER_CLEARANCE,
    FINGER_SIDE_CLEARANCE,
    READOUT_EDGE,
    touchReadoutPlacement,
} from "../readoutPlacement";

/** Where a readout of a touch drag goes: clear of the finger, inside the field (tablet 1.7) */

const FIELD = { width: 800, height: 600 };
const PILL = { width: 120, height: 24 };

describe("touchReadoutPlacement", () => {
    it("centers the readout above the finger, its bottom clear of the fingertip", () => {
        expect(touchReadoutPlacement({ x: 400, y: 300 }, PILL, FIELD)).toEqual({
            left: 400 - PILL.width / 2,
            top: 300 - FINGER_CLEARANCE - PILL.height,
        });
    });

    it("keeps inside the field's left and right edges, still above the finger", () => {
        const top = 300 - FINGER_CLEARANCE - PILL.height;
        expect(touchReadoutPlacement({ x: 10, y: 300 }, PILL, FIELD)).toEqual({
            left: READOUT_EDGE,
            top,
        });
        expect(touchReadoutPlacement({ x: 795, y: 300 }, PILL, FIELD)).toEqual({
            left: FIELD.width - PILL.width - READOUT_EDGE,
            top,
        });
    });

    it("goes beside the finger near the top, where there's no room above it", () => {
        const placed = touchReadoutPlacement({ x: 400, y: 40 }, PILL, FIELD);
        expect(placed.left).toBe(400 + FINGER_SIDE_CLEARANCE);
        // Level with the fingertip, never under it
        expect(placed.top).toBe(40 - PILL.height / 2);
        expect(placed.left).toBeGreaterThan(400);
    });

    it("goes to the finger's left near the top right corner", () => {
        const placed = touchReadoutPlacement({ x: 780, y: 40 }, PILL, FIELD);
        expect(placed.left).toBe(780 - FINGER_SIDE_CLEARANCE - PILL.width);
        expect(placed.left + PILL.width).toBeLessThan(780);
    });

    it("never leaves the field, however small it is", () => {
        const tiny = { width: 100, height: 30 };
        const placed = touchReadoutPlacement({ x: 50, y: 15 }, PILL, tiny);
        expect(placed.left).toBe(READOUT_EDGE);
        expect(placed.top).toBe(READOUT_EDGE);
    });
});
