/**
 * Re-importing a corrected MusicXML in place (Tempo lab `reimportInPlace`, E12). Pure.
 *
 * The show keeps its counts, pages and drill: a bar of the file that lines up with a bar of the
 * show with the same number of counts gives that bar's counts new lengths (a duration-only retime,
 * which never ripples and is never refused) and its rehearsal mark (a label). Bars that don't line
 * up are left alone and reported. Nothing here adds, removes or moves a count.
 *
 * Bars are lined up by rehearsal marks both versions share (each used once in each), with the
 * first bar lined up by measure number. Between two shared marks, the bars pair one to one only
 * when both versions have the same number of bars there; otherwise the whole stretch is reported
 * as different, because where bars were added inside it can't be told from counts alone
 * (docs/tempo/decisions.md RI-1).
 */
import { countTimes } from "./retime";
import { bpmOfRange, isEvenRange } from "./tempoReadout";

/** A measure of the show: its row id, the ordinal of its first count, and its mark. */
export interface ReimportShowMeasure {
    readonly id: number;
    readonly startOrdinal: number;
    readonly mark: string | null;
}

/** The show as the re-import reads it. */
export interface ReimportShow {
    /** Beat ids by ordinal; ordinal 0 is the fixed zero-length beat. */
    readonly beatIds: readonly number[];
    /** `durations[i]` is the length of `beatIds[i]` in seconds. */
    readonly durations: readonly number[];
    /** Measure lines in show order. */
    readonly measures: readonly ReimportShowMeasure[];
    /** The number the show gives its first measure. */
    readonly measurementOffset: number;
    /** Counts lined up with the recording (`tempoSyncedBeatIds`). */
    readonly syncedBeatIds: readonly number[];
}

/** A measure of the file, as the parser read it. */
export interface ReimportScoreMeasure {
    /** The file's measure number, or -1 when it has none. */
    readonly number: number;
    readonly mark?: string;
    /** One duration per count, in seconds. */
    readonly durations: readonly number[];
}

/** Bars of the show and of the file that don't line up. Ranges are measure indexes, `[from, to)`. */
export interface DifferingBars {
    readonly show: { readonly from: number; readonly to: number };
    readonly score: { readonly from: number; readonly to: number };
    /** The shared mark the stretch ends at, if any ("before L"). */
    readonly beforeMark?: string;
    /** The shared mark the stretch starts after, if any. */
    readonly afterMark?: string;
}

/** A run of paired bars whose tempo changes the same way. Ranges are show measure indexes. */
export interface ReimportTempoChange {
    readonly from: number;
    readonly to: number;
    readonly mark?: string;
    readonly before: { readonly bpm: number; readonly even: boolean };
    readonly after: { readonly bpm: number; readonly even: boolean };
}

export interface ReimportMarkChange {
    readonly measureIndex: number;
    readonly measureId: number;
    readonly from: string | null;
    readonly to: string | null;
}

export interface ReimportPlan {
    /** Every bar pairs with the bar at the same place, with the same counts. */
    readonly sameStructure: boolean;
    /** Show measure index to file measure index, ascending. */
    readonly pairs: readonly {
        readonly show: number;
        readonly score: number;
    }[];
    readonly differing: readonly DifferingBars[];
    /** The show's durations with the paired bars' counts at the file's lengths. */
    readonly durations: number[];
    /** Ordinals whose length changes with the file's timing. */
    readonly retimedOrdinals: readonly number[];
    readonly tempoChanges: readonly ReimportTempoChange[];
    readonly markChanges: readonly ReimportMarkChange[];
    /** The first measure's number, when the file numbers it differently and the first bars pair. */
    readonly measurementOffset: {
        readonly from: number;
        readonly to: number;
    } | null;
    /** Synced counts, and those the file's timing would move off the recording. */
    readonly synced: {
        readonly total: number;
        readonly moved: readonly number[];
    };
    /** The end of the show in seconds, now and with the file's timing. */
    readonly end: { readonly before: number; readonly after: number };
}

/** How far a count may move and still count as staying on the recording, in seconds. */
export const SYNCED_TOLERANCE_SECONDS = 0.001;

/** Show measure i's counts as an ordinal range. The last runs to the end of the show. */
function measureRanges(show: ReimportShow): { from: number; to: number }[] {
    const n = show.durations.length;
    return show.measures.map((m, i) => ({
        from: m.startOrdinal,
        to:
            i + 1 < show.measures.length
                ? show.measures[i + 1].startOrdinal
                : n,
    }));
}

const normalizeMark = (mark: string | null | undefined): string | undefined => {
    const t = mark?.trim();
    return t ? t : undefined;
};

/** Marks used exactly once, by index. */
function uniqueMarks(marks: (string | undefined)[]): Map<string, number> {
    const seen = new Map<string, number>();
    const dup = new Set<string>();
    marks.forEach((m, i) => {
        if (m === undefined) return;
        if (seen.has(m)) dup.add(m);
        else seen.set(m, i);
    });
    for (const m of dup) seen.delete(m);
    return seen;
}

interface Anchor {
    show: number;
    score: number;
    mark?: string;
}

/**
 * Where the two versions line up: the first bar (by measure number when that makes the stretch
 * up to the first shared mark the same length, else by position), each shared mark in order, and
 * the end.
 */
function anchorsOf(
    show: ReimportShow,
    score: readonly ReimportScoreMeasure[],
): Anchor[] {
    const showMarks = uniqueMarks(
        show.measures.map((m) => normalizeMark(m.mark)),
    );
    const scoreMarks = uniqueMarks(score.map((m) => normalizeMark(m.mark)));
    const shared: Anchor[] = [];
    for (const [mark, s] of [...showMarks].sort((a, b) => a[1] - b[1])) {
        const c = scoreMarks.get(mark);
        if (c === undefined) continue;
        const last = shared[shared.length - 1];
        // Keep marks in the same order in both; a mark that moved backwards isn't an anchor
        if (last && c <= last.score) continue;
        shared.push({ show: s, score: c, mark });
    }

    let start: Anchor = { show: 0, score: 0 };
    const firstScoreNumber = score[0]?.number;
    if (
        firstScoreNumber !== undefined &&
        firstScoreNumber !== show.measurementOffset
    ) {
        // A pickup added or dropped: line up the bars that have the same number
        const next = shared[0] ?? {
            show: show.measures.length,
            score: score.length,
        };
        const scoreAt = score.findIndex(
            (m) => m.number === show.measurementOffset,
        );
        const showAt = firstScoreNumber - show.measurementOffset;
        const candidates: Anchor[] = [];
        if (scoreAt > 0) candidates.push({ show: 0, score: scoreAt });
        if (showAt > 0 && showAt < show.measures.length)
            candidates.push({ show: showAt, score: 0 });
        start =
            candidates.find(
                (a) =>
                    a.show <= next.show &&
                    a.score <= next.score &&
                    next.show - a.show === next.score - a.score,
            ) ?? start;
    }
    const anchors = [
        start,
        ...shared.filter((a) => a.show >= start.show && a.score >= start.score),
    ];
    if (
        anchors[1] &&
        anchors[1].show === start.show &&
        anchors[1].score === start.score
    )
        anchors.splice(0, 1);
    return [...anchors, { show: show.measures.length, score: score.length }];
}

const sameDurations = (a: readonly number[], b: readonly number[]) =>
    a.length === b.length && a.every((d, i) => Math.abs(d - b[i]) < 1e-9);

/**
 * Lines the file's bars up with the show's and works out what an in-place re-import would change.
 */
// eslint-disable-next-line max-lines-per-function
export function planReimport(
    show: ReimportShow,
    score: readonly ReimportScoreMeasure[],
): ReimportPlan {
    const ranges = measureRanges(show);
    const pairs: { show: number; score: number }[] = [];
    const differing: DifferingBars[] = [];
    // Ordinal 0 is the fixed beat; a bar on it can't be retimed
    const fits = (s: number, c: number) =>
        ranges[s].to - ranges[s].from === score[c].durations.length &&
        ranges[s].from > 0;
    // Same bars with the same counts: pair them in order, whatever the marks say
    const sameBars =
        ranges.length === score.length && ranges.every((_, i) => fits(i, i));
    const anchors = sameBars
        ? [
              { show: 0, score: 0 },
              { show: ranges.length, score: score.length },
          ]
        : anchorsOf(show, score);
    const pushDiffering = (d: DifferingBars) => {
        const last = differing[differing.length - 1];
        if (
            last &&
            last.show.to === d.show.from &&
            last.score.to === d.score.from &&
            last.beforeMark === d.beforeMark
        )
            differing[differing.length - 1] = {
                ...last,
                show: { from: last.show.from, to: d.show.to },
                score: { from: last.score.from, to: d.score.to },
            };
        else differing.push(d);
    };

    // Before the first anchor (bars only one version has at the start)
    const first = anchors[0];
    if (first.show > 0 || first.score > 0)
        pushDiffering({
            show: { from: 0, to: first.show },
            score: { from: 0, to: first.score },
            beforeMark: first.mark,
        });

    for (let a = 0; a + 1 < anchors.length; a++) {
        const from = anchors[a];
        const to = anchors[a + 1];
        const showLen = to.show - from.show;
        const scoreLen = to.score - from.score;
        if (showLen !== scoreLen) {
            pushDiffering({
                show: { from: from.show, to: to.show },
                score: { from: from.score, to: to.score },
                afterMark: from.mark,
                beforeMark: to.mark,
            });
            continue;
        }
        for (let k = 0; k < showLen; k++) {
            const s = from.show + k;
            const c = from.score + k;
            if (fits(s, c)) pairs.push({ show: s, score: c });
            else
                pushDiffering({
                    show: { from: s, to: s + 1 },
                    score: { from: c, to: c + 1 },
                    afterMark: from.mark,
                    beforeMark: to.mark,
                });
        }
    }

    const durations = [...show.durations];
    for (const p of pairs) {
        const range = ranges[p.show];
        score[p.score].durations.forEach((d, k) => {
            durations[range.from + k] = d;
        });
    }
    const retimedOrdinals = durations.flatMap((d, i) =>
        Math.abs(d - show.durations[i]) > 1e-9 ? [i] : [],
    );

    const tempoChanges: ReimportTempoChange[] = [];
    for (const p of pairs) {
        const { from, to } = ranges[p.show];
        if (
            sameDurations(
                show.durations.slice(from, to),
                durations.slice(from, to),
            )
        )
            continue;
        const before = {
            bpm: round1(bpmOfRange(show.durations as number[], from, to) ?? 0),
            even: isEvenRange(show.durations as number[], from, to),
        };
        const after = {
            bpm: round1(bpmOfRange(durations, from, to) ?? 0),
            even: isEvenRange(durations, from, to),
        };
        const last = tempoChanges[tempoChanges.length - 1];
        const mark = normalizeMark(show.measures[p.show].mark);
        if (
            last &&
            last.to === p.show &&
            !mark &&
            sameReading(last.before, before) &&
            sameReading(last.after, after)
        )
            tempoChanges[tempoChanges.length - 1] = { ...last, to: p.show + 1 };
        else
            tempoChanges.push({
                from: p.show,
                to: p.show + 1,
                mark,
                before,
                after,
            });
    }

    const markChanges: ReimportMarkChange[] = pairs.flatMap((p) => {
        const m = show.measures[p.show];
        const from = normalizeMark(m.mark) ?? null;
        const to = normalizeMark(score[p.score].mark) ?? null;
        return from === to
            ? []
            : [{ measureIndex: p.show, measureId: m.id, from, to }];
    });

    const firstNumber = score[0]?.number;
    const firstPaired = pairs[0]?.show === 0 && pairs[0]?.score === 0;
    const measurementOffset =
        firstPaired &&
        firstNumber !== undefined &&
        firstNumber >= 0 &&
        firstNumber !== show.measurementOffset
            ? { from: show.measurementOffset, to: firstNumber }
            : null;

    const timesBefore = countTimes(show.durations as number[]);
    const timesAfter = countTimes(durations);
    const ordinalOf = new Map(show.beatIds.map((id, i) => [id, i]));
    const synced = show.syncedBeatIds.filter((id) => ordinalOf.has(id));
    const moved = synced.filter((id) => {
        const i = ordinalOf.get(id)!;
        return (
            Math.abs(timesAfter[i] - timesBefore[i]) > SYNCED_TOLERANCE_SECONDS
        );
    });

    return {
        sameStructure: sameBars && (show.measures[0]?.startOrdinal ?? 1) === 1,
        pairs,
        differing,
        durations,
        retimedOrdinals,
        tempoChanges,
        markChanges,
        measurementOffset,
        synced: { total: synced.length, moved },
        end: {
            before: timesBefore[timesBefore.length - 1],
            after: timesAfter[timesAfter.length - 1],
        },
    };
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const sameReading = (
    a: { bpm: number; even: boolean },
    b: { bpm: number; even: boolean },
) => a.bpm === b.bpm && a.even === b.even;

/** Whether the re-import would change anything with this timing choice. */
export function reimportChangesAnything(
    plan: ReimportPlan,
    timing: ReimportTiming,
): boolean {
    return (
        plan.markChanges.length > 0 ||
        plan.measurementOffset !== null ||
        (timing === "score" && plan.retimedOrdinals.length > 0)
    );
}

/**
 * `"score"` writes the file's count lengths; `"keep"` keeps the show's timing (and its alignment
 * to the recording) and updates labels only.
 */
export type ReimportTiming = "score" | "keep";

/** Keep the show's timing when it is lined up with the recording, else use the file's. */
export const defaultReimportTiming = (plan: ReimportPlan): ReimportTiming =>
    plan.synced.total > 0 ? "keep" : "score";

/**
 * The synced counts after a re-import: with the file's timing, counts it moved off the recording
 * are no longer synced; the rest stay.
 */
export function syncedAfterReimport(
    show: ReimportShow,
    plan: ReimportPlan,
    timing: ReimportTiming,
): number[] {
    if (timing === "keep") return [...show.syncedBeatIds];
    const moved = new Set(plan.synced.moved);
    return show.syncedBeatIds.filter((id) => !moved.has(id));
}

/** The parsed file's measures as the re-import takes them. */
export function scoreMeasuresOf(
    measures: readonly {
        number: number;
        rehearsalMark?: string;
        beats: readonly { duration: number }[];
    }[],
): ReimportScoreMeasure[] {
    return measures.map((m) => ({
        number: m.number,
        mark: m.rehearsalMark,
        durations: m.beats.map((b) => b.duration),
    }));
}
