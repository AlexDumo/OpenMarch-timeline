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
import { pressTimelinePlayKey, seekTimeline } from "../timelineTransport";

/**
 * Timeline mode's playback rules while playing (ui.md UI-9, UI-10, UI-22; P8.11), frame by frame
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
    // reset keeps page boxes; a start flag is pinned only when it isn't the box holding P
    store().setPageBoxes([]);
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
    type Result = {
        current: {
            playing: {
                isPlaying: boolean;
                setIsPlaying: (p: boolean) => void;
            };
        };
    };
    /** A play key (UI-22): plays from the start flag; playing, Space stops and Shift+Space pauses */
    const playKey = (stop: "stop" | "pause") => (result: Result) => {
        act(() => {
            pressTimelinePlayKey(
                stop,
                result.current.playing.isPlaying,
                result.current.playing.setIsPlaying,
            );
        });
        audio.startInfo.current = {};
    };
    const space = playKey("stop");
    const shiftSpace = playKey("pause");
    const TWO_PAGES = [
        { start: 1, end: 9 },
        { start: 9, end: 17 },
    ];

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

    it("Space plays from the start flag to the end flag and stops there, on the end flag (UI-22)", async ({
        db,
        wrapper,
    }) => {
        const { result } = await setUp(db, wrapper);
        act(() => {
            store().setPageBoxes(TWO_PAGES);
            store().selectRange(9, 13);
        });
        expect(store().endBeat).toBe(13);
        space(result);
        expect(store().playback).toEqual({
            kind: "preview",
            from: 9,
            to: 13,
            once: true,
        });
        expect(store().cursorBeat).toBe(9);
        audio.seconds = 5.9; // beat 12.8
        frame();
        expect(result.current.playing.isPlaying).toBe(true);
        audio.seconds = 6; // beat 13, the end flag
        frame();
        expect(result.current.playing.isPlaying).toBe(false);
        expect(audio.restarts).toEqual([]);
        expect(store().playheadBeat).toBe(13);
        expect(store().cursorBeat).toBeNull();
        expect(store().selection).toEqual({ kind: "range", start: 9, end: 13 });
        expect(store().playback).toBeNull();
    });

    it("Shift+Space pauses on the nearest beat and leaves the flags; Play starts again from the start flag (UI-22)", async ({
        db,
        wrapper,
    }) => {
        const { result } = await setUp(db, wrapper);
        act(() => {
            store().setPageBoxes(TWO_PAGES);
            store().selectRange(9, 17);
        });
        shiftSpace(result);
        expect(store().cursorBeat).toBe(9);
        audio.seconds = 5.7; // beat 12.4: the nearest beat is 12
        frame();
        shiftSpace(result);
        expect(result.current.playing.isPlaying).toBe(false);
        expect(store().playheadBeat).toBe(12);
        expect(store().startBeat).toBe(9);
        expect(store().endBeat).toBe(17);
        expect(store().selection).toEqual({ kind: "range", start: 9, end: 12 });
        // Play again: from the start flag, not from where it paused
        shiftSpace(result);
        expect(store().cursorBeat).toBe(9);
        expect(store().playback).toMatchObject({ from: 9, to: 17 });
        audio.seconds = 6.3; // beat 13.6: the nearest beat is 14
        frame();
        shiftSpace(result);
        expect(store().playheadBeat).toBe(14);
        // Stop, paused: to the end flag
        space(result);
        audio.seconds = 4.6;
        frame();
        space(result);
        expect(store().playheadBeat).toBe(17);
        expect(store().cursorBeat).toBeNull();
    });

    it("Space while playing stops on the end flag wherever it is, and a pause in the first beat stays on the move (UI-22)", async ({
        db,
        wrapper,
    }) => {
        const { result } = await setUp(db, wrapper);
        act(() => {
            store().setPageBoxes(TWO_PAGES);
            store().selectRange(9, 17);
        });
        space(result);
        audio.seconds = 4.6; // beat 10.2
        frame();
        space(result);
        expect(store().playheadBeat).toBe(17);
        expect(store().startBeat).toBe(9);
        expect(store().cursorBeat).toBeNull();
        // Paused on the start flag (page 1's end flag), it stays a beat in, on this page's move
        shiftSpace(result);
        audio.seconds = 4.05; // beat 9.1
        frame();
        shiftSpace(result);
        expect(store().playheadBeat).toBe(10);
        expect(store().selection).toEqual({ kind: "range", start: 9, end: 10 });
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

    it("playing on stopped from outside the transport lands on the last beat played, and the flags come to it (UI-22)", async ({
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
        audio.seconds = 6.1; // beat 13.2
        play(result);
        frame();
        act(() => {
            result.current.playing.setIsPlaying(false);
        });
        expect(store().playheadBeat).toBe(13);
        expect(store().startBeat).toBe(9);
        expect(store().endBeat).toBe(17);
        expect(store().selection).toEqual({ kind: "range", start: 9, end: 13 });
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

    it("with looping on, Play loops between the flags wherever the playhead is in them, and never moves it while playing (UI-22)", async ({
        db,
        wrapper,
    }) => {
        const { result } = await setUp(db, wrapper);
        act(() => {
            store().selectRange(9, 13);
            store().setLooping(true);
        });
        space(result);
        expect(store().playback).toEqual({
            kind: "preview",
            from: 9,
            to: 13,
            once: false,
        });
        expect(store().cursorBeat).toBe(9);
        audio.seconds = 5.9; // beat 12.8, still inside
        frame();
        expect(result.current.playing.isPlaying).toBe(true);
        expect(audio.restarts).toEqual([]);
        audio.seconds = 6; // beat 13, the end flag: it repeats
        frame();
        expect(result.current.playing.isPlaying).toBe(true);
        expect(audio.restarts).toEqual([4]); // beat 9
        expect(store().cursorBeat).toBe(9);
        expect(store().playheadBeat).toBe(13);
        // Looping turned off while playing: it stops at the end flag next time
        act(() => {
            store().setLooping(false);
        });
        audio.seconds = 6;
        frame();
        expect(result.current.playing.isPlaying).toBe(false);
        expect(store().playheadBeat).toBe(13);

        // The end flag dragged on and the playhead moved back inside the flags: Play still goes
        // to the start flag and plays to the end flag
        act(() => {
            store().setLooping(true);
            store().beginLineDrag("end");
            store().dragLine(15);
            store().endLineDrag();
            store().seek(11);
        });
        expect(store().endBeat).toBe(15);
        space(result);
        expect(store().playback).toMatchObject({ from: 9, to: 15 });
        expect(store().cursorBeat).toBe(9);
        expect(store().playheadBeat).toBe(11);
        audio.seconds = 5;
        frame();
        space(result);
        expect(store().playheadBeat).toBe(15);
    });

    it("stopping a loop goes to the end flag (UI-22)", async ({
        db,
        wrapper,
    }) => {
        const { result } = await setUp(db, wrapper);
        act(() => {
            store().selectRange(9, 13);
            store().setLooping(true);
        });
        space(result);
        audio.seconds = 5.6; // beat 12.2
        frame();
        space(result);
        expect(result.current.playing.isPlaying).toBe(false);
        expect(store().cursorBeat).toBeNull();
        expect(store().playheadBeat).toBe(13);
        expect(store().startBeat).toBe(9);
        expect(store().playback).toBeNull();
        expect(store().looping).toBe(true);
        expect(store().selection).toEqual({ kind: "range", start: 9, end: 13 });
    });

    it("Space in isolation loops the isolated range with looping on, and never moves P (UI-22)", async ({
        db,
        wrapper,
    }) => {
        const { result } = await setUp(db, wrapper);
        act(() => {
            store().setLooping(true);
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
        expect(store().playheadBeat).toBe(17);
        space(result);
        expect(store().playback).toEqual({
            kind: "preview",
            from: 9,
            to: 17,
            once: false,
        });
        expect(store().cursorBeat).toBe(9);
        audio.seconds = 8; // beat 17, the end of the isolated range
        frame();
        expect(result.current.playing.isPlaying).toBe(true);
        expect(audio.restarts).toEqual([4]); // beat 9
        expect(store().cursorBeat).toBe(9);
        expect(store().playheadBeat).toBe(17);
        expect(store().playback).toEqual({
            kind: "preview",
            from: 9,
            to: 17,
            once: false,
        });
    });

    it("a pause before the audio starts goes back to the end flag (UI-22)", async ({
        db,
        wrapper,
    }) => {
        const { result } = await setUp(db, wrapper);
        act(() => {
            store().setPageBoxes(TWO_PAGES);
            store().selectRange(9, 13);
        });
        shiftSpace(result);
        expect(store().cursorBeat).toBe(9);
        // No frame: the audio never started, so there is no beat to pause on
        shiftSpace(result);
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
                store().setLooping(true);
            });
            space(result);
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
            // Released inside the flags: the same run keeps looping (UI-22)
            expect(store().playback).toEqual({
                kind: "preview",
                from: 9,
                to: 13,
                once: false,
            });
            expect(store().cursorBeat).toBe(10);
            expect(store().playheadBeat).toBe(13);
            expect(audio.restarts).toEqual([]);

            // Stopping it goes to the end flag, where P is
            audio.seconds = 5.1; // beat 11.2
            frame();
            act(() => {
                result.current.playing.setIsPlaying(false);
            });
            expect(store().playheadBeat).toBe(13);
            expect(store().cursorBeat).toBeNull();
            expect(store().startBeat).toBe(9);
        });

        it("a click inside the flags keeps the loop, and outside plays on (UI-22)", async ({
            db,
            wrapper,
        }) => {
            const { result } = await setUp(db, wrapper);
            act(() => {
                store().selectRange(9, 13);
                store().setLooping(true);
            });
            space(result);
            audio.seconds = 4.6;
            frame();
            const { playChanges, send } = scrubber(result);

            send(11, "press");
            send(11, "end");
            expect(playChanges).toEqual([]);
            expect(result.current.playing.isPlaying).toBe(true);
            expect(audio.restarts).toEqual([5]); // beat 11
            expect(store().playback).toEqual({
                kind: "preview",
                from: 9,
                to: 13,
                once: false,
            });
            expect(store().playheadBeat).toBe(13);
            expect(store().cursorBeat).toBe(11);

            send(14, "press");
            send(14, "end");
            expect(playChanges).toEqual([]);
            expect(result.current.playing.isPlaying).toBe(true);
            expect(audio.restarts).toEqual([5, 6.5]); // beat 14
            // Outside the flags the run plays on
            expect(store().playback).toEqual({ kind: "on" });
            expect(store().playheadBeat).toBe(13);
            expect(store().cursorBeat).toBe(14);
        });

        it("a jump during an isolated preview keeps the isolated run (UI-22)", async ({
            db,
            wrapper,
        }) => {
            const { result } = await setUp(db, wrapper);
            act(() => {
                store().setLooping(true);
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
            space(result);
            expect(store().playback).toEqual({
                kind: "preview",
                from: 9,
                to: 17,
                once: false,
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
                once: false,
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
                store().setLooping(true);
            });
            space(result);
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
