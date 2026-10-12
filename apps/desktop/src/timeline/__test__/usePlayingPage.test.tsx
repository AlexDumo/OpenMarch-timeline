import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { describeDbTests, type DbConnection, schema } from "@/test/base";
import { transactionWithHistory } from "@/db-functions/history";
import { useIsPlaying } from "@/context/IsPlayingContext";
import { useTimingObjects } from "@/hooks";
import { useTimelineMode } from "@/hooks/queries/useWorkspaceSettings";
import { usePlayingPage } from "../usePlayingPage";

/**
 * The page the inspector shows while timeline playback runs. The audio clock is a settable fake,
 * as in useTimelinePlaybackDriver.test.tsx; animation frames are faked.
 */

const audio = vi.hoisted(() => ({
    seconds: 0,
    startInfo: { current: null as object | null },
}));
vi.mock("@/components/timeline/audio/AudioPlayer", () => ({
    getLivePlaybackPosition: () => audio.seconds,
    playbackStartInfoRef: audio.startInfo,
    restartLivePlaybackAt: (seconds: number) => {
        audio.seconds = seconds;
    },
}));

/**
 * Beats 1..16 of 0.5 s; after the blank file's page at beat 0, pages start on beats 1, 5, 9 and
 * 13, so the flags are 0, 5, 9, 13 and 17 (beat b starts at (b - 1) * 0.5 s).
 */
const seedShow = (db: DbConnection, timelineMode: boolean) =>
    transactionWithHistory(db, "seedShow", async (tx) => {
        await tx.delete(schema.workspace_settings);
        await tx.insert(schema.workspace_settings).values({
            id: 1,
            json_data: JSON.stringify({ timelineMode }),
        });
        await tx.insert(schema.beats).values(
            Array.from({ length: 16 }, (_, i) => ({
                id: i + 1,
                position: i + 1,
                duration: 0.5,
            })),
        );
        await tx.insert(schema.pages).values([
            { id: 1, start_beat: 1 },
            { id: 2, start_beat: 5 },
            { id: 3, start_beat: 9 },
            { id: 4, start_beat: 13 },
        ]);
    });

beforeEach(() => {
    audio.seconds = 0;
    audio.startInfo.current = null;
    vi.useFakeTimers({
        toFake: ["requestAnimationFrame", "cancelAnimationFrame"],
    });
});
afterEach(() => vi.useRealTimers());

const frame = () =>
    act(() => {
        vi.advanceTimersToNextFrame();
    });

describeDbTests("usePlayingPage", (it) => {
    const render = async (db: DbConnection, wrapper: never, on = true) => {
        await seedShow(db, on);
        const { result } = renderHook(
            () => ({
                playingPage: usePlayingPage(),
                timing: useTimingObjects()!,
                playing: useIsPlaying()!,
                timelineMode: useTimelineMode(),
            }),
            { wrapper },
        );
        await waitFor(() => expect(result.current.timing.pages.length).toBe(5));
        if (on)
            await waitFor(() => expect(result.current.timelineMode).toBe(true));
        return result;
    };

    it("follows the page box holding the live beat, and is null once stopped", async ({
        db,
        wrapper,
    }) => {
        const result = await render(db, wrapper as never);
        expect(result.current.playingPage).toBeNull();

        act(() => {
            result.current.playing.setIsPlaying(true);
        });
        // Before the audio starts there is no live beat
        frame();
        expect(result.current.playingPage).toBeNull();

        audio.startInfo.current = {};
        audio.seconds = 0.2; // beat 1.4, in page 1's box [1, 5)
        frame();
        expect(result.current.playingPage?.id).toBe(1);
        audio.seconds = 3.1; // beat 7.2, in [5, 9)
        frame();
        expect(result.current.playingPage?.id).toBe(2);
        audio.seconds = 6.9; // beat 14.8, in [13, 17)
        frame();
        expect(result.current.playingPage?.id).toBe(4);

        act(() => {
            result.current.playing.setIsPlaying(false);
        });
        expect(result.current.playingPage).toBeNull();
    });

    it("is null in page mode, where useAnimation selects pages as it plays", async ({
        db,
        wrapper,
    }) => {
        const result = await render(db, wrapper as never, false);
        act(() => {
            result.current.playing.setIsPlaying(true);
        });
        audio.startInfo.current = {};
        audio.seconds = 3.1;
        frame();
        expect(result.current.playingPage).toBeNull();
    });
});
