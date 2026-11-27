/**
 * `window.view3dEditorPlaybackTest`: records the editor's live playback time
 * (what the 2D field draws at) every display frame, with the wall time, so a
 * script can line it up with the 3D View's `view3dPlaybackTest` frames and
 * measure how far the two views are apart (fork #1377).
 */
import { getLivePlaybackPosition } from "@/components/timeline/audio/AudioPlayer";
import { wallNowMs } from "./protocol";

export interface EditorProbeFrame {
    wall: number;
    /** The live playback time, ms (0 while stopped). */
    ms: number;
}

declare global {
    // eslint-disable-next-line no-unused-vars
    interface Window {
        view3dEditorPlaybackTest?: {
            start: () => void;
            stop: () => EditorProbeFrame[];
        };
    }
}

/** Installs `window.view3dEditorPlaybackTest`; returns a function that removes it. */
export function installEditorPlaybackProbe(): () => void {
    let frames: EditorProbeFrame[] = [];
    let raf = 0;
    const tick = () => {
        frames.push({
            wall: wallNowMs(),
            ms: getLivePlaybackPosition() * 1000,
        });
        raf = requestAnimationFrame(tick);
    };
    window.view3dEditorPlaybackTest = {
        start: () => {
            cancelAnimationFrame(raf);
            frames = [];
            raf = requestAnimationFrame(tick);
        },
        stop: () => {
            cancelAnimationFrame(raf);
            const out = frames;
            frames = [];
            return out;
        },
    };
    return () => {
        cancelAnimationFrame(raf);
        delete window.view3dEditorPlaybackTest;
    };
}
