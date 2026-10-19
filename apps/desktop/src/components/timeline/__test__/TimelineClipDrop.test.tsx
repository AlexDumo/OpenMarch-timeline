import { Globals } from "@react-spring/web";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Beat from "@/global/classes/Beat";
import type Page from "@/global/classes/Page";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { Timeline, type TimelineInput } from "../Timeline";
import { TIMELINE_PAGE_ROW_TOP } from "../TimelineGeometry";

/**
 * A page's move that stops fitting its box drops out of the page row (UI-9 **+**, `useClipDrops`):
 * its clip is first drawn up in the page row, under the pinned header, and springs down into its
 * track row. A clip shown for any other reason draws in its row at once.
 */

afterEach(() => {
    cleanup();
    Globals.assign({ skipAnimation: false });
});
beforeEach(() => useTimelineSelectionStore.getState().reset());

/** The zero-length beat 0, then `count` timed beats */
const appBeats = (count: number): Beat[] =>
    Array.from({ length: count + 1 }, (_, index) => ({
        id: index + 1,
        position: index,
        duration: index === 0 ? 0 : 0.5,
        includeInMeasure: true,
        notes: null,
        index,
        timestamp: index === 0 ? 0 : (index - 1) * 0.5,
    }));

const BEATS = appBeats(16);

const page = (id: number, name: string, beats: Beat[]): Page =>
    ({
        id,
        name,
        counts: beats[0]!.index === 0 ? 0 : beats.length,
        notes: null,
        order: 0,
        nextPageId: null,
        previousPageId: beats[0]!.index === 0 ? null : 1,
        isSubset: false,
        duration: beats.length * 0.5,
        beats,
        measures: null,
        measureBeatToStartOn: null,
        measureBeatToEndOn: null,
        timestamp: beats[0]!.timestamp,
    }) as unknown as Page;

/** Home, page 1 on counts 1–8, page 2 on 9–16 */
const PAGES = [
    page(1, "0", [BEATS[0]!]),
    page(2, "1", BEATS.slice(1, 9)),
    page(3, "2", BEATS.slice(9, 17)),
];
/** **+** at count 5 of page 1: the new page 1 takes counts 1–4, the old page (now 2) keeps 5–8 */
const PAGES_SPLIT = [
    page(1, "0", [BEATS[0]!]),
    page(4, "1", BEATS.slice(1, 5)),
    page(2, "2", BEATS.slice(5, 9)),
    page(3, "3", BEATS.slice(9, 17)),
];

const clip = (id: string, start: number, end: number): TimelineInput => ({
    id,
    linkId: id,
    targetId: id,
    targetType: "timeline",
    label: id,
    color: "#2fc4b2",
    startBeatIndex: start,
    endBeatIndex: end,
    legs: [
        {
            id: `${id}-leg`,
            startBeatIndex: start,
            endBeatIndex: end,
            texture: "move",
        },
    ],
    activitySpans: [{ startBeatIndex: start, endBeatIndex: end, active: true }],
});

const show = (pages: Page[], timelines: TimelineInput[]) => (
    <Timeline
        mode="expanded"
        beats={BEATS}
        pages={pages}
        measures={[]}
        timelines={timelines}
        showTransport={false}
        playback={{ positionBeat: 5, isPlaying: false }}
        selection={null}
        onSelectionChange={vi.fn()}
    />
);

const clipTop = (el: HTMLElement) => parseFloat(el.style.top);
const theClip = (label: string) =>
    screen.getByRole("button", { name: new RegExp(`^${label}\\b`) });
/** The spring reaches the DOM on the next frame */
const nextFrame = () =>
    act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));

describe("a page's move drops out of its split box (UI-9)", () => {
    it("is first drawn up in the page row, then slides down into its row", async () => {
        // Page 1's own move: not a clip while its box stands for it
        const { rerender } = render(show(PAGES, []));
        expect(screen.queryByTestId("timeline-clip")).toBeNull();
        rerender(show(PAGES_SPLIT, [clip("Page 1's move", 1, 9)]));
        const dropped = theClip("Page 1's move");
        expect(dropped.dataset.dropping).toBe("true");
        expect(clipTop(dropped)).toBe(TIMELINE_PAGE_ROW_TOP);
        // Over the pinned header while it drops, so it is seen leaving the page box
        expect(screen.getByTestId("timeline-tracks").className).toContain(
            "z-[3]",
        );
        await nextFrame();
        expect(clipTop(dropped)).toBeGreaterThan(TIMELINE_PAGE_ROW_TOP);
    });

    it("lands in its row, like a clip that was always there", async () => {
        Globals.assign({ skipAnimation: true });
        const always = render(show(PAGES_SPLIT, [clip("Always", 1, 9)]));
        const restingTop = clipTop(theClip("Always"));
        expect(theClip("Always").dataset.dropping).toBeUndefined();
        expect(restingTop).toBeGreaterThan(TIMELINE_PAGE_ROW_TOP);
        always.unmount();

        const { rerender } = render(show(PAGES, []));
        rerender(show(PAGES_SPLIT, [clip("Page 1's move", 1, 9)]));
        await nextFrame();
        const dropped = theClip("Page 1's move");
        expect(clipTop(dropped)).toBe(restingTop);
        expect(dropped.dataset.dropping).toBeUndefined();
        expect(screen.getByTestId("timeline-tracks").className).toContain(
            "z-[1]",
        );
    });

    it("a move that was never a page's draws in its row at once", () => {
        const { rerender } = render(show(PAGES, []));
        rerender(show(PAGES, [clip("Window", 3, 7)]));
        const shown = theClip("Window");
        expect(shown.dataset.dropping).toBeUndefined();
        expect(clipTop(shown)).toBeGreaterThan(TIMELINE_PAGE_ROW_TOP);
    });

    it("keeps dropping over the header while the data settles", async () => {
        Globals.assign({ skipAnimation: false });
        const { rerender } = render(show(PAGES, []));
        rerender(show(PAGES_SPLIT, [clip("Page 1's move", 1, 9)]));
        // A query settling mid-drop: the same pages and moves, new arrays
        rerender(show([...PAGES_SPLIT], [clip("Page 1's move", 1, 9)]));
        expect(theClip("Page 1's move").dataset.dropping).toBe("true");
        expect(screen.getByTestId("timeline-tracks").className).toContain(
            "z-[3]",
        );
    });

    it("drops when the new pages arrive before the move", () => {
        const { rerender } = render(show(PAGES, []));
        rerender(show(PAGES_SPLIT, []));
        rerender(show(PAGES_SPLIT, [clip("Page 1's move", 1, 9)]));
        const dropped = theClip("Page 1's move");
        expect(dropped.dataset.dropping).toBe("true");
        expect(clipTop(dropped)).toBe(TIMELINE_PAGE_ROW_TOP);
    });

    it("deleting a flag but not its moves drops both moves", () => {
        // Pages 1 and 2 each stand for their move; deleting the flag between them merges the boxes
        const { rerender } = render(show(PAGES_SPLIT, []));
        rerender(show(PAGES, []));
        rerender(show(PAGES, [clip("First", 1, 5), clip("Second", 5, 9)]));
        for (const label of ["First", "Second"]) {
            expect(theClip(label).dataset.dropping).toBe("true");
            expect(clipTop(theClip(label))).toBe(TIMELINE_PAGE_ROW_TOP);
        }
    });
});
