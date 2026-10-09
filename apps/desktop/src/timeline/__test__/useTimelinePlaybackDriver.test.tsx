import { act, renderHook, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, vi } from "vitest";
import { describeDbTests, type DbConnection, schema } from "@/test/base";
import { transactionWithHistory } from "@/db-functions/history";
import { useIsPlaying } from "@/context/IsPlayingContext";
import { useTimingObjects } from "@/hooks";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { useTimelinePlaybackDriver } from "../useTimelinePlaybackDriver";
import type { TimelineSeekGesture } from "@/components/timeline/TimelineViewModel";
import {
    playTimelineFromFlag,
    playTimelineFromHere,
    seekTimeline,
} from "../timelineTransport";

/**
 * Timeline mode's playback rules while playing (ui.md UI-9, UI-10, UI-17; P8.11), frame by frame
 * with fake animation frames. The audio clock is replaced by a settable one: `restartLivePlaybackAt`
 * moves it, as the real one moves the live position, and the audio player never restarts, so a loop
 * that waited for it would stall.
 */

const audio = vi.hoisted(() => ({
    seconds: 0,
    restarts: [] as number[],
    startInfo: { current: null as object | null },
}));
vi.mock("@/components/timeline/audio/AudioPlayer", () => ({
    getLivePlaybackPosition: () => audio.seconds,
    playbackStartInfoRef: audio.startInfo,
    restartLivePlaybackAt: (seconds: number) => {
        audio.restarts.push(seconds);
        audio.seconds = seconds;
    },
}));

const store = () => useTimelineSelectionStore.getState();

beforeEach(() => {
    store().reset();
    audio.seconds = 0;
    audio.restarts = [];
    audio.startInfo.current = null;
    vi.useFakeTimers({
        toFake: ["requestAnimationFrame", "cancelAnimationFrame"],
    });
});
afterEach(() => {
    vi.useRealTimers();
});

/** Beats 1..16 of 0.5 s after the fixed beat 0: beat b starts at (b - 1) / 2 s; the end is 17. */
const seedShow = (db: DbConnection) =>
    transactionWithHistory(db, "seedShow", async (tx) => {
        await tx.insert(schema.beats).values(
            Array.from({ length: 16 }, (_, i) => ({
                id: i + 1,
                position: i + 1,
                duration: 0.5,
            })),
        );
        await tx.insert(schema.pages).values([
            { id: 1, start_beat: 1 },
            { id: 2, start_beat: 9 },
        ]);
    });

const frame = () =>
    act(() => {
        vi.advanceTimersToNextFrame();
    });

describeDbTests("useTimelinePlaybackDriver", (it) => {
    const setUp = async (
        db: DbConnection,
        wrapper: ComponentType<{ children: ReactNode }>,
    ) => {
        await seedShow(db);
        const hook = renderHook(
            () => {
                useTimelinePlaybackDriver(true);
                return {
                    beats: useTimingObjects()!.beats,
                    playing: useIsPlaying()!,
                };
            },
            { wrapper },
        );
        await waitFor(() => expect(hook.result.current.beats).toHaveLength(17));
        await waitFor(() => expect(store().showEndBeat).toBe(17));
        return hook;
    };
    const play = (result: {
        current: { playing: { setIsPlaying: (p: boolean) => void } };
    }) => {
        audio.startInfo.current = {};
        act(() => {
            result.current.playing.setIsPlaying(true);
        });
    };
    /** Space: play on from the playhead, or stop (UI-17). */
    const fromHere = (result: {
        current: {
            beats: { readonly length: number };
            playing: {
                isPlaying: boolean;
                setIsPlaying: (p: boolean) => void;
            };
        };
    }) =>
        act(() => {
            playTimelineFromHere({
                isPlaying: result.current.playing.isPlaying,
                showEndBeat: result.current.beats.length,
                setIsPlaying: result.current.playing.setIsPlaying,
            });
        });
    /** Shift+Space: preview from the start flag, or stop a preview (UI-17). */
    const fromFlag = (result: {
        current: {
            beats: Parameters<typeof playTimelineFromFlag>[0];
            playing: {
                isPlaying: boolean;
                setIsPlaying: (p: boolean) => void;
            };
        };
    }) => {
        act(() => {
            playTimelineFromFlag(result.current.beats, {
                isPlaying: result.current.playing.isPlaying,
                setIsPlaying: result.current.playing.setIsPlaying,
            });
        });
        audio.startInfo.current = {};
    };

    it("plays through the window's end without looping (UI-10 Play)", async ({
        db,
        wrapper,
    }) => {
        const { result } = await setUp(db, wrapper);
        act(() => {
            store().selectRange(1, 9);
        });
        audio.seconds = 3.9; // beat 8.8
        play(result);
        frame();
        audio.seconds = 4.2; // past beat 9, the window's end
        frame();
        expect(audio.restarts).toEqual([]);
        expect(result.current.playing.isPlaying).toBe(true);
    });

    it("pausing leaves the start flag: the window runs from it to the paused playhead", async ({
        db,
        wrapper,
    }) => {
        const { result } = await setUp(db, wrapper);
        act(() => {
            store().selectRange(9, 13);
        });
        audio.seconds = 6.1; // beat 13.2
        play(result);
        frame();
        act(() => {
            result.current.playing.setIsPlaying(false);
        });
        expect(store().playheadBeat).toBe(13);
        expect(store().startBeat).toBe(9);
        expect(store().selection).toEqual({ kind: "range", start: 9, end: 13 });
    });

    it("Space stops play-on in place, moving P to the last whole beat (UI-17)", async ({
        db,
        wrapper,
    }) => {
        const { result } = await setUp(db, wrapper);
        act(() => {
            store().selectRange(1, 9);
        });
        audio.seconds = 6.1; // beat 13.2
        fromHere(result);
        audio.startInfo.current = {};
        frame();
        expect(store().playback).toEqual({ kind: "on" });
        expect(store().playheadBeat).toBe(9);
        fromHere(result);
        expect(result.current.playing.isPlaying).toBe(false);
        expect(store().playheadBeat).toBe(13);
        expect(store().cursorBeat).toBeNull();
        expect(store().startBeat).toBe(1);
        expect(store().playback).toBeNull();
    });

    it("plays on and stops at the end of the show, leaving the playhead there", async ({
        db,
        wrapper,
    }) => {
        const { result } = await setUp(db, wrapper);
        audio.seconds = 7.9;
        play(result);
        frame();
        expect(result.current.playing.isPlaying).toBe(true);
        audio.seconds = 8; // the end of beat 16
        frame();
        expect(result.current.playing.isPlaying).toBe(false);
        expect(store().playheadBeat).toBe(17);
        // The start flag stayed at beat 0
        expect(store().selection).toEqual({ kind: "range", start: 0, end: 17 });
    });

    it("pausing leaves the playhead on the last whole beat played", async ({
        db,
        wrapper,
    }) => {
        const { result } = await setUp(db, wrapper);
        act(() => {
            store().selectRange(1, 9);
        });
        audio.seconds = 2.3; // beat 5.6
        play(result);
        frame();
        act(() => {
            result.current.playing.setIsPlaying(false);
        });
        expect(store().playheadBeat).toBe(5);
        expect(store().selection).toEqual({ kind: "range", start: 1, end: 5 });
    });

    it("pausing a play-on run moves an unpinned start flag with the playhead; a pinned one stays (UI-12 review)", async ({
        db,
        wrapper,
    }) => {
        const { result } = await setUp(db, wrapper);
        act(() => {
            store().setPageBoxes([
                { start: 1, end: 9 },
                { start: 9, end: 17 },
            ]);
            store().selectRange(1, 9);
        });
        expect(store().startPinned).toBe(false);
        audio.seconds = 6.1; // beat 13.2
        play(result);
        frame();
        act(() => {
            result.current.playing.setIsPlaying(false);
        });
        expect(store().playheadBeat).toBe(13);
        expect(store().startBeat).toBe(9);
        expect(store().selection).toEqual({ kind: "range", start: 9, end: 13 });

        act(() => {
            store().selectRange(5, 9);
        });
        expect(store().startPinned).toBe(true);
        play(result);
        frame();
        act(() => {
            result.current.playing.setIsPlaying(false);
        });
        expect(store().playheadBeat).toBe(13);
        expect(store().startBeat).toBe(5);
    });

    it("does nothing before the audio has started", async ({ db, wrapper }) => {
        const { result } = await setUp(db, wrapper);
        act(() => {
            store().selectRange(1, 9);
        });
        audio.seconds = 5; // past the range, but there is no live position yet
        act(() => {
            result.current.playing.setIsPlaying(true);
        });
        frame();
        expect(audio.restarts).toEqual([]);
        act(() => {
            result.current.playing.setIsPlaying(false);
        });
        // A pause before any frame leaves the playhead alone
        expect(store().playheadBeat).toBe(9);
    });

    it("clamps seeks to the end of the show and ignores non-finite ones", async ({
        db,
        wrapper,
    }) => {
        await setUp(db, wrapper);
        act(() => {
            store().seek(40);
        });
        expect(store().playheadBeat).toBe(17);
        act(() => {
            store().seek(Number.NaN);
        });
        expect(store().playheadBeat).toBe(17);
    });

    it("Shift+Space previews from the start flag to P, and reaching the end returns the cursor to P (UI-17)", async ({
        db,
        wrapper,
    }) => {
        const { result } = await setUp(db, wrapper);
        act(() => {
            store().selectRange(9, 13);
        });
        fromFlag(result);
        // From the start flag; the playhead stays on the window's end
        expect(store().playback).toEqual({ kind: "preview", from: 9, to: 13 });
        expect(store().cursorBeat).toBe(9);
        expect(store().playheadBeat).toBe(13);
        audio.seconds = 5.9; // beat 12.8
        frame();
        expect(result.current.playing.isPlaying).toBe(true);
        audio.seconds = 6; // beat 13, the playhead: the preview ends there
        frame();
        expect(result.current.playing.isPlaying).toBe(false);
        expect(store().cursorBeat).toBeNull();
        expect(store().playback).toBeNull();
        expect(store().playheadBeat).toBe(13);
        expect(store().selection).toEqual({ kind: "range", start: 9, end: 13 });
        expect(audio.restarts).toEqual([]);
    });

    it("loops the preview while the loop is on, never moving the playhead (UI-17)", async ({
        db,
        wrapper,
    }) => {
        const { result } = await setUp(db, wrapper);
        act(() => {
            store().selectRange(9, 13);
            store().toggleLoopPreview(true);
        });
        fromFlag(result);
        audio.seconds = 6; // beat 13, the playhead
        frame();
        expect(result.current.playing.isPlaying).toBe(true);
        expect(audio.restarts).toEqual([4]); // beat 9
        expect(store().cursorBeat).toBe(9);
        expect(store().playheadBeat).toBe(13);
        expect(store().startBeat).toBe(9);
        expect(store().playback).toEqual({ kind: "preview", from: 9, to: 13 });
    });

    it("Space or Shift+Space stops a preview back on P, leaving P (UI-17)", async ({
        db,
        wrapper,
    }) => {
        const { result } = await setUp(db, wrapper);
        act(() => {
            store().selectRange(9, 13);
        });
        fromFlag(result);
        audio.seconds = 5.6; // beat 12.2
        frame();
        fromHere(result);
        expect(result.current.playing.isPlaying).toBe(false);
        expect(store().cursorBeat).toBeNull();
        expect(store().playheadBeat).toBe(13);
        expect(store().startBeat).toBe(9);
        expect(store().playback).toBeNull();

        fromFlag(result);
        audio.seconds = 5.6;
        frame();
        fromFlag(result);
        expect(result.current.playing.isPlaying).toBe(false);
        expect(store().cursorBeat).toBeNull();
        expect(store().playheadBeat).toBe(13);
        expect(store().selection).toEqual({ kind: "range", start: 9, end: 13 });
    });

    it("Shift+Space while playing on restarts from the flag as a preview (UI-17)", async ({
        db,
        wrapper,
    }) => {
        const { result } = await setUp(db, wrapper);
        act(() => {
            store().selectRange(9, 13);
        });
        audio.seconds = 6.1; // beat 13.2, already at P
        fromHere(result);
        audio.startInfo.current = {};
        frame();
        expect(store().playback).toEqual({ kind: "on" });
        expect(result.current.playing.isPlaying).toBe(true);
        fromFlag(result);
        expect(result.current.playing.isPlaying).toBe(true);
        expect(store().playback).toEqual({ kind: "preview", from: 9, to: 13 });
        expect(store().cursorBeat).toBe(9);
        expect(store().playheadBeat).toBe(13);
        expect(audio.restarts).toEqual([4]); // beat 9, the flag
    });

    it("Shift+Space with no window previews the show from 0 (UI-17)", async ({
        db,
        wrapper,
    }) => {
        const { result } = await setUp(db, wrapper);
        expect(store().selection).toEqual({ kind: "home" });
        fromFlag(result);
        expect(result.current.playing.isPlaying).toBe(true);
        expect(store().playback).toEqual({ kind: "preview", from: 0, to: 17 });
        expect(store().cursorBeat).toBe(0);
        expect(store().playheadBeat).toBe(0);
    });

    it("a pause before the audio starts clears the cursor and leaves P (UI-17)", async ({
        db,
        wrapper,
    }) => {
        const { result } = await setUp(db, wrapper);
        act(() => {
            store().selectRange(9, 13);
        });
        fromHere(result);
        expect(store().playback).toEqual({ kind: "on" });
        expect(store().cursorBeat).toBe(13);
        act(() => {
            result.current.playing.setIsPlaying(false);
        });
        expect(store().cursorBeat).toBeNull();
        expect(store().playheadBeat).toBe(13);
        expect(store().playback).toBeNull();
    });

    describe("scrubbing while playing (UI-12 review)", () => {
        /** Sends seeks as the timeline does, recording each play/pause they cause */
        const scrubber = (result: {
            current: {
                beats: readonly { timestamp: number; duration: number }[];
                playing: {
                    isPlaying: boolean;
                    setIsPlaying: (p: boolean) => void;
                };
            };
        }) => {
            const playChanges: boolean[] = [];
            const setIsPlaying = (playing: boolean) => {
                playChanges.push(playing);
                result.current.playing.setIsPlaying(playing);
            };
            // Returns where the seek says it landed (`seekTimeline`)
            const send = (beat: number, gesture?: TimelineSeekGesture) => {
                let landed: number | null = null;
                act(() => {
                    landed = seekTimeline(result.current.beats, beat, gesture, {
                        isPlaying: result.current.playing.isPlaying,
                        setIsPlaying,
                    });
                });
                return landed;
            };
            return { playChanges, send };
        };

        it("suspends playback for a drag, follows it, and resumes once from the release", async ({
            db,
            wrapper,
        }) => {
            const { result } = await setUp(db, wrapper);
            act(() => {
                store().selectRange(9, 13);
            });
            fromFlag(result);
            audio.seconds = 4.6; // beat 10.2
            frame();
            const { playChanges, send } = scrubber(result);

            // Over playback a press only marks where a click would jump: nothing has landed
            expect(send(11, "press")).toBeNull();
            expect(send(11.3, "drag")).toBeNull();
            // Still on the pressed beat: nothing has moved yet
            expect(playChanges).toEqual([]);
            expect(result.current.playing.isPlaying).toBe(true);

            // Suspended, the frame the scrub shows is where it landed
            expect(send(12, "drag")).toBe(12);
            expect(playChanges).toEqual([false]);
            // The suspension writes neither the playhead nor the frame the scrub shows
            expect(store().playheadBeat).toBe(13);
            expect(store().cursorBeat).toBe(12);
            expect(store().playback).toBeNull();
            const revision = store().playheadRevision;
            expect(send(12.4, "drag")).toBe(12);
            expect(store().playheadRevision).toBe(revision);
            send(11, "drag");
            expect(store().cursorBeat).toBe(11);

            send(10, "end");
            expect(playChanges).toEqual([false, true]);
            expect(result.current.playing.isPlaying).toBe(true);
            // A scrubbed preview plays on from the release, even inside the window (UI-17)
            expect(store().playback).toEqual({ kind: "on" });
            expect(store().cursorBeat).toBe(10);
            expect(store().playheadBeat).toBe(13);
            expect(audio.restarts).toEqual([]);

            // The next ordinary pause is a play-on stop: P moves, the cursor clears
            audio.seconds = 5.1; // beat 11.2
            frame();
            act(() => {
                result.current.playing.setIsPlaying(false);
            });
            expect(store().playheadBeat).toBe(11);
            expect(store().cursorBeat).toBeNull();
            expect(store().startBeat).toBe(9);
        });

        it("a click during a preview plays on, inside the window too (UI-17)", async ({
            db,
            wrapper,
        }) => {
            const { result } = await setUp(db, wrapper);
            act(() => {
                store().selectRange(9, 13);
            });
            fromFlag(result);
            audio.seconds = 4.6;
            frame();
            const { playChanges, send } = scrubber(result);

            send(11, "press");
            send(11, "end");
            expect(playChanges).toEqual([]);
            expect(result.current.playing.isPlaying).toBe(true);
            expect(audio.restarts).toEqual([5]); // beat 11
            expect(store().playback).toEqual({ kind: "on" });
            expect(store().playheadBeat).toBe(13);
            expect(store().cursorBeat).toBe(11);
        });

        it("a jump during an isolated preview keeps the isolated run (UI-17)", async ({
            db,
            wrapper,
        }) => {
            const { result } = await setUp(db, wrapper);
            act(() => {
                store().setStoredTimelines([
                    {
                        id: 1,
                        start: 9,
                        end: 17,
                        marcherIds: new Set([1]),
                    },
                ]);
                store().isolate(1);
            });
            fromFlag(result);
            expect(store().playback).toEqual({
                kind: "preview",
                from: 9,
                to: 17,
            });
            const { playChanges, send } = scrubber(result);
            send(12, "press");
            send(12, "end");
            expect(playChanges).toEqual([]);
            expect(result.current.playing.isPlaying).toBe(true);
            expect(store().playback).toEqual({
                kind: "preview",
                from: 9,
                to: 17,
            });
            expect(store().playheadBeat).toBe(17);
            expect(audio.restarts).toEqual([5.5]); // beat 12
        });

        it("a drag released outside the preview's window plays on from there", async ({
            db,
            wrapper,
        }) => {
            const { result } = await setUp(db, wrapper);
            act(() => {
                store().selectRange(9, 13);
            });
            fromFlag(result);
            audio.seconds = 4.6;
            frame();
            const { playChanges, send } = scrubber(result);

            send(14, "drag");
            send(16, "end");
            expect(playChanges).toEqual([false, true]);
            expect(store().playback).toEqual({ kind: "on" });
            expect(store().cursorBeat).toBe(16);
        });
    });
});
