import { create } from "zustand";

/**
 * The selected audio's loudness over time, for the timeline's waveform lane (UI-12): the largest
 * absolute sample in each `1 / rate` seconds, across every channel, on the show's clock (the
 * audio player publishes it after applying the audio offset). `null` with no audio loaded.
 */
export interface AudioEnvelope {
    readonly peaks: Float32Array;
    /** Envelope values per second */
    readonly rate: number;
}

/** How many envelope values a second of audio gets: fine enough for 64px-a-beat zoom */
export const AUDIO_ENVELOPE_RATE = 200;

/** How many bars the waveform draws per beat */
export const WAVEFORM_PEAKS_PER_BEAT = 8;

export const useAudioEnvelopeStore = create<{
    readonly envelope: AudioEnvelope | null;
    readonly setEnvelope: (envelope: AudioEnvelope | null) => void;
}>((set) => ({
    envelope: null,
    setEnvelope: (envelope) => set({ envelope }),
}));

/** The envelope of decoded audio (an `AudioBuffer`, or anything shaped like one). */
export function audioEnvelope(
    buffer: {
        readonly numberOfChannels: number;
        readonly sampleRate: number;
        readonly length: number;
        getChannelData(channel: number): Float32Array;
    },
    rate = AUDIO_ENVELOPE_RATE,
): AudioEnvelope {
    const window = Math.max(1, Math.round(buffer.sampleRate / rate));
    const peaks = new Float32Array(Math.ceil(buffer.length / window));
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const data = buffer.getChannelData(channel);
        for (let i = 0; i < data.length; i++) {
            const magnitude = Math.abs(data[i]!);
            const slot = Math.floor(i / window);
            if (magnitude > peaks[slot]!) peaks[slot] = magnitude;
        }
    }
    return { peaks, rate: buffer.sampleRate / window };
}

/**
 * The waveform's peaks for each beat on the timeline's view axis (`offset` hidden beats first,
 * see `createTimelineBeatAxis`): `perBeat` values a beat, each the loudest moment in its slice of
 * the beat's time, scaled so the loudest moment of the show is 1. Beats past the audio get none.
 */
export function peaksByBeat(
    envelope: AudioEnvelope,
    beats: readonly { readonly timestamp: number; readonly duration: number }[],
    offset: number,
    perBeat = WAVEFORM_PEAKS_PER_BEAT,
): number[][] {
    let loudest = 0;
    for (const peak of envelope.peaks) if (peak > loudest) loudest = peak;
    const scale = loudest > 0 ? 1 / loudest : 0;
    const at = (seconds: number) =>
        Math.min(
            envelope.peaks.length,
            Math.max(0, Math.floor(seconds * envelope.rate)),
        );
    return beats.slice(offset).map((beat) => {
        if (at(beat.timestamp) >= envelope.peaks.length) return [];
        return Array.from({ length: perBeat }, (_, slice) => {
            const from = at(beat.timestamp + (beat.duration * slice) / perBeat);
            const to = Math.max(
                from + 1,
                at(beat.timestamp + (beat.duration * (slice + 1)) / perBeat),
            );
            let peak = 0;
            for (let i = from; i < to && i < envelope.peaks.length; i++)
                if (envelope.peaks[i]! > peak) peak = envelope.peaks[i]!;
            return peak * scale;
        });
    });
}
