import { describe, expect, it } from "vitest";
import { rgbaToString, type FieldProperties } from "@openmarch/core";
import FieldPropertiesTemplates from "@/global/classes/FieldProperties.templates";
import { fieldGeometry, parseRgba } from "../fieldGeometry";

const fp: FieldProperties =
    FieldPropertiesTemplates.HIGH_SCHOOL_FOOTBALL_FIELD_NO_END_ZONES;
const { xPixels, yPixels } = fp.centerFrontPoint;

/** Each rectangle as { minX, minY, maxX, maxY, color }. */
const rects = (geometry: ReturnType<typeof fieldGeometry>) =>
    Array.from({ length: geometry.rects.count }, (_, i) => {
        const [minX, minY, maxX, maxY] = geometry.rects.bounds.subarray(
            i * 4,
            i * 4 + 4,
        );
        const color = Array.from(
            geometry.rects.colors.subarray(i * 4, i * 4 + 4),
        );
        return { minX, minY, maxX, maxY, color };
    });

describe("fieldGeometry", () => {
    const geometry = fieldGeometry(fp);
    const all = rects(geometry);

    it("keeps every rectangle on the field", () => {
        for (const r of all) {
            expect(r.minX).toBeGreaterThanOrEqual(-1e-3);
            expect(r.minY).toBeGreaterThanOrEqual(-1e-3);
            expect(r.maxX).toBeLessThanOrEqual(fp.width + 1e-3);
            expect(r.maxY).toBeLessThanOrEqual(fp.height + 1e-3);
        }
    });

    it("centers each yard line on its checkpoint, where a dot on it is drawn", () => {
        const primary = parseRgba(rgbaToString(fp.theme.primaryStroke));
        const fullHeight = all.filter(
            (r) =>
                r.maxY - r.minY > fp.height - 1e-3 &&
                r.maxX - r.minX < 2 &&
                r.color.every((c, i) => Math.abs(c - primary[i]) < 1e-6),
        );
        const centers = fullHeight.map((r) => (r.minX + r.maxX) / 2);
        for (const checkpoint of fp.xCheckpoints.filter((c) => c.visible)) {
            const x =
                xPixels + checkpoint.stepsFromCenterFront * fp.pixelsPerStep;
            // Lines at the field's edges are clipped to it
            if (x <= 0 || x >= fp.width) continue;
            expect(
                centers.some((center) => Math.abs(center - x) < 1e-3),
                `a yard line at x = ${x}`,
            ).toBe(true);
        }
    });

    it("places the yard numbers on their yard lines, home and away", () => {
        const numbers = geometry.texts.filter((t) => t.font === "number");
        const labeled = fp.xCheckpoints.filter((c) => c.fieldLabel);
        expect(numbers).toHaveLength(labeled.length * 2);
        for (const checkpoint of labeled) {
            const x =
                xPixels + checkpoint.stepsFromCenterFront * fp.pixelsPerStep;
            const at = numbers.filter(
                (t) =>
                    t.text === checkpoint.fieldLabel &&
                    Math.abs(t.x - x) < 1e-3,
            );
            expect(at.map((t) => t.rotation).sort()).toEqual([0, Math.PI]);
        }
        // Home numbers are between the front sideline and the field's middle
        for (const t of numbers.filter((n) => n.rotation === 0)) {
            expect(t.y).toBeGreaterThan(yPixels / 2);
            expect(t.y).toBeLessThan(yPixels);
        }
    });

    it("labels the checkpoints outside the field's edges", () => {
        const labels = geometry.texts.filter((t) => t.font === "label");
        const xs = fp.xCheckpoints.filter((c) => c.visible).length;
        const ys = fp.yCheckpoints.filter((c) => c.visible).length;
        const expected =
            xs *
                (Number(fp.bottomLabelsVisible) + Number(fp.topLabelsVisible)) +
            ys * (Number(fp.leftLabelsVisible) + Number(fp.rightLabelsVisible));
        expect(labels).toHaveLength(expected);
        for (const label of labels) {
            const outside =
                label.x < 0 ||
                label.x > fp.width ||
                label.y < 0 ||
                label.y > fp.height;
            expect(outside, `${label.text} at ${label.x}, ${label.y}`).toBe(
                true,
            );
        }
    });
});
