import type {
    DifferingBars,
    ReimportPlan,
    ReimportScoreMeasure,
    ReimportShow,
    ReimportTiming,
} from "@/timeline/tempo/reimport";
import { formatDuration } from "./musicXmlPreview";

/**
 * Pure helpers for the "Re-import" part of the MusicXML preview (E12): what an in-place
 * re-import changes, as lines of translation keys and parameters. The dialog only translates and
 * lays them out.
 */

/** One line of the re-import summary: a key under `music.xmlPreview.reimport` and its params. */
export interface ReimportLine {
    key: string;
    params: Record<string, string | number>;
    /** Shown as a warning (bars that don't line up) */
    warning?: boolean;
}

/** At most this many tempo lines; the rest are counted. */
export const MAX_TEMPO_LINES = 6;

/** "m41" or "m41–48", from show measure indexes `[from, to)`. */
export function showMeasureRange(
    show: Pick<ReimportShow, "measurementOffset">,
    from: number,
    to: number,
): string {
    const a = from + show.measurementOffset;
    const b = to - 1 + show.measurementOffset;
    return b > a ? `m${a}–${b}` : `m${a}`;
}

/** "m83" or "m83–84" as the file numbers its measures (by position when it has no numbers). */
export function scoreMeasureRange(
    score: readonly ReimportScoreMeasure[],
    from: number,
    to: number,
): string {
    const label = (i: number) =>
        score[i] && score[i].number >= 0 ? score[i].number : i + 1;
    const a = label(from);
    const b = label(to - 1);
    return to - 1 > from ? `m${a}–${b}` : `m${a}`;
}

const formatBpm = (r: { bpm: number; even: boolean }) =>
    `${r.even ? "" : "≈"}${r.bpm}`;

/** How a stretch of bars that don't line up reads. */
export function differingLine(
    d: DifferingBars,
    show: ReimportShow,
    score: readonly ReimportScoreMeasure[],
): ReimportLine {
    const showBars = d.show.to - d.show.from;
    const scoreBars = d.score.to - d.score.from;
    const where = d.beforeMark
        ? { kind: "before", mark: d.beforeMark }
        : d.afterMark
          ? { kind: "after", mark: d.afterMark }
          : d.show.from === 0 && d.score.from === 0
            ? { kind: "start", mark: "" }
            : { kind: "end", mark: "" };
    const params = {
        where: where.kind,
        mark: where.mark,
        here:
            showBars > 0 ? showMeasureRange(show, d.show.from, d.show.to) : "",
        file:
            scoreBars > 0
                ? scoreMeasureRange(score, d.score.from, d.score.to)
                : "",
    };
    if (showBars === 0)
        return {
            key: "added",
            params: { ...params, count: scoreBars },
            warning: true,
        };
    if (scoreBars === 0)
        return {
            key: "removed",
            params: { ...params, count: showBars },
            warning: true,
        };
    if (showBars === scoreBars)
        return { key: "countsDiffer", params, warning: true };
    return {
        key: scoreBars > showBars ? "moreBars" : "fewerBars",
        params: {
            ...params,
            count: Math.abs(scoreBars - showBars),
            showBars,
            scoreBars,
        },
        warning: true,
    };
}

/**
 * The summary: whether the bars line up, then (with the file's timing) where the tempo changes
 * and when the show ends, then marks, numbering, and the bars that don't line up.
 */
export function reimportLines(
    show: ReimportShow,
    score: readonly ReimportScoreMeasure[],
    plan: ReimportPlan,
    timing: ReimportTiming,
): ReimportLine[] {
    const lines: ReimportLine[] = [];
    if (plan.sameStructure) lines.push({ key: "same", params: {} });
    else if (plan.pairs.length > 0)
        lines.push({
            key: "partial",
            params: { count: plan.pairs.length, total: score.length },
        });

    if (plan.tempoChanges.length > 0 && timing === "keep")
        lines.push({
            key: "timingKept",
            params: { count: plan.tempoChanges.length },
        });
    if (timing === "score") {
        for (const c of plan.tempoChanges.slice(0, MAX_TEMPO_LINES))
            lines.push({
                key: "tempo",
                params: {
                    measures: `${showMeasureRange(show, c.from, c.to)}${c.mark ? ` (${c.mark})` : ""}`,
                    before: formatBpm(c.before),
                    after: formatBpm(c.after),
                },
            });
        if (plan.tempoChanges.length > MAX_TEMPO_LINES)
            lines.push({
                key: "moreTempo",
                params: { count: plan.tempoChanges.length - MAX_TEMPO_LINES },
            });
        const delta = plan.end.after - plan.end.before;
        if (Math.abs(delta) >= 0.05)
            lines.push({
                key: "end",
                params: {
                    before: formatDuration(plan.end.before),
                    after: formatDuration(plan.end.after),
                    delta: `${delta > 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)}`,
                },
            });
    }

    for (const m of plan.markChanges) {
        const measure = showMeasureRange(
            show,
            m.measureIndex,
            m.measureIndex + 1,
        );
        if (m.from === null)
            lines.push({ key: "markAdded", params: { measure, mark: m.to! } });
        else if (m.to === null)
            lines.push({
                key: "markRemoved",
                params: { measure, mark: m.from },
            });
        else
            lines.push({
                key: "markRenamed",
                params: { measure, from: m.from, to: m.to },
            });
    }
    if (plan.measurementOffset)
        lines.push({ key: "numbering", params: { ...plan.measurementOffset } });

    for (const d of plan.differing) lines.push(differingLine(d, show, score));
    return lines;
}
