import { act, renderHook, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { describeDbTests, type DbConnection, schema } from "@/test/base";
import { transactionWithHistory } from "@/db-functions/history";
import { useIsPlaying } from "@/context/IsPlayingContext";
import { useSelectedPage } from "@/context/SelectedPageContext";
import { useTimingObjects } from "@/hooks";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import {
    canPlayOn,
    navigationTarget,
    pageAtPlayhead,
    pageFlags,
    playbackStep,
    previewBounds,
} from "@/timeline/timelinePlayhead";
import { playRange, toggleTimelineLoop } from "@/timeline/timelineTransport";
import { useTimelinePageBridge } from "@/timeline/useTimelinePageBridge";
import { useTimelinePlayback } from "../useTimelinePlayback";

/**
 * The timeline-mode playhead (ui.md UI-9; P8.11): pages are flags, the paused playhead rests on any
 * whole beat, seeking doesn't change the selection, navigation selects a page's range (home for
 * the first). Play plays from the start flag to the end flag, and loops there with looping on (UI-22).
 */

/** Pages as `fromDatabasePages` builds them: page 0 holds only the fixed beat 0. */
const pagesOf = (...beatLists: number[][]) =>
    beatLists.map((indexes, i) => ({
        id: i,
        beats: indexes.map((index) => ({ index })),
    }));
/** Page 0 is beat 0; page 1 is beats 1-8 (flag 9); page 2 is beats 9-16 (flag 17) */
const PAGES = pagesOf(
    [0],
    [1, 2, 3, 4, 5, 6, 7, 8],
    [9, 10, 11, 12, 13, 14, 15, 16],
);
const store = () => useTimelineSelectionStore.getState();

beforeEach(() => {
    store().reset();
    // reset keeps page boxes; whether a flag is pinned depends on them
    store().setPageBoxes([]);
});

describe("pages as flags", () => {
    it("puts each page's flag at its end, and home's at 0", () => {
        expect(
            pageFlags(PAGES).map(({ page, flag, range }) => ({
                id: page.id,
                flag,
                range,
            })),
        ).toEqual([
            { id: 0, flag: 0, range: null },
            { id: 1, flag: 9, range: { start: 1, end: 9 } },
            { id: 2, flag: 17, range: { start: 9, end: 17 } },
        ]);
        expect(pageFlags([])).toEqual([]);
    });

    it("finds the page containing or ending at the playhead", () => {
        expect(pageAtPlayhead(PAGES, 0)?.id).toBe(0);
        expect(pageAtPlayhead(PAGES, 1)?.id).toBe(1);
        expect(pageAtPlayhead(PAGES, 5)?.id).toBe(1);
        expect(pageAtPlayhead(PAGES, 9)?.id).toBe(1);
        expect(pageAtPlayhead(PAGES, 10)?.id).toBe(2);
        expect(pageAtPlayhead(PAGES, 17)?.id).toBe(2);
        // Past the last flag: the last page
        expect(pageAtPlayhead(PAGES, 30)?.id).toBe(2);
        expect(pageAtPlayhead([], 3)).toBeNull();
    });

    it("navigates by flags from the playhead", () => {
        const to = (
            beat: number,
            direction: Parameters<typeof navigationTarget>[2],
        ) => navigationTarget(PAGES, beat, direction)?.page.id ?? null;
        expect(to(0, "next-page")).toBe(1);
        expect(to(5, "next-page")).toBe(1);
        expect(to(9, "next-page")).toBe(2);
        expect(to(17, "next-page")).toBeNull();
        expect(to(17, "previous-page")).toBe(1);
        expect(to(12, "previous-page")).toBe(1);
        expect(to(9, "previous-page")).toBe(0);
        expect(to(0, "previous-page")).toBeNull();
        expect(to(12, "first-page")).toBe(0);
        expect(to(0, "last-page")).toBe(2);
        expect(navigationTarget([], 0, "first-page")).toBeNull();
    });
});

describe("play", () => {
    const range = { kind: "range", start: 1, end: 9 } as const;
    const home = { kind: "home" } as const;

    const on = { kind: "on" } as const;

    it("previews exactly the window, with no roll (UI-11 Play)", () => {
        const window = (start: number, end: number) => ({
            selection: { kind: "range", start, end } as const,
            isolation: null,
        });
        expect(previewBounds(window(5, 9))).toEqual({ from: 5, to: 9 });
        expect(previewBounds(window(1, 17))).toEqual({ from: 1, to: 17 });
        // Nothing to preview at home or with nothing selected: Play plays on
        expect(previewBounds({ selection: home, isolation: null })).toBeNull();
        expect(
            previewBounds({ selection: { kind: "none" }, isolation: null }),
        ).toBeNull();
        // An isolated timeline previews its whole range
        expect(
            previewBounds({
                selection: range,
                isolation: { start: 3, end: 9 },
            }),
        ).toEqual({ from: 3, to: 9 });
    });

    it("plays on while there is time after the start", () => {
        expect(canPlayOn(17, 17)).toBe(false);
        expect(canPlayOn(16, 17)).toBe(true);
    });

    it("a preview always loops back to its start at its end (UI-17)", () => {
        const preview = { kind: "preview", from: 3, to: 11 } as const;
        expect(playbackStep(preview, 10.5, 17, null)).toBeNull();
        expect(playbackStep(preview, 11, 17, null)).toEqual({ loopTo: 3 });
        expect(playbackStep(preview, 12, 17, null)).toEqual({ loopTo: 3 });
    });

    it("plays on to the end of the show and stops there", () => {
        expect(playbackStep(on, 9, 17, null)).toBeNull();
        expect(playbackStep(on, 17, 17, null)).toBe("stop");
    });

    it("playRange is the isolated range, else the start flag to the end flag (UI-22)", () => {
        store().selectRange(1, 9);
        expect(playRange(store())).toEqual({ from: 1, to: 9 });
        store().setEnd(6);
        expect(playRange(store())).toEqual({ from: 1, to: 6 });
        // Isolation wins
        store().setStoredTimelines([
            {
                id: 1,
                start: 3,
                end: 9,
                marcherIds: new Set([1]),
            },
        ]);
        store().isolate(1);
        expect(playRange(store())).toEqual({ from: 3, to: 9 });
    });

    it("loops over an isolated timeline (docs/timeline/research/ownership/09-isolation.md)", () => {
        const isolated = { start: 3, end: 9 };
        const preview = { kind: "preview", from: 3, to: 9 } as const;
        expect(playbackStep(on, 8.5, 17, isolated)).toBeNull();
        expect(playbackStep(on, 9, 17, isolated)).toEqual({ loopTo: 3 });
        expect(playbackStep(preview, 9, 17, isolated)).toEqual({ loopTo: 3 });
        expect(playbackStep(on, 9, 17, null)).toBeNull();
    });
});

/** Beats 1..16 of 0.5 s after the fixed beat 0; page 1 starts at beat 1 and page 2 at beat 9. */
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

/** The seeded show's page boxes, as `TimelineModePanel` gives them to the store */
const PAGE_BOXES = [
    { start: 1, end: 9 },
    { start: 9, end: 17 },
];

describeDbTests("useTimelinePlayback", (it) => {
    const renderPlayback = (
        wrapper: ComponentType<{ children: ReactNode }>,
        bridge = false,
    ) =>
        renderHook(
            () => {
                const { beats, pages } = useTimingObjects()!;
                useTimelinePageBridge(bridge);
                return {
                    pages,
                    beats,
                    playback: useTimelinePlayback({ beats, pages }),
                    selected: useSelectedPage()!,
                    playing: useIsPlaying()!,
                    selection: useTimelineSelectionStore((s) => s.selection),
                };
            },
            { wrapper },
        );

    it("shows the playhead, and seeking moves the playhead and the window's end", async ({
        db,
        wrapper,
    }) => {
        await seedShow(db);
        const { result } = renderPlayback(wrapper);
        await waitFor(() => expect(result.current.pages).toHaveLength(3));
        expect(result.current.playback.positionBeat).toBe(0);
        expect(result.current.selection).toEqual({ kind: "home" });

        act(() => {
            store().selectRange(1, 9);
        });
        expect(result.current.playback.positionBeat).toBe(9);
        act(() => {
            result.current.playback.onSeek!(5);
        });
        expect(result.current.playback.positionBeat).toBe(5);
        // UI-10: the window ends at the playhead
        expect(result.current.selection).toEqual({
            kind: "range",
            start: 1,
            end: 5,
        });
        // Any whole beat, the end of the show (the last flag) included
        act(() => {
            result.current.playback.onSeek!(17);
        });
        expect(result.current.playback.positionBeat).toBe(17);
    });

    it("navigates to flags, selecting each page's range or home, only while paused", async ({
        db,
        wrapper,
    }) => {
        await seedShow(db);
        const { result } = renderPlayback(wrapper);
        await waitFor(() => expect(result.current.pages).toHaveLength(3));
        // TimelineModePanel keeps these; without them every range reads as pinned
        act(() => {
            store().setPageBoxes(PAGE_BOXES);
        });

        act(() => {
            result.current.playback.onNavigate!("next-page");
        });
        expect(result.current.selection).toEqual({
            kind: "range",
            start: 1,
            end: 9,
        });
        expect(result.current.playback.positionBeat).toBe(9);
        act(() => {
            result.current.playback.onNavigate!("last-page");
        });
        expect(result.current.selection).toEqual({
            kind: "range",
            start: 9,
            end: 17,
        });
        expect(result.current.playback.positionBeat).toBe(17);
        act(() => {
            result.current.playback.onNavigate!("first-page");
        });
        expect(result.current.selection).toEqual({ kind: "home" });
        expect(result.current.playback.positionBeat).toBe(0);

        act(() => {
            result.current.playing.setIsPlaying(true);
        });
        act(() => {
            result.current.playback.onNavigate!("last-page");
        });
        act(() => {
            result.current.playback.onSeek!(4);
        });
        expect(result.current.selection).toEqual({ kind: "home" });
        expect(store().playheadBeat).toBe(0);
    });

    it("Shift+click on Previous and Next steps the playhead a beat, inside the show", async ({
        db,
        wrapper,
    }) => {
        await seedShow(db);
        const { result } = renderPlayback(wrapper);
        await waitFor(() => expect(result.current.pages).toHaveLength(3));
        act(() => {
            store().setPageBoxes(PAGE_BOXES);
        });
        act(() => {
            result.current.playback.onNavigate!("next-beat");
        });
        // Beats 0 and 1 are both the start of the show, so the first step goes to beat 2
        expect(result.current.playback.positionBeat).toBe(2);
        act(() => {
            result.current.playback.onNavigate!("next-page");
            result.current.playback.onNavigate!("next-beat");
        });
        expect(result.current.playback.positionBeat).toBe(10);
        act(() => {
            result.current.playback.onNavigate!("previous-beat");
        });
        expect(result.current.playback.positionBeat).toBe(9);
        // Not past either end of the show (the playback driver keeps its end)
        act(() => {
            store().setShowEndBeat(17);
        });
        act(() => {
            result.current.playback.onNavigate!("last-page");
            result.current.playback.onNavigate!("next-beat");
        });
        expect(result.current.playback.positionBeat).toBe(17);
        act(() => {
            result.current.playback.onNavigate!("first-page");
            result.current.playback.onNavigate!("previous-beat");
        });
        expect(result.current.playback.positionBeat).toBe(0);
    });

    it("C turns looping on and off, and E/Q put both flags on the page (UI-22)", async ({
        db,
        wrapper,
    }) => {
        await seedShow(db);
        const { result } = renderPlayback(wrapper);
        await waitFor(() => expect(result.current.pages).toHaveLength(3));
        act(() => {
            store().setPageBoxes(PAGE_BOXES);
        });
        act(() => {
            result.current.playback.onNavigate!("next-page");
        });
        expect(store().looping).toBe(false);
        act(() => {
            toggleTimelineLoop();
        });
        expect(store().looping).toBe(true);
        expect(store().startBeat).toBe(1);
        expect(store().endBeat).toBe(9);
        expect(result.current.playback.playLoops).toBe(true);
        // A pinned end flag goes back on the page's end with E
        act(() => {
            store().setEnd(12);
            result.current.playback.onNavigate!("next-page");
        });
        expect(store().startBeat).toBe(9);
        expect(store().endBeat).toBe(17);
        expect(store().endPinned).toBe(false);
        expect(store().looping).toBe(true);
        act(() => {
            toggleTimelineLoop();
        });
        expect(store().looping).toBe(false);
        expect(result.current.playback.playLoops).toBe(false);
    });

    it("a seek or a click takes an unpinned end flag along, and leaves a pinned one (UI-22)", async ({
        db,
        wrapper,
    }) => {
        await seedShow(db);
        const { result } = renderPlayback(wrapper);
        await waitFor(() => expect(result.current.pages).toHaveLength(3));
        act(() => {
            store().setPageBoxes(PAGE_BOXES);
            store().selectRange(1, 9);
        });
        act(() => {
            result.current.playback.onSeek!(5);
        });
        expect(store().endBeat).toBe(5);
        act(() => {
            result.current.playback.onSeek!(4, { gesture: "press" });
            result.current.playback.onSeek!(4, { gesture: "end" });
        });
        expect(store().endBeat).toBe(4);
        act(() => {
            store().setEnd(8);
            result.current.playback.onSeek!(12);
        });
        expect(store().playheadBeat).toBe(12);
        expect(store().endBeat).toBe(8);
        expect(store().endPinned).toBe(true);
    });

    it("leaves a hand-drawn start flag through a seek, and page navigation selects the page (UI-12)", async ({
        db,
        wrapper,
    }) => {
        await seedShow(db);
        const { result } = renderPlayback(wrapper);
        await waitFor(() => expect(result.current.pages).toHaveLength(3));
        act(() => {
            store().setPageBoxes(PAGE_BOXES);
            store().selectRange(12, 15);
        });
        expect(store().startPinned).toBe(true);
        act(() => {
            result.current.playback.onSeek!(16);
        });
        expect(store().startBeat).toBe(12);
        expect(store().startPinned).toBe(true);
        // E selects the target page. It does not keep the drawn flag or turn looping on
        act(() => {
            result.current.playback.onNavigate!("next-page");
        });
        expect(store().selection).toEqual({
            kind: "range",
            start: 9,
            end: 17,
        });
        expect(store().startPinned).toBe(false);
        expect(store().looping).toBe(false);
    });

    it("C in isolation does nothing; an isolated move always loops (UI-22)", async ({
        db,
        wrapper,
    }) => {
        await seedShow(db);
        const { result } = renderPlayback(wrapper);
        await waitFor(() => expect(result.current.pages).toHaveLength(3));
        act(() => {
            store().setPageBoxes(PAGE_BOXES);
            store().selectRange(9, 17);
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
        expect(store().looping).toBe(false);
        expect(result.current.playback.playLoops).toBe(true);
        act(() => {
            toggleTimelineLoop();
        });
        expect(store().looping).toBe(false);
        expect(store().isolation).not.toBeNull();
    });

    it("the Play button plays from the start flag, Pause pauses, and Stop goes to the end flag (UI-22)", async ({
        db,
        wrapper,
    }) => {
        await seedShow(db);
        const { result } = renderPlayback(wrapper);
        await waitFor(() => expect(result.current.pages).toHaveLength(3));
        act(() => {
            store().setPageBoxes(PAGE_BOXES);
            store().selectRange(1, 9);
        });
        expect(result.current.playback.playKeys).toEqual({
            stop: "Space",
            pause: "Shift + Space",
        });
        act(() => {
            result.current.playback.onPlayingChange!(true);
        });
        expect(result.current.playback.isPlaying).toBe(true);
        expect(store().playback).toEqual({
            kind: "preview",
            from: 1,
            to: 9,
            once: true,
        });
        expect(store().playheadBeat).toBe(9);
        // The start flag on beat 1, which cues as 0 (beat 0 has no length)
        expect(store().cursorBeat).toBe(0);
        expect(result.current.playback.positionBeat).toBeGreaterThanOrEqual(0);
        act(() => {
            result.current.playback.onPlayingChange!(false);
        });
        expect(result.current.playback.isPlaying).toBe(false);
        // The driver isn't mounted: Stop, paused, goes to the end flag itself
        act(() => {
            store().setPlayback(null);
            store().pauseAt(5, 1);
        });
        expect(store().playheadBeat).toBe(5);
        act(() => {
            result.current.playback.onStop!();
        });
        expect(store().playheadBeat).toBe(9);
    });

    it("keeps the legacy selected page on the playhead's page, and back (TEMPORARY, P8.12)", async ({
        db,
        wrapper,
    }) => {
        await seedShow(db);
        const { result } = renderPlayback(wrapper, true);
        await waitFor(() => expect(result.current.pages).toHaveLength(3));
        // The page boxes `TimelineModePanel` keeps in the app, so the start flag follows
        act(() => {
            store().setPageBoxes([
                { start: 1, end: 9 },
                { start: 9, end: 17 },
            ]);
        });

        act(() => {
            store().selectRange(9, 17);
        });
        await waitFor(() =>
            expect(result.current.selected.selectedPage?.id).toBe(2),
        );
        act(() => {
            store().seek(4);
        });
        await waitFor(() =>
            expect(result.current.selected.selectedPage?.id).toBe(1),
        );
        // Selecting a page elsewhere moves the playhead to its flag, not the selection
        act(() => {
            result.current.selected.setSelectedPage({ id: 2 });
        });
        await waitFor(() => expect(store().playheadBeat).toBe(17));
        expect(result.current.selection).toEqual({
            kind: "range",
            start: 9,
            end: 17,
        });
        act(() => {
            result.current.selected.setSelectedPage({ id: 0 });
        });
        await waitFor(() => expect(store().playheadBeat).toBe(0));
        expect(result.current.selected.selectedPage?.id).toBe(0);
    });

    it("waits for a scrub to end before following the playhead's page", async ({
        db,
        wrapper,
    }) => {
        await seedShow(db);
        const { result } = renderPlayback(wrapper, true);
        await waitFor(() => expect(result.current.pages).toHaveLength(3));
        act(() => {
            store().setPageBoxes([
                { start: 1, end: 9 },
                { start: 9, end: 17 },
            ]);
        });
        act(() => {
            store().selectRange(9, 17);
        });
        await waitFor(() =>
            expect(result.current.selected.selectedPage?.id).toBe(2),
        );

        // Scrub back across page 2's flag into page 1, then forward to page 2 and back again
        act(() => {
            store().beginScrub();
            store().seek(12);
        });
        act(() => {
            store().seek(4);
        });
        act(() => {
            store().seek(3);
        });
        expect(store().playheadBeat).toBe(3);
        expect(result.current.selected.selectedPage?.id).toBe(2);

        act(() => {
            store().endScrub();
        });
        await waitFor(() =>
            expect(result.current.selected.selectedPage?.id).toBe(1),
        );
        // The bridge's own write isn't read back as a page change
        expect(store().playheadBeat).toBe(3);
    });
});
