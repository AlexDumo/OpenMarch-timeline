// @vitest-environment node
import { describe, expect, it } from "vitest";
import { anchorsClearOfPoints } from "../facingPoint";

describe("labels clear of facing points (#1316)", () => {
    // Three marchers: facing back (up the screen), side 2 (right), and a plain dot
    const positions = new Float64Array([10, 20, 30, 40, 50, 60]);
    const directions = new Float32Array([0, -1, 1, 0, 0, 0]);

    it("lifts a label above the dot by the point's reach up", () => {
        const out = anchorsClearOfPoints(
            positions,
            directions,
            false,
            new Float64Array(6),
        );
        expect([...out]).toEqual([10, 15.5, 30, 40, 50, 60]);
    });

    it("moves a label beside the dot right by the point's reach right", () => {
        const out = anchorsClearOfPoints(
            positions,
            directions,
            true,
            new Float64Array(6),
        );
        expect([...out]).toEqual([10, 20, 34.5, 40, 50, 60]);
    });
});
