/**
 * Runs the parser over every MusicXML file in a folder and prints what it read.
 *
 *   pnpm exec tsx scripts/corpus-report.ts <folder> [out.jsonl]
 *
 * Prints failures, how many files had each warning, and the software that wrote the files. With
 * `out.jsonl`, also writes one JSON line per file (measures played and written, counts, seconds,
 * warnings, and the measure order) to compare two versions of the parser with a diff.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseMusicXmlWithReport, readMusicXmlFile } from "../src";

const [folder, out] = process.argv.slice(2);
if (!folder) {
    console.error("usage: tsx scripts/corpus-report.ts <folder> [out.jsonl]");
    process.exit(1);
}

function* scoreFiles(dir: string): Generator<string> {
    for (const name of readdirSync(dir).sort()) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
            if (name !== "META-INF") yield* scoreFiles(path);
        } else if (/\.(musicxml|xml|mxl)$/i.test(name)) yield path;
    }
}

const lines: string[] = [];
const failures: string[] = [];
const warningFiles = new Map<string, number>();
const software = new Map<string, number>();
let scores = 0;

for (const path of scoreFiles(folder)) {
    const file = relative(folder, path);
    let xml: string;
    try {
        xml = await readMusicXmlFile(new Uint8Array(readFileSync(path)));
    } catch (e) {
        failures.push(`${file}: can't read: ${(e as Error).message}`);
        continue;
    }
    // Other XML files (containers, part lists, settings) aren't scores
    if (!/<score-(partwise|timewise)/.test(xml)) continue;
    scores++;
    const started = performance.now();
    try {
        const result = parseMusicXmlWithReport(xml);
        const codes = new Map<string, number>();
        for (const w of result.warnings)
            codes.set(w.code, (codes.get(w.code) ?? 0) + 1);
        for (const code of codes.keys())
            warningFiles.set(code, (warningFiles.get(code) ?? 0) + 1);
        const writer = result.score.software.join(" + ") || "(not named)";
        software.set(writer, (software.get(writer) ?? 0) + 1);
        lines.push(
            JSON.stringify({
                file,
                software: result.score.software,
                measures: result.summary.measures,
                written: result.summary.writtenMeasures,
                counts: result.summary.counts,
                seconds: Number(result.summary.durationSeconds.toFixed(4)),
                warnings: Object.fromEntries(codes),
                ms: Math.round(performance.now() - started),
                order: result.measures.map((m) => m.label).join(" "),
            }),
        );
    } catch (e) {
        failures.push(`${file}: ${(e as Error).message}`);
    }
}

const sorted = (map: Map<string, number>) =>
    [...map.entries()].sort((a, b) => b[1] - a[1]);
console.log(`${scores} scores, ${failures.length} failed`);
for (const failure of failures) console.log(`  FAILED ${failure}`);
console.log("\nFiles with each warning:");
for (const [code, n] of sorted(warningFiles)) console.log(`  ${n}\t${code}`);
console.log("\nWritten by:");
for (const [name, n] of sorted(software)) console.log(`  ${n}\t${name}`);
if (out) writeFileSync(out, lines.join("\n") + "\n");
