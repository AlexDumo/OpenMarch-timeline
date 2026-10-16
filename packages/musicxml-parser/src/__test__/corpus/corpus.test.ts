import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { corpusFiles, corpusName, snapshot, type Snapshot } from "./snapshot";

/**
 * Real files from many exporters (see ATTRIBUTION.md), read the way the parser read them when
 * `expected.json` was last written. A change here is a change in how a real score imports: check
 * it, then run `pnpm exec tsx scripts/update-corpus-snapshot.ts` to accept it.
 */
const expected: Record<string, Snapshot> = JSON.parse(
    readFileSync(join(import.meta.dirname, "expected.json"), "utf8"),
);

describe("corpus", () => {
    const files = corpusFiles();

    it("has a snapshot for every file", () => {
        expect(files.map(corpusName).sort()).toEqual(
            Object.keys(expected).sort(),
        );
    });

    it.each(files.map((f) => [corpusName(f), f]))(
        "reads %s",
        async (name, path) => {
            expect(await snapshot(path)).toEqual(expected[name]);
        },
    );
});
