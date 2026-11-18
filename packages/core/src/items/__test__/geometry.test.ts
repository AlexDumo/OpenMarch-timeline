import { describe, expect, it } from "vitest";
import { itemGeometryAt, shortTurn, type GeometryChange } from "../geometry";

const change = (
    beat: number,
    patch: Partial<GeometryChange> = {},
): GeometryChange => ({
    beat,
    outlineType: "rectangle",
    width: 2,
    depth: 1,
    height: 0.5,
    rotation: 0,
    customOutline: null,
    transitionLength: 1,
    rollsOut: false,
    leadingEdge: null,
    ...patch,
});

describe("itemGeometryAt", () => {
    it("has no geometry with no changes", () => {
        expect(itemGeometryAt([], 4)).toBeNull();
    });

    it("is Off field before the first change, and on field from its count", () => {
        const changes = [change(8, { transitionLength: 4 })];
        expect(itemGeometryAt(changes, 7.99)).toBeNull();
        // The first change has nothing to ease from: it is in place on its count
        expect(itemGeometryAt(changes, 8)).toMatchObject({
            width: 2,
            progress: 1,
        });
    });

    it("takes the latest change at or before the count", () => {
        const changes = [change(0), change(10, { width: 6 })];
        expect(itemGeometryAt(changes, 9.5)?.width).toBe(2);
        expect(itemGeometryAt(changes, 10)?.width).toBe(6);
        expect(itemGeometryAt(changes, 40)?.width).toBe(6);
    });

    it("snaps on the click with a transition of 1", () => {
        const changes = [change(0), change(10, { width: 6 })];
        expect(itemGeometryAt(changes, 9.999)?.width).toBe(2);
        expect(itemGeometryAt(changes, 10)).toMatchObject({
            width: 6,
            progress: 1,
        });
    });

    it("eases in from the click of B - L + 1 to the click of B", () => {
        // Ends on 10, takes 5 counts: from the click of 6 to the click of 10
        const changes = [
            change(0, { width: 2, depth: 1, height: 0, rotation: 0 }),
            change(10, {
                width: 6,
                depth: 3,
                height: 1,
                rotation: 90,
                transitionLength: 5,
            }),
        ];
        expect(itemGeometryAt(changes, 6)).toMatchObject({
            width: 2,
            progress: 0,
        });
        // Halfway in time is halfway in size on a symmetric ease
        expect(itemGeometryAt(changes, 8)).toMatchObject({
            width: 4,
            depth: 2,
            height: 0.5,
            rotation: 45,
            progress: 0.5,
        });
        const early = itemGeometryAt(changes, 7)!;
        // Eased: slower than linear near the start
        expect(early.width).toBeGreaterThan(2);
        expect(early.width).toBeLessThan(3);
        expect(itemGeometryAt(changes, 10)).toMatchObject({
            width: 6,
            progress: 1,
        });
    });

    it("turns through the raw angle, so a full spin is drawn", () => {
        const changes = [
            change(0, { rotation: 0 }),
            change(4, { rotation: 360, transitionLength: 5 }),
        ];
        expect(itemGeometryAt(changes, 2)?.rotation).toBe(180);
    });

    it("switches outline type, custom outline and roll-out when the transition starts", () => {
        const points = { points: [{ x: 0, y: 0 }] };
        const changes = [
            change(0),
            change(10, {
                outlineType: "freehand",
                customOutline: points,
                rollsOut: true,
                leadingEdge: "front",
                transitionLength: 5,
            }),
        ];
        expect(itemGeometryAt(changes, 5.9)).toMatchObject({
            outlineType: "rectangle",
            rollsOut: false,
        });
        expect(itemGeometryAt(changes, 6)).toMatchObject({
            outlineType: "freehand",
            customOutline: points,
            rollsOut: true,
            leadingEdge: "front",
        });
    });

    it("eases from wherever the item is when a transition starts inside another", () => {
        const changes = [
            change(0, { width: 0.5 }),
            change(10, { width: 10.5, transitionLength: 11 }), // clicks 0 to 10
            change(12, { width: 0.5, transitionLength: 7 }), // clicks 6 to 12
        ];
        const at6 = itemGeometryAt(changes.slice(0, 2), 6)!.width;
        // At 6 the third change takes over, starting from the second's eased width there
        expect(itemGeometryAt(changes, 6)?.width).toBeCloseTo(at6);
        expect(itemGeometryAt(changes, 12)?.width).toBe(0.5);
    });

    it("doesn't depend on the order changes come in", () => {
        const changes = [change(10, { width: 6 }), change(0)];
        expect(itemGeometryAt(changes, 4)?.width).toBe(2);
        expect(itemGeometryAt(changes, 12)?.width).toBe(6);
    });
});

describe("lifting, tilting and turning over time (fork #1087)", () => {
    it("eases elevation, pitch and roll over the transition", () => {
        const changes = [
            change(0),
            change(8, {
                elevation: 2,
                pitch: 90,
                roll: -40,
                transitionLength: 4,
            }),
        ];
        // Halfway through the transition (it starts on the click of 5)
        const mid = itemGeometryAt(changes, 6.5)!;
        expect(mid.elevation).toBeCloseTo(1);
        expect(mid.pitch).toBeCloseTo(45);
        expect(mid.roll).toBeCloseTo(-20);
        expect(itemGeometryAt(changes, 8)).toMatchObject({
            elevation: 2,
            pitch: 90,
            roll: -40,
        });
    });

    it("reads a change without them as on the ground and level", () => {
        expect(itemGeometryAt([change(0)], 0)).toMatchObject({
            elevation: 0,
            pitch: 0,
            roll: 0,
        });
    });

    it("tilts through the raw angle, like rotation, so a flip is drawn", () => {
        const changes = [
            change(0),
            change(4, { pitch: 360, transitionLength: 5 }),
        ];
        expect(itemGeometryAt(changes, 2)?.pitch).toBe(180);
    });
});

describe("shortTurn", () => {
    it("takes the short way round, half a turn the positive way", () => {
        expect(shortTurn(350, 10)).toBe(20);
        expect(shortTurn(10, 350)).toBe(-20);
        expect(shortTurn(0, 180)).toBe(180);
        expect(shortTurn(180, 0)).toBe(180);
        expect(shortTurn(0, 720)).toBe(0);
        expect(shortTurn(-90, 90)).toBe(180);
        expect(shortTurn(45, 45)).toBe(0);
    });
});
