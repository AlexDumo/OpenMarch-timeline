import { useEffect, useMemo, useState } from "react";
import { useAudioOffsetSeconds } from "./audioOffset";
import { useQuery } from "@tanstack/react-query";
import AudioFile from "@/global/classes/AudioFile";
import { useSelectedAudioFile } from "@/context/SelectedAudioFileContext";
import { workspaceSettingsQueryOptions } from "@/hooks/queries/useWorkspaceSettings";
import OnsetsWorker from "./onsets.worker.ts?worker";
import type { OnsetsWorkerResponse } from "./onsets.worker";
import type { OnsetEnvelope } from "./onsets";

export type MusicOnsetsStatus = "idle" | "working" | "ready" | "none" | "error";

/**
 * The decode rate: the browser resamples while decoding, and `onsetEnvelope` analyzes at
 * ~22 kHz anyway, so decoding straight to it saves the worker the decimation and the memory
 */
const DECODE_SAMPLE_RATE = 22050;
/** Envelopes kept, by audio file */
const CACHE_LIMIT = 6;

/**
 * Each audio file's envelope in AUDIO time (frame 0 = the file's first sample, plus the flux's
 * peak lead), or null when there is no music (the silent placeholder). Shared by every hook user
 * and kept across enable/disable. A failed analysis is dropped so the next try runs again.
 */
const cache = new Map<string, Promise<OnsetEnvelope | null>>();

function audioEnvelopeFor(key: string): Promise<OnsetEnvelope | null> {
    const cached = cache.get(key);
    if (cached) return cached;
    const promise = analyzeSelectedAudio();
    cache.set(key, promise);
    promise.catch(() => cache.delete(key));
    while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
    return promise;
}

async function analyzeSelectedAudio(): Promise<OnsetEnvelope | null> {
    const audioFile = await AudioFile.getSelectedAudioFile();
    // No music: getSelectedAudioFile makes a silent placeholder with id -1
    if (!audioFile.data || audioFile.id === -1) return null;

    // Standard web APIs only (the web editor runs this too). An offline context decodes without
    // touching the audio hardware, as the video export does
    const decoder = new OfflineAudioContext(1, 1, DECODE_SAMPLE_RATE);
    const decoded = await decoder.decodeAudioData(audioFile.data.slice(0));
    const channels: Float32Array[] = [];
    for (let i = 0; i < decoded.numberOfChannels; i++)
        channels.push(decoded.getChannelData(i));

    return await new Promise<OnsetEnvelope>((resolve, reject) => {
        const worker = new OnsetsWorker();
        worker.onmessage = (e: MessageEvent<OnsetsWorkerResponse>) => {
            worker.terminate();
            if (e.data.type === "envelope") {
                const { rate, values, startSeconds } = e.data;
                resolve({ rate, values, startSeconds });
            } else reject(new Error(e.data.message));
        };
        worker.onerror = (error) => {
            worker.terminate();
            reject(
                error instanceof ErrorEvent ? new Error(error.message) : error,
            );
        };
        worker.postMessage(
            { channels, sampleRate: decoded.sampleRate },
            channels.map((c) => c.buffer as ArrayBuffer),
        );
    });
}

/**
 * The selected music's onset envelope in SHOW time, for lining counts up with the music.
 * Computed in a worker the first time it is enabled for an audio file, then cached.
 *
 * Audio time to show time: show time t plays audio time t - audioOffsetSeconds. The audio player
 * hands the decoded music to `workers/audioOffset.worker.ts` with the workspace's
 * `audioOffsetSeconds` (AudioPlayer.tsx:177, :429), which pads that much silence at the start
 * when positive and trims it when negative (audioOffset.worker.ts:52–80; offsets under 1 ms are
 * ignored, :198). The padding to `minimumDuration` (:430) is only at the end, so it moves nothing.
 * Playback then starts the offset buffer at sample `from * sampleRate` (timeStretch.worklet.ts:44)
 * with `from = countGrid.timeAtBeat(playheadBeat)` (AudioPlayer.tsx:210, :505): offset-buffer time
 * is show time. So the envelope's audio-time frames start at show time `audioOffsetSeconds`
 * (resampling while decoding, as the player's own decode at :345 also does, changes no times).
 *
 * Status: "idle" while disabled, "working" while decoding and analyzing, "ready" with an envelope,
 * "none" when the show has no music, "error" if decoding or analysis failed.
 */
export function useMusicOnsets(enabled: boolean): {
    envelope: OnsetEnvelope | null;
    status: MusicOnsetsStatus;
} {
    const selectedAudioFile = useSelectedAudioFile()?.selectedAudioFile ?? null;
    const { data: workspaceSettings } = useQuery(
        workspaceSettingsQueryOptions(),
    );
    // the offset in the show's history, else the workspace setting (audioOffset.ts)
    const rawOffset = useAudioOffsetSeconds();
    void workspaceSettings;
    // As audioOffset.worker.ts:198
    const offsetSeconds = Math.abs(rawOffset) >= 0.001 ? rawOffset : 0;
    const key = selectedAudioFile
        ? `${selectedAudioFile.id}:${selectedAudioFile.path}`
        : null;

    const [state, setState] = useState<{
        key: string | null;
        envelope: OnsetEnvelope | null;
        status: MusicOnsetsStatus;
    }>({ key: null, envelope: null, status: "idle" });

    useEffect(() => {
        if (!enabled) return;
        if (!key) {
            setState({ key, envelope: null, status: "none" });
            return;
        }
        let cancelled = false;
        setState((s) =>
            s.key === key && s.status === "ready"
                ? s
                : { key, envelope: null, status: "working" },
        );
        audioEnvelopeFor(key).then(
            (envelope) => {
                if (cancelled) return;
                setState({
                    key,
                    envelope,
                    status: envelope ? "ready" : "none",
                });
            },
            (error) => {
                if (cancelled) return;
                console.error("Music onset analysis failed", error);
                setState({ key, envelope: null, status: "error" });
            },
        );
        return () => {
            cancelled = true;
        };
    }, [enabled, key]);

    const audioEnvelope = enabled && state.key === key ? state.envelope : null;
    const envelope = useMemo<OnsetEnvelope | null>(
        () =>
            audioEnvelope && {
                ...audioEnvelope,
                startSeconds: audioEnvelope.startSeconds + offsetSeconds,
            },
        [audioEnvelope, offsetSeconds],
    );
    const status: MusicOnsetsStatus = !enabled
        ? "idle"
        : state.key === key
          ? state.status
          : "working";
    return { envelope, status };
}
