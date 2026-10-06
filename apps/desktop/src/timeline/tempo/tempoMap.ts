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
    UNIT_GLYPH,
    UNIT_SIXTEENTHS,
    convertBpm,
    defaultUnit,
    formatBpm,
    formatMeter,
    formatTempo,
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
/** Relative difference under which a row still plays at the tempo its mark gave it. */
export const EXACT_TOLERANCE = 1e-6;
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

/**
 * What a typed or imported row says about the measures from it on: a meter, a beat unit or both,
 * and the tempo it was given, so the map can tell a typed value from one a drag left behind.
 */
export interface TempoMapMark {
    readonly meter?: Meter;
    readonly unit?: BeatUnit;
    /** The tempo typed (or read from the score) for the row's first count, in `unit` */
    readonly bpm?: number;
    /** The tempo a typed rit. or accel. ends on, in `unit` */
    readonly endBpm?: number;
    /** Typed in the map, or read from a MusicXML import; only typed rows are protected */
    readonly source?: "typed" | "import";
    /**
     * The meter as the score writes it, when `meter` counts it differently: "3/2" counted in ♩
     * is stored as 6/4, "3/4+3/8" as 9/8 2+2+2+3.
     */
    readonly label?: string;
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
    /** Where the row's mark came from, if it has one. */
    readonly source?: "typed" | "import";
    /** The tempo the mark gave the row (typed or from the score), in `unit`. */
    readonly markedBpm?: number;
    /**
     * The row plays exactly at a tempo someone wrote: the mark's, or (without one) a steady
     * tempo with at most two decimals. False once a drag or a fit moved it ("≈", never "=").
     */
    readonly exact: boolean;
    /** The row's first measure has fewer counts than its meter (a pickup). */
    readonly partial: boolean;
    /** The meter as the score writes it, when it differs from how it is counted ("3/2"). */
    readonly label?: string;
    /** The number of the row's last measure. */
    readonly endMeasureNumber: number;
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
    readonly label?: string;
    /** Fewer counts than the meter: a pickup, counted as the meter's last counts */
    readonly partial: boolean;
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
    let carried: TempoMapMark = {};
    measures.forEach((m, i) => {
        const from = Math.max(m.firstCount, 1);
        const to = Math.min(m.firstCount + m.counts, durations.length);
        const own = durations.slice(from, to);
        const mark = marks.get(i);
        if (mark) carried = { ...mark };
        const inferred = inferMeter(own);
        // The marked measure itself may be short (a pickup): it is the meter's last counts
        const partial =
            mark?.meter !== undefined &&
            own.length > 0 &&
            own.length < meterCounts(mark.meter);
        // A mark stops at a measure with another number of counts or another grouping
        if (
            !partial &&
            carried.meter &&
            (meterCounts(carried.meter) !== own.length ||
                (inferred.groups !== null &&
                    !sameShape(inferred, carried.meter)))
        )
            carried = {};
        const meter = carried.meter ?? inferred;
        const unit = carried.unit ?? defaultUnit(meter);
        const weights = partial
            ? unitWeights(meter, unit).slice(-own.length)
            : meterCounts(meter) === own.length
              ? unitWeights(meter, unit)
              : own.map(() => 1);
        out.push({
            meter,
            label: carried.meter ? carried.label : undefined,
            partial,
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
            !prev.partial &&
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
        const startBpm = bpms[0];
        const endBpm = bpms[bpms.length - 1];
        const mark = first.marked ? marks.get(start) : undefined;
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
            startBpm,
            endBpm,
            averageBpm: span > 0 ? (totalWeight * 60) / span : NaN,
            startTime: times[from],
            typed: first.marked,
            ...(mark?.source ? { source: mark.source } : {}),
            ...(mark?.bpm !== undefined ? { markedBpm: mark.bpm } : {}),
            exact: isExact(shape, startBpm, endBpm, mark),
            partial: first.partial,
            ...(first.label ? { label: first.label } : {}),
            endMeasureNumber: measures[end - 1].number,
            weights,
        };
    });
}

/** A tempo someone would write: at most two decimals (a drag's 185.0351… isn't one). */
const isWritten = (bpm: number) =>
    Number.isFinite(bpm) && Math.abs(bpm - Math.round(bpm * 100) / 100) < 1e-6;

/**
 * Whether a row plays at a tempo someone wrote. With a mark that has a tempo, the row must still
 * play at it (a drag over a typed row makes it "≈"); without one, a steady tempo (or a rit.'s two
 * ends) with at most two decimals reads as written. Uneven rows never are.
 */
function isExact(
    shape: TempoMapShape,
    startBpm: number,
    endBpm: number,
    mark: TempoMapMark | undefined,
): boolean {
    if (shape === "uneven") return false;
    if (mark?.bpm !== undefined) {
        if (!close(startBpm, mark.bpm, EXACT_TOLERANCE)) return false;
        if (shape === "steady") return mark.endBpm === undefined;
        return (
            mark.endBpm !== undefined &&
            close(endBpm, mark.endBpm, EXACT_TOLERANCE)
        );
    }
    return shape === "steady"
        ? isWritten(startBpm)
        : isWritten(startBpm) && isWritten(endBpm);
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
    const label = sameMeter(meter, row.meter) ? row.label : undefined;
    marks.set(row.measureIndex, {
        meter,
        unit,
        bpm: startBpm,
        ...(close(startBpm, endBpm, STEADY_TOLERANCE) ? {} : { endBpm }),
        source: "typed",
        ...(label ? { label } : {}),
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
    let meter = row.meter;
    let bpm: number;
    if (cell.kind === "tempo") {
        unit = cell.unit ?? row.unit;
        bpm = cell.bpm;
        meter = countedIn(row, unit);
    } else {
        if (!previous) return { ok: false, error: "noPreviousRow" };
        if (cell.kind === "relation") {
            unit = cell.unit;
            meter = countedIn(row, unit);
            bpm = convertBpm(
                rowEndTempo(previous),
                previous.unit,
                cell.previousUnit,
            );
        }
        // The same pulse as the previous row's end, in this row's unit (e=352 then =prev is ♩=176)
        else bpm = convertBpm(rowEndTempo(previous), previous.unit, unit);
    }
    return writeRow({
        state,
        row,
        meter,
        unit,
        startBpm: bpm,
        // A rit. keeps the tempo it ends on
        endBpm:
            row.shape === "ramp" ? convertBpm(row.endBpm, row.unit, unit) : bpm,
    });
}

/**
 * The meter a row is counted in once a tempo is typed in `unit`. A dotted unit typed over counts
 * read as plain quarters (no typed meter) means each count is that unit: "♩.=86" over a section
 * shown as 2/4 makes it 6/8, so the counts keep their lengths' meaning instead of playing 1.5×
 * too fast. Anything else keeps the row's meter.
 */
function countedIn(row: TempoMapRow, unit: BeatUnit): Meter {
    if (
        unit === row.unit ||
        !row.meterInferred ||
        row.meter.groups !== null ||
        !DOTTED_UNITS.has(unit)
    )
        return row.meter;
    return meterFromWeights(
        Array<number>(meterCounts(row.meter)).fill(UNIT_SIXTEENTHS[unit]),
    );
}

const DOTTED_UNITS: ReadonlySet<BeatUnit> = new Set(["de", "dq", "dh"]);

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
    marks.set(
        measureIndex,
        row
            ? {
                  meter: row.meter,
                  unit: row.unit,
                  ...(row.label ? { label: row.label } : {}),
              }
            : {},
    );
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

/** Marks by measure index as the file stores them: by the beat id each measure starts on. */
export function storedMarks(
    marks: ReadonlyMap<number, TempoMapMark>,
    measureStartBeatIds: readonly number[],
) {
    return [...marks.entries()]
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
            ...(mark.bpm !== undefined ? { bpm: mark.bpm } : {}),
            ...(mark.endBpm !== undefined ? { endBpm: mark.endBpm } : {}),
            ...(mark.source ? { source: mark.source } : {}),
            ...(mark.label ? { label: mark.label } : {}),
        }));
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
        tempoMapMarks: storedMarks(write.marks, measureStartBeatIds),
    };
}

/**
 * Whether a map edit changes nothing: the same count lengths, the same marks (as the file stores
 * them) and no synced count added or taken out. Such an edit writes nothing, so it never takes an
 * undo step (DE-4: Marcus's "86" after ♩.=86 and "6/8" after that used up two Ctrl+Z).
 */
export function isNoOpWrite({
    write,
    durations,
    marks,
    synced,
}: {
    write: TempoMapWrite;
    durations: readonly number[];
    marks: TempoMapMarks;
    /** Synced count indexes before the edit */
    synced: readonly number[];
}): boolean {
    if (write.durations.length !== durations.length) return false;
    if (write.durations.some((d, i) => d !== durations[i])) return false;
    const before = new Set(synced);
    if (write.sync.some((c) => !before.has(c))) return false;
    if (write.unsync.some((c) => before.has(c))) return false;
    // Stored by measure index itself, so two sets of marks compare as the file would hold them
    const last = Math.max(-1, ...write.marks.keys(), ...marks.keys());
    const byIndex = Array.from({ length: last + 1 }, (_, i) => i);
    const asStored = (m: TempoMapMarks) =>
        JSON.stringify(storedMarks(m, byIndex));
    return asStored(write.marks) === asStored(marks);
}

/**
 * The meter cell's text: the score's own signature when it is counted differently ("3/2"), and a
 * short marked measure as a pickup ("4/4 pickup").
 */
export function meterText(row: TempoMapRow): string {
    const meter = row.label ?? formatMeter(row.meter);
    // The Counts column says how many: the cell stays narrow
    return row.partial ? `${meter} pickup` : meter;
}

/** A row's tempo: "♩=152.5" when it plays at a written tempo, "♩≈185" when not. */
export function rowTempoText(row: TempoMapRow): string {
    if (row.shape === "uneven")
        return formatTempo(row.unit, row.averageBpm, false);
    return formatTempo(row.unit, row.startBpm, row.exact);
}

/** "m1–16" or "m29" */
export const rowMeasures = (row: TempoMapRow) =>
    row.endMeasureNumber > row.measureNumber
        ? `m${row.measureNumber}–${row.endMeasureNumber}`
        : `m${row.measureNumber}`;

/** What an edit wrote at its row, as the confirmation reads it: "6/8 ♩.=86", "♩=176 rit. to ♩=100" */
export function markText(
    mark: TempoMapMark,
    { withMeter }: { withMeter: boolean },
): string {
    const unit = mark.unit ?? "q";
    const parts: string[] = [];
    if (withMeter && mark.meter)
        parts.push(mark.label ?? formatMeter(mark.meter));
    if (mark.bpm !== undefined) parts.push(formatTempo(unit, mark.bpm, true));
    if (mark.endBpm !== undefined && mark.bpm !== undefined)
        parts.push(
            `${mark.endBpm < mark.bpm ? "rit." : "accel."} to ${formatTempo(unit, mark.endBpm, true)}`,
        );
    return parts.join(" ");
}

/** A typed section: a row typed in the map that still plays at the typed tempo. */
export interface TypedSection {
    /** Counts `[from, to)` */
    readonly from: number;
    readonly to: number;
    /** "♩=176" */
    readonly tempo: string;
    /** "m1–16" */
    readonly measures: string;
}

/**
 * The sections an Align drag must not rescale without saying so: rows typed in the map (not
 * imported) that still play at their typed tempo (FX-5). A mark without a source was typed: files
 * saved before marks had one only ever got them from the map (DE-2).
 */
export const typedSections = (rows: readonly TempoMapRow[]): TypedSection[] =>
    rows
        .filter((r) => r.typed && r.source !== "import" && r.exact)
        .map((r) => ({
            from: r.from,
            to: r.to,
            tempo:
                r.shape === "ramp"
                    ? `${formatTempo(r.unit, r.startBpm, true)}→${formatBpm(r.endBpm)}`
                    : formatTempo(r.unit, r.startBpm, true),
            measures: rowMeasures(r),
        }));

/** The typed sections whose counts an edit gives other lengths (FX-5). */
export function overriddenSections(
    sections: readonly TypedSection[],
    before: readonly number[],
    after: readonly number[],
): TypedSection[] {
    return sections.filter((s) => {
        for (let i = s.from; i < s.to; i++)
            if (
                Math.abs((after[i] ?? 0) - (before[i] ?? 0)) >
                1e-9 * Math.max(1, before[i] ?? 0)
            )
                return true;
        return false;
    });
}

/** What a count is counted in: its unit, and its length in that unit (1.5 for 7/8's long ♩). */
export interface CountUnit {
    readonly unit: BeatUnit;
    readonly weight: number;
}

/** Each count's unit and weight, by count index, from the map's rows (undefined outside them). */
export function countUnits(
    rows: readonly TempoMapRow[],
    countCount: number,
): (CountUnit | undefined)[] {
    const out = new Array<CountUnit | undefined>(countCount).fill(undefined);
    for (const row of rows)
        for (let i = row.from; i < row.to && i < countCount; i++)
            out[i] = { unit: row.unit, weight: row.weights[i - row.from] ?? 1 };
    return out;
}

/** A tempo over some counts, in the unit they are counted in. */
export interface UnitTempo {
    readonly unit: BeatUnit;
    readonly bpm: number;
    /** Every count at the same tempo */
    readonly even: boolean;
    /** Plain quarter counts, so a bare number ("120") says it all */
    readonly plain: boolean;
}

/**
 * The tempo of the counts from `from` (before `to`) that share `from`'s unit: a page that runs
 * from 6/8 into 3/4 reads the 6/8's tempo at its start, never an average across both. Null for no
 * counts or no length.
 */
export function unitTempo(
    durations: readonly number[],
    units: readonly (CountUnit | undefined)[],
    from: number,
    to: number,
): UnitTempo | null {
    const unit = units[from]?.unit ?? "q";
    let weight = 0;
    let span = 0;
    let plain = true;
    const bpms: number[] = [];
    for (let i = from; i < to && i < durations.length; i++) {
        const u = units[i] ?? { unit: "q" as const, weight: 1 };
        if (u.unit !== unit) break;
        if (u.unit !== "q" || Math.abs(u.weight - 1) > 1e-9) plain = false;
        weight += u.weight;
        span += durations[i]!;
        if (durations[i]! > 0) bpms.push((u.weight * 60) / durations[i]!);
    }
    if (!(span > 0)) return null;
    return {
        unit,
        bpm: (weight * 60) / span,
        even: bpms.every((b) => close(b, bpms[0]!, STEADY_TOLERANCE)),
        plain,
    };
}

/**
 * A tempo in Align and the readout: a bare number for plain quarter counts ("152.5", "≈138", as
 * E7-4), else with its note ("♩.=88", "♩.≈85", "♩=176" for 5/8 3+2 in ♩). Exact only when even
 * and written with at most two decimals.
 */
export function formatUnitTempo(tempo: UnitTempo): string {
    const exact = tempo.even && isWritten(tempo.bpm);
    const number = exact
        ? String(Number(tempo.bpm.toFixed(2)))
        : String(Math.round(tempo.bpm));
    if (tempo.plain) return exact ? number : `≈${number}`;
    return `${UNIT_GLYPH[tempo.unit]}${exact ? "=" : "≈"}${number}`;
}
