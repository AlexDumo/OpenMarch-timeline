import { describe, expect, it } from "vitest";
import {
    estimateBeatPeriod,
    fitCountsToOnsets,
    onsetEnvelope,
    snapToOnset,
    type OnsetEnvelope,
} from "../onsets";

const SAMPLE_RATE = 44100;

/** Deterministic noise in [-1, 1) */
function noiseSource(seed: number) {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 2 ** 31 - 1;
    };
}

/**
 * The test song's count boundaries (show seconds):
 * - counts 0–23: 120 BPM with clicks, starting at 1 s
 * - counts 24–39: ritardando 120 → 90 BPM, clicks
 * - counts 40–47: 90 BPM, no clicks (noise floor only)
 * - counts 48–59: 90 BPM, clicks
 */
function songBeats() {
    const times = [1];
    const clicked: boolean[] = [];
    const add = (interval: number, click: boolean) => {
        clicked.push(click);
        times.push(times[times.length - 1] + interval);
    };
    for (let i = 0; i < 24; i++) add(0.5, true);
    for (let i = 0; i < 16; i++)
        add(0.5 + ((2 / 3 - 0.5) * (i + 1)) / 16, true);
    for (let i = 0; i < 8; i++) add(2 / 3, false);
    for (let i = 0; i < 12; i++) add(2 / 3, true);
    // A boundary is clicked when the count it starts is (the last one too)
    const onsets = times.filter((_, i) => clicked[i] ?? true);
    return { times, clicked, onsets };
}

/** A click (short noise burst) plus a decaying tone at each onset, over a light noise floor */
function synthesize(
    onsets: readonly number[],
    seconds: number,
    {
        stereo = true,
        seed = 1,
        sampleRate = SAMPLE_RATE,
        gains = [] as readonly number[],
    } = {},
): Float32Array[] {
    const SAMPLE_RATE = sampleRate;
    const length = Math.ceil(seconds * SAMPLE_RATE);
    const left = new Float32Array(length);
    const noise = noiseSource(seed);
    for (let i = 0; i < length; i++) left[i] = 0.003 * noise();
    const pitches = [220, 330, 440, 277];
    onsets.forEach((t, k) => {
        const start = Math.round(t * SAMPLE_RATE);
        const pitch = pitches[k % pitches.length];
        const gain = gains[k] ?? 1;
        const span = Math.min(length - start, Math.round(0.35 * SAMPLE_RATE));
        for (let j = 0; j < span; j++) {
            const time = j / SAMPLE_RATE;
            const click =
                time < 0.01 ? 0.5 * noise() * Math.exp(-time / 0.003) : 0;
            const tone =
                0.3 *
                Math.sin(2 * Math.PI * pitch * time) *
                Math.exp(-time / 0.12);
            left[start + j] += gain * (click + tone);
        }
    });
    if (!stereo) return [left];
    const right = new Float32Array(length);
    for (let i = 0; i < length; i++) right[i] = left[i] * 0.8 + 0.002 * noise();
    return [left, right];
}

function envelopePeaks(env: OnsetEnvelope, threshold = 0.3): number[] {
    const out: number[] = [];
    const v = env.values;
    const half = Math.round(0.05 * env.rate);
    for (let i = 1; i < v.length - 1; i++) {
        if (v[i] < threshold) continue;
        let isMax = true;
        for (
            let j = Math.max(0, i - half);
            j <= Math.min(v.length - 1, i + half);
            j++
        )
            if (v[j] > v[i] || (v[j] === v[i] && j < i)) isMax = false;
        if (isMax) out.push(env.startSeconds + i / env.rate);
    }
    return out;
}

const nearest = (list: readonly number[], t: number) =>
    list.reduce(
        (best, x) => (Math.abs(x - t) < Math.abs(best - t) ? x : best),
        Infinity,
    );

const song = songBeats();
const songEnd = song.times[song.times.length - 1] + 1;
const audio = synthesize(song.onsets, songEnd);
const env = onsetEnvelope(audio, SAMPLE_RATE);

describe("onsetEnvelope", () => {
    it("has ~5 ms frames in show time", () => {
        expect(env.rate).toBeGreaterThan(100);
        expect(env.rate).toBeLessThan(250);
        expect(env.values.length / env.rate).toBeCloseTo(songEnd, 0);
        expect(
            onsetEnvelope(audio, SAMPLE_RATE, 2.5).startSeconds -
                env.startSeconds,
        ).toBeCloseTo(2.5, 9);
    });

    it("peaks within 10 ms of every onset, and nowhere else", () => {
        const peaks = envelopePeaks(env);
        for (const onset of song.onsets)
            expect(Math.abs(nearest(peaks, onset) - onset)).toBeLessThan(0.01);
        // Nothing strong away from the onsets (the silent counts in particular)
        for (const peak of peaks)
            expect(Math.abs(nearest(song.onsets, peak) - peak)).toBeLessThan(
                0.03,
            );
    });

    it("normalizes typical peaks to about 1", () => {
        const strengths = song.onsets.map((t) => {
            const i = Math.round((t - env.startSeconds) * env.rate);
            let m = 0;
            for (let j = i - 3; j <= i + 3; j++)
                m = Math.max(m, env.values[j] ?? 0);
            return m;
        });
        strengths.sort((a, b) => a - b);
        const median = strengths[strengths.length >> 1];
        expect(median).toBeGreaterThan(0.5);
        expect(median).toBeLessThan(1.5);
    });

    it("works on mono and at 48 kHz", () => {
        const mono = onsetEnvelope(
            synthesize([1, 1.5, 2], 3, { stereo: false }),
            SAMPLE_RATE,
        );
        expect(envelopePeaks(mono).length).toBe(3);
        // 48 kHz: resample the same clicks by synthesizing at the other rate
        const at48 = synthesize([1, 1.5, 2], 3, {
            stereo: false,
            sampleRate: 48000,
        });
        const env48 = onsetEnvelope(at48, 48000);
        const peaks48 = envelopePeaks(env48);
        expect(peaks48.length).toBe(3);
        for (const t of [1, 1.5, 2])
            expect(Math.abs(nearest(peaks48, t) - t)).toBeLessThan(0.01);
        expect(onsetEnvelope([], SAMPLE_RATE).values.length).toBe(0);
    });
});

describe("snapToOnset", () => {
    it("finds each onset precisely from up to 60 ms away", () => {
        for (const [k, onset] of song.onsets.entries()) {
            const from = onset + (k % 2 ? 0.06 : -0.05);
            expect(Math.abs(snapToOnset(env, from) - onset)).toBeLessThan(
                0.008,
            );
        }
    });

    it("leaves a time with no onset nearby unchanged", () => {
        const silent = (song.times[42] + song.times[43]) / 2;
        expect(snapToOnset(env, silent)).toBe(silent);
        expect(snapToOnset(env, song.times[10] + 0.25, 0.1)).toBe(
            song.times[10] + 0.25,
        );
    });
});

describe("fitCountsToOnsets", () => {
    const truth = song.times;
    const counts = truth.length - 1;
    const clickedBoundary = (i: number) => song.clicked[i] ?? true;
    const errors = (fit: readonly number[]) =>
        fit.map((t, i) => ({
            i,
            error: Math.abs(t - truth[i]),
            clicked: clickedBoundary(i),
        }));

    function expectAscending(fit: readonly number[], length: number) {
        expect(fit.length).toBe(length);
        for (let i = 1; i < fit.length; i++)
            expect(fit[i]).toBeGreaterThan(fit[i - 1]);
    }

    it("converges from a guess off by up to 25% of a count", () => {
        const noise = noiseSource(7);
        const guess = truth.map((t, i) => {
            if (i === 0 || i === counts) return t;
            const local = (truth[i + 1] - truth[i - 1]) / 2;
            return t + 0.25 * local * noise();
        });
        const fit = fitCountsToOnsets({
            env,
            guess,
            startFixed: true,
            endFixed: true,
        });
        expectAscending(fit, truth.length);
        const clicked = errors(fit).filter((e) => e.clicked);
        const good = clicked.filter((e) => e.error < 0.015).length;
        expect(good / clicked.length).toBeGreaterThan(0.9);
        // The silent counts (boundaries 40–47) keep the guess's proportions between the onsets
        // around them
        for (let i = 40; i < 48; i++) {
            const share = (guess[i] - guess[39]) / (guess[48] - guess[39]);
            expect(fit[i]).toBeCloseTo(
                fit[39] + share * (fit[48] - fit[39]),
                6,
            );
        }
    });

    it("follows the ritardando from a constant-tempo guess", () => {
        // The ritardando's 16 counts guessed at one even tempo between the true ends: the middle
        // of the guess is ~0.6 counts off the music
        const from = 24;
        const to = 40;
        const guess = truth
            .slice(from, to + 1)
            .map(
                (_, k) =>
                    truth[from] + ((truth[to] - truth[from]) * k) / (to - from),
            );
        const fit = fitCountsToOnsets({
            env,
            guess,
            startFixed: true,
            endFixed: true,
        });
        expectAscending(fit, guess.length);
        const errs = fit.map((t, k) => ({
            k,
            error: Math.abs(t - truth[from + k]),
            clicked: clickedBoundary(from + k),
        }));
        const clicked = errs.filter((e) => e.clicked);
        expect(
            clicked.filter((e) => e.error < 0.015).length / clicked.length,
        ).toBeGreaterThan(0.85);
    });

    it("finds the music's tempo from a guess at the wrong steady tempo, end free", () => {
        // Counts 0–16 at 120 BPM guessed at 118 BPM: the free end is 0.27 counts late
        const guess = Array.from(
            { length: 17 },
            (_, k) => truth[0] + k * (60 / 118),
        );
        const fit = fitCountsToOnsets({
            env,
            guess,
            startFixed: true,
            endFixed: false,
        });
        expectAscending(fit, 17);
        expect(fit[0]).toBe(truth[0]);
        const errs = fit.map((t, k) => Math.abs(t - truth[k]));
        expect(
            errs.filter((e) => e < 0.015).length / errs.length,
        ).toBeGreaterThan(0.85);
    });

    it("moves a free start onto the music and keeps fixed ends where they are", () => {
        const guess = truth.slice(0, 9).map((t) => t + 0.1);
        const free = fitCountsToOnsets({
            env,
            guess,
            startFixed: false,
            endFixed: false,
        });
        expect(Math.abs(free[0] - truth[0])).toBeLessThan(0.015);
        expect(Math.abs(free[8] - truth[8])).toBeLessThan(0.015);

        const fixed = fitCountsToOnsets({
            env,
            guess,
            startFixed: true,
            endFixed: true,
        });
        expect(fixed[0]).toBe(guess[0]);
        expect(fixed[8]).toBe(guess[8]);
        expectAscending(fixed, 9);
    });

    it("stays on an even guess where the music has no onsets", () => {
        // The silent stretch, guessed a little off the truth but evenly
        const guess = Array.from(
            { length: 7 },
            (_, k) => truth[41] + 0.05 + k * 0.6,
        );
        const fit = fitCountsToOnsets({
            env,
            guess,
            startFixed: false,
            endFixed: false,
        });
        for (let k = 0; k < guess.length; k++)
            expect(Math.abs(fit[k] - guess[k])).toBeLessThan(0.02);
    });

    it("stays on the beats of busier music (weaker eighths and sixteenths between them)", () => {
        // 32 counts at 100 BPM: beats at full strength, eighths at 0.5, sixteenths at 0.3
        const period = 0.6;
        const beats = Array.from({ length: 33 }, (_, k) => 0.5 + k * period);
        const notes: number[] = [];
        const gains: number[] = [];
        for (const beat of beats.slice(0, -1)) {
            for (const [offset, gain] of [
                [0, 1],
                [0.25, 0.3],
                [0.5, 0.5],
                [0.75, 0.3],
            ] as const) {
                notes.push(beat + offset * period);
                gains.push(gain);
            }
        }
        notes.push(beats[32]);
        gains.push(1);
        const busy = onsetEnvelope(
            synthesize(notes, 21, { gains, seed: 5 }),
            SAMPLE_RATE,
        );
        const noise = noiseSource(11);
        const guess = beats.map((t, i) =>
            i === 0 ? t : t + 0.25 * period * noise(),
        );
        const fit = fitCountsToOnsets({
            env: busy,
            guess,
            startFixed: true,
            endFixed: false,
        });
        const errs = fit.map((t, i) => Math.abs(t - beats[i]));
        expect(
            errs.filter((e) => e < 0.015).length / errs.length,
        ).toBeGreaterThan(0.9);
    });

    it("returns the guess when it has a single count with nothing near", () => {
        const guess = [truth[42] + 0.1, truth[43] + 0.1];
        expect(
            fitCountsToOnsets({
                env,
                guess,
                startFixed: false,
                endFixed: false,
            }),
        ).toEqual(guess);
    });
});

describe("estimateBeatPeriod", () => {
    it("finds 0.5 s at 120 BPM", () => {
        const period = estimateBeatPeriod(env, song.times[0], song.times[24]);
        expect(period).not.toBeNull();
        expect(Math.abs(period! - 0.5)).toBeLessThan(0.005);
    });

    it("finds 2/3 s at 90 BPM", () => {
        const period = estimateBeatPeriod(env, song.times[48], song.times[60]);
        expect(Math.abs(period! - 2 / 3)).toBeLessThan(0.01);
    });

    it("is null in silence or for a short range", () => {
        expect(
            estimateBeatPeriod(env, song.times[40] + 0.2, song.times[48] - 0.2),
        ).toBeNull();
        expect(estimateBeatPeriod(env, 1, 2)).toBeNull();
    });
});

describe("performance", () => {
    it("computes a 6-minute stereo envelope and fits 400 counts quickly", () => {
        const seconds = 360;
        const beats = Array.from(
            { length: Math.floor((seconds - 1) / 0.5) },
            (_, k) => 0.5 + k * 0.5,
        );
        const long = synthesize(beats, seconds, { seed: 3 });
        const t0 = performance.now();
        const longEnv = onsetEnvelope(long, SAMPLE_RATE);
        const envelopeMs = performance.now() - t0;

        const guess = Array.from(
            { length: 401 },
            (_, k) => 0.5 + k * 0.5 + (k % 3) * 0.04,
        );
        guess[0] = 0.5;
        const t1 = performance.now();
        const fit = fitCountsToOnsets({
            env: longEnv,
            guess,
            startFixed: true,
            endFixed: false,
        });
        const fitMs = performance.now() - t1;
        console.info(
            `onsets perf: envelope ${envelopeMs.toFixed(0)} ms, fit 400 counts ${fitMs.toFixed(1)} ms`,
        );

        expect(fit.length).toBe(401);
        expect(Math.abs(fit[200] - beats[200])).toBeLessThan(0.015);
        expect(envelopeMs).toBeLessThan(3000);
        expect(fitMs).toBeLessThan(150);

        // Dense music (sixteenths everywhere) is the fit's worst case: the most candidates
        const sixteenths = Array.from(
            { length: 1600 },
            (_, k) => 0.5 + k * 0.125,
        );
        const dense = onsetEnvelope(
            synthesize(sixteenths, 202, { seed: 9 }),
            SAMPLE_RATE,
        );
        const t2 = performance.now();
        fitCountsToOnsets({
            env: dense,
            guess,
            startFixed: true,
            endFixed: false,
        });
        const denseMs = performance.now() - t2;
        console.info(
            `onsets perf: fit 400 counts over sixteenths ${denseMs.toFixed(1)} ms`,
        );
        expect(denseMs).toBeLessThan(300);
    });
});
