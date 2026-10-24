import { describe, expect, it } from "vitest";
import { GLIDE_MS, SpotGlide } from "../spotGlide";

/**
 * The glide (#387, the owner's pick from the lab): when the open shape changes without a gesture,
 * each marcher's spot slides from where it was to where it's going instead of jumping.
 */

const a = {
    params: {},
    targets: [
        { id: 1, to: { x: 0, y: 0 } },
        { id: 2, to: { x: 10, y: 0 } },
    ],
};
const b = {
    params: {},
    targets: [
        { id: 1, to: { x: 20, y: 0 } },
        { id: 2, to: { x: 10, y: 40 } },
    ],
};

describe("the spot glide", () => {
    it("does nothing until the shape changes", () => {
        const g = new SpotGlide();
        g.update(a.params, false, a.targets, 0);
        expect(g.positions(10)).toBeNull();
    });

    it("slides each marcher from its old spot to its new one, eased, then stops", () => {
        const g = new SpotGlide();
        g.update(a.params, false, a.targets, 0);
        g.update(b.params, false, b.targets, 1000);
        const start = g.positions(1000)!;
        expect(start.get(1)).toEqual({ x: 0, y: 0 });
        const mid = g.positions(1000 + GLIDE_MS / 2)!;
        // Eased out: past halfway at half time
        expect(mid.get(1)!.x).toBeGreaterThan(10);
        expect(mid.get(1)!.x).toBeLessThan(20);
        expect(mid.get(2)!.y).toBeGreaterThan(20);
        expect(g.positions(1000 + GLIDE_MS)).toBeNull();
        expect(g.active(1000 + GLIDE_MS)).toBe(false);
    });

    it("doesn't glide during a gesture: a drag follows the pointer", () => {
        const g = new SpotGlide();
        g.update(a.params, false, a.targets, 0);
        g.update(b.params, true, b.targets, 10);
        expect(g.positions(20)).toBeNull();
    });

    it("starts a new glide from where the marchers are shown, mid-glide", () => {
        const g = new SpotGlide();
        g.update(a.params, false, a.targets, 0);
        g.update(b.params, false, b.targets, 100);
        const shown = g.positions(100 + GLIDE_MS / 2)!.get(1)!;
        const c = {
            params: {},
            targets: [
                { id: 1, to: { x: 0, y: 0 } },
                { id: 2, to: { x: 0, y: 0 } },
            ],
        };
        g.update(c.params, false, c.targets, 100 + GLIDE_MS / 2);
        expect(g.positions(100 + GLIDE_MS / 2)!.get(1)).toEqual(shown);
    });

    it("leaves a marcher that only one side has where it's going", () => {
        const g = new SpotGlide();
        g.update(a.params, false, a.targets, 0);
        const more = {
            params: {},
            targets: [...b.targets, { id: 3, to: { x: 5, y: 5 } }],
        };
        g.update(more.params, false, more.targets, 10);
        expect(g.positions(10)!.get(3)).toEqual({ x: 5, y: 5 });
    });
});
