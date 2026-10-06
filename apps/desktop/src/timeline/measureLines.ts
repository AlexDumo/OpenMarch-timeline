/**
 * Measure lines and rehearsal marks as labels (tempo experiment E8): pure planning for the edits
 * the timeline's measure row offers. A `measures` row stores only its downbeat (`start_beat`) and
 * an optional rehearsal mark; a measure runs to the next row, the last to the end of the show. So
 * every edit here creates, moves or deletes measure rows, or changes a mark, and never touches
 * beats or pages: counts, timing and drill stay as they are, and nothing can be refused.
 *
 * Beats here are ordinals (indexes in show order), as in the timeline's spec beats.
 *
 * Marks belong to their measure: when re-barring moves a measure line, its mark moves with it, so
 * "D at m25" stays at m25. A mark is dropped only when its line goes past the end of the show or
 * is merged away; the plan names it, so the caller can say so.
 */

/** A measure row as the plan sees it: its id, its downbeat (an ordinal) and its mark */
export interface MeasureLine {
    readonly id: number;
    readonly beat: number;
    readonly mark: string | null;
}

/** The show's beats: lines may sit on ordinals `[firstBeat, beatCount)` */
export interface MeasureLineBounds {
    /** How many beats the show has, beat 0 included */
    readonly beatCount: number;
    /** The first beat a line may start on: 1 when beat 0 is the zero-length beat, else 0 */
    readonly firstBeat: number;
}

export type MeasureLineEdit =
    /** Start a measure at `beat` (a line there already: only sets `mark`, when given) */
    | {
          readonly kind: "start";
          readonly beat: number;
          readonly mark?: string | null;
      }
    /** Remove a measure line, joining that measure with the previous one. Not the first. */
    | { readonly kind: "remove"; readonly measureId: number }
    /** Name or rename a measure's rehearsal mark; empty or null removes it */
    | {
          readonly kind: "mark";
          readonly measureId: number;
          readonly mark: string | null;
      }
    /**
     * Move a measure's rehearsal mark to another measure (a label edit: lines, beats and pages
     * stay). The other measure must have no mark of its own.
     */
    | {
          readonly kind: "moveMark";
          readonly fromMeasureId: number;
          readonly toMeasureId: number;
      }
    /**
     * Give a measure `beats` beats by moving the line after it. With `laterKeep`, every later line
     * moves by the same amount, so later measures keep their beats (the rest of the show is
     * re-barred); without it, the next measure absorbs the difference.
     */
    | {
          readonly kind: "setBeats";
          readonly measureId: number;
          readonly beats: number;
          readonly laterKeep: boolean;
      }
    /**
     * Re-bar from a measure into measures of `beats` beats, up to the next rehearsal mark or to the
     * end of the show. A last, shorter measure keeps what is left before the mark.
     */
    | {
          readonly kind: "beatsFrom";
          readonly measureId: number;
          readonly beats: number;
          readonly until: "mark" | "end";
      };

/** The row writes for an edit; applying them never changes beats or pages */
export interface MeasureLinePlan {
    readonly creates: readonly { beat: number; mark: string | null }[];
    readonly updates: readonly {
        id: number;
        beat?: number;
        mark?: string | null;
    }[];
    readonly deletes: readonly number[];
    /** Rehearsal marks that go with deleted lines */
    readonly droppedMarks: readonly string[];
}

const EMPTY_PLAN: MeasureLinePlan = {
    creates: [],
    updates: [],
    deletes: [],
    droppedMarks: [],
};

/** A typed mark, trimmed; empty is no mark */
export const cleanRehearsalMark = (mark: string | null | undefined) => {
    const trimmed = mark?.trim() ?? "";
    return trimmed === "" ? null : trimmed;
};

const sortedLines = (lines: readonly MeasureLine[]) =>
    [...lines].sort((a, b) => a.beat - b.beat);

const assertBeats = (beats: number) => {
    if (!Number.isInteger(beats) || beats < 1)
        throw new Error(
            `a measure needs a whole number of beats, not ${beats}`,
        );
};

/**
 * The row writes for `edit` on `lines`. Throws for an edit the measure row never offers (an
 * unknown measure, measure 1's line, a beat outside the show), which is a caller's mistake.
 */
// eslint-disable-next-line max-lines-per-function
export function planMeasureLineEdit(
    lines: readonly MeasureLine[],
    bounds: MeasureLineBounds,
    edit: MeasureLineEdit,
): MeasureLinePlan {
    const ordered = sortedLines(lines);
    const indexOf = (measureId: number) => {
        const index = ordered.findIndex((line) => line.id === measureId);
        if (index < 0) throw new Error(`measure ${measureId} does not exist`);
        return index;
    };
    switch (edit.kind) {
        case "start": {
            const { beat } = edit;
            if (
                !Number.isInteger(beat) ||
                beat < bounds.firstBeat ||
                beat >= bounds.beatCount
            )
                throw new Error(`a measure can't start at beat ${beat}`);
            const existing = ordered.find((line) => line.beat === beat);
            const mark =
                edit.mark === undefined
                    ? undefined
                    : cleanRehearsalMark(edit.mark);
            if (existing)
                return mark === undefined || mark === existing.mark
                    ? EMPTY_PLAN
                    : { ...EMPTY_PLAN, updates: [{ id: existing.id, mark }] };
            return { ...EMPTY_PLAN, creates: [{ beat, mark: mark ?? null }] };
        }
        case "remove": {
            const index = indexOf(edit.measureId);
            if (index === 0)
                throw new Error("the first measure's line can't be removed");
            const line = ordered[index]!;
            return {
                ...EMPTY_PLAN,
                deletes: [line.id],
                droppedMarks: line.mark ? [line.mark] : [],
            };
        }
        case "mark": {
            const line = ordered[indexOf(edit.measureId)]!;
            const mark = cleanRehearsalMark(edit.mark);
            return mark === line.mark
                ? EMPTY_PLAN
                : { ...EMPTY_PLAN, updates: [{ id: line.id, mark }] };
        }
        case "moveMark": {
            const from = ordered[indexOf(edit.fromMeasureId)]!;
            const to = ordered[indexOf(edit.toMeasureId)]!;
            if (from.id === to.id || from.mark === null) return EMPTY_PLAN;
            if (to.mark !== null)
                throw new Error(
                    `that measure already has rehearsal mark ${to.mark}`,
                );
            return {
                ...EMPTY_PLAN,
                updates: [
                    { id: from.id, mark: null },
                    { id: to.id, mark: from.mark },
                ],
            };
        }
        case "setBeats": {
            assertBeats(edit.beats);
            const index = indexOf(edit.measureId);
            return planSetBeats(
                ordered,
                bounds,
                index,
                edit.beats,
                edit.laterKeep,
            );
        }
        case "beatsFrom": {
            assertBeats(edit.beats);
            const index = indexOf(edit.measureId);
            return planBeatsFrom(
                ordered,
                bounds,
                index,
                edit.beats,
                edit.until,
            );
        }
    }
}

function planSetBeats(
    ordered: readonly MeasureLine[],
    { beatCount }: MeasureLineBounds,
    index: number,
    beats: number,
    laterKeep: boolean,
): MeasureLinePlan {
    const line = ordered[index]!;
    const target = line.beat + beats;
    const next = ordered[index + 1];
    // The last measure runs to the end: a line after it starts the remainder
    if (!next)
        return target < beatCount
            ? { ...EMPTY_PLAN, creates: [{ beat: target, mark: null }] }
            : EMPTY_PLAN;
    if (target === next.beat) return EMPTY_PLAN;
    const later = ordered.slice(index + 1);
    const updates: { id: number; beat?: number; mark?: string | null }[] = [];
    const deletes: number[] = [];
    const droppedMarks: string[] = [];
    const drop = (dropped: MeasureLine) => {
        deletes.push(dropped.id);
        if (dropped.mark) droppedMarks.push(dropped.mark);
    };
    if (laterKeep) {
        // Every later line moves by the same amount; lines pushed past the end go
        const delta = target - next.beat;
        for (const after of later) {
            const moved = after.beat + delta;
            if (moved >= beatCount) drop(after);
            else updates.push({ id: after.id, beat: moved });
        }
        return { creates: [], updates, deletes, droppedMarks };
    }
    // The next measure absorbs the difference: its line moves; lines it passes merge into it
    if (target >= beatCount) {
        later.forEach(drop);
        return { creates: [], updates, deletes, droppedMarks };
    }
    const passed = later.slice(1).filter((after) => after.beat <= target);
    const landing = passed.find((after) => after.beat === target);
    for (const after of passed) if (after !== landing) drop(after);
    if (landing) {
        // A line is already there: it stays, and takes the moved line's mark when it has none
        drop(next);
        if (next.mark && !landing.mark) {
            droppedMarks.pop();
            updates.push({ id: landing.id, mark: next.mark });
        }
    } else updates.push({ id: next.id, beat: target });
    return { creates: [], updates, deletes, droppedMarks };
}

function planBeatsFrom(
    ordered: readonly MeasureLine[],
    { beatCount }: MeasureLineBounds,
    index: number,
    beats: number,
    until: "mark" | "end",
): MeasureLinePlan {
    const start = ordered[index]!.beat;
    const later = ordered.slice(index + 1);
    const stop =
        until === "mark" ? later.findIndex((line) => line.mark !== null) : -1;
    const end = stop >= 0 ? later[stop]!.beat : beatCount;
    // The lines being re-barred, the first one included; they keep their order and marks
    const inRange = [
        ordered[index]!,
        ...(stop >= 0 ? later.slice(0, stop) : later),
    ];
    const positions: number[] = [];
    for (let beat = start; beat < end; beat += beats) positions.push(beat);
    const creates: { beat: number; mark: string | null }[] = [];
    const updates: { id: number; beat?: number }[] = [];
    const deletes: number[] = [];
    const droppedMarks: string[] = [];
    positions.forEach((beat, i) => {
        const reused = inRange[i];
        if (!reused) creates.push({ beat, mark: null });
        else if (reused.beat !== beat) updates.push({ id: reused.id, beat });
    });
    for (const unused of inRange.slice(positions.length)) {
        deletes.push(unused.id);
        if (unused.mark) droppedMarks.push(unused.mark);
    }
    return { creates, updates, deletes, droppedMarks };
}

/** The lines after applying `plan`, in order (for tests and previews) */
export function applyMeasureLinePlan(
    lines: readonly MeasureLine[],
    plan: MeasureLinePlan,
    newId: (index: number) => number = (index) => -1 - index,
): MeasureLine[] {
    const deleted = new Set(plan.deletes);
    const updates = new Map(plan.updates.map((u) => [u.id, u]));
    const kept = lines
        .filter((line) => !deleted.has(line.id))
        .map((line) => {
            const update = updates.get(line.id);
            return update
                ? {
                      id: line.id,
                      beat: update.beat ?? line.beat,
                      mark: update.mark === undefined ? line.mark : update.mark,
                  }
                : line;
        });
    const created = plan.creates.map((c, i) => ({
        id: newId(i),
        beat: c.beat,
        mark: c.mark,
    }));
    return sortedLines([...kept, ...created]);
}

// ---------------------------------------------------------------------------
// Rehearsal mark names
// ---------------------------------------------------------------------------

const nextLetters = (letters: string): string => {
    const upper = letters === letters.toUpperCase();
    const base = upper ? 65 : 97;
    const codes = [...letters].map((c) => c.charCodeAt(0) - base);
    const repeated = codes.every((code) => code === codes[0]);
    let out: number[];
    if (repeated) {
        // A, B, … Z, AA, BB, … ZZ, AAA: the doubled letters scores use after Z
        const code = codes[0]!;
        out =
            code === 25
                ? Array.from({ length: codes.length + 1 }, () => 0)
                : codes.map(() => code + 1);
    } else {
        // Mixed letters count like spreadsheet columns: AB, AC, … AZ, BA
        out = [...codes];
        let i = out.length - 1;
        while (i >= 0 && out[i] === 25) out[i--] = 0;
        if (i < 0) out.unshift(0);
        else out[i]! += 1;
    }
    return String.fromCharCode(...out.map((code) => code + base));
};

/** The name after `mark`: the next letter (Z, then AA), or the next number */
export const followingRehearsalMark = (mark: string | null | undefined) => {
    const current = cleanRehearsalMark(mark);
    if (current === null) return "A";
    const numbered = current.match(/^(.*?)(\d+)$/);
    if (numbered) return `${numbered[1]}${Number(numbered[2]) + 1}`;
    if (/^[A-Z]+$/.test(current) || /^[a-z]+$/.test(current))
        return nextLetters(current);
    // A word such as "Intro": start the letters
    return "A";
};

/**
 * The name R offers for a new mark (11-ui.md D): the one after the previous mark (`previous`, the
 * last mark before the new one), skipping names the show already uses, so go-to stays
 * unambiguous. A, B, … Z, AA; or the next number when marks are numbers.
 */
export function nextRehearsalMark(
    previous: string | null | undefined,
    taken: Iterable<string | null | undefined> = [],
): string {
    const used = new Set(
        [...taken].flatMap((mark) => {
            const clean = cleanRehearsalMark(mark);
            return clean === null ? [] : [clean.toLowerCase()];
        }),
    );
    let candidate = followingRehearsalMark(previous);
    for (let i = 0; i < 1000 && used.has(candidate.toLowerCase()); i++)
        candidate = followingRehearsalMark(candidate);
    return candidate;
}

// ---------------------------------------------------------------------------
// Where R lands
// ---------------------------------------------------------------------------

/** A downbeat on some beat axis */
export interface MeasureAt {
    readonly atBeat: number;
}

/**
 * The measure R marks at the playhead (`beat`, fractional): paused, the measure holding it; while
 * playing, the nearest downbeat, so a press a little early or late for the hit still lands on its
 * measure (21-persona-dana.md E4). Null when there is no measure there (none in the show, or a
 * paused playhead before the first one).
 */
export function measureForMark<T extends MeasureAt>(
    measures: readonly T[],
    beat: number,
    playing: boolean,
): T | null {
    const ordered = [...measures].sort((a, b) => a.atBeat - b.atBeat);
    if (ordered.length === 0) return null;
    if (playing)
        return ordered.reduce((best, measure) =>
            Math.abs(measure.atBeat - beat) < Math.abs(best.atBeat - beat)
                ? measure
                : best,
        );
    const holding = ordered.filter((m) => m.atBeat <= Math.floor(beat));
    return holding[holding.length - 1] ?? null;
}

/** The last rehearsal mark strictly before `atBeat`, or null */
export function previousRehearsalMark(
    measures: readonly (MeasureAt & {
        readonly rehearsalMark?: string | null;
    })[],
    atBeat: number,
): string | null {
    const before = measures
        .filter((m) => m.atBeat < atBeat && cleanRehearsalMark(m.rehearsalMark))
        .sort((a, b) => a.atBeat - b.atBeat);
    return cleanRehearsalMark(before[before.length - 1]?.rehearsalMark);
}
