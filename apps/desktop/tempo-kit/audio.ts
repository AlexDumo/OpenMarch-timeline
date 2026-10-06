import { createMetronomeWav, SAMPLE_RATE } from "@openmarch/metronome";
import type { TempoTruth } from "./truth";

/**
 * Renders a map's audio: the app's metronome click (`createMetronomeWav`) on every count with
 * louder downbeats, a louder "hit" at marked hits, and a quiet sustained tone that changes pitch at
 * each rehearsal mark and pulses with the counts, so the waveform isn't just clicks. Silent during
 * the lead-in and a caesura. Deterministic: the same truth gives the same samples.
 */

type MetronomeArgs = Parameters<typeof createMetronomeWav>;
type MetronomeMeasure = MetronomeArgs[0][number];
type MetronomeBeat = NonNullable<MetronomeArgs[1]>[number];

/** The truth's counts as the metronome package's measures and beats, at audio times. */
const metronomeInput = (truth: TempoTruth) => {
    const beats: MetronomeBeat[] = truth.counts.map((c, i) => ({
        position: c.index,
        duration: c.duration,
        includeInMeasure: true,
        index: i,
        timestamp: c.time,
    }));
    const measures: MetronomeMeasure[] = truth.measures.map((m) => {
        const mBeats = beats.slice(
            m.firstCount - 1,
            m.firstCount - 1 + m.counts,
        );
        return {
            startBeat: mBeats[0]!,
            number: m.number,
            duration: mBeats.reduce((s, b) => s + b.duration, 0),
            counts: m.counts,
            beats: mBeats,
            timestamp: mBeats[0]!.timestamp,
        };
    });
    return { beats, measures };
};

/** A small deterministic PRNG (mulberry32), so hits sound the same on every run. */
const prng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** A full-band "hit": a noise burst and a low thump, 0.6 s, peaking at 1. */
const hitSound = (): Float32Array => {
    const n = Math.floor(0.6 * SAMPLE_RATE);
    const out = new Float32Array(n);
    const rand = prng(7);
    for (let i = 0; i < n; i++) {
        const t = i / SAMPLE_RATE;
        const noise = (rand() * 2 - 1) * Math.exp(-t / 0.08);
        const thump = Math.sin(2 * Math.PI * 70 * t) * Math.exp(-t / 0.25);
        const chord =
            (Math.sin(2 * Math.PI * 220 * t) +
                Math.sin(2 * Math.PI * 277.18 * t) +
                Math.sin(2 * Math.PI * 329.63 * t)) *
            0.3 *
            Math.exp(-t / 0.3);
        out[i] = (noise * 0.6 + thump * 0.8 + chord) / 1.6;
    }
    return out;
};

/** Root frequencies of the sustained tone, one per rehearsal section in turn. */
const PAD_ROOTS = [130.81, 146.83, 164.81, 174.61, 196.0, 220.0, 246.94];

/** The sustained tone: a soft chord per section, pulsing a little on each count. */
const padLayer = (truth: TempoTruth, length: number): Float32Array => {
    const out = new Float32Array(length);
    let section = 0;
    let phase = [0, 0, 0];
    let gain = 0;
    const smooth = 1 - Math.exp(-1 / (0.015 * SAMPLE_RATE));
    for (const c of truth.counts) {
        if (c.mark) section++;
        const root = PAD_ROOTS[section % PAD_ROOTS.length]!;
        const frequencies = [root, root * 1.5, root * 2];
        const start = Math.floor(c.time * SAMPLE_RATE);
        const sounding = c.events?.includes("caesura")
            ? (c.plainDuration ?? c.duration)
            : c.duration;
        const soundEnd = Math.floor((c.time + sounding) * SAMPLE_RATE);
        const end = Math.floor((c.time + c.duration) * SAMPLE_RATE);
        for (let i = start; i < end && i < length; i++) {
            const target = i < soundEnd ? 1 : 0;
            gain += (target - gain) * smooth;
            const sinceCount = (i - start) / SAMPLE_RATE;
            const pulse = 0.65 + 0.35 * Math.exp(-sinceCount / 0.12);
            let v = 0;
            phase = phase.map((p, k) => {
                v += Math.sin(p) / (k + 1);
                return p + (2 * Math.PI * frequencies[k]!) / SAMPLE_RATE;
            });
            out[i] = v * gain * pulse;
        }
    }
    // Let the last chord ring out and fade over the tail
    const last = Math.floor(truth.end * SAMPLE_RATE);
    const root = PAD_ROOTS[section % PAD_ROOTS.length]!;
    for (let i = last; i < length; i++) {
        const t = (i - last) / SAMPLE_RATE;
        let v = 0;
        [root, root * 1.5, root * 2].forEach((f, k) => {
            v += Math.sin(phase[k]! + 2 * Math.PI * f * t) / (k + 1);
        });
        out[i] = v * gain * Math.exp(-t / 0.4);
    }
    return out;
};

/** Mono samples at `SAMPLE_RATE`, peaking at 0.95. */
export const renderAudio = (truth: TempoTruth): Float32Array => {
    const length = Math.ceil(truth.audioLength * SAMPLE_RATE);
    const out = new Float32Array(length);
    const { beats, measures } = metronomeInput(truth);
    const add = (src: Float32Array, gain: number, at = 0) => {
        for (let i = 0; i < src.length && at + i < length; i++)
            out[at + i]! += src[i]! * gain;
    };
    add(createMetronomeWav(measures, beats, true), 0.35);
    // Downbeats again, so they are louder than the other counts
    add(createMetronomeWav(measures, beats, true, true), 0.25);
    add(padLayer(truth, length), 0.12);
    const hit = hitSound();
    for (const c of truth.counts)
        if (c.events?.includes("hit"))
            add(hit, 0.9, Math.floor(c.time * SAMPLE_RATE));
    let peak = 0;
    for (const v of out) peak = Math.max(peak, Math.abs(v));
    if (peak > 0) for (let i = 0; i < length; i++) out[i]! *= 0.95 / peak;
    return out;
};

/** 16-bit PCM mono WAV bytes. */
export const encodeWav = (samples: Float32Array): Uint8Array => {
    const bytes = new Uint8Array(44 + samples.length * 2);
    const view = new DataView(bytes.buffer);
    const text = (at: number, s: string) =>
        [...s].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)));
    text(0, "RIFF");
    view.setUint32(4, 36 + samples.length * 2, true);
    text(8, "WAVE");
    text(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, SAMPLE_RATE, true);
    view.setUint32(28, SAMPLE_RATE * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    text(36, "data");
    view.setUint32(40, samples.length * 2, true);
    samples.forEach((v, i) => {
        const c = Math.max(-1, Math.min(1, v));
        view.setInt16(44 + i * 2, Math.round(c * 32767), true);
    });
    return bytes;
};
