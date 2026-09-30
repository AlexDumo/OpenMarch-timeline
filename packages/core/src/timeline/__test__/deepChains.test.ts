/**
 * QA-REG-6, the CI-sized version: deep chains resolve cold, with no recursion
 * in pull-compile or the dirty walk. Vitest workers don't take
 * `--stack-size`, so this runs a few thousand links on the default stack; the
 * full 20,000 / 5,000 run on `node --stack-size=300` is
 * `pnpm --dir packages/core run test:deep` (scripts/deep-chains.mjs).
 *
 * The recursive oracle is not used here: it overflows on deep chains by
 * design (spec 9.3).
 */
import { describe, expect, it } from "vitest";
import { runDeepChains } from "../../../scripts/deep-chains.mjs";
import { createResolver } from "..";

describe("deep chains (QA-REG-6, CI size)", () => {
    it("3,000 direct, the same after editing the first shape, and 750 FTL", () => {
        const results = runDeepChains(createResolver, 3000);
        expect(results).toHaveLength(3);
        for (const r of results) expect(r.ok, r.message).toBe(true);
    });
});
