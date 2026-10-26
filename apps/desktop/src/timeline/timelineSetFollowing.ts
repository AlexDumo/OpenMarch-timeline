import type { XY } from "@openmarch/core";
import type { CarrySpan } from "./timelineCarryForward";

/**
 * Set vs Following (#300): on the playhead's exact count, a marcher is **Set** when a move of its
 * own ends there with real motion, and on the first page (beat 0), always. Everywhere else it's
 * **Following**: holding from an earlier count, partway through a move, or on a stay move that
 * ends where it began (Only Page N, unlink) or a kept spot (keep later pages). Read from the
 * marcher's resolver spans, as the inspector's hold line is.
 *
 * "Ends there" means the move's own end: a span that stops because a later move takes the marcher
 * over partway (spec R-2) is a point along the way, not a coordinate anyone set, and no row ends
 * on it for Remove keyframe to take back.
 *
 * The field asks per playhead move, so each marcher's Set beats are worked out once per resolver
 * version (`marcherSetBeats`) and looked up per beat (`isSetAt`, `followingAt`).
 */

/**
 * A resolver span, with its assignment for telling kept spots apart and its assignment's end for
 * telling a move's end from the count a later move cuts in (`SpanInfo.assignmentEnd`).
 */
export type SetSpan = CarrySpan & {
    readonly assignmentId?: number | null;
    readonly assignmentEnd?: number | null;
};

const NO_KEPT: ReadonlySet<number> = new Set();

/**
 * The beats one marcher is Set on, ascending, without the first page's (always Set).
 *
 * @param spans the marcher's spans (`resolverSpans`)
 * @param positionAt where the marcher stands at a beat, for telling a stay move from real motion
 * @param kept the kept assignments' ids (`useKeptAssignmentsStore`): a kept spot follows
 */
export function marcherSetBeats(
    spans: readonly SetSpan[],
    positionAt: (beat: number) => XY,
    kept: ReadonlySet<number> = NO_KEPT,
): number[] {
    const beats = new Set<number>();
    for (const span of spans) {
        if (span.kind === "hold" || !Number.isFinite(span.end)) continue;
        if (span.assignmentId != null && kept.has(span.assignmentId)) continue;
        if (span.assignmentEnd != null && span.assignmentEnd !== span.end)
            continue;
        if (!Number.isFinite(span.start) || moved(span, positionAt))
            beats.add(span.end);
    }
    return [...beats].sort((a, b) => a - b);
}

function moved(span: SetSpan, positionAt: (beat: number) => XY): boolean {
    const [x0, y0] = positionAt(span.start);
    const [x1, y1] = positionAt(span.end);
    return Math.abs(x1 - x0) > EPSILON || Math.abs(y1 - y0) > EPSILON;
}

/** Closer than this, in field units, is the same spot: a stay move. */
const EPSILON = 1e-6;

/** Whether a marcher with these Set beats (`marcherSetBeats`) is Set at `beat`. */
export function isSetAt(setBeats: readonly number[], beat: number): boolean {
    if (beat === 0) return true;
    let low = 0;
    let high = setBeats.length;
    while (low < high) {
        const mid = (low + high) >> 1;
        if (setBeats[mid]! < beat) low = mid + 1;
        else high = mid;
    }
    return setBeats[low] === beat;
}

/** The marchers Following at `beat`, from each one's Set beats by id. */
export function followingAt(
    setBeats: ReadonlyMap<number, readonly number[]>,
    beat: number,
): Set<number> {
    const following = new Set<number>();
    if (beat === 0) return following;
    for (const [id, beats] of setBeats)
        if (!isSetAt(beats, beat)) following.add(id);
    return following;
}

/**
 * A count where a selected marcher is Set: a keyframe on the timeline. Filled when all the
 * selected marchers are Set there (`set === total`), hollow when only some are.
 */
export interface SelectionKeyframe {
    readonly beat: number;
    /** How many selected marchers are Set on the count */
    readonly set: number;
    /** How many marchers are selected */
    readonly total: number;
    /** The selected marchers Set on the count, in selection order (the diamond names them) */
    readonly marcherIds: readonly number[];
}

/**
 * The selection's keyframes, ascending: every count after the first page where a selected marcher
 * is Set. The first page has none: everyone is Set there, always.
 *
 * @param setBeats each selected marcher's Set beats (`marcherSetBeats`)
 * @param marcherIds the selected marchers, in the same order as `setBeats`
 */
export function selectionKeyframes(
    setBeats: readonly (readonly number[])[],
    marcherIds: readonly number[],
): SelectionKeyframe[] {
    const setOn = new Map<number, number[]>();
    setBeats.forEach((beats, index) => {
        for (const beat of beats) {
            if (beat === 0) continue;
            const ids = setOn.get(beat);
            if (ids) ids.push(marcherIds[index]!);
            else setOn.set(beat, [marcherIds[index]!]);
        }
    });
    const total = setBeats.length;
    return [...setOn]
        .sort(([a], [b]) => a - b)
        .map(([beat, ids]) => ({
            beat,
            set: ids.length,
            total,
            marcherIds: ids,
        }));
}
