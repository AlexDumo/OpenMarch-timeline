/**
 * The tempo map (Tempo lab `tempoMap`): one row per tempo or meter change at a measure, derived
 * from the show's count durations and measures, and the duration-only edits its cells make. Pure.
 *
 * Counts carry no note values, so a measure's meter is read from its counts' relative lengths
 * (three counts at 2:2:3 are 7/8 2+2+3) unless a typed row says otherwise: 12/8 at ♩.=152.5 and
 * 4/4 at ♩=152.5 have the same counts. Typed rows are stored as **marks** (a meter and a beat unit
 * at a measure), which also keep the row in the map when the tempo doesn't change there.
 */
import { MAX_COUNT_SECONDS, MIN_COUNT_SECONDS, countTimes } from "./retime";
import { setRangeRamp } from "./ramp";
import {
    UNIT_SIXTEENTHS,
    convertBpm,
    defaultUnit,
    meterCounts,
    meterFromWeights,
    meterWeights,
    sameMeter,
    type BeatUnit,
    type Meter,
    type RampCell,
    type TempoCell,
} from "./tempoMapParse";

/** Slowest tempo a cell may type, in beats of its unit per minute (Beat.ts `MIN_TEMPO_BPM`). */
export const MIN_TYPED_BPM = 40;
/** Relative difference under which two counts play at the same tempo ("=" rather than "≈"). */
export const STEADY_TOLERANCE = 1e-7;
/** Relative difference under which a row's tempos lie on a straight line (a rit. or accel.). */
export const RAMP_TOLERANCE = 1e-6;
/** How close count lengths must be to 2:2:3-style ratios to read as a grouping. */
const GROUPING_TOLERANCE = 0.03;

/** A measure as the map needs it. */
export interface TempoMapMeasure {
    /** The measure's number as shown (with the show's measure offset). */
    readonly number: number;
    readonly rehearsalMark: string | null;
    /** The count (beat ordinal) the measure starts on. */
    readonly firstCount: number;
    /** How many counts it has. */
    readonly counts: number;
}

/** What a typed row says about the measures from it on: a meter, a beat unit or both. */
export interface TempoMapMark {
    readonly meter?: Meter;
    readonly unit?: BeatUnit;
}

/** Marks by measure index (into the measures passed to the map). */
export type TempoMapMarks = ReadonlyMap<number, TempoMapMark>;

/**
 * - `steady`: every count at the same tempo ("♩=152.5");
 * - `ramp`: the tempo changes by the same amount every count (rit. or accel. "to ♩=100");
 * - `uneven`: anything else (holds, live timing), shown as an average ("♩≈131.4").
 */
export type TempoMapShape = "steady" | "ramp" | "uneven";

export interface TempoMapRow {
    /** Index of the row's first measure, and one past its last. */
    readonly measureIndex: number;
    readonly endMeasureIndex: number;
    readonly measureNumber: number;
    readonly rehearsalMark: string | null;
    /** The row's counts, `[from, to)`. */
    readonly from: number;
    readonly to: number;
    readonly meter: Meter;
    /** The meter was read from count lengths, not typed. */
    readonly meterInferred: boolean;
    readonly unit: BeatUnit;
    readonly shape: TempoMapShape;
    /** Tempo of the first and last count, in beats of `unit` per minute. */
    readonly startBpm: number;
    readonly endBpm: number;
    /** Beats of `unit` per minute over the whole row. */
    readonly averageBpm: number;
    /** When the row's first count starts, in seconds of show time. */
    readonly startTime: number;
    /** A typed row: it has a mark (its first count is also synced once typed). */
    readonly typed: boolean;
    /** Each count's length in beats of `unit` (1.5 for the long count of 7/8 2+2+3 in ♩). */
    readonly weights: readonly number[];
}

const close = (a: number, b: number, tolerance: number) =>
    Math.abs(a - b) <= tolerance * Math.max(Math.abs(a), Math.abs(b));

/**
 * The meter a measure's counts suggest: 2:2:3 reads as 7/8 2+2+3 and 3:2 as 5/8 3+2 (ratios of 1,
 * 1.5 and 2 to the shortest count); anything else, including equal counts, as n/4.
 */
export function inferMeter(durations: readonly number[]): Meter {
    const plain: Meter = { top: durations.length, bottom: 4, groups: null };
    if (durations.length < 2 || durations.some((d) => !(d > 0))) return plain;
    const shortest = Math.min(...durations);
    const halves = durations.map((d) => (2 * d) / shortest);
    const rounded = halves.map(Math.round);
    if (
        rounded.every((w) => w === 2) ||
        rounded.some((w) => w < 2 || w > 4) ||
        halves.some((h, i) => !close(h, rounded[i], GROUPING_TOLERANCE))
    )
        return plain;
    return meterFromWeights(rounded.map((w) => w * 2));
}

/** Each count's length in beats of `unit`. */
export const unitWeights = (meter: Meter, unit: BeatUnit): number[] =>
    meterWeights(meter).map((s) => s / UNIT_SIXTEENTHS[unit]);

interface MeasureProfile {
    readonly meter: Meter;
    readonly inferred: boolean;
    readonly unit: BeatUnit;
    readonly marked: boolean;
    readonly from: number;
    readonly to: number;
    readonly weights: number[];
    /** Tempo of each count; NaN for a zero-length count. */
    readonly bpms: number[];
}

/** Whether two meters' counts have the same relative lengths. */
const sameShape = (a: Meter, b: Meter) => {
    const wa = meterWeights(a);
    const wb = meterWeights(b);
    return (
        wa.length === wb.length &&
        wa.every((w, i) => close(w / wa[0], wb[i] / wb[0], 1e-9))
    );
};

const isSteady = (bpms: readonly number[]) =>
    bpms.every(
        (b) => Number.isFinite(b) && close(b, bpms[0], STEADY_TOLERANCE),
    );

function profiles(
    durations: readonly number[],
    measures: readonly TempoMapMeasure[],
    marks: TempoMapMarks,
): MeasureProfile[] {
    const out: MeasureProfile[] = [];
    // A mark's meter and unit carry on through the measures after it that have as many counts
    let carried: { meter?: Meter; unit?: BeatUnit } = {};
    measures.forEach((m, i) => {
        const from = Math.max(m.firstCount, 1);
        const to = Math.min(m.firstCount + m.counts, durations.length);
        const own = durations.slice(from, to);
        const mark = marks.get(i);
        if (mark) carried = { ...mark };
        const inferred = inferMeter(own);
        // A mark stops at a measure with another number of counts or another grouping
        if (
            carried.meter &&
            (meterCounts(carried.meter) !== own.length ||
                (inferred.groups !== null &&
                    !sameShape(inferred, carried.meter)))
        )
            carried = {};
        const meter = carried.meter ?? inferred;
        const unit = carried.unit ?? defaultUnit(meter);
        const weights =
            meterCounts(meter) === own.length
                ? unitWeights(meter, unit)
                : own.map(() => 1);
        out.push({
            meter,
            inferred: carried.meter === undefined,
            unit,
            marked: mark !== undefined,
            from,
            to,
            weights,
            bpms: own.map((d, k) => (d > 0 ? (weights[k] * 60) / d : NaN)),
        });
    });
    return out;
}

function shapeOf(bpms: readonly number[]): TempoMapShape {
    if (isSteady(bpms)) return "steady";
    if (bpms.length < 3 || bpms.some((b) => !Number.isFinite(b)))
        return "uneven";
    const first = bpms[0];
    const last = bpms[bpms.length - 1];
    const n = bpms.length - 1;
    return bpms.every((b, k) =>
        close(b, first + ((last - first) * k) / n, RAMP_TOLERANCE),
    )
        ? "ramp"
        : "uneven";
}

/**
 * The tempo map: a row where a typed mark is, where the meter or unit changes, where a steady
 * tempo changes, and where steady counts turn uneven or back. Uneven measures in a row stay one
 * row, so a rit. over two bars is one row. Measures with no counts are left out.
 */
export function deriveTempoMap({
    durations,
    measures,
    marks = new Map(),
}: {
    durations: readonly number[];
    measures: readonly TempoMapMeasure[];
    marks?: TempoMapMarks;
}): TempoMapRow[] {
    const times = countTimes(durations);
    const all = profiles(durations, measures, marks);
    const groups: { start: number; end: number }[] = [];
    let rowSteadyBpm: number | null = null;
    let rowSteady = false;
    all.forEach((p, i) => {
        if (p.to <= p.from) return;
        const steady = isSteady(p.bpms);
        const current = groups[groups.length - 1];
        const prev = current ? all[current.end - 1] : undefined;
        const continues =
            current !== undefined &&
            current.end === i &&
            !p.marked &&
            prev !== undefined &&
            sameMeter(prev.meter, p.meter) &&
            prev.unit === p.unit &&
            (steady
                ? rowSteady && close(rowSteadyBpm!, p.bpms[0], STEADY_TOLERANCE)
                : !rowSteady);
        if (continues) {
            current.end = i + 1;
            return;
        }
        groups.push({ start: i, end: i + 1 });
        rowSteady = steady;
        rowSteadyBpm = steady ? p.bpms[0] : null;
    });
    return groups.map(({ start, end }) => {
        const first = all[start];
        const members = all.slice(start, end);
        const bpms = members.flatMap((p) => p.bpms);
        const weights = members.flatMap((p) => p.weights);
        const from = first.from;
        const to = all[end - 1].to;
        const span = times[to] - times[from];
        const totalWeight = weights.reduce((a, b) => a + b, 0);
        const shape = shapeOf(bpms);
        return {
            measureIndex: start,
            endMeasureIndex: end,
            measureNumber: measures[start].number,
            rehearsalMark: measures[start].rehearsalMark,
            from,
            to,
            meter: first.meter,
            meterInferred: first.inferred,
            unit: first.unit,
            shape,
            startBpm: bpms[0],
            endBpm: bpms[bpms.length - 1],
            averageBpm: span > 0 ? (totalWeight * 60) / span : NaN,
            startTime: times[from],
            typed: first.marked,
            weights,
        };
    });
}

/** The row's tempo as the tempo cell edits it: the first count's, or the average when uneven. */
export const rowTempo = (row: TempoMapRow) =>
    row.shape === "uneven" ? row.averageBpm : row.startBpm;

/** The tempo a row ends on, for "♩.=♩" and "=prev" in the row after it. */
export const rowEndTempo = (row: TempoMapRow) =>
    row.shape === "uneven" ? row.averageBpm : row.endBpm;

/** Why a cell's value can't be written. */
export type TempoMapEditError =
    | "noPreviousRow"
    | "tooSlow"
    | "tooFast"
    | "rampNeedsCounts"
    | "changesCounts"
    | "rowExists"
    | "noSuchMeasure"
    | "notTyped";

/**
 * A tempo map edit: the new durations (same length; only lengths change), the marks after it and
 * the counts to add to or take out of the synced counts. One edit is one undo entry.
 */
export interface TempoMapWrite {
    readonly durations: number[];
    readonly marks: Map<number, TempoMapMark>;
    readonly sync: readonly number[];
    readonly unsync: readonly number[];
}

export type TempoMapEditResult =
    | { ok: true; write: TempoMapWrite }
    | { ok: false; error: TempoMapEditError };

interface MapState {
    readonly durations: readonly number[];
    readonly measures: readonly TempoMapMeasure[];
    readonly marks: TempoMapMarks;
    readonly rows: readonly TempoMapRow[];
}

/** The counts a typed row puts on the music: its first count and the count after its last. */
const boundaries = (row: TempoMapRow, durations: readonly number[]) =>
    row.to < durations.length ? [row.from, row.to] : [row.from];

/** Writes `[from, to)` of a row at `startBpm` (to `endBpm`) in `unit`, checking the limits. */
function writeRow({
    state,
    row,
    meter,
    unit,
    startBpm,
    endBpm,
}: {
    state: MapState;
    row: TempoMapRow;
    meter: Meter;
    unit: BeatUnit;
    startBpm: number;
    endBpm: number;
}): TempoMapEditResult {
    if (Math.min(startBpm, endBpm) < MIN_TYPED_BPM)
        return { ok: false, error: "tooSlow" };
    const counts = row.to - row.from;
    const perMeasure = meterCounts(meter);
    const weights =
        counts % perMeasure === 0
            ? Array.from({ length: counts / perMeasure }, () =>
                  unitWeights(meter, unit),
              ).flat()
            : row.weights;
    const durations = setRangeRamp(
        state.durations,
        row.from,
        row.to,
        startBpm,
        endBpm,
        weights,
    );
    for (let i = row.from; i < row.to; i++) {
        if (durations[i] < MIN_COUNT_SECONDS - 1e-12)
            return { ok: false, error: "tooFast" };
        if (durations[i] > MAX_COUNT_SECONDS)
            return { ok: false, error: "tooSlow" };
    }
    const marks = new Map(state.marks);
    marks.set(row.measureIndex, {
        ...marks.get(row.measureIndex),
        meter,
        unit,
    });
    return {
        ok: true,
        write: {
            durations,
            marks,
            sync: boundaries(row, state.durations),
            unsync: [],
        },
    };
}

/**
 * A typed tempo cell on row `rowIndex`. The row's counts get exactly that tempo (keeping a rit.'s
 * end tempo), and later counts shift: a typed tempo is the score's, so nothing after it re-spaces.
 * "♩.=♩" and "=prev" are worked out once from the previous row's last tempo.
 */
export function editRowTempo(
    state: MapState,
    rowIndex: number,
    cell: Exclude<TempoCell, { kind: "error" }>,
): TempoMapEditResult {
    const row = state.rows[rowIndex];
    const previous = state.rows[rowIndex - 1];
    let unit = row.unit;
    let bpm: number;
    if (cell.kind === "tempo") {
        unit = cell.unit ?? row.unit;
        bpm = cell.bpm;
    } else {
        if (!previous) return { ok: false, error: "noPreviousRow" };
        if (cell.kind === "relation") {
            unit = cell.unit;
            bpm = convertBpm(
                rowEndTempo(previous),
                previous.unit,
                cell.previousUnit,
            );
        } else bpm = rowEndTempo(previous);
    }
    return writeRow({
        state,
        row,
        meter: row.meter,
        unit,
        startBpm: bpm,
        // A rit. keeps the tempo it ends on
        endBpm:
            row.shape === "ramp" ? convertBpm(row.endBpm, row.unit, unit) : bpm,
    });
}

/** A rit./accel. cell: the row ramps from its tempo to the typed one, or turns steady. */
export function editRowRamp(
    state: MapState,
    rowIndex: number,
    cell: Exclude<RampCell, { kind: "error" }>,
): TempoMapEditResult {
    const row = state.rows[rowIndex];
    const start = rowTempo(row);
    if (cell.kind === "clear")
        return writeRow({
            state,
            row,
            meter: row.meter,
            unit: row.unit,
            startBpm: start,
            endBpm: start,
        });
    if (row.to - row.from < 2) return { ok: false, error: "rampNeedsCounts" };
    return writeRow({
        state,
        row,
        meter: row.meter,
        unit: row.unit,
        startBpm: start,
        endBpm: cell.unit
            ? convertBpm(cell.bpm, cell.unit, row.unit)
            : cell.bpm,
    });
}

/**
 * A typed meter: only a regrouping with the same number of counts per measure ("3/4" to "7/8
 * 2+2+3", "4/4" to "12/8"). The tempo's number stays and its unit follows the meter (♩=120 in 4/4
 * becomes ♩.=120 in 12/8), so equal counts keep their lengths.
 */
export function editRowMeter(
    state: MapState,
    rowIndex: number,
    meter: Meter,
): TempoMapEditResult {
    const row = state.rows[rowIndex];
    const perMeasure = state.measures
        .slice(row.measureIndex, row.endMeasureIndex)
        .map((m) => m.counts);
    if (perMeasure.some((c) => c !== meterCounts(meter)))
        return { ok: false, error: "changesCounts" };
    const unit = defaultUnit(meter);
    return writeRow({
        state,
        row,
        meter,
        unit,
        startBpm: rowTempo(row),
        endBpm: row.shape === "ramp" ? row.endBpm : rowTempo(row),
    });
}

/**
 * "Add row at m45": a typed row at that measure with the meter and unit it already has. No count
 * changes length; its first count is synced.
 */
export function addRowAt(
    state: MapState,
    measureIndex: number,
): TempoMapEditResult {
    const measure = state.measures[measureIndex];
    if (!measure) return { ok: false, error: "noSuchMeasure" };
    if (state.rows.some((r) => r.measureIndex === measureIndex))
        return { ok: false, error: "rowExists" };
    const row = [...state.rows]
        .reverse()
        .find((r) => r.measureIndex < measureIndex);
    const marks = new Map(state.marks);
    marks.set(measureIndex, row ? { meter: row.meter, unit: row.unit } : {});
    return {
        ok: true,
        write: {
            durations: [...state.durations],
            marks,
            sync: [Math.max(measure.firstCount, 1)],
            unsync: [],
        },
    };
}

/**
 * Removes a typed row's mark and takes its first count out of the synced counts. Durations don't change, so the row stays
 * if the tempo or meter changes there anyway.
 */
export function removeRow(
    state: MapState,
    rowIndex: number,
): TempoMapEditResult {
    const row = state.rows[rowIndex];
    if (!row.typed) return { ok: false, error: "notTyped" };
    const marks = new Map(state.marks);
    marks.delete(row.measureIndex);
    return {
        ok: true,
        write: {
            durations: [...state.durations],
            marks,
            sync: [],
            unsync: [row.from],
        },
    };
}

/** The measure index a typed "m45", "45" or rehearsal mark "C" names, or -1. */
export function findMeasure(
    measures: readonly TempoMapMeasure[],
    text: string,
): number {
    const t = text.trim();
    const number = /^m?\s*(-?\d+)$/i.exec(t);
    if (number)
        return measures.findIndex((m) => m.number === Number(number[1]));
    return measures.findIndex(
        (m) => m.rehearsalMark?.trim().toLowerCase() === t.toLowerCase(),
    );
}

/** A typed row as the file stores it: by the beat id its measure starts on. */
export interface StoredTempoMapMark extends TempoMapMark {
    readonly beatId: number;
}

/** Stored marks as the map takes them, by measure index. Marks off a measure start are dropped. */
export function marksByMeasure(
    stored: readonly StoredTempoMapMark[] | undefined,
    measureStartBeatIds: readonly number[],
): Map<number, TempoMapMark> {
    const index = new Map(measureStartBeatIds.map((id, i) => [id, i]));
    const out = new Map<number, TempoMapMark>();
    for (const { beatId, ...mark } of stored ?? []) {
        const i = index.get(beatId);
        if (i !== undefined) out.set(i, mark);
    }
    return out;
}

/**
 * What `retimeBeats` takes for a tempo map edit: durations by beat id, the synced beat ids with
 * the edit's added and removed, and the marks by beat id.
 */
export function retimeArgsOf({
    write,
    beatIds,
    measureStartBeatIds,
    syncedBeatIds,
}: {
    write: TempoMapWrite;
    /** Beat ids by ordinal. */
    beatIds: readonly number[];
    measureStartBeatIds: readonly number[];
    syncedBeatIds: readonly number[];
}) {
    if (beatIds.length !== write.durations.length)
        throw new RangeError(
            `the show has ${beatIds.length} counts but the edit has ${write.durations.length}`,
        );
    const synced = new Set(syncedBeatIds);
    for (const count of write.unsync) synced.delete(beatIds[count]);
    for (const count of write.sync) synced.add(beatIds[count]);
    return {
        newDurationsByBeatId: new Map(
            beatIds.map((id, i) => [id, write.durations[i]]),
        ),
        syncedBeatIds: [...synced].sort((a, b) => a - b),
        tempoMapMarks: [...write.marks.entries()]
            .filter(([i]) => measureStartBeatIds[i] !== undefined)
            .sort(([a], [b]) => a - b)
            .map(([i, mark]) => ({
                beatId: measureStartBeatIds[i],
                ...(mark.meter
                    ? {
                          meter: {
                              top: mark.meter.top,
                              bottom: mark.meter.bottom,
                              groups: mark.meter.groups
                                  ? [...mark.meter.groups]
                                  : null,
                          },
                      }
                    : {}),
                ...(mark.unit ? { unit: mark.unit } : {}),
            })),
    };
}
