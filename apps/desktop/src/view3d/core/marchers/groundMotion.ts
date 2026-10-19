/**
 * How fast a performer covers the ground and turns at a count, read from
 * the drill sampled at count boundaries and the plan's headings: what a
 * silk's wave follows (props-spec.md section 7). Every value is a function
 * of the count alone, never of the frames before it, so a scrub or a seek
 * gives the same answer as playing there. Pure: no three.js.
 */

/** One performer's ground track over the show. */
export interface GroundTrack {
    /** Distance covered by each count boundary, m (K + 1). */
    distance: Float64Array;
    /** Speed over each count, m/s (K). */
    speed: Float64Array;
}

/**
 * The track of drill `positions` (x, z interleaved at each count
 * boundary, as the planner samples them), with count k lasting
 * `secondsPerCount(k)`.
 */
export function groundTrack(
    positions: Float64Array,
    secondsPerCount: (k: number) => number,
): GroundTrack {
    const K = Math.max(0, positions.length / 2 - 1);
    const distance = new Float64Array(K + 1);
    const speed = new Float64Array(K);
    for (let k = 0; k < K; k++) {
        const d = Math.hypot(
            positions[k * 2 + 2] - positions[k * 2],
            positions[k * 2 + 3] - positions[k * 2 + 1],
        );
        distance[k + 1] = distance[k] + d;
        const s = secondsPerCount(k);
        speed[k] = s > 0 ? d / s : 0;
    }
    return { distance, speed };
}

/** The distance covered by count clock `c`: linear within each count. */
export function groundDistanceAt(track: GroundTrack, c: number): number {
    const d = track.distance;
    const K = d.length - 1;
    if (K <= 0 || !(c > 0)) return 0;
    if (c >= K) return d[K];
    const k = Math.floor(c);
    return d[k] + (c - k) * (d[k + 1] - d[k]);
}

/**
 * The ground speed at count clock `c`: each count's speed at its middle,
 * linear between, so a silk eases into a move instead of jumping at the
 * count boundary.
 */
export function groundSpeedAt(track: GroundTrack, c: number): number {
    const s = track.speed;
    const K = s.length;
    if (K === 0 || !(c >= 0) || c > K) return 0;
    const m = Math.min(Math.max(c - 0.5, 0), K - 1);
    const k = Math.min(Math.floor(m), K - 1);
    const next = Math.min(k + 1, K - 1);
    return s[k] + (m - k) * (s[next] - s[k]);
}

const wrapAngle = (a: number) =>
    a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

/** The window the turn rate is measured over, in counts either side. */
export const TURN_RATE_SPAN = 0.05;

/**
 * The turn rate at count clock `c`, rad/s: the heading's central
 * difference over {@link TURN_RATE_SPAN} counts either side.
 */
export function turnRateAt(
    heading: (c: number) => number,
    c: number,
    secondsPerCount: (k: number) => number,
): number {
    const e = TURN_RATE_SPAN;
    const s = secondsPerCount(Math.max(0, Math.floor(c)));
    if (!(s > 0)) return 0;
    return wrapAngle(heading(c + e) - heading(c - e)) / (2 * e * s);
}
