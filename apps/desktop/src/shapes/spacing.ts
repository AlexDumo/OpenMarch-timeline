import type { Path } from "./geometry/path";
import type { IntervalRun, Slot, Spacing } from "./types";

/**
 * Spacing along a path, shared by every path kind.
 *
 * Intervals are typed in steps:
 * - one number is that interval for every gap: `2`;
 * - a list is one gap each, in order: `4,4,4,2,2,2,2`;
 * - `steps x gaps` repeats an interval: `4x3,2x4` is three gaps of 4 steps, then four of 2 (the
 *   same as the list above). Runs and single gaps can be mixed: `4x3,2,2`.
 *
 * A list shorter than the marchers need repeats from its start (`describeGaps` says so).
 */
export type ParsedIntervals =
    | { readonly ok: true; readonly runs: IntervalRun[] }
    | { readonly ok: false; readonly message: string };

const NUMBER = String.raw`(\d+(?:\.\d+)?|\.\d+)`;
const RUN = new RegExp(String.raw`^${NUMBER}(?:\s*[x×*]\s*(\d+))?$`, "i");

export function parseIntervals(text: string): ParsedIntervals {
    const parts = text
        .split(/[,;]/)
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
    if (parts.length === 0)
        return { ok: false, message: "Enter an interval in steps" };
    const runs: IntervalRun[] = [];
    for (const part of parts) {
        const match = RUN.exec(part);
        if (!match) {
            return {
                ok: false,
                message: `"${part}" isn't an interval. Type steps (2), a list (4,4,2) or steps x gaps (4x3)`,
            };
        }
        const steps = Number(match[1]);
        if (!(steps > 0))
            return {
                ok: false,
                message: "An interval must be more than 0 steps",
            };
        // A bare number is a single run that repeats for every gap.
        const count = match[2] === undefined ? 0 : Number(match[2]);
        if (match[2] !== undefined && !(count >= 1)) {
            return { ok: false, message: "A run needs at least 1 gap" };
        }
        runs.push({ steps, count });
    }
    // In a list, a bare number is a single gap; alone, it repeats for every gap
    if (runs.length > 1) {
        return {
            ok: true,
            runs: runs.map((run) =>
                run.count === 0 ? { ...run, count: 1 } : run,
            ),
        };
    }
    return { ok: true, runs };
}

const trim = (n: number) => String(Number(n.toFixed(4)));

export function formatIntervals(runs: readonly IntervalRun[]): string {
    return runs
        .map((run) =>
            run.count === 0 || (run.count === 1 && runs.length > 1)
                ? trim(run.steps)
                : `${trim(run.steps)}x${run.count}`,
        )
        .join(",");
}

/**
 * The `gapCount` gaps, in steps, that `runs` give. Runs repeat from the first when there are more
 * gaps than they cover; extra runs past `gapCount` are unused.
 */
export function gapsInSteps(
    runs: readonly IntervalRun[],
    gapCount: number,
): number[] {
    const gaps: number[] = [];
    if (runs.length === 0 || gapCount <= 0) return gaps;
    if (runs.length === 1 && runs[0]!.count === 0) {
        return Array.from({ length: gapCount }, () => runs[0]!.steps);
    }
    while (gaps.length < gapCount) {
        for (const run of runs) {
            for (let i = 0; i < run.count && gaps.length < gapCount; i++)
                gaps.push(run.steps);
        }
    }
    return gaps;
}

/** How many gaps the runs spell out, or undefined for a single repeating interval */
export function runsGapCount(runs: readonly IntervalRun[]): number | undefined {
    if (runs.length === 1 && runs[0]!.count === 0) return undefined;
    return runs.reduce((sum, run) => sum + run.count, 0);
}

/** The length, in field units, that `n` marchers cover with this spacing on `path` */
export function spacedLength(
    path: Path,
    spacing: Spacing,
    n: number,
    stepPx: number,
): number {
    if (spacing.mode === "fit") return path.length;
    if (spacing.size === "follow")
        return requiredLength(spacing.runs, n, path.closed, stepPx);
    // `sampleAlong` lays n - 1 gaps along a drawn shape, closed or not
    return (
        gapsInSteps(spacing.runs, n - 1).reduce((sum, g) => sum + g, 0) * stepPx
    );
}

/**
 * The path length `n` marchers need at these intervals: n − 1 gaps along an open path, n around
 * a closed one (the last gap closes the loop).
 */
export function requiredLength(
    runs: readonly IntervalRun[],
    n: number,
    closed: boolean,
    stepPx: number,
): number {
    const gaps = closed ? n : n - 1;
    return gapsInSteps(runs, gaps).reduce((sum, g) => sum + g, 0) * stepPx;
}

/**
 * `n` slots along `path`, tagged with their distance `s` from the path's start.
 *
 * Fit spreads them over the whole path (around it when closed). Interval lays the gaps from the
 * anchor: from the start, centered on the path's middle, or back from the end; a run longer than
 * the path continues past its end (see `Path.at`).
 */
export function sampleAlong(
    path: Path,
    spacing: Spacing,
    n: number,
    stepPx: number,
): Slot[] {
    if (n <= 0) return [];
    const offsets: number[] = [];
    if (spacing.mode === "fit") {
        if (n === 1) offsets.push(path.closed ? 0 : path.length / 2);
        else {
            const divisions = path.closed ? n : n - 1;
            for (let i = 0; i < n; i++)
                offsets.push((path.length * i) / divisions);
        }
    } else {
        const gaps = gapsInSteps(spacing.runs, n - 1).map((g) => g * stepPx);
        const total = gaps.reduce((sum, g) => sum + g, 0);
        // A shape that follows the interval is already as long as the run: lay it from the start
        let s =
            spacing.size === "follow" || spacing.anchor === "start"
                ? 0
                : spacing.anchor === "end"
                  ? path.length - total
                  : (path.length - total) / 2;
        offsets.push(s);
        for (const gap of gaps) {
            s += gap;
            offsets.push(s);
        }
    }
    return offsets.map((s) => ({ ...path.at(s), s }));
}

/**
 * What a typed list does for `n` marchers, when that isn't obvious: a list shorter than the gaps
 * needed repeats from its start, a longer one leaves its end unused. Undefined when it fits
 * exactly or is a single repeating interval.
 */
export function describeGaps(
    runs: readonly IntervalRun[],
    n: number,
): string | undefined {
    const given = runsGapCount(runs);
    const needed = Math.max(n - 1, 0);
    if (given === undefined || given === needed) return undefined;
    const gaps = (k: number) => `${k} ${k === 1 ? "gap" : "gaps"}`;
    return given < needed
        ? `${gaps(needed)} needed, ${given} typed: repeating from the first`
        : `${gaps(needed)} needed, ${given} typed: the last ${given - needed} unused`;
}
