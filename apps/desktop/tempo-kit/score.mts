#!/usr/bin/env node
/**
 * Scores a show's timing against a kit ground truth (README.md, "Scoring").
 *
 *   node apps/desktop/tempo-kit/score.mts <show.dots> <truth.json> [--json] [--worst N]
 *
 * Count k of the show is its k-th beat by position after beat 0, and is compared with count k of
 * the truth. A count's show time is the sum of the durations before it, moved into audio time by
 * the show's audio offset (`audioOffsetSeconds`: audio time = show time − offset). Errors are show
 * minus truth, in ms and in counts (divided by the truth count's length without any fermata or
 * caesura). Measures and rehearsal marks are compared by the count they start on.
 *
 * Runs on Node 24 directly (type stripping); it only reads the file.
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { basename } from "node:path";
import type { TempoTruth } from "./truth.ts";

export interface ShowTiming {
    /** Beat durations after beat 0, in position order */
    durations: number[];
    /** Measures by first count (1-based ordinal), in order */
    measures: { firstCount: number; mark: string | null }[];
    /** First count of each page after page 0 */
    pages: number[];
    audioOffsetSeconds: number;
    measurementOffset: number;
}

export interface ErrorStats {
    n: number;
    maxMs: number;
    medianMs: number;
    p95Ms: number;
    meanSignedMs: number;
    maxCounts: number;
    medianCounts: number;
    p95Counts: number;
}

export interface CountError {
    index: number;
    measure: number;
    beat: number;
    errorMs: number;
    errorCounts: number;
}

export interface ScoreReport {
    showCounts: number;
    truthCounts: number;
    counts: ErrorStats;
    downbeats: ErrorStats;
    pageStarts: ErrorStats;
    pages: (CountError & { page: number })[];
    worstCounts: CountError[];
    measureMismatches: string[];
    markMismatches: string[];
}

/** Reads the timing a scorer needs from a `.dots` file. */
export const readShow = (path: string): ShowTiming => {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
        const beats = db
            .prepare("SELECT id, duration FROM beats ORDER BY position")
            .all() as { id: number; duration: number }[];
        const ordinal = new Map(beats.map((b, i) => [b.id, i]));
        const measures = (
            db
                .prepare("SELECT start_beat, rehearsal_mark FROM measures")
                .all() as {
                start_beat: number;
                rehearsal_mark: string | null;
            }[]
        )
            .map((m) => ({
                firstCount: ordinal.get(m.start_beat) ?? -1,
                mark: m.rehearsal_mark,
            }))
            .sort((a, b) => a.firstCount - b.firstCount);
        const pages = (
            db.prepare("SELECT start_beat FROM pages").all() as {
                start_beat: number;
            }[]
        )
            .map((p) => ordinal.get(p.start_beat) ?? -1)
            .filter((c) => c > 0)
            .sort((a, b) => a - b);
        const row = db
            .prepare("SELECT json_data FROM workspace_settings")
            .get() as { json_data: string } | undefined;
        let settings: {
            audioOffsetSeconds?: number;
            measurementOffset?: number;
        } = {};
        try {
            settings = row ? JSON.parse(row.json_data) : {};
        } catch {
            settings = {};
        }
        return {
            durations: beats.slice(1).map((b) => b.duration),
            measures,
            pages,
            audioOffsetSeconds: settings.audioOffsetSeconds ?? 0,
            measurementOffset: settings.measurementOffset ?? 1,
        };
    } finally {
        db.close();
    }
};

const quantile = (sorted: number[], q: number) => {
    if (sorted.length === 0) return 0;
    const at = (sorted.length - 1) * q;
    const lo = Math.floor(at);
    const hi = Math.ceil(at);
    return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
};

export const stats = (errors: CountError[]): ErrorStats => {
    const ms = errors.map((e) => Math.abs(e.errorMs)).sort((a, b) => a - b);
    const counts = errors
        .map((e) => Math.abs(e.errorCounts))
        .sort((a, b) => a - b);
    return {
        n: errors.length,
        maxMs: ms[ms.length - 1] ?? 0,
        medianMs: quantile(ms, 0.5),
        p95Ms: quantile(ms, 0.95),
        meanSignedMs:
            errors.reduce((s, e) => s + e.errorMs, 0) /
            Math.max(1, errors.length),
        maxCounts: counts[counts.length - 1] ?? 0,
        medianCounts: quantile(counts, 0.5),
        p95Counts: quantile(counts, 0.95),
    };
};

/** Compares a show's timing, measures and marks with the truth. */
export const scoreShow = (
    show: ShowTiming,
    truth: TempoTruth,
    { worst = 5 }: { worst?: number } = {},
): ScoreReport => {
    const errors: CountError[] = [];
    let t = 0;
    show.durations.forEach((duration, i) => {
        const c = truth.counts[i];
        if (c) {
            const audio = t - show.audioOffsetSeconds;
            const errorMs = (audio - c.time) * 1000;
            errors.push({
                index: c.index,
                measure: c.measure,
                beat: c.beat,
                errorMs,
                errorCounts: errorMs / 1000 / (c.plainDuration ?? c.duration),
            });
        }
        t += duration;
    });
    const byIndex = new Map(errors.map((e) => [e.index, e]));
    const pages = show.pages.flatMap((count, i) => {
        const e = byIndex.get(count);
        return e ? [{ ...e, page: i + 1 }] : [];
    });

    const truthByCount = new Map(truth.measures.map((m) => [m.firstCount, m]));
    const showByCount = new Map(
        show.measures.map((m, i) => [
            m.firstCount,
            { ...m, number: i + show.measurementOffset },
        ]),
    );
    const measureMismatches: string[] = [];
    const markMismatches: string[] = [];
    for (const m of truth.measures) {
        const s = showByCount.get(m.firstCount);
        if (!s) {
            measureMismatches.push(
                `m${m.number} (count ${m.firstCount}): no measure line in the show`,
            );
            continue;
        }
        if (s.number !== m.number)
            measureMismatches.push(
                `count ${m.firstCount}: the show calls it m${s.number}, the score m${m.number}`,
            );
        if ((s.mark ?? null) !== (m.mark ?? null))
            markMismatches.push(
                `m${m.number}: the show has ${s.mark ? `"${s.mark}"` : "no mark"}, the score ${m.mark ? `"${m.mark}"` : "none"}`,
            );
    }
    for (const s of showByCount.values())
        if (!truthByCount.has(s.firstCount))
            measureMismatches.push(
                `count ${s.firstCount}: the show starts m${s.number} here, the score has no bar line${s.mark ? ` (mark "${s.mark}")` : ""}`,
            );

    return {
        showCounts: show.durations.length,
        truthCounts: truth.counts.length,
        counts: stats(errors),
        downbeats: stats(errors.filter((e) => e.beat === 1)),
        pageStarts: stats(pages),
        pages,
        worstCounts: [...errors]
            .sort((a, b) => Math.abs(b.errorMs) - Math.abs(a.errorMs))
            .slice(0, worst),
        measureMismatches,
        markMismatches,
    };
};

const ms = (v: number) =>
    `${v <= -0.05 ? "-" : ""}${Math.abs(v).toFixed(1)} ms`;
const cts = (v: number) => `${v.toFixed(3)} counts`;
const line = (label: string, s: ErrorStats) =>
    `${label.padEnd(12)} n=${String(s.n).padEnd(4)} max ${ms(s.maxMs)} (${cts(s.maxCounts)})  median ${ms(s.medianMs)} (${cts(s.medianCounts)})  p95 ${ms(s.p95Ms)} (${cts(s.p95Counts)})  mean signed ${ms(s.meanSignedMs)}`;

/** The report as text for the terminal. */
export const formatReport = (r: ScoreReport): string => {
    const out = [
        r.showCounts === r.truthCounts
            ? `counts       ${r.showCounts} in the show and the truth`
            : `counts       MISMATCH: ${r.showCounts} in the show, ${r.truthCounts} in the truth (compared the first ${Math.min(r.showCounts, r.truthCounts)})`,
        line("all counts", r.counts),
        line("downbeats", r.downbeats),
        line("page starts", r.pageStarts),
        "worst counts:",
        ...r.worstCounts.map(
            (e) =>
                `  count ${e.index} (m${e.measure} beat ${e.beat}): ${ms(e.errorMs)} (${e.errorCounts.toFixed(3)} counts)`,
        ),
        "worst page starts:",
        ...[...r.pages]
            .sort((a, b) => Math.abs(b.errorMs) - Math.abs(a.errorMs))
            .slice(0, r.worstCounts.length)
            .map(
                (e) =>
                    `  page ${e.page} (count ${e.index}, m${e.measure} beat ${e.beat}): ${ms(e.errorMs)} (${e.errorCounts.toFixed(3)} counts)`,
            ),
        `measures     ${r.measureMismatches.length} mismatch${r.measureMismatches.length === 1 ? "" : "es"}`,
        ...r.measureMismatches.slice(0, 10).map((m) => `  ${m}`),
        `marks        ${r.markMismatches.length} mismatch${r.markMismatches.length === 1 ? "" : "es"}`,
        ...r.markMismatches.slice(0, 10).map((m) => `  ${m}`),
    ];
    return out.join("\n");
};

const main = (argv: string[]) => {
    const paths: string[] = [];
    let json = false;
    let worst = 5;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--json") json = true;
        else if (argv[i] === "--worst") worst = Number(argv[++i]);
        else paths.push(argv[i]!);
    }
    const [showPath, truthPath] = paths;
    if (!showPath || !truthPath) {
        console.error(
            "usage: node score.mts <show.dots> <truth.json> [--json] [--worst N]",
        );
        process.exit(2);
    }
    const truth = JSON.parse(readFileSync(truthPath, "utf8")) as TempoTruth;
    const report = scoreShow(readShow(showPath), truth, { worst });
    if (json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else
        process.stdout.write(
            `${basename(showPath)} vs ${basename(truthPath)} (${truth.title})\n${formatReport(report)}\n`,
        );
};

if (import.meta.url === `file://${process.argv[1]}`)
    main(process.argv.slice(2));
