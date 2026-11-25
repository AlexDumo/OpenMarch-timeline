/**
 * Record path (prototype, 2026-11-25): a take recorded by dragging marchers while a move plays,
 * stored as each marcher's exact path (ADR 0018). Pure: the samples in, the path out.
 *
 * The path is the pointer's own motion, with no easing or smoothing: straight legs through the
 * samples kept, a timing key on each, so at every sample the marcher is within `tolerance` of
 * where it was dragged at that moment. A stretch held still is a hold (two keys at one place).
 */
import type { ExactKey, ExactPath, XY } from "@openmarch/core";

/** Where a marcher was dragged at one moment: `tick` counts from the move's start, 480 a beat */
export interface RecordedSample {
    tick: number;
    x: number;
    y: number;
}

/** Below this two kept samples are the same place (field units): a hold, not a leg */
const SAME_PLACE = 1e-6;

/**
 * The samples as one marcher's exact path over a move `ticks` long, or null when it goes nowhere
 * (EP-6). Samples are put in order, on whole ticks inside the move, one per tick; the first is
 * stretched back to tick 0 and the last on to `ticks`. `tolerance` (field units) is how far the
 * path may stray from a sample at that sample's moment: 1/100 of a step keeps the drag as drawn.
 */
export function exactPathFromSamples(
    samples: readonly RecordedSample[],
    ticks: number,
    tolerance: number,
): ExactPath | null {
    const take = cleanSamples(samples, ticks);
    if (take.length < 2) return null;
    const kept = keptSamples(take, tolerance);
    const first = take[kept[0]!]!;
    const from: XY = [first.x, first.y];
    const points: XY[] = [];
    const keys: ExactKey[] = [{ tick: 0, u: 0 }];
    let at = from;
    for (const i of kept.slice(1)) {
        const s = take[i]!;
        if (Math.hypot(s.x - at[0], s.y - at[1]) > SAME_PLACE) {
            at = [s.x, s.y];
            points.push(at);
        }
        keys.push({ tick: s.tick, u: points.length });
    }
    if (points.length === 0) return null;
    return { v: 1, from, shapes: [{ kind: "points", points }], keys };
}

/**
 * Make speed even: the same path walked at one steady speed from start to end (holds and speed
 * changes dropped), by keeping only its first and last keys.
 */
export function withEvenSpeed(path: ExactPath): ExactPath {
    const last = path.keys[path.keys.length - 1]!;
    return { ...path, keys: [{ tick: 0, u: 0 }, { ...last }] };
}

/** In order, whole ticks from 0 to `ticks`, one sample per tick (the last one there wins). */
function cleanSamples(
    samples: readonly RecordedSample[],
    ticks: number,
): RecordedSample[] {
    const byTick = new Map<number, RecordedSample>();
    for (const s of samples) {
        if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) continue;
        const tick = Math.min(ticks, Math.max(0, Math.round(s.tick)));
        byTick.set(tick, { tick, x: s.x, y: s.y });
    }
    const out = [...byTick.values()].sort((a, b) => a.tick - b.tick);
    if (out.length === 0) return out;
    if (out[0]!.tick > 0) out.unshift({ ...out[0]!, tick: 0 });
    const last = out[out.length - 1]!;
    if (last.tick < ticks) out.push({ ...last, tick: ticks });
    return out;
}

/**
 * The samples to keep (indexes, first and last always): line simplification in time, measuring each
 * dropped sample against where steady speed between the kept ones would put it at its own tick,
 * so both the shape and the timing stay within `tolerance`.
 */
function keptSamples(
    take: readonly RecordedSample[],
    tolerance: number,
): number[] {
    const keep = new Uint8Array(take.length);
    keep[0] = 1;
    keep[take.length - 1] = 1;
    const stack: [number, number][] = [[0, take.length - 1]];
    while (stack.length > 0) {
        const [a, b] = stack.pop()!;
        const A = take[a]!;
        const B = take[b]!;
        let worst = -1;
        let at = -1;
        for (let k = a + 1; k < b; k++) {
            const S = take[k]!;
            const f = (S.tick - A.tick) / (B.tick - A.tick);
            const d = Math.hypot(
                S.x - (A.x + (B.x - A.x) * f),
                S.y - (A.y + (B.y - A.y) * f),
            );
            if (d > worst) {
                worst = d;
                at = k;
            }
        }
        if (worst > tolerance) {
            keep[at] = 1;
            stack.push([a, at], [at, b]);
        }
    }
    const kept: number[] = [];
    keep.forEach((v, i) => v && kept.push(i));
    return kept;
}
