import { describe, expect, it } from "vitest";
import { FieldProperties, FieldPropertiesTemplates } from "@openmarch/core";
import {
    fieldPixelsToScene,
    fieldSceneBounds,
    sceneToFieldPixels,
    sceneToSteps,
    stepsToScene,
} from "../coordinates";
import { drillPosition, formatDrillPosition } from "../position";
import {
    createFieldSnapshot,
    fieldUnderlayMarkup,
} from "../../field/fieldStyle";

const templates = {
    "high school":
        FieldPropertiesTemplates.HIGH_SCHOOL_FOOTBALL_FIELD_NO_END_ZONES,
    college: FieldPropertiesTemplates.COLLEGE_FOOTBALL_FIELD_NO_END_ZONES,
    pro: FieldPropertiesTemplates.PRO_FOOTBALL_FIELD_NO_END_ZONES,
    "high school with end zones":
        FieldPropertiesTemplates.HIGH_SCHOOL_FOOTBALL_FIELD_WITH_END_ZONES,
};

const checkpoint = (fp: FieldProperties, axis: "x" | "y", name: string) => {
    const list = axis === "x" ? fp.xCheckpoints : fp.yCheckpoints;
    const c = list.find((x) => x.name === name);
    if (!c) throw new Error(`no ${name}`);
    return c;
};

describe.each(Object.entries(templates))(
    "scene coordinates on the %s field (ADR 0006 D-3)",
    (_, fp) => {
        it("puts the origin on the 50 at the front sideline", () => {
            expect(sceneToFieldPixels(fp, { x: 0, y: 0 })).toEqual({
                x: fp.centerFrontPoint.xPixels,
                y: fp.centerFrontPoint.yPixels,
            });
            expect(sceneToFieldPixels(fp, { x: 0, y: 0 }).y).toBe(fp.height);
        });

        it("measures in FieldProperties pixels: steps × stepSizeInches × PIXELS_PER_INCH", () => {
            const pps = fp.stepSizeInches * FieldProperties.PIXELS_PER_INCH;
            expect(stepsToScene(fp, { x: 8, y: -4 })).toEqual({
                x: 8 * pps,
                y: -4 * pps,
            });
            expect(sceneToSteps(fp, { x: 8 * pps, y: -4 * pps })).toEqual({
                x: 8,
                y: -4,
            });
        });

        it("lands every checkpoint on its stepsFromCenterFront", () => {
            for (const c of fp.xCheckpoints) {
                const scene = stepsToScene(fp, {
                    x: c.stepsFromCenterFront,
                    y: 0,
                });
                const pixels = sceneToFieldPixels(fp, scene);
                expect(pixels.x).toBeCloseTo(
                    fp.centerFrontPoint.xPixels +
                        c.stepsFromCenterFront * fp.pixelsPerStep,
                    9,
                );
            }
            for (const c of fp.yCheckpoints) {
                const pixels = sceneToFieldPixels(
                    fp,
                    stepsToScene(fp, { x: 0, y: c.stepsFromCenterFront }),
                );
                expect(pixels.y).toBeCloseTo(
                    fp.centerFrontPoint.yPixels +
                        c.stepsFromCenterFront * fp.pixelsPerStep,
                    9,
                );
            }
        });

        it("round-trips field pixels and scene points", () => {
            const p = { x: 123.5, y: 456.25 };
            expect(sceneToFieldPixels(fp, fieldPixelsToScene(fp, p))).toEqual(
                p,
            );
        });

        it("covers the whole field in its scene bounds", () => {
            const b = fieldSceneBounds(fp);
            expect(b).toEqual({
                x: -fp.centerFrontPoint.xPixels,
                y: -fp.height,
                width: fp.width,
                height: fp.height,
            });
        });

        it("draws the underlay with the field's back-left corner at the scene's top-left bound", () => {
            const markup = fieldUnderlayMarkup(createFieldSnapshot(fp));
            expect(markup).toContain(
                `translate(${-fp.centerFrontPoint.xPixels} ${-fp.height})`,
            );
        });

        it("reads the front hash on the 50 in drill language", () => {
            const fh = checkpoint(
                fp,
                "y",
                fp.yCheckpoints.find((c) => c.terseName === "FH")!.name,
            );
            const p = stepsToScene(fp, { x: 0, y: fh.stepsFromCenterFront });
            expect(formatDrillPosition(drillPosition(fp, p))).toBe(
                "on 50 · on FH",
            );
        });
    },
);

describe("drill readout", () => {
    const fp = templates["high school"];
    const at = (x: number, y: number) =>
        formatDrillPosition(drillPosition(fp, stepsToScene(fp, { x, y })));

    it("reads yard lines by side, inside and outside", () => {
        // The S1 30 is 32 steps left of the 50
        expect(at(-32, -32)).toBe("on S1 30 · 4 behind FH");
        expect(at(-36, -40)).toBe("4 out S1 30 · 12 behind FH");
        expect(at(-30, -26)).toBe("2 in S1 30 · 2 in front of FH");
        expect(at(27, -56)).toBe("3 out S2 35 · on BH");
        expect(at(21, -56)).toBe("3 in S2 35 · on BH");
        expect(at(2, 0)).toBe("2 S2 of 50 · on FSL");
    });

    it("rounds to a quarter step", () => {
        expect(at(-32.2, -28.2)).toBe("0.25 out S1 30 · 0.25 behind FH");
    });

    it("measures from the college hashes on a college field", () => {
        const college = templates.college;
        const p = stepsToScene(college, { x: -32, y: -32 });
        expect(formatDrillPosition(drillPosition(college, p))).toBe(
            "on S1 30 · on FH",
        );
    });
});
