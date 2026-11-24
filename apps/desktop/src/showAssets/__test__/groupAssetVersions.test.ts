/**
 * The Assets view's rows (fork #1258): one per asset, its other versions counted, so editing a
 * uniform's items doesn't list the uniform once per save.
 */
import { describe, expect, it } from "vitest";
import {
    groupAssetVersions,
    removableCount,
    removableLines,
    type AssetUse,
} from "../assetUse";
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

describe("removableLines", () => {
    it("lists an asset's unused versions on one line, as older versions when one stays", () => {
        const rows = [
            version("u", "a", 0, "b1"),
            version("u", "b", 0, "b2"),
            version("u", "c", 0, "b3"),
            version("u", "d", 1, "b4"),
            version("m", "e", 0, "b5"),
        ];
        const unused = rows.filter((r) => r.uses === 0);
        const lines = removableLines(unused, rows);
        expect(lines).toEqual([
            {
                id: "u",
                name: "fjm-page",
                count: 3,
                bytes: 3000,
                olderOnly: true,
                allOlder: true,
            },
            {
                id: "m",
                name: "fjm-page",
                count: 1,
                bytes: 1000,
                olderOnly: false,
                allOlder: false,
            },
        ]);
        // the dialog counts what the lines hold: versions, since one line groups them
        expect(removableCount(lines)).toEqual({ count: 4, unit: "versions" });
    });

    it("calls them other versions when one may be newer than the one kept (after an undo)", () => {
        const rows = [version("u", "a", 1, "b1"), version("u", "b", 0, "b2")];
        const [line] = removableLines([rows[1]], rows);
        expect(line.olderOnly).toBe(true);
        expect(line.allOlder).toBe(false);
    });

    it("calls them older when they precede the version in use, though an earlier one is kept for undo", () => {
        // the origin, kept for undo; three undone versions; then the one in use
        const rows = [
            version("u", "o", 0, "b0"),
            version("u", "a", 0, "b1"),
            version("u", "b", 0, "b2"),
            version("u", "c", 0, "b3"),
            version("u", "d", 1, "b4"),
        ];
        const [line] = removableLines(rows.slice(1, 4), rows);
        expect(line).toMatchObject({
            count: 3,
            olderOnly: true,
            allOlder: true,
        });
    });

    it("counts assets when every line is one whole asset", () => {
        const rows = [version("u", "a", 0, "b1"), version("m", "b", 0, "b2")];
        expect(removableCount(removableLines(rows, rows))).toEqual({
            count: 2,
            unit: "assets",
        });
    });
});
