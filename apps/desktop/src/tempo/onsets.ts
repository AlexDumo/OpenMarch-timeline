/**
 * Music onset analysis for lining the timeline's counts up with the imported music.
 *
 * Pure (no DOM): it runs in a worker (`onsets.worker.ts`), in Node tests and on the main thread.
 *
 * - `onsetEnvelope`: spectral-flux onset strength, one value per ~5 ms frame, in show time
 * - `snapToOnset`: the precise time of the strongest onset near a time
 * - `fitCountsToOnsets`: moves a run of count boundaries onto the music's onsets (dynamic programming)
 * - `estimateBeatPeriod`: rough seconds per count of a range, from the envelope's autocorrelation
 */

export interface OnsetEnvelope {
    /** Frames per second */
    rate: number;
    /** Onset strength per frame, normalized so typical peaks are ~1 */
    values: Float32Array;
    /** Show time (seconds) of frame 0 */
    startSeconds: number;
}

// ---------------------------------------------------------------------------------------------
// FFT

/** In-place iterative radix-2 complex FFT of a fixed power-of-two size */
class Fft {
    readonly size: number;
    private readonly rev: Uint32Array;
    private readonly cos: Float64Array;
    private readonly sin: Float64Array;

    constructor(size: number) {
        if (size < 2 || (size & (size - 1)) !== 0)
            throw new Error(`FFT size must be a power of two, got ${size}`);
        this.size = size;
        this.rev = new Uint32Array(size);
        const bits = Math.log2(size);
        for (let i = 0; i < size; i++) {
            let r = 0;
            for (let b = 0; b < bits; b++)
                r |= ((i >> b) & 1) << (bits - 1 - b);
            this.rev[i] = r;
        }
        this.cos = new Float64Array(size / 2);
        this.sin = new Float64Array(size / 2);
        for (let i = 0; i < size / 2; i++) {
            this.cos[i] = Math.cos((2 * Math.PI * i) / size);
            this.sin[i] = -Math.sin((2 * Math.PI * i) / size);
        }
    }

    transform(re: Float64Array, im: Float64Array): void {
        const n = this.size;
        const rev = this.rev;
        for (let i = 0; i < n; i++) {
            const j = rev[i];
            if (j > i) {
                let t = re[i];
                re[i] = re[j];
                re[j] = t;
                t = im[i];
                im[i] = im[j];
                im[j] = t;
            }
        }
        const cos = this.cos;
        const sin = this.sin;
        for (let len = 2; len <= n; len <<= 1) {
            const half = len >> 1;
            const step = n / len;
            for (let start = 0; start < n; start += len) {
                for (let k = 0, w = 0; k < half; k++, w += step) {
                    const a = start + k;
                    const b = a + half;
                    const wr = cos[w];
                    const wi = sin[w];
                    const xr = re[b] * wr - im[b] * wi;
                    const xi = re[b] * wi + im[b] * wr;
                    re[b] = re[a] - xr;
                    im[b] = im[a] - xi;
                    re[a] += xr;
                    im[a] += xi;
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Envelope

/** Analysis rate the input is decimated to (roughly), Hz */
const ANALYSIS_RATE = 22050;
/** Window length target, seconds (rounded to a power of two in samples) */
const WINDOW_SECONDS = 0.023;
/** Hop target, seconds */
const HOP_SECONDS = 0.005;
/** Log-spaced bands the spectrum is summed into */
const BAND_COUNT = 40;
const BAND_LOW_HZ = 40;
const BAND_HIGH_HZ = 11000;
/** Log compression: log(1 + COMPRESSION * magnitude) */
const COMPRESSION = 1000;
/** Half-width of the moving mean subtracted from the flux, seconds */
const LOCAL_MEAN_SECONDS = 0.1;
/**
 * How far an onset's flux peak lands before the onset itself, seconds: the log flux rises as soon
 * as the attack enters the window. Measured on synthetic clicks and tones (onsets.test.ts).
 */
const PEAK_LEAD_SECONDS = 0.005;

/**
 * Spectral-flux onset envelope: mono mix, decimate to ~22 kHz, 23 ms Hann windows every 5 ms,
 * magnitudes summed into 40 log-spaced bands, log-compressed, half-wave rectified frame
 * difference summed over bands, local mean removed, normalized so typical peaks are ~1.
 *
 * Frame `n` is centered on input sample `n * hop` (the input is padded by half a window at the
 * start), so it is centered on `startSeconds + n / rate`; `startSeconds` is then nudged later by the
 * flux's measured lead so peaks land on the onsets.
 */
// eslint-disable-next-line max-lines-per-function -- one tight analysis loop
export function onsetEnvelope(
    channels: readonly Float32Array[],
    sampleRate: number,
    startSeconds = 0,
): OnsetEnvelope {
    const length = channels.reduce((m, c) => Math.max(m, c.length), 0);
    const decimation = Math.max(1, Math.round(sampleRate / ANALYSIS_RATE));
    const rate0 = sampleRate / decimation;
    const windowSize = nearestPowerOfTwo(WINDOW_SECONDS * rate0);
    const hop = Math.max(1, Math.round(HOP_SECONDS * rate0));
    const frameRate = rate0 / hop;
    const halfWindow = windowSize / 2;
    // Padded by half a window before and a window after, so frames never read out of range
    const { samples: mono, length: monoLength } = monoDecimate(
        channels,
        length,
        decimation,
        halfWindow,
        windowSize + hop,
    );
    const frameCount = Math.max(0, Math.ceil(monoLength / hop));
    if (frameCount < 3) {
        return {
            rate: frameRate,
            values: new Float32Array(frameCount),
            startSeconds: startSeconds + PEAK_LEAD_SECONDS,
        };
    }

    const bandEdges = makeBandEdges(windowSize, rate0);
    const bands = bandEdges.length - 1;
    const hann = new Float64Array(windowSize);
    for (let i = 0; i < windowSize; i++)
        hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / windowSize);
    const scale = COMPRESSION / (windowSize / 2);

    const fft = new Fft(windowSize);
    const re = new Float64Array(windowSize);
    const im = new Float64Array(windowSize);
    const bandsA = new Float64Array(bands);
    const bandsB = new Float64Array(bands);
    let previous = new Float64Array(bands);
    let current = new Float64Array(bands);
    const flux = new Float32Array(frameCount);

    // Two real frames per complex FFT: frame A in the real part, frame B in the imaginary part
    for (let frame = 0; frame < frameCount; frame += 2) {
        const hasB = frame + 1 < frameCount;
        const startA = frame * hop;
        const startB = startA + hop;
        for (let i = 0; i < windowSize; i++) {
            const w = hann[i];
            re[i] = mono[startA + i] * w;
            im[i] = mono[startB + i] * w;
        }
        fft.transform(re, im);
        for (let band = 0; band < bands; band++) {
            let sumA = 0;
            let sumB = 0;
            const last = bandEdges[band + 1];
            for (let k = bandEdges[band]; k < last; k++) {
                const zr = re[k];
                const zi = im[k];
                const cr = re[windowSize - k];
                const ci = -im[windowSize - k];
                // X_A = (Z[k] + conj Z[N-k]) / 2, X_B = (Z[k] - conj Z[N-k]) / 2i
                const ar = zr + cr;
                const ai = zi + ci;
                const br = zi - ci;
                const bi = cr - zr;
                sumA += Math.sqrt(ar * ar + ai * ai);
                sumB += Math.sqrt(br * br + bi * bi);
            }
            bandsA[band] = sumA * 0.5;
            bandsB[band] = sumB * 0.5;
        }
        for (let pass = 0; pass < (hasB ? 2 : 1); pass++) {
            const source = pass === 0 ? bandsA : bandsB;
            let sum = 0;
            for (let b = 0; b < bands; b++) {
                const value = Math.log1p(scale * source[b]);
                current[b] = value;
                const rise = value - previous[b];
                if (rise > 0) sum += rise;
            }
            const index = frame + pass;
            flux[index] = index === 0 ? 0 : sum;
            const swap = previous;
            previous = current;
            current = swap;
        }
    }

    const values = removeLocalMean(
        flux,
        Math.max(1, Math.round(LOCAL_MEAN_SECONDS * frameRate)),
    );
    normalizePeaks(values, Math.max(1, Math.round(0.05 * frameRate)));
    return {
        rate: frameRate,
        values,
        startSeconds: startSeconds + PEAK_LEAD_SECONDS,
    };
}

function nearestPowerOfTwo(value: number): number {
    return 2 ** Math.max(1, Math.round(Math.log2(Math.max(2, value))));
}

/** Channels mixed to mono and decimated by averaging, with `padStart`/`padEnd` zeros around */
function monoDecimate(
    channels: readonly Float32Array[],
    length: number,
    decimation: number,
    padStart: number,
    padEnd: number,
): { samples: Float32Array; length: number } {
    const outLength = Math.floor(length / decimation);
    const out = new Float32Array(padStart + outLength + padEnd);
    const count = channels.length;
    if (count === 0) return { samples: out, length: 0 };
    const gain = 1 / (count * decimation);
    for (const channel of channels) {
        const n = Math.min(channel.length, outLength * decimation);
        if (decimation === 1) {
            for (let i = 0; i < n; i++) out[padStart + i] += channel[i] * gain;
        } else {
            for (let i = 0; i < n; i++)
                out[padStart + ((i / decimation) | 0)] += channel[i] * gain;
        }
    }
    return { samples: out, length: outLength };
}

/** FFT bin edges of the log-spaced bands, ascending and distinct (each band ≥ 1 bin) */
function makeBandEdges(windowSize: number, rate: number): number[] {
    const binHz = rate / windowSize;
    const nyquistBin = windowSize / 2;
    const high = Math.min(BAND_HIGH_HZ, rate / 2 - binHz);
    const edges: number[] = [];
    for (let i = 0; i <= BAND_COUNT; i++) {
        const hz = BAND_LOW_HZ * (high / BAND_LOW_HZ) ** (i / BAND_COUNT);
        const bin = Math.min(nyquistBin, Math.max(1, Math.round(hz / binHz)));
        if (edges.length === 0 || bin > edges[edges.length - 1])
            edges.push(bin);
    }
    return edges;
}

/** Half-wave rectified flux minus its moving mean over ±`half` frames */
function removeLocalMean(flux: Float32Array, half: number): Float32Array {
    const n = flux.length;
    const prefix = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + flux[i];
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const lo = Math.max(0, i - half);
        const hi = Math.min(n, i + half + 1);
        const mean = (prefix[hi] - prefix[lo]) / (hi - lo);
        const v = flux[i] - mean;
        out[i] = v > 0 ? v : 0;
    }
    return out;
}

/** Divides by a high quantile of the local maxima so typical (strong) peaks are ~1 */
function normalizePeaks(values: Float32Array, half: number): void {
    const peaks = localMaxima(values, half).map((i) => values[i]);
    if (peaks.length === 0) return;
    peaks.sort((a, b) => a - b);
    const norm =
        peaks[Math.min(peaks.length - 1, Math.floor(peaks.length * 0.9))];
    if (!(norm > 0)) return;
    const inv = 1 / norm;
    for (let i = 0; i < values.length; i++) values[i] *= inv;
}

/** Indices that are the (first) maximum of a ±`half` frame neighborhood and above 0 */
function localMaxima(
    values: Float32Array,
    half: number,
    from = 0,
    to = values.length,
): number[] {
    const out: number[] = [];
    const n = values.length;
    for (let i = Math.max(0, from); i < Math.min(n, to); i++) {
        const v = values[i];
        if (!(v > 0)) continue;
        let isMax = true;
        const lo = Math.max(0, i - half);
        const hi = Math.min(n - 1, i + half);
        for (let j = lo; j <= hi; j++) {
            const w = values[j];
            if (w > v || (w === v && j < i)) {
                isMax = false;
                break;
            }
        }
        if (isMax) out.push(i);
    }
    return out;
}

/** Sub-frame position of a peak at `i` (parabolic interpolation), in frames */
function refinePeak(values: Float32Array, i: number): number {
    if (i <= 0 || i >= values.length - 1) return i;
    const a = values[i - 1];
    const b = values[i];
    const c = values[i + 1];
    const denominator = a - 2 * b + c;
    if (denominator >= 0) return i;
    const offset = (0.5 * (a - c)) / denominator;
    return i + Math.max(-0.5, Math.min(0.5, offset));
}

function frameAt(env: OnsetEnvelope, seconds: number): number {
    return (seconds - env.startSeconds) * env.rate;
}

function secondsAt(env: OnsetEnvelope, frame: number): number {
    return env.startSeconds + frame / env.rate;
}

// ---------------------------------------------------------------------------------------------
// Peaks

/** The weakest peak (normalized strength) that counts as an onset */
const PEAK_FLOOR = 0.15;
/** Peaks closer than this are one onset, seconds */
const PEAK_SEPARATION_SECONDS = 0.03;

interface Peak {
    /** Precise time, seconds */
    seconds: number;
    /** Normalized strength */
    strength: number;
}

/** The onset peaks between two times, ascending */
function peaksBetween(env: OnsetEnvelope, from: number, to: number): Peak[] {
    const half = Math.max(1, Math.round(PEAK_SEPARATION_SECONDS * env.rate));
    const lo = Math.max(0, Math.floor(frameAt(env, from)));
    const hi = Math.min(env.values.length, Math.ceil(frameAt(env, to)) + 1);
    const peaks: Peak[] = [];
    for (const i of localMaxima(env.values, half, lo, hi)) {
        const strength = env.values[i];
        if (strength < PEAK_FLOOR) continue;
        const seconds = secondsAt(env, refinePeak(env.values, i));
        if (seconds < from || seconds > to) continue;
        peaks.push({ seconds, strength });
    }
    return peaks;
}

/**
 * The time of the strongest onset peak within ±`windowSeconds` of `seconds` (nearer peaks win
 * close calls), interpolated between frames, or `seconds` unchanged if there is none above the
 * floor.
 */
export function snapToOnset(
    env: OnsetEnvelope,
    seconds: number,
    windowSeconds = 0.08,
): number {
    if (!Number.isFinite(seconds) || env.values.length === 0) return seconds;
    let best: Peak | null = null;
    let bestScore = 0;
    for (const peak of peaksBetween(
        env,
        seconds - windowSeconds,
        seconds + windowSeconds,
    )) {
        const d = (peak.seconds - seconds) / windowSeconds;
        const score = peak.strength * (1 - 0.3 * d * d);
        if (score > bestScore) {
            bestScore = score;
            best = peak;
        }
    }
    return best ? best.seconds : seconds;
}

// ---------------------------------------------------------------------------------------------
// Fitting counts

/** Each free boundary is searched within ± this share of its local count length */
const SEARCH_SHARE = 0.75;
/** A free end may move within ± this share of its count's length */
const END_SHARE = 0.35;
/** Evenly spaced "no onset here" positions per boundary window */
const NULL_CANDIDATES = 11;
/** At most this many onset peaks per boundary (the strongest) */
const MAX_PEAKS = 10;
/** Penalty weight on the squared log-ratio between consecutive intervals */
const SMOOTHNESS = 25;
/** Penalty weight on the squared log-ratio between an interval and the guess's */
const TEMPO_PRIOR = 1;
/** Onset strength credited at most per boundary */
const MAX_GAIN = 2;
const MAX_PASSES = 6;
/** An interval may be at most this many times longer or shorter than the guess's */
const LOG_MAX_RATIO = Math.log(2.5);
/** Shortest count the fit makes, seconds */
const MIN_INTERVAL = 0.02;

interface Candidate {
    seconds: number;
    gain: number;
    onset: boolean;
}

/**
 * Fit `counts = guess.length - 1` consecutive counts to the music: moves each count boundary onto
 * an onset where the music has one, keeping tempo changes smooth.
 *
 * Each pass is a dynamic program (after Ellis 2007, "Beat tracking by dynamic programming") over
 * candidate times for every boundary: the onset peaks within ±40% of the local count length of
 * the current guess, plus evenly spaced "no onset" positions. A path scores the onset strength at
 * its boundaries, minus a penalty on the squared log-ratio between consecutive intervals (state
 * is the last two boundaries' candidates, so this is second order), minus a weak penalty on each
 * interval's log-ratio to the original guess's. Boundaries the best path puts on no onset are then
 * spread between their onset-anchored neighbors in proportion to the guess, so silence keeps
 * the guess's spacing. The result becomes the next pass's guess (windows re-centered), which
 * lets the fit follow tempo that drifts further than one window.
 */
export function fitCountsToOnsets(args: {
    env: OnsetEnvelope;
    guess: readonly number[];
    startFixed: boolean;
    endFixed: boolean;
}): number[] {
    const { env, guess, startFixed, endFixed } = args;
    const counts = guess.length - 1;
    if (counts < 1 || env.values.length === 0) return guess.slice();
    const originalIntervals: number[] = [];
    for (let i = 1; i <= counts; i++)
        originalIntervals.push(Math.max(MIN_INTERVAL, guess[i] - guess[i - 1]));

    let current = makeAscending(guess.slice(), endFixed);
    for (let pass = 0; pass < MAX_PASSES; pass++) {
        const next = fitPass(
            env,
            current,
            guess,
            originalIntervals,
            startFixed,
            endFixed,
        );
        let change = 0;
        for (let i = 0; i <= counts; i++)
            change = Math.max(change, Math.abs(next[i] - current[i]));
        current = next;
        if (change < 0.001) break;
    }
    return current;
}

function fitPass(
    env: OnsetEnvelope,
    current: readonly number[],
    original: readonly number[],
    originalIntervals: readonly number[],
    startFixed: boolean,
    endFixed: boolean,
): number[] {
    const counts = current.length - 1;
    const candidates = boundaryCandidates(env, current, startFixed, endFixed);
    const chosen = bestPath(candidates, originalIntervals.map(Math.log));
    if (!chosen) return current.slice();
    const result = spreadOffOnsets(candidates, chosen, current);
    if (!result) return current.slice();

    // Free ends stay within reach of the original guess
    if (startFixed) result[0] = original[0];
    else {
        const reach = END_SHARE * originalIntervals[0];
        result[0] = clamp(result[0], original[0] - reach, original[0] + reach);
    }
    if (endFixed) result[counts] = original[counts];
    else {
        const reach = END_SHARE * originalIntervals[counts - 1];
        result[counts] = clamp(
            result[counts],
            original[counts] - reach,
            original[counts] + reach,
        );
    }
    return makeAscending(result, endFixed);
}

/**
 * Each boundary's candidate times: evenly spaced "no onset" positions across its window plus the
 * strongest onset peaks in it. A fixed end has only itself (counted as an onset: it anchors)
 */
function boundaryCandidates(
    env: OnsetEnvelope,
    current: readonly number[],
    startFixed: boolean,
    endFixed: boolean,
): Candidate[][] {
    const counts = current.length - 1;
    const interval = (i: number) =>
        Math.max(MIN_INTERVAL, current[i + 1] - current[i]);
    const localInterval = (i: number) =>
        i === 0
            ? interval(0)
            : i === counts
              ? interval(counts - 1)
              : (interval(i - 1) + interval(i)) / 2;

    const candidates: Candidate[][] = [];
    for (let i = 0; i <= counts; i++) {
        if ((i === 0 && startFixed) || (i === counts && endFixed)) {
            candidates.push([{ seconds: current[i], gain: 0, onset: true }]);
            continue;
        }
        const share = i === 0 || i === counts ? END_SHARE : SEARCH_SHARE;
        const radius = share * localInterval(i);
        const center = current[i];
        const list: Candidate[] = [];
        for (let k = 0; k < NULL_CANDIDATES; k++) {
            const offset = -radius + (2 * radius * k) / (NULL_CANDIDATES - 1);
            list.push({ seconds: center + offset, gain: 0, onset: false });
        }
        const peaks = peaksBetween(env, center - radius, center + radius)
            .sort((a, b) => b.strength - a.strength)
            .slice(0, MAX_PEAKS);
        for (const peak of peaks)
            list.push({
                seconds: peak.seconds,
                gain: Math.min(MAX_GAIN, peak.strength),
                onset: true,
            });
        candidates.push(list);
    }

    return candidates;
}

/**
 * The DP: the best candidate index per boundary, or null if no path fits. State is the pair
 * (previous boundary's candidate, this boundary's), so the score can penalize the change between
 * consecutive intervals. score[i] is K[i-1] x K[i], row = previous
 */
// eslint-disable-next-line max-lines-per-function -- one tight DP loop
function bestPath(
    candidates: readonly Candidate[][],
    logPrior: readonly number[],
): number[] | null {
    const counts = candidates.length - 1;
    let previousScore: Float64Array | null = null;
    let previousLogs: Float64Array | null = null;
    const back: Int32Array[] = [];
    for (let i = 1; i <= counts; i++) {
        const before = candidates[i - 1];
        const here = candidates[i];
        const kb = before.length;
        const kh = here.length;
        const logs = new Float64Array(kb * kh);
        const score = new Float64Array(kb * kh).fill(-Infinity);
        const pointers = new Int32Array(kb * kh).fill(-1);
        const prior = logPrior[i - 1];
        for (let a = 0; a < kb; a++) {
            for (let b = 0; b < kh; b++) {
                const d = here[b].seconds - before[a].seconds;
                logs[a * kh + b] = d >= MIN_INTERVAL ? Math.log(d) : NaN;
            }
        }
        if (i === 1) {
            for (let a = 0; a < kb; a++) {
                for (let b = 0; b < kh; b++) {
                    const l = logs[a * kh + b];
                    if (Number.isNaN(l) || Math.abs(l - prior) > LOG_MAX_RATIO)
                        continue;
                    const p = l - prior;
                    score[a * kh + b] =
                        before[a].gain + here[b].gain - TEMPO_PRIOR * p * p;
                }
            }
        } else {
            const kc = candidates[i - 2].length;
            const ps = previousScore!;
            const pl = previousLogs!;
            for (let a = 0; a < kb; a++) {
                for (let b = 0; b < kh; b++) {
                    const l = logs[a * kh + b];
                    if (Number.isNaN(l) || Math.abs(l - prior) > LOG_MAX_RATIO)
                        continue;
                    let best = -Infinity;
                    let bestC = -1;
                    for (let c = 0; c < kc; c++) {
                        const s = ps[c * kb + a];
                        if (s === -Infinity) continue;
                        // the change in count length, against the change the guess has there (an
                        // uneven grouping or a rit. is not a mistake)
                        // or a steady one, whichever is closer: a jittered guess shouldn't pull)
                        const steady = l - pl[c * kb + a];
                        const shaped = steady - (prior - logPrior[i - 2]);
                        const r2 = Math.min(steady * steady, shaped * shaped);
                        const v = s - SMOOTHNESS * r2;
                        if (v > best) {
                            best = v;
                            bestC = c;
                        }
                    }
                    if (bestC < 0) continue;
                    const p = l - prior;
                    score[a * kh + b] =
                        best + here[b].gain - TEMPO_PRIOR * p * p;
                    pointers[a * kh + b] = bestC;
                }
            }
        }
        back.push(pointers);
        previousScore = score;
        previousLogs = logs;
    }

    // Best final pair, then trace back
    const chosen = new Array<number>(counts + 1).fill(0);
    {
        const kb = candidates[counts - 1].length;
        const kh = candidates[counts].length;
        let best = -Infinity;
        for (let a = 0; a < kb; a++) {
            for (let b = 0; b < kh; b++) {
                const s = previousScore![a * kh + b];
                if (s > best) {
                    best = s;
                    chosen[counts - 1] = a;
                    chosen[counts] = b;
                }
            }
        }
        if (best === -Infinity) return null;
        for (let i = counts; i >= 2; i--) {
            const kh2 = candidates[i].length;
            chosen[i - 2] = back[i - 1][chosen[i - 1] * kh2 + chosen[i]];
        }
    }

    return chosen;
}

/**
 * The chosen times, with boundaries off any onset spread between their onset-anchored
 * neighbors in proportion to the current guess (and extrapolated at the fitted tempo past the
 * first and last anchors). Null when nothing is anchored
 */
function spreadOffOnsets(
    candidates: readonly Candidate[][],
    chosen: readonly number[],
    current: readonly number[],
): number[] | null {
    const counts = current.length - 1;
    const result = new Array<number>(counts + 1);
    const anchors: number[] = [];
    for (let i = 0; i <= counts; i++) {
        const candidate = candidates[i][chosen[i]];
        result[i] = candidate.seconds;
        if (candidate.onset) anchors.push(i);
    }
    if (anchors.length === 0) return null;
    for (let k = 0; k + 1 < anchors.length; k++) {
        const a = anchors[k];
        const b = anchors[k + 1];
        const span = current[b] - current[a];
        for (let i = a + 1; i < b; i++) {
            const share =
                span > 0 ? (current[i] - current[a]) / span : (i - a) / (b - a);
            result[i] = result[a] + share * (result[b] - result[a]);
        }
    }
    const first = anchors[0];
    const last = anchors[anchors.length - 1];
    const leadRatio = tempoRatio(
        result,
        current,
        first,
        Math.min(last, first + 4),
    );
    for (let i = first - 1; i >= 0; i--)
        result[i] = result[first] - (current[first] - current[i]) * leadRatio;
    const tailRatio = tempoRatio(
        result,
        current,
        Math.max(first, last - 4),
        last,
    );
    for (let i = last + 1; i <= counts; i++)
        result[i] = result[last] + (current[i] - current[last]) * tailRatio;

    return result;
}

/** Fitted over guessed length of the span between two boundaries (1 when it is empty) */
function tempoRatio(
    fitted: readonly number[],
    guessed: readonly number[],
    a: number,
    b: number,
): number {
    if (b <= a) return 1;
    const g = guessed[b] - guessed[a];
    const f = fitted[b] - fitted[a];
    if (!(g > 0) || !(f > 0)) return 1;
    return clamp(f / g, 0.5, 2);
}

function clamp(value: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, value));
}

/**
 * Pushes boundaries apart so each count is at least MIN_INTERVAL long. With `keepEnd`, the last
 * boundary stays put and the others give way before it
 */
function makeAscending(times: number[], keepEnd = false): number[] {
    const n = times.length;
    const end = times[n - 1];
    for (let i = 1; i < n; i++)
        if (times[i] < times[i - 1] + MIN_INTERVAL)
            times[i] = times[i - 1] + MIN_INTERVAL;
    if (keepEnd) times[n - 1] = end;
    for (let i = n - 2; i >= 0; i--)
        if (times[i] > times[i + 1] - MIN_INTERVAL)
            times[i] = times[i + 1] - MIN_INTERVAL;
    return times;
}

// ---------------------------------------------------------------------------------------------
// Tempo

/**
 * Rough tempo of a time range, in seconds per count, from the envelope's autocorrelation with a
 * mild preference for ~120 BPM (log-Gaussian, one octave wide), refined over the period's first
 * few multiples. `null` if the range is too short or has no clear periodicity.
 */
export function estimateBeatPeriod(
    env: OnsetEnvelope,
    fromSeconds: number,
    toSeconds: number,
    minSeconds = 60 / 200,
    maxSeconds = 60 / 50,
): number | null {
    const lo = Math.max(0, Math.floor(frameAt(env, fromSeconds)));
    const hi = Math.min(env.values.length, Math.ceil(frameAt(env, toSeconds)));
    const n = hi - lo;
    const minLag = Math.max(1, Math.floor(minSeconds * env.rate));
    const maxLag = Math.ceil(maxSeconds * env.rate);
    if (n < 2 * maxLag || minLag >= maxLag) return null;

    const x = new Float64Array(n);
    let mean = 0;
    for (let i = 0; i < n; i++) mean += env.values[lo + i];
    mean /= n;
    for (let i = 0; i < n; i++) x[i] = env.values[lo + i] - mean;
    const topLag = Math.min(n - 1, 4 * maxLag + 2);
    const acf = new Float64Array(topLag + 1);
    for (let lag = 0; lag <= topLag; lag++) {
        let s = 0;
        for (let i = lag; i < n; i++) s += x[i] * x[i - lag];
        acf[lag] = s / (n - lag);
    }
    if (!(acf[0] > 0)) return null;

    let bestLag = -1;
    let bestScore = -Infinity;
    for (let lag = minLag; lag <= Math.min(maxLag, topLag - 1); lag++) {
        if (!(acf[lag] >= acf[lag - 1] && acf[lag] >= acf[lag + 1])) continue;
        const octaves = Math.log2(lag / env.rate / 0.5);
        const score = acf[lag] * Math.exp(-0.5 * octaves * octaves);
        if (score > bestScore) {
            bestScore = score;
            bestLag = lag;
        }
    }
    if (bestLag < 0 || acf[bestLag] / acf[0] < 0.1) return null;

    // Refine over the period's multiples that fit
    let sum = 0;
    let weight = 0;
    for (let m = 1; m <= 4; m++) {
        const target = Math.round(refineLag(acf, bestLag) * m);
        if (target + 3 > topLag) break;
        let peak = target;
        for (let lag = target - 3; lag <= target + 3; lag++)
            if (acf[lag] > acf[peak]) peak = lag;
        if (peak <= 0 || peak >= topLag || acf[peak] <= 0) continue;
        const w = acf[peak];
        sum += (refineLag(acf, peak) / m) * w;
        weight += w;
    }
    const lag = weight > 0 ? sum / weight : refineLag(acf, bestLag);
    return lag / env.rate;
}

function refineLag(acf: Float64Array, i: number): number {
    if (i <= 0 || i >= acf.length - 1) return i;
    const a = acf[i - 1];
    const b = acf[i];
    const c = acf[i + 1];
    const denominator = a - 2 * b + c;
    if (denominator >= 0) return i;
    return i + Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denominator));
}
