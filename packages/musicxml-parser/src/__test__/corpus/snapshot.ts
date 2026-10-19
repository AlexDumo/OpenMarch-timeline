/**
 * What the parser reads from each corpus file, in a form small enough to review in a diff: the
 * order measures are played in, each measure's counts, the total length and the warning codes.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parseMusicXmlWithReport } from "../../parser";
import { readMusicXmlFile } from "../../read";

export const FILES = join(import.meta.dirname, "files");

export interface Snapshot {
    /** Measure labels in the order they are played */
    order: string;
    /** Counts in each played measure */
    counts: string;
    seconds: number;
    warnings: string[];
}

export function corpusFiles(dir = FILES): string[] {
    return readdirSync(dir)
        .sort()
        .flatMap((name) => {
            const path = join(dir, name);
            if (statSync(path).isDirectory()) return corpusFiles(path);
            return /\.(musicxml|xml|mxl)$/i.test(name) ? [path] : [];
        });
}

export const corpusName = (path: string) => relative(FILES, path);

export async function snapshot(path: string): Promise<Snapshot> {
    const xml = await readMusicXmlFile(new Uint8Array(readFileSync(path)));
    const result = parseMusicXmlWithReport(xml);
    return {
        order: result.measures.map((m) => m.label).join(" "),
        counts: result.measures.map((m) => m.beats.length).join(" "),
        seconds: Number(result.summary.durationSeconds.toFixed(3)),
        warnings: [...new Set(result.warnings.map((w) => w.code))].sort(),
    };
}
