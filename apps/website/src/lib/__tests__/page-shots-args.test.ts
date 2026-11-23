import { describe, expect, it } from "vitest";
import { parsePageShotsArgs } from "../../../scripts/page-shots-args.mjs";

const A = "/guides/timeline/moves/";
const B = "/guides/timeline/pages/";

describe("page-shots argument parsing", () => {
    it("keeps every page when --out isn't passed (#1052)", () => {
        expect(parsePageShotsArgs([A]).pages).toEqual([A]);
        expect(parsePageShotsArgs([A, B]).pages).toEqual([A, B]);
    });

    it("keeps every page when --out is passed, before or after them", () => {
        expect(parsePageShotsArgs([A, B, "--out", "/tmp/x"])).toMatchObject({
            pages: [A, B],
            out: "/tmp/x",
        });
        expect(parsePageShotsArgs(["--out", "/tmp/x", A, B])).toMatchObject({
            pages: [A, B],
            out: "/tmp/x",
        });
        expect(parsePageShotsArgs([A, "--out=/tmp/x", B])).toMatchObject({
            pages: [A, B],
            out: "/tmp/x",
        });
    });

    it("keeps every page next to the other flags", () => {
        expect(
            parsePageShotsArgs(["--tiles", A, "--theme", "dark", B]),
        ).toMatchObject({ pages: [A, B], theme: "dark", tiles: true });
        expect(parsePageShotsArgs([A, "--theme=light"])).toMatchObject({
            pages: [A],
            theme: "light",
        });
    });

    it("treats everything after -- as pages, as pnpm passes it", () => {
        expect(parsePageShotsArgs(["--", A, B]).pages).toEqual([A, B]);
    });

    it("gives a page without a leading slash one", () => {
        expect(parsePageShotsArgs(["guides/timeline/moves/"]).pages).toEqual([
            A,
        ]);
    });

    it("reads --all without needing a page", () => {
        expect(parsePageShotsArgs(["--all"])).toMatchObject({
            all: true,
            pages: [],
        });
    });

    it("rejects what it can't read instead of dropping it", () => {
        expect(() => parsePageShotsArgs([A, "--out"])).toThrow(/needs a value/);
        expect(() => parsePageShotsArgs([A, "--theme", "blue"])).toThrow(
            /light or dark/,
        );
        expect(() => parsePageShotsArgs([A, "--tile"])).toThrow(/Unknown/);
    });
});
