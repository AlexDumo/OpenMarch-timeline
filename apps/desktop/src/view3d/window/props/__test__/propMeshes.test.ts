import { describe, expect, it } from "vitest";
import type { ItemGeometry } from "@openmarch/core";
import type { PropSolid } from "@/view3d/core/props/propLayout";
import {
    FLOOR_PROP_Y,
    OPEN_PATH_THICKNESS,
    propGeometry,
    propMeshY,
    shapeKey,
    thickenPath,
} from "../propMeshes";

const geometry = {} as ItemGeometry;

const solid = (more: Partial<PropSolid> = {}): PropSolid => ({
    id: 1,
    surface: "platform",
    center: { x: 10, z: 5 },
    base: 0.4,
    height: 0.6,
    // 2 wide, 1 deep, toward the audience at +z
    outline: [
        { x: 9, z: 4.5 },
        { x: 11, z: 4.5 },
        { x: 11, z: 5.5 },
        { x: 9, z: 5.5 },
    ],
    closed: true,
    geometry,
    ...more,
});

const bounds = (s: PropSolid) => {
    const g = propGeometry(s);
    g.computeBoundingBox();
    return g.boundingBox!;
};

describe("propGeometry", () => {
    it("raises the Outline to the prop's height, around its center", () => {
        const box = bounds(solid());
        expect(box.min.x).toBeCloseTo(-1);
        expect(box.max.x).toBeCloseTo(1);
        expect(box.min.y).toBeCloseTo(0);
        expect(box.max.y).toBeCloseTo(0.6);
        expect(box.min.z).toBeCloseTo(-0.5);
        expect(box.max.z).toBeCloseTo(0.5);
    });

    it("keeps the Outline's side toward the audience at +z", () => {
        const box = bounds(
            solid({
                outline: [
                    { x: 9, z: 5 },
                    { x: 11, z: 5 },
                    { x: 10, z: 7 },
                ],
            }),
        );
        expect(box.min.z).toBeCloseTo(0);
        expect(box.max.z).toBeCloseTo(2);
    });

    it("lays a Floor prop flat", () => {
        const box = bounds(solid({ surface: "floor", height: 0 }));
        expect(box.min.y).toBeCloseTo(0);
        expect(box.max.y).toBeCloseTo(0);
    });

    it("stands an open path as a thin wall", () => {
        const box = bounds(
            solid({
                closed: false,
                outline: [
                    { x: 9, z: 5 },
                    { x: 11, z: 5 },
                ],
            }),
        );
        expect(box.max.x - box.min.x).toBeCloseTo(2);
        expect(box.max.z - box.min.z).toBeCloseTo(OPEN_PATH_THICKNESS);
    });
});

describe("thickenPath", () => {
    it("goes out one side and back the other", () => {
        const strip = thickenPath(
            [
                { x: 0, z: 0 },
                { x: 4, z: 0 },
            ],
            0.2,
        );
        expect(strip).toHaveLength(4);
        expect(strip.map((p) => p.x)).toEqual([0, 4, 4, 0]);
        expect(Math.abs(strip[0]!.z - strip[3]!.z)).toBeCloseTo(0.2);
    });
});

describe("propMeshY", () => {
    it("stands a prop on its base, and a Floor prop just over the field", () => {
        expect(propMeshY(solid())).toBe(0.4);
        expect(propMeshY(solid({ surface: "floor", base: 0 }))).toBe(
            FLOOR_PROP_Y,
        );
    });
});

describe("shapeKey", () => {
    it("ignores where the prop is, not its shape or height", () => {
        const moved = solid({
            center: { x: 20, z: 5 },
            outline: solid().outline.map((p) => ({ x: p.x + 10, z: p.z })),
        });
        expect(shapeKey(moved)).toBe(shapeKey(solid()));
        expect(shapeKey(solid({ height: 0.8 }))).not.toBe(shapeKey(solid()));
    });
});
