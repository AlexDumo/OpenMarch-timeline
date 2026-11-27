/**
 * The desktop recorder's picture (fork #1378): one video that shows whichever
 * OpenMarch window is in front. Main says when windows open, close, minimize
 * or take focus, and answers each screen request with the window named just
 * before it (`electron/main/reportRecording.ts`).
 *
 * Only the window shown is captured: capturing a window slows its drawing a
 * little (the 3D View most), so the others aren't touched. When another
 * window comes to the front its capture starts (about a tenth of a second)
 * and the video keeps the last picture until its first frame arrives.
 *
 * Windows differ in size and the MP4 encoder needs one size, so each frame is
 * scaled into a fixed canvas and written to a generated track. The canvas is
 * kept in memory (`willReadFrequently`): a GPU canvas stalls on every frame
 * while the 3D View is drawing. This runs on the captures' frames, not the
 * editor's drawing, so it keeps going while the editor is behind another window.
 */
import {
    chooseShownWindow,
    fitInside,
    videoSize,
    type RecordableWindows,
} from "./recordingWindows";

// Chromium's track processor and generator; not in TypeScript's DOM types yet
declare class MediaStreamTrackProcessor {
    constructor(init: { track: MediaStreamTrack; maxBufferSize?: number });
    readonly readable: ReadableStream<VideoFrame>;
}
declare class MediaStreamTrackGenerator extends MediaStreamTrack {
    constructor(init: { kind: "video" });
    readonly writable: WritableStream<VideoFrame>;
}

/** The track processor and generator, OffscreenCanvas and main's window list are all here. */
export function canRecordAllWindows(): boolean {
    return (
        typeof MediaStreamTrackProcessor !== "undefined" &&
        typeof MediaStreamTrackGenerator !== "undefined" &&
        typeof OffscreenCanvas !== "undefined" &&
        typeof VideoFrame !== "undefined" &&
        !!window.electron?.report?.recording
    );
}

interface Capture {
    readonly id: number;
    readonly track: MediaStreamTrack;
    readonly reader: ReadableStreamDefaultReader<VideoFrame>;
}

export interface WindowsRecording {
    /** The video track to record */
    readonly track: MediaStreamTrack;
    stop(): void;
}

/** Frames waiting for the encoder before new ones are dropped */
const MAX_PENDING_FRAMES = 2;

/**
 * Starts recording the OpenMarch window in front. Rejects when the first
 * window's capture is refused.
 */
// eslint-disable-next-line max-lines-per-function -- one recorder, start to stop
export async function recordAllWindows(
    displayOptions: DisplayMediaStreamOptions,
    /** Drawn while every OpenMarch window is minimized */
    minimizedLabel: string,
): Promise<WindowsRecording> {
    const api = window.electron.report.recording!;
    let snapshot: RecordableWindows = { windows: [], focusedId: null };
    let stopped = false;
    /** The window being shown, or being switched to */
    let wanted: number | null = null;
    let current: Capture | null = null;
    /** A switch is under way; it re-checks `wanted` when done */
    let switching = false;

    const size = videoSize({
        width: window.innerWidth * window.devicePixelRatio,
        height: window.innerHeight * window.devicePixelRatio,
    });
    const canvas = new OffscreenCanvas(size.width, size.height);
    const context = canvas.getContext("2d", {
        alpha: false,
        willReadFrequently: true,
    })!;
    const generator = new MediaStreamTrackGenerator({ kind: "video" });
    const writer = generator.writable.getWriter();
    let pending = 0;
    let timestamp = 0;

    /** Writes the canvas as the next frame, dropping it if the encoder is behind. */
    const emit = () => {
        if (stopped || pending >= MAX_PENDING_FRAMES) return;
        // Microseconds, at least a millisecond apart: the MP4 writer counts
        // milliseconds and refuses two frames in one
        timestamp = Math.max(
            timestamp + 1000,
            Math.round(performance.now() * 1000),
        );
        const frame = new VideoFrame(canvas, { timestamp });
        pending++;
        writer
            .write(frame)
            .catch(() => frame.close())
            .finally(() => pending--);
    };

    const draw = (frame: VideoFrame) => {
        const box = fitInside(
            { width: frame.displayWidth, height: frame.displayHeight },
            canvas,
        );
        context.fillStyle = "#000";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(frame, box.x, box.y, box.width, box.height);
        emit();
    };

    const drawMinimized = () => {
        context.fillStyle = "#0f0e13";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "#d0d0d0";
        context.font = `${Math.round(canvas.height / 30)}px sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(minimizedLabel, canvas.width / 2, canvas.height / 2);
        emit();
    };

    const end = (capture: Capture | null) => {
        if (!capture) return;
        capture.track.stop();
        void capture.reader.cancel().catch(() => undefined);
    };

    /** Captures one window; null when it closed meanwhile. Throws when refused. */
    const capture = async (id: number): Promise<Capture | null> => {
        if (!(await api.target(id))) return null;
        const stream =
            await navigator.mediaDevices.getDisplayMedia(displayOptions);
        const track = stream.getVideoTracks()[0];
        if (!track) return null;
        const processor = new MediaStreamTrackProcessor({
            track,
            maxBufferSize: 1,
        });
        return { id, track, reader: processor.readable.getReader() };
    };

    /** Draws a capture's frames from its first one on, which is when it takes over from the last. */
    const pump = async (next: Capture, onFirstFrame: () => void) => {
        let first = true;
        for (;;) {
            const { value: frame, done } = await next.reader
                .read()
                .catch(() => ({ value: undefined, done: true as const }));
            if (done || !frame) break;
            if (stopped || (!first && current !== next)) {
                frame.close();
                break;
            }
            if (first) {
                first = false;
                onFirstFrame();
            }
            draw(frame);
            frame.close();
        }
        // The window closed or was hidden under it: show another one
        if (current === next && !stopped) {
            current = null;
            end(next);
            update(snapshot, true);
        }
    };

    /** Shows `next` from its first frame on, and ends the capture it replaces. */
    const takeOver = (next: Capture) =>
        new Promise<void>((resolve) => {
            const previous = current;
            const swap = () => {
                if (current !== next) {
                    current = next;
                    end(previous);
                }
                resolve();
            };
            void pump(next, swap);
            // A window that draws nothing new sends no frame: don't wait forever
            setTimeout(swap, 1000);
        });

    /** Moves the video to `wanted`, one switch at a time. */
    const settle = async () => {
        if (switching) return;
        switching = true;
        try {
            while (!stopped && (current?.id ?? null) !== wanted) {
                const id = wanted;
                if (id === null) {
                    end(current);
                    current = null;
                    drawMinimized();
                    continue;
                }
                const next = await capture(id).catch(() => null);
                if (!next) {
                    // Gone or refused: show something else rather than freeze
                    if (wanted === id)
                        wanted = chooseShownWindow(
                            {
                                ...snapshot,
                                windows: snapshot.windows.filter(
                                    (w) => w.id !== id,
                                ),
                            },
                            current?.id ?? null,
                        );
                    continue;
                }
                if (stopped) {
                    end(next);
                    break;
                }
                await takeOver(next);
            }
        } finally {
            switching = false;
        }
    };

    function update(next: RecordableWindows, lostCurrent = false) {
        snapshot = next;
        wanted = chooseShownWindow(
            snapshot,
            lostCurrent ? null : (current?.id ?? wanted),
        );
        void settle();
    }

    const watch = api.watch((next) => update(next));
    const first = await watch.windows;
    if (!first) {
        watch.stop();
        throw new Error("Only the editor can record");
    }
    snapshot = first;
    wanted = chooseShownWindow(first, null);

    // The first capture is made here so a refusal fails the start, as before
    if (wanted !== null) {
        const opening = await capture(wanted).catch((error: unknown) => {
            watch.stop();
            throw error;
        });
        if (!opening) {
            watch.stop();
            throw new Error("The window to record closed");
        }
        current = opening;
        void pump(opening, () => undefined);
    } else drawMinimized();
    void settle();

    return {
        track: generator,
        stop() {
            if (stopped) return;
            stopped = true;
            watch.stop();
            end(current);
            current = null;
            void writer.close().catch(() => undefined);
            generator.stop();
        },
    };
}
