/**
 * `window.view3dPlaybackTest`: records, frame by frame, where the 3D View
 * draws its performers and where their 2D dots are at the same show time, so
 * scripted checks can measure how closely the 3D View follows the 2D field
 * during playback (fork #1377). Nothing is recorded until `start()`.
 */
import { wallNowMs } from "@/view3d/sync/protocol";

export interface PlaybackProbeFrame {
    /** Wall time of the frame (`wallNowMs`), comparable with the editor's. */
    wall: number;
    /** The show time the window drew, ms. */
    ms: number;
    /** The window's count clock at `ms`. */
    count: number;
    /** Whether the clock was playing. */
    playing: boolean;
    /** Per recorded marcher: the body's x, z (world m) as drawn. */
    body: number[];
    /** Per recorded marcher: the drill dot's x, z (world m) at `ms`. */
    dot: number[];
    /** CPU time the performers took this frame, ms. */
    cpuMs: number;
}

export interface PlaybackProbeApi {
    /** Starts recording these marchers (all when left out), clearing earlier frames. */
    start: (marcherIds?: number[]) => void;
    /** Stops recording and returns the marcher ids and the frames. */
    stop: () => { ids: number[]; frames: PlaybackProbeFrame[] };
}

declare global {
    // eslint-disable-next-line no-unused-vars
    interface Window {
        /** 3D View playback recording; see `playbackProbe.ts`. */
        view3dPlaybackTest?: PlaybackProbeApi;
    }
}

interface ProbeState {
    recording: boolean;
    wanted: number[] | null;
    ids: number[];
    frames: PlaybackProbeFrame[];
}

const state: ProbeState = {
    recording: false,
    wanted: null,
    ids: [],
    frames: [],
};

/** Whether a frame should be recorded: false unless a script started it. */
export function probeRecording(): boolean {
    return state.recording;
}

/**
 * Records one frame. `slotIds` are the slots' marcher ids; `body` and `dot`
 * are x, z per slot.
 */
export function probeFrame(
    slotIds: readonly number[],
    ms: number,
    count: number,
    playing: boolean,
    body: ArrayLike<number>,
    dot: ArrayLike<number>,
    cpuMs: number,
): void {
    if (!state.recording) return;
    if (state.ids.length === 0)
        state.ids = state.wanted
            ? state.wanted.filter((id) => slotIds.includes(id))
            : [...slotIds];
    const b: number[] = [];
    const d: number[] = [];
    for (const id of state.ids) {
        const i = slotIds.indexOf(id);
        b.push(body[i * 2], body[i * 2 + 1]);
        d.push(dot[i * 2], dot[i * 2 + 1]);
    }
    state.frames.push({
        wall: wallNowMs(),
        ms,
        count,
        playing,
        body: b,
        dot: d,
        cpuMs,
    });
}

/** Installs `window.view3dPlaybackTest`; returns a function that removes it. */
export function installPlaybackProbe(): () => void {
    window.view3dPlaybackTest = {
        start: (marcherIds) => {
            state.recording = true;
            state.wanted = marcherIds ?? null;
            state.ids = [];
            state.frames = [];
        },
        stop: () => {
            state.recording = false;
            const out = { ids: state.ids, frames: state.frames };
            state.frames = [];
            return out;
        },
    };
    return () => {
        delete window.view3dPlaybackTest;
    };
}
