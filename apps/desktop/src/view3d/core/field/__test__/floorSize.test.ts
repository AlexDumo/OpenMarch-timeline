import { describe, expect, it } from "vitest";
import { FieldProperties, fieldFootprint } from "@openmarch/core";
import FieldPropertiesTemplates from "../../../../global/classes/FieldProperties.templates";
import { floorSizeForImage } from "../floorSize";

const gym = FieldPropertiesTemplates.INDOOR_50x80_8to5;

const extent = (fp: FieldProperties) => {
    const f = fieldFootprint(fp);
    return { width: f.maxX - f.minX, depth: f.maxZ - f.minZ };
};

describe("floorSizeForImage (D-23 convert on open)", () => {
    it("fits the image inside the field and keeps its shape", () => {
        const footprint = extent(gym);
        // A square image on a wide floor: as tall as the field, narrower than it
        const size = floorSizeForImage(gym, { width: 1000, height: 1000 });
        expect(size.heightM).toBeCloseTo(footprint.depth, 6);
        expect(size.widthM).toBeCloseTo(size.heightM, 6);
        expect(size.widthM).toBeLessThan(footprint.width);
    });

    it("covers the field when the image fills it", () => {
        const fill = new FieldProperties({ ...gym, imageFillOrFit: "fill" });
        const footprint = extent(fill);
        const size = floorSizeForImage(fill, { width: 1000, height: 1000 });
        expect(size.widthM).toBeCloseTo(footprint.width, 6);
        expect(size.heightM).toBeCloseTo(size.widthM, 6);
        expect(size.heightM).toBeGreaterThan(footprint.depth);
    });

    it("matches the field exactly for an image of the field's shape", () => {
        const footprint = extent(gym);
        const size = floorSizeForImage(gym, {
            width: gym.width,
            height: gym.height,
        });
        expect(size.widthM).toBeCloseTo(footprint.width, 6);
        expect(size.heightM).toBeCloseTo(footprint.depth, 6);
    });
});
