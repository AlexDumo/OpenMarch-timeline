// @vitest-environment node
import { describe, expect, it } from "vitest";
import { fieldForNewShow } from "../previousDotsField";

const floor = {
    itemId: "77777777-7777-4777-8777-777777777777",
    versionHash: "e".repeat(64),
};
const bytes = (n: number) => new Uint8Array([n, n, n]);

describe("fieldForNewShow (D-23)", () => {
    it("drops the previous show's floor from the copied field properties", () => {
        const json = JSON.stringify({ name: "Gym", floor, useHashes: true });
        expect(
            JSON.parse(
                fieldForNewShow(json, null, bytes(1)).fieldPropertiesJson,
            ),
        ).toEqual({ name: "Gym", useHashes: true });
    });

    it("carries the floor's original as the image to make the new show's floor", () => {
        const json = JSON.stringify({ name: "Gym", floor });
        expect(fieldForNewShow(json, bytes(9), bytes(1)).fieldImage).toEqual(
            bytes(1),
        );
    });

    it("falls back to a legacy field image when the previous show has no floor", () => {
        const json = JSON.stringify({ name: "Gym" });
        const result = fieldForNewShow(json, bytes(9), null);
        expect(result.fieldImage).toEqual(bytes(9));
        expect(result.fieldPropertiesJson).toBe(json);
    });

    it("has no image when the previous show has neither", () => {
        expect(
            fieldForNewShow(JSON.stringify({ name: "Gym" }), null, null)
                .fieldImage,
        ).toBeNull();
    });
});
