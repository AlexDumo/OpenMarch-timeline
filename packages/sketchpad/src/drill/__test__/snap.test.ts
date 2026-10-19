import { describe, expect, it } from "vitest";
import { FieldPropertiesTemplates } from "@openmarch/core";
import { snapDelta, snapScenePoint, snapTargets } from "../snap";
import { stepsToScene } from "../coordinates";

const fp = FieldPropertiesTemplates.HIGH_SCHOOL_FOOTBALL_FIELD_NO_END_ZONES;
const pps = fp.pixelsPerStep;

describe("snapping to steps", () => {
    it("rounds to the nearest step from the 50 and the front sideline", () => {
        const r = snapScenePoint(fp, "steps", { x: 3.4 * pps, y: -7.6 * pps });
        expect(r.point.x).toBeCloseTo(3 * pps, 9);
        expect(r.point.y).toBeCloseTo(-8 * pps, 9);
        expect(r.guides).toEqual([]);
    });

    it("moves selections in whole steps", () => {
        const d = snapDelta(fp, "steps", { x: 2.6 * pps, y: -0.4 * pps });
        expect(d.x).toBeCloseTo(3 * pps, 9);
        expect(d.y).toBeCloseTo(0, 9);
    });
});

describe("snapping to yard lines and hashes", () => {
    it("snaps to a yard line and a hash within the threshold, with labels", () => {
        const s1_30 = stepsToScene(fp, { x: -32, y: -28 });
        const r = snapScenePoint(
            fp,
            "lines",
            { x: s1_30.x + 6, y: s1_30.y - 5 },
            1,
            10,
        );
        expect(r.point).toEqual(s1_30);
        expect(r.guides.map((g) => g.label)).toEqual([
            "S1 30 line",
            "HS front hash",
        ]);
    });

    it("snaps to half lines every 4 steps", () => {
        const half = stepsToScene(fp, { x: 4, y: 0 }).x;
        const r = snapScenePoint(fp, "lines", { x: half + 3, y: -150 }, 1, 10);
        expect(r.point.x).toBeCloseTo(half, 9);
        expect(r.guides[0]?.label).toBe("half line");
    });

    it("leaves an axis alone when no line is near, measured on screen", () => {
        const far = { x: 2 * pps, y: -14.5 * pps };
        expect(snapScenePoint(fp, "lines", far, 1, 10).point).toEqual(far);
        // Zoomed out, the same scene distance is within 10 screen pixels
        const zoomedOut = snapScenePoint(fp, "lines", far, 0.2, 10).point;
        expect(zoomedOut.x).toBe(0);
    });

    it("lists every visible yard line and hash", () => {
        const t = snapTargets(fp);
        expect(t.x.filter((x) => x.label !== "half line")).toHaveLength(
            fp.xCheckpoints.length,
        );
        expect(t.y.map((y) => y.label)).toEqual(
            expect.arrayContaining(["HS front hash", "HS back hash"]),
        );
    });

    it("does nothing when off or in Shapes mode", () => {
        const p = { x: 1.234, y: -5.678 };
        expect(snapScenePoint(fp, "off", p).point).toEqual(p);
        expect(snapScenePoint(fp, "shapes", p).point).toEqual(p);
    });
});
