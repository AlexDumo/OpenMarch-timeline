import { describe, expect, it } from "vitest";
import {
    lengthUnitKey,
    metersToShown,
    shownLength,
    shownToMeters,
} from "../showLengths";

describe("lengths in the show's units", () => {
    it("shows meters as feet in an imperial show", () => {
        expect(shownLength(2, "imperial")).toBe("6.56");
        expect(lengthUnitKey("imperial")).toBe("props.units.feet");
    });

    it("keeps meters in a metric show", () => {
        expect(shownLength(2, "metric")).toBe("2");
        expect(lengthUnitKey("metric")).toBe("props.units.meters");
    });

    it("stores a typed length back in meters", () => {
        expect(shownToMeters(10, "imperial")).toBeCloseTo(3.048);
        expect(shownToMeters(3, "metric")).toBe(3);
        expect(shownToMeters(metersToShown(1.7, "imperial"), "imperial")).toBe(
            1.7,
        );
    });
});
