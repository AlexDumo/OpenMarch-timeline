/**
 * The Assets view's rows (fork #1258): one per asset, its other versions counted, so editing a
 * uniform's items doesn't list the uniform once per save.
 */
import { describe, expect, it } from "vitest";
import { groupAssetVersions, type AssetUse } from "../assetUse";
import type { ShowAsset } from "@/db-functions/showAssets";

const version = (
    id: string,
    hash: string,
    uses: number,
    blob: string,
): AssetUse => ({
    asset: {
        id,
        versionHash: hash.repeat(64).slice(0, 64),
        kind: "uniform",
        name: "fjm-page",
        parts: { pack: blob },
        sidecar: {},
        credits: {},
        createdAt: "",
    } as ShowAsset,
    value: `library:${id}@${hash}`,
    bytes: 1000,
    uses,
});

describe("groupAssetVersions", () => {
    it("lists a uniform once, showing the version in use, with its older versions counted", () => {
        const rows = [
            version("u", "a", 0, "b1"),
            version("u", "b", 0, "b2"),
            version("u", "c", 1, "b3"),
            version("m", "d", 2, "b4"),
        ];
        const sizes = new Map([
            ["b1", 2000],
            ["b2", 3000],
            ["b3", 4000],
            ["b4", 5000],
        ]);
        const groups = groupAssetVersions(rows, sizes);
        expect(groups.map((g) => g.row.value)).toEqual([
            "library:u@c",
            "library:m@d",
        ]);
        expect(groups[0].others.map((o) => o.value)).toEqual([
            "library:u@a",
            "library:u@b",
        ]);
        expect(groups[0].allOlder).toBe(true);
        expect(groups[0].othersBytes).toBe(5000);
        expect(groups[1].others).toEqual([]);
    });

    it("says other, not older, when the version in use isn't the newest (after an undo)", () => {
        const groups = groupAssetVersions(
            [version("u", "a", 1, "b1"), version("u", "b", 0, "b2")],
            new Map([
                ["b1", 1],
                ["b2", 2],
            ]),
        );
        expect(groups[0].row.value).toBe("library:u@a");
        expect(groups[0].allOlder).toBe(false);
    });

    it("shows the newest when no version is in use, and counts a shared blob once", () => {
        const groups = groupAssetVersions(
            [version("u", "a", 0, "same"), version("u", "b", 0, "same")],
            new Map([["same", 7]]),
        );
        expect(groups[0].row.value).toBe("library:u@b");
        expect(groups[0].othersBytes).toBe(0);
    });
});
