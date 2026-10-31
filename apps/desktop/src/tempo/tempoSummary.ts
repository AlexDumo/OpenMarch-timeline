/**
 * PROTOTYPE (tempo mode, branch tempo/track-proto): what tempos a stretch of counts is at, in a
 * few plain pieces, so Fit can say what it found (dana: "it never told me it found a change at
 * m. 41"). Built from the tempo lane's own segments, with the small wobbles a fit to a real
 * recording leaves merged away.
 */

/** A run of counts at about one tempo */
export interface TempoRegion {
    /** First beat */
    from: number;
    /** One past the last beat */
    to: number;
    /** The middle tempo of its counts, in quarter notes a minute */
    bpm: number;
}

/** Counts shorter than this are a wobble or a bump, not a tempo of their own */
const SHORTEST_REGION = 3;

/** Two tempos this close are the same tempo, for saying in words */
const sameTempo = (a: number, b: number) =>
    Math.abs(a - b) <= Math.max(2, 0.025 * Math.min(a, b));

const median = (values: number[]) => {
    const sorted = values.filter(Number.isFinite).sort((x, y) => x - y);
    if (sorted.length === 0) return NaN;
    const mid = sorted.length >> 1;
    return sorted.length % 2
        ? sorted[mid]!
        : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/**
 * The tempos of beats `from`..`to - 1`, as few runs as say it honestly.
 *
 * @param bpms each beat's tempo in quarter notes a minute; NaN for a hold, which has none
 * @param segments the tempo lane's segments (`tempoSegments`), in beat order
 */
export function tempoRegions(
    bpms: readonly number[],
    segments: readonly { from: number; to: number }[],
    from: number,
    to: number,
): TempoRegion[] {
    const medianOf = (a: number, e: number) => median(bpms.slice(a, e));
    const pieces: TempoRegion[] = [];
    for (const s of segments) {
        const a = Math.max(s.from, from);
        const e = Math.min(s.to, to);
        if (e <= a) continue;
        const bpm = medianOf(a, e);
        if (Number.isFinite(bpm)) pieces.push({ from: a, to: e, bpm });
    }
    const mergeSimilar = (list: TempoRegion[]) => {
        const out: TempoRegion[] = [];
        for (const p of list) {
            const last = out[out.length - 1];
            if (last && sameTempo(last.bpm, p.bpm)) {
                last.to = p.to;
                last.bpm = medianOf(last.from, last.to);
            } else out.push({ ...p });
        }
        return out;
    };
    let regions = mergeSimilar(pieces);
    // A short run goes into the run before it (or after it, at the start)
    for (let i = 0; i < regions.length && regions.length > 1; ) {
        const r = regions[i]!;
        if (r.to - r.from >= SHORTEST_REGION) {
            i++;
            continue;
        }
        const into = i > 0 ? regions[i - 1]! : regions[i + 1]!;
        into.from = Math.min(into.from, r.from);
        into.to = Math.max(into.to, r.to);
        into.bpm = medianOf(into.from, into.to);
        regions.splice(i, 1);
        if (i > 0) i--;
    }
    regions = mergeSimilar(regions);
    return regions;
}
