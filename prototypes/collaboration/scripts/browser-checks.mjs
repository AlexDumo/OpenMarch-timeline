// Runs the scripted two-window walkthroughs in scripts/browser against `pnpm dev`, in headless
// Chromium. Each prints what it saw; a run fails on a page error, an exception, or a "false".
// Screenshots go to $OUT (default /tmp/om-sync-shots).
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "browser");
mkdirSync(process.env.OUT ?? "/tmp/om-sync-shots", { recursive: true });
let failed = 0;
for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".mjs"))
    .sort()) {
    const run = spawnSync(process.execPath, [join(dir, file)], {
        encoding: "utf8",
        timeout: 180_000,
    });
    const output = `${run.stdout}${run.stderr}`;
    const ok =
        run.status === 0 &&
        /errors \[\]/.test(output) &&
        !/\bfalse\b/.test(output);
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} ${file}`);
    if (!ok || process.env.VERBOSE) console.log(output.replace(/^/gm, "    "));
}
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
