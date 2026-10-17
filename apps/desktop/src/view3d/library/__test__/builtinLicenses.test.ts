import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
    BUILTIN_ASSET_ROOTS,
    checkBuiltinLicenses,
    THIRD_PARTY_LICENSES,
    type ThirdPartyEntry,
} from "../builtinLicenses";
import thirdParty from "../../assets/third-party.json";

const DESKTOP = path.resolve(__dirname, "../../../..");

const trumpet: ThirdPartyEntry = {
    name: "Trumpet",
    files: ["src/view3d/assets/instruments/trumpet.json"],
    license: "CC-BY-4.0",
    author: "Kagelok",
    sourceUrl:
        "https://sketchfab.com/3d-models/trumpet-1dc9efd37bf14d1b9d1e3de0ca90435c",
    attribution: '"Trumpet" by Kagelok, CC BY 4.0',
    retrieved: "2026-10-09",
    modified: true,
};

/** A tree with one licensed folder and the trumpet listed. */
const files = [
    "src/view3d/assets/instruments/trumpet.json",
    "src/view3d/assets/instruments/CREDITS.md",
    "src/view3d/assets/om-pose/LICENSE",
    "src/view3d/assets/om-pose/bodies/neutral-average.glb",
];

describe("checkBuiltinLicenses", () => {
    it("passes a listed CC-BY item and a file under a folder LICENSE", () => {
        expect(checkBuiltinLicenses({ entries: [trumpet], files })).toEqual([]);
    });

    it.each(["CC-BY-SA-4.0", "CC-BY-NC-4.0", "CC-BY-ND-4.0", "MIT", ""])(
        "fails an entry licensed %s, outside the allow-list",
        (license) => {
            expect(
                checkBuiltinLicenses({
                    entries: [{ ...trumpet, license }],
                    files,
                }),
            ).toEqual([
                `Trumpet: license "${license}" isn't allowed (${THIRD_PARTY_LICENSES.join(", ")})`,
            ]);
        },
    );

    it.each(["author", "sourceUrl", "attribution", "retrieved"] as const)(
        "fails an entry without its %s",
        (field) => {
            expect(
                checkBuiltinLicenses({
                    entries: [{ ...trumpet, [field]: " " }],
                    files,
                }),
            ).toEqual([`Trumpet: ${field} is missing`]);
        },
    );

    it("fails a source that isn't an https URL and a date that isn't YYYY-MM-DD", () => {
        expect(
            checkBuiltinLicenses({
                entries: [
                    {
                        ...trumpet,
                        sourceUrl: "sketchfab.com/trumpet",
                        retrieved: "Oct 9",
                    },
                ],
                files,
            }),
        ).toEqual([
            "Trumpet: sourceUrl isn't an https URL",
            "Trumpet: retrieved isn't a YYYY-MM-DD date",
        ]);
    });

    it("fails a listed file that isn't there", () => {
        expect(
            checkBuiltinLicenses({
                entries: [
                    {
                        ...trumpet,
                        files: [...trumpet.files, "src/view3d/assets/x.json"],
                    },
                ],
                files,
            }),
        ).toEqual([
            "Trumpet: src/view3d/assets/x.json isn't in the repository",
        ]);
    });

    it("fails a built-in that neither the manifest nor a folder LICENSE covers", () => {
        expect(
            checkBuiltinLicenses({
                entries: [],
                files,
            }),
        ).toEqual([
            "src/view3d/assets/instruments/trumpet.json has no license: list it in third-party.json or add a LICENSE to its folder",
        ]);
    });
});

/** Every file under the built-in asset roots, relative to apps/desktop. */
function assetFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
        for (const entry of fs.readdirSync(path.join(DESKTOP, dir), {
            withFileTypes: true,
        })) {
            const rel = `${dir}/${entry.name}`;
            if (entry.isDirectory()) walk(rel);
            else out.push(rel);
        }
    };
    BUILTIN_ASSET_ROOTS.forEach(walk);
    return out.sort();
}

describe("the built-ins in the repository", () => {
    it("carry their license fields, inside the allow-list", () => {
        expect(
            checkBuiltinLicenses({
                entries: thirdParty.entries,
                files: assetFiles(),
            }),
        ).toEqual([]);
    });
});
