/* eslint-disable no-console -- a command line tool: it prints its results */
// cspell:words omasset
/**
 * uniform:build — turns a uniform pack folder into a `.omasset` the app imports.
 * See README.md. Run from apps/desktop: `pnpm uniform:build <packDir> [--out file.omasset] [--json]`.
 *
 * Exit codes: 0 built, 4 refused (every problem printed), 2 anything else.
 */
import fs from "node:fs";
import path from "node:path";
import { uniformPackFileName } from "@/view3d/core/uniformPack/format";
import { openToolPage } from "./lib/browser";
import { buildFolder } from "./lib/build";
import { PackSourceError } from "./lib/packSource";
import { resolveFromCaller } from "./lib/args";

const USAGE = `usage: pnpm uniform:build <packDir> [--out <file.omasset>] [--json]
  packDir   a folder with uniform.json and the SVG/PNG files it names
  --out     where to write the pack (default: <packDir>/../<name>.omasset)
  --json    print the result as JSON`;

async function main(argv: string[]): Promise<number> {
    const json = argv.includes("--json");
    const rest = argv.filter((a) => a !== "--json");
    const outAt = rest.indexOf("--out");
    const out = outAt >= 0 ? rest[outAt + 1] : undefined;
    if (outAt >= 0) rest.splice(outAt, 2);
    if (rest.length !== 1 || rest[0].startsWith("-") || (outAt >= 0 && !out)) {
        console.error(USAGE);
        return 4;
    }
    const dir = resolveFromCaller(rest[0]);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
        console.error(`error: ${dir} isn't a folder\n${USAGE}`);
        return 4;
    }
    const t0 = Date.now();
    const page = await openToolPage({ gpu: false });
    try {
        const built = await buildFolder(dir, page);
        const file = out
            ? resolveFromCaller(out)
            : path.join(
                  path.dirname(dir),
                  uniformPackFileName(built.manifest.name),
              );
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, built.bytes);
        const result = {
            file,
            bytes: built.bytes.byteLength,
            formatVersion: built.manifest.formatVersion,
            layers: built.manifest.layers.map((l) => l.id),
            items: (built.manifest.items ?? []).map((i) => i.id),
            modes: (built.manifest.modes ?? []).map((m) => m.id),
            warnings: built.warnings,
            seconds: (Date.now() - t0) / 1000,
        };
        if (json) console.log(JSON.stringify(result, null, 2));
        else {
            console.log(
                `built ${file} (format version ${result.formatVersion}, ${(result.bytes / 1e6).toFixed(2)} MB): ` +
                    `${result.layers.length} layer(s), ${result.items.length} item(s), ${result.modes.length} mode(s), ${result.seconds.toFixed(1)} s`,
            );
            for (const w of built.warnings) console.log(`warning: ${w}`);
        }
        return 0;
    } catch (error) {
        if (error instanceof PackSourceError) {
            if (json)
                console.log(
                    JSON.stringify({ refused: error.problems }, null, 2),
                );
            else for (const p of error.problems) console.error(`refused: ${p}`);
            return 4;
        }
        throw error;
    } finally {
        await page.close();
    }
}

main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
        console.error(`error: ${(error as Error)?.stack ?? String(error)}`);
        process.exit(2);
    },
);
