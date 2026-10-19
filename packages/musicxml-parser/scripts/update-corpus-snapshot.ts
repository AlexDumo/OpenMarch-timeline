/**
 * Rewrites src/__test__/corpus/expected.json from what the parser reads now. Run it after a
 * change to the parser, then review the diff: every changed line is a score that imports
 * differently.
 *
 *   pnpm exec tsx scripts/update-corpus-snapshot.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
    corpusFiles,
    corpusName,
    snapshot,
} from "../src/__test__/corpus/snapshot";

const out: Record<string, unknown> = {};
for (const path of corpusFiles()) out[corpusName(path)] = await snapshot(path);
const target = join(
    import.meta.dirname,
    "../src/__test__/corpus/expected.json",
);
writeFileSync(target, JSON.stringify(out, null, 4) + "\n");
console.log(`${Object.keys(out).length} files -> ${target}`);
