/**
 * "Tap the beat" (E6): a few taps along with the music set the tempo, and, from the start, where
 * count 1 is. Pure; times in seconds of the current show time (the time playback reports).
 *
 * Both starting points scale the counts proportionally rather than setting every count to the
 * tapped tempo, so a score's tempo changes keep their shape (Marcus): only the tapped stretch is
 * matched to the taps, and everything after it is scaled by the same factor.
 */
import {
    countTimes,
    respaceProportional,
    spanLimits,
    spanOf,
    type CountDurations,
    type CountRange,
    type SyncedCounts,
} from "./retime";
import type { TapTempo } from "./tapTempo";

/** Where tapping starts: count 1 (and the taps say where it is), or the count at the playhead. */
export type TapStart =
    | { readonly kind: "start" }
    | { readonly kind: "here"; readonly count: number };

/** The tapped tempo is taken as is (1), as twice as fast (2) or as half as fast (0.5). */
export type TapMultiplier = 0.5 | 1 | 2;

/** Taps at or above this confidence (`tempoFromTaps`) read as steady: "That's steady". */
export const TAP_STEADY_CONFIDENCE = 0.75;
/** Fewer taps than this never apply: two or three taps can't tell a beat from a stumble. */
export const MIN_TAPS_TO_APPLY = 4;

export interface TapTheBeatArgs {
    durations: CountDurations;
    start: TapStart;
    fit: TapTempo;
    multiplier?: TapMultiplier;
    /** Synced counts: the counts after the tapped stretch re-space up to the first one. */
    synced?: SyncedCounts;
}

export interface TapTheBeatPlan {
    /** New durations, same length as the input. */
    durations: number[];
    /** Seconds count 1 moved (for the audio offset); 0 when tapping from here. */
    originShift: number;
    /** The tempo the taps set, after the multiplier, per minute. */
    bpm: number;
    /** The first count that changes: 1 from the start, else the playhead's count. */
    fromCount: number;
    /** The counts matched to the taps: `[from, to)`. Later counts are scaled with them. */
    tapped: { from: number; to: number };
    /** The synced count from which nothing moves, or null. */
    heldFrom: number | null;
    /** Synced counts the edit moved (inside the tapped stretch); they are no longer on the music. */
    unsynced: number[];
    /** Whether the count limits held the result back from the taps. */
    clamped: boolean;
}

/** The highest beat number the fit gave a tap (how many beats the taps span). */
const lastTapBeat = (fit: TapTempo): number =>
    fit.beats.reduce<number>((m, b) => (b !== null && b > m ? b : m), 0);

/** `factor`, limited so no count in `[from, to)` leaves the count limits. */
function clampFactor(
    durations: CountDurations,
    from: number,
    to: number,
    factor: number,
): { factor: number; clamped: boolean } {
    const old = spanOf(durations, from, to);
    if (!(old > 0)) return { factor, clamped: false };
    const [min, max] = spanLimits(durations, from, to);
    const lo = min / old;
    const hi = max / old;
    if (factor < lo) return { factor: lo, clamped: true };
    if (factor > hi) return { factor: hi, clamped: true };
    return { factor, clamped: false };
}

/** Clamps a new span for `[from, to)` into what the count limits allow. */
function clampSpan(
    durations: CountDurations,
    from: number,
    to: number,
    span: number,
): { span: number; clamped: boolean } {
    const [min, max] = spanLimits(durations, from, to);
    if (span < min) return { span: min, clamped: true };
    if (span > max) return { span: max, clamped: true };
    return { span, clamped: false };
}

const toArray = (synced: SyncedCounts | undefined): number[] =>
    [...(synced ?? [])].sort((a, b) => a - b);

/**
 * Turns a run of taps into new count lengths.
 *
 * - **From the start:** the first tap is count 1. Count 1 moves to the fitted time of the first
 *   tap (`originShift`, which the write path turns into an audio offset change), and the counts
 *   the taps span get the tapped tempo on average.
 * - **From here:** the playhead's count `c` stays where it is. The first beat tapped after it
 *   lands on the taps' grid (count `c` absorbs the difference, at most half a beat either way),
 *   and the counts the taps span get the tapped tempo on average. Counts before `c` don't change.
 *
 * In both, every count from the tapped stretch to the end of the show is scaled by the same
 * factor, so relative lengths (score tempo changes, holds) are kept, not flattened. When a synced
 * count follows the tapped stretch, the counts between re-space so it stays on the music and
 * nothing after it moves. Durations only: no count is added or removed. Returns null when the
 * show has no counts to retime.
 */
// eslint-disable-next-line max-lines-per-function
export function planTapTheBeat({
    durations,
    start,
    fit,
    multiplier = 1,
    synced,
}: TapTheBeatArgs): TapTheBeatPlan | null {
    const n = durations.length;
    if (n < 2 || !(fit.period > 0)) return null;
    const period = fit.period / multiplier;
    const oldTimes = countTimes(durations);
    let clamped = false;
    let out = durations.slice();

    // The fixed point, and the first tapped count with the time it should start at
    let fromCount: number;
    let firstTapped: number;
    let firstTappedTime: number;
    let originShift = 0;
    if (start.kind === "start") {
        fromCount = 1;
        firstTapped = 1;
        originShift = fit.firstBeatTime;
        firstTappedTime = 0; // in the new show time, count 1 is 0
    } else {
        fromCount = Math.min(Math.max(Math.round(start.count), 1), n - 1);
        const t = oldTimes[fromCount];
        let k = Math.round((fit.firstBeatTime - t) / period);
        let firstTime = fit.firstBeatTime;
        // Tapping began on the playhead's count, or before it: use the next beat on the taps'
        // grid, so count `c` itself stays put and still absorbs the phase
        if (k < 1) {
            firstTime += (1 - k) * period;
            k = 1;
        }
        if (fromCount + k > n - 1) {
            k = n - 1 - fromCount;
            firstTime = t + k * period;
        }
        firstTapped = fromCount + k;
        firstTappedTime = firstTime;
    }

    const beats = Math.max(1, Math.round(lastTapBeat(fit) * multiplier));
    const tappedTo = Math.min(n, firstTapped + Math.max(beats, 1));
    const ref = spanOf(durations, firstTapped, tappedTo);
    const count = tappedTo - firstTapped;

    // Scale the tapped stretch and everything after it by one factor
    if (count > 0 && ref > 0) {
        const wanted = (count * period) / ref;
        const f = clampFactor(durations, firstTapped, n, wanted);
        clamped ||= f.clamped;
        for (let i = firstTapped; i < n; i++) out[i] = durations[i] * f.factor;
    } else if (count > 0) {
        for (let i = firstTapped; i < n; i++) out[i] = period;
    }

    // From here: the counts from the playhead to the first tapped count fill the gap
    if (firstTapped > fromCount) {
        const want = firstTappedTime - oldTimes[fromCount];
        const s = clampSpan(durations, fromCount, firstTapped, want);
        clamped ||= s.clamped;
        out = respaceProportional(out, fromCount, firstTapped, s.span);
    }

    // Keep the first synced count after the tapped stretch on the music: its show time moves by
    // -originShift with the audio offset, so it stays at the same moment of the recording
    const syncedList = toArray(synced);
    let heldFrom: number | null = null;
    const hold = syncedList.find((s) => s >= tappedTo && s < n);
    if (hold !== undefined) {
        const newTimes = countTimes(out);
        const target = oldTimes[hold] - originShift;
        const span = target - newTimes[tappedTo];
        const [min, max] = spanLimits(out, tappedTo, hold);
        if (hold > tappedTo && span >= min && span <= max) {
            out = respaceProportional(out, tappedTo, hold, span);
            for (let i = hold; i < n; i++) out[i] = durations[i];
            heldFrom = hold;
        } else if (hold === tappedTo && Math.abs(span) < 1e-9) {
            for (let i = hold; i < n; i++) out[i] = durations[i];
            heldFrom = hold;
        } else clamped = true;
    }

    // Synced counts that moved against the music are no longer on it
    const finalTimes = countTimes(out);
    const unsynced = syncedList.filter(
        (s) =>
            s > 1 &&
            s < n &&
            Math.abs(finalTimes[s] - (oldTimes[s] - originShift)) > 1e-6,
    );

    return {
        durations: out,
        originShift,
        bpm: 60 / period,
        fromCount,
        tapped: { from: firstTapped, to: tappedTo },
        heldFrom,
        unsynced,
        clamped,
    };
}

/** What the tap panel says about the taps so far. */
export type TapProgress =
    /** Fewer than two usable taps: nothing to show yet */
    | { readonly kind: "waiting"; readonly taps: number }
    /** A tempo, but not steady or not enough taps yet */
    | {
          readonly kind: "keepGoing";
          readonly taps: number;
          readonly fit: TapTempo;
      }
    /** Steady enough to apply */
    | {
          readonly kind: "steady";
          readonly taps: number;
          readonly fit: TapTempo;
      };

/** Classifies a fit for the panel's "Keep going…" / "That's steady" line. */
export function tapProgress(taps: number, fit: TapTempo | null): TapProgress {
    if (!fit) return { kind: "waiting", taps };
    if (taps >= MIN_TAPS_TO_APPLY && fit.confidence >= TAP_STEADY_CONFIDENCE)
        return { kind: "steady", taps, fit };
    return { kind: "keepGoing", taps, fit };
}

/** Whether a run of taps may be applied: enough taps for a tempo, steady or not (the user stopped). */
export const canApplyTaps = (taps: number, fit: TapTempo | null): boolean =>
    fit !== null && taps >= MIN_TAPS_TO_APPLY;

/** The next multiplier after pressing ×2 (`up`) or ÷2; stays within ÷2 to ×2. */
export function nextMultiplier(
    current: TapMultiplier,
    direction: "up" | "down",
): TapMultiplier {
    if (direction === "up") return current === 0.5 ? 1 : 2;
    return current === 2 ? 1 : 0.5;
}

export interface LineUpStripInput {
    /** The Tempo lab flag */
    enabled: boolean;
    /** The show has music loaded */
    hasAudio: boolean;
    /** Synced counts stored in the file */
    syncedCount: number;
    /** The strip was dismissed for this file, or tapping was applied */
    dismissed: boolean;
    /** The file's audio offset; non-zero means someone already set where the music starts */
    audioOffsetSeconds: number;
}

/**
 * Whether the waveform lane shows "Counts aren't lined up with the music yet": only for a show
 * with music that nobody has lined up (no synced counts, no audio offset) and that hasn't
 * dismissed it.
 */
export const showLineUpStrip = ({
    enabled,
    hasAudio,
    syncedCount,
    dismissed,
    audioOffsetSeconds,
}: LineUpStripInput): boolean =>
    enabled &&
    hasAudio &&
    !dismissed &&
    syncedCount === 0 &&
    audioOffsetSeconds === 0;

/** "0:01.84": minutes, seconds and hundredths, for times in the recording. Negative as "-0:00.50". */
export function formatMusicTime(seconds: number): string {
    const sign = seconds < 0 ? "-" : "";
    const hundredths = Math.round(Math.abs(seconds) * 100);
    const m = Math.floor(hundredths / 6000);
    const s = Math.floor((hundredths % 6000) / 100);
    const h = hundredths % 100;
    return `${sign}${m}:${String(s).padStart(2, "0")}.${String(h).padStart(2, "0")}`;
}

/** A gap longer than this between taps starts a new run: the user stopped, or playback jumped. */
export const TAP_RUN_GAP_SECONDS = 3;

/**
 * Adds a tap at `time` (show seconds) to a run. A tap earlier than the last one (playback jumped
 * back or restarted) or more than `TAP_RUN_GAP_SECONDS` after it starts a new run with it.
 */
export function addTap(taps: readonly number[], time: number): number[] {
    const last = taps[taps.length - 1];
    if (last === undefined || time < last || time - last > TAP_RUN_GAP_SECONDS)
        return [time];
    return [...taps, time];
}

/**
 * The synced counts after applying a tap plan (docs/tempo/decisions.md FB-1): the ones it moved
 * off the music are dropped, and the counts the taps put on the music join them: the first and
 * last tapped counts, and from here, the playhead's count too (it stays put), so a later Align
 * drag can't re-tempo the counts before it. Count 1 is always synced and isn't listed. Ascending.
 */
export function syncedAfterTaps(
    previous: readonly number[],
    plan: TapTheBeatPlan,
    countCount: number,
): number[] {
    const moved = new Set(plan.unsynced);
    const out = new Set(previous.filter((s) => !moved.has(s)));
    const add = (index: number) => {
        if (Number.isInteger(index) && index > 1 && index < countCount)
            out.add(index);
    };
    add(plan.fromCount);
    add(plan.tapped.from);
    add(plan.tapped.to);
    return [...out].sort((a, b) => a - b);
}

/** Tapped tempos outside this range per minute are likelier the wrong pulse than the music's */
export const PLAUSIBLE_TAP_BPM = { min: 60, max: 200 } as const;

/**
 * Whether a tapped tempo looks like the wrong pulse: `fast` above ~200 per minute (twice per
 * count?), `slow` below ~60 (every other count?), else null.
 */
export function tapPlausibility(bpm: number): "fast" | "slow" | null {
    if (!(bpm > 0)) return null;
    if (bpm > PLAUSIBLE_TAP_BPM.max) return "fast";
    if (bpm < PLAUSIBLE_TAP_BPM.min) return "slow";
    return null;
}

/** The fractional count index at `time` on counts starting at `times` (as `countTimes` gives). */
export function countAtTime(times: readonly number[], time: number): number {
    const n = times.length - 1;
    if (n < 1) return 0;
    if (time <= times[1]!) return 1;
    if (time >= times[n]!) return n;
    let lo = 1;
    let hi = n - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >>> 1;
        if (times[mid]! <= time) lo = mid;
        else hi = mid - 1;
    }
    const length = times[lo + 1]! - times[lo]!;
    return length > 0 ? lo + (time - times[lo]!) / length : lo;
}

/**
 * Where a tap plan would put the counts it changes, drawn over the timing as it is: for each count
 * from `plan.fromCount` up to where nothing moves (`heldFrom`, else the end), the fractional count
 * index of the current timing at the moment of the music it would land on. A count that moves
 * later reads as a larger index. `changed` is that range, for the flash after applying.
 */
export function tapGhostCounts(
    before: CountDurations,
    plan: TapTheBeatPlan,
): { counts: { index: number; at: number }[]; changed: CountRange } {
    const n = before.length;
    const oldTimes = countTimes(before);
    const newTimes = countTimes(plan.durations);
    const to = Math.min(plan.heldFrom ?? n, n);
    const counts: { index: number; at: number }[] = [];
    for (let i = Math.max(1, plan.fromCount); i <= to; i++)
        counts.push({
            index: i,
            // Show time t after applying is t + originShift before it
            at: countAtTime(oldTimes, newTimes[i]! + plan.originShift),
        });
    return { counts, changed: { from: plan.fromCount, to } };
}

/**
 * When the plan's counts would land, in the current show time, from `fromTime` on, for clicks
 * that preview the plan before it's applied.
 */
export function tapPlanClickTimes(
    plan: TapTheBeatPlan,
    fromTime: number,
): number[] {
    const times = countTimes(plan.durations);
    const out: number[] = [];
    for (let i = 1; i < times.length; i++) {
        const t = times[i]! + plan.originShift;
        if (t >= fromTime - 1e-9) out.push(t);
    }
    return out;
}

/** Counts past the last synced count before Tap the beat suggests tapping again from here */
export const TAP_AGAIN_COUNTS = 32;

/**
 * Whether to suggest "Tap again from here": the show has been lined up somewhere (synced counts),
 * and the playhead is at least `TAP_AGAIN_COUNTS` counts past the last synced count before it
 * (count 1 counts), so tapping there would line up music nobody has checked.
 */
export function suggestTapAgain(
    playheadCount: number,
    synced: readonly number[],
): boolean {
    if (synced.length === 0 || playheadCount <= 1) return false;
    let previous = 1;
    for (const s of synced)
        if (s <= playheadCount && s > previous) previous = s;
    return playheadCount - previous >= TAP_AGAIN_COUNTS;
}
