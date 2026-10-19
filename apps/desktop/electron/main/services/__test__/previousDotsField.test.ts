// @vitest-environment node
import { describe, expect, it } from "vitest";
import { fieldForNewShow } from "../previousDotsField";
import type { EmbedLibraryVersion } from "../../../../src/db-functions/showLibrary";

const floor = {
    itemId: "77777777-7777-4777-8777-777777777777",
    versionHash: "e".repeat(64),
};
const bytes = (n: number) => new Uint8Array([n, n, n]);
const version = {
    ...floor,
    kind: "artwork",
    name: "Gym tarp",
    parts: { original: bytes(1) },
} as unknown as EmbedLibraryVersion;

describe("fieldForNewShow (D-23)", () => {
    it("drops the previous show's floor from the copied field properties", () => {
        const json = JSON.stringify({ name: "Gym", floor, useHashes: true });
        expect(
            JSON.parse(
                fieldForNewShow(json, null, version).fieldPropertiesJson,
            ),
        ).toEqual({ name: "Gym", useHashes: true });
    });

    it("carries the floor's Version as it is, for the new show to embed", () => {
        const json = JSON.stringify({ name: "Gym", floor });
        const result = fieldForNewShow(json, bytes(9), version);
        expect(result.fieldFloor).toBe(version);
        expect(result.fieldImage).toBeNull();
    });

    it("falls back to a legacy field image when the previous show has no floor", () => {
        const json = JSON.stringify({ name: "Gym" });
        const result = fieldForNewShow(json, bytes(9), null);
        expect(result.fieldImage).toEqual(bytes(9));
        expect(result.fieldFloor).toBeNull();
        expect(result.fieldPropertiesJson).toBe(json);
    });

    it("has no image when the previous show has neither", () => {
        expect(
            fieldForNewShow(JSON.stringify({ name: "Gym" }), null, null)
                .fieldImage,
        ).toBeNull();
    });
});
