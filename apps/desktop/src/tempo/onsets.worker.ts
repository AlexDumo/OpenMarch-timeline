/**
 * Web Worker that computes the music's onset envelope (`onsets.ts`) off the main thread.
 * The main thread decodes the audio (decoding needs an audio context) and transfers the channels.
 */
import { onsetEnvelope } from "./onsets";

export interface OnsetsWorkerRequest {
    channels: Float32Array[];
    sampleRate: number;
}

export type OnsetsWorkerResponse =
    | {
          type: "envelope";
          rate: number;
          values: Float32Array;
          startSeconds: number;
      }
    | { type: "error"; message: string };

onmessage = (e: MessageEvent<OnsetsWorkerRequest>) => {
    try {
        const { channels, sampleRate } = e.data;
        // Audio time: frame 0 is the start of the file; the hook moves it into show time
        const envelope = onsetEnvelope(channels, sampleRate, 0);
        const response: OnsetsWorkerResponse = {
            type: "envelope",
            ...envelope,
        };
        postMessage(response, {
            transfer: [envelope.values.buffer as ArrayBuffer],
        });
    } catch (error) {
        const response: OnsetsWorkerResponse = {
            type: "error",
            message: error instanceof Error ? error.message : "Unknown error",
        };
        postMessage(response);
    }
};
