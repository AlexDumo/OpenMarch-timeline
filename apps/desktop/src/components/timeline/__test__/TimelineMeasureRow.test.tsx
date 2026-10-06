import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExpandedTimeline } from "../TimelineVariants";
import type { TimelineMeasureRowCommands } from "../TimelineMeasureRow";
import type { TimelineViewModel } from "../TimelineViewModel";
import { timelineStoryModel } from "../TimelineStoryFixtures";

const toasts = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({
    toast: Object.assign(vi.fn(), toasts),
}));

/**
 * Tempo E8: rehearsal marks and measure lines on the measure row. The commands are the timeline's
 * callbacks, so the test only checks what the row sends; the writes are `measureLines` tests.
 */

afterEach(cleanup);

// jsdom has no PointerEvent, so fireEvent's pointer events would lose clientX
if (typeof window.PointerEvent === "undefined") {
    class TestPointerEvent extends MouseEvent {
        readonly pointerId: number;
        constructor(type: string, init: PointerEventInit = {}) {
            super(type, init);
            this.pointerId = init.pointerId ?? 1;
        }
    }
    window.PointerEvent = TestPointerEvent as unknown as typeof PointerEvent;
}

/** m1–m8 of 4 counts over 32; B at m3 */
const model: TimelineViewModel = {
    ...timelineStoryModel,
    tracks: [],
    measures: Array.from({ length: 8 }, (_, index) => ({
        id: index + 1,
        label: `M${index + 1}`,
        atBeat: index * 4,
        rehearsalMark: index === 2 ? "B" : null,
    })),
};

const commands = (): TimelineMeasureRowCommands => ({
    onSetMark: vi.fn(),
    onStartMeasure: vi.fn(),
    onRemoveLine: vi.fn(),
    onSetBeats: vi.fn(),
    onBeatsFrom: vi.fn(),
});

const renderRow = (
    props: Partial<Parameters<typeof ExpandedTimeline>[0]> = {},
) => {
    const measureRow = commands();
    const onSeek = vi.fn();
    render(
        <ExpandedTimeline
            model={model}
            positionBeat={21}
            isPlaying={false}
            pixelsPerBeat={16}
            showTransport={false}
            onSeek={onSeek}
            measureRow={measureRow}
            {...props}
        />,
    );
    return { measureRow, onSeek };
};

const input = () =>
    screen.getByTestId("timeline-measure-row-input") as HTMLInputElement;

/** Right-click on the measure row at view beat `beat` (jsdom lays the surface out at x = 0) */
const rightClickRow = (beat: number) =>
    fireEvent.contextMenu(screen.getByTestId("timeline-pointer-surface"), {
        clientX: beat * 16,
        clientY: 36,
    });

describe("rehearsal tabs", () => {
    it("seek on click and say how to edit them", () => {
        const { onSeek } = renderRow();
        const tab = screen.getByTestId("timeline-rehearsal-tab");
        expect(tab).toHaveAttribute(
            "title",
            "Rehearsal B, measure 3. Double-click to rename, R to add one.",
        );
        fireEvent.click(tab);
        expect(onSeek).toHaveBeenCalledWith(8);
    });

    it("a click seeks without leaving the tab where Backspace would remove it", () => {
        const { measureRow, onSeek } = renderRow();
        const tab = screen.getByTestId("timeline-rehearsal-tab");
        tab.focus();
        fireEvent.click(tab, { detail: 1 });
        expect(onSeek).toHaveBeenCalledWith(8);
        expect(document.activeElement).not.toBe(tab);
        // Focused from the keyboard, Delete still removes it
        tab.focus();
        fireEvent.keyDown(tab, { key: "Delete" });
        expect(measureRow.onSetMark).toHaveBeenCalledWith(3, null);
    });

    it("drags along the measure row to move the mark to another measure (Normal view)", () => {
        const onMoveMark = vi.fn();
        const { onSeek } = renderRow({
            measureRow: { ...commands(), onMoveMark },
        });
        const tab = screen.getByTestId("timeline-rehearsal-tab");
        expect(tab.getAttribute("title")).toMatch(/Drag along the measure row/);
        // B is m3 at view beat 8 (x = 128); drag it 4 counts later, onto m4
        fireEvent.pointerDown(tab, { button: 0, clientX: 128 });
        fireEvent.pointerMove(tab, { clientX: 190 });
        expect(
            screen.getByTestId("timeline-rehearsal-tab-ghost"),
        ).toHaveTextContent("B → m4");
        fireEvent.pointerUp(tab, { clientX: 190 });
        fireEvent.click(tab, { detail: 1 });
        expect(onMoveMark).toHaveBeenCalledWith(3, 4);
        // The drag's click doesn't seek
        expect(onSeek).not.toHaveBeenCalled();
    });

    it("won't drop a mark onto a measure that has one", () => {
        const onMoveMark = vi.fn();
        renderRow({
            model: {
                ...model,
                measures: model.measures.map((m) =>
                    m.id === 4 ? { ...m, rehearsalMark: "C" } : m,
                ),
            },
            measureRow: { ...commands(), onMoveMark },
        });
        const [b] = screen.getAllByTestId("timeline-rehearsal-tab");
        fireEvent.pointerDown(b!, { button: 0, clientX: 128 });
        fireEvent.pointerMove(b!, { clientX: 190 });
        expect(
            screen.getByTestId("timeline-rehearsal-tab-ghost"),
        ).toHaveAttribute("data-blocked", "true");
        fireEvent.pointerUp(b!, { clientX: 190 });
        expect(onMoveMark).not.toHaveBeenCalled();
    });

    it("double-click renames inline; Enter commits, Esc cancels", () => {
        const { measureRow } = renderRow();
        fireEvent.doubleClick(screen.getByTestId("timeline-rehearsal-tab"));
        expect(input().value).toBe("B");
        fireEvent.change(input(), { target: { value: "C" } });
        fireEvent.keyDown(input(), { key: "Enter" });
        expect(measureRow.onSetMark).toHaveBeenCalledWith(3, "C");

        fireEvent.doubleClick(screen.getByTestId("timeline-rehearsal-tab"));
        fireEvent.change(input(), { target: { value: "Z" } });
        fireEvent.keyDown(input(), { key: "Escape" });
        expect(measureRow.onSetMark).toHaveBeenCalledTimes(1);
        expect(
            screen.queryByTestId("timeline-measure-row-input"),
        ).not.toBeInTheDocument();
    });

    it("an empty name removes the mark", () => {
        const { measureRow } = renderRow();
        fireEvent.doubleClick(screen.getByTestId("timeline-rehearsal-tab"));
        fireEvent.change(input(), { target: { value: " " } });
        fireEvent.keyDown(input(), { key: "Enter" });
        expect(measureRow.onSetMark).toHaveBeenCalledWith(3, null);
    });

    it("Enter on a focused tab renames it and Delete removes it", () => {
        const { measureRow, onSeek } = renderRow();
        const tab = screen.getByTestId("timeline-rehearsal-tab");
        fireEvent.keyDown(tab, { key: "Delete" });
        expect(measureRow.onSetMark).toHaveBeenCalledWith(3, null);
        fireEvent.keyDown(tab, { key: "Enter" });
        expect(input().value).toBe("B");
        expect(onSeek).not.toHaveBeenCalled();
    });
});

describe("duplicate marks (FB-9)", () => {
    it("a name another measure has is refused, with the input kept open", () => {
        toasts.error.mockClear();
        const { measureRow } = renderRow();
        // R at m6 offers C; typing B (m3's mark) is refused
        fireEvent.keyDown(window, { key: "r" });
        fireEvent.change(input(), { target: { value: "b" } });
        fireEvent.keyDown(input(), { key: "Enter" });
        expect(measureRow.onSetMark).not.toHaveBeenCalled();
        expect(toasts.error).toHaveBeenCalledWith("There's already a B at m3");
        expect(input().value).toBe("b");
    });

    it("R while playing on a marked measure says so instead of a rename box", () => {
        toasts.info.mockClear();
        const { measureRow } = renderRow({
            positionBeat: 9,
            isPlaying: true,
        });
        fireEvent.keyDown(window, { key: "r" });
        expect(measureRow.onSetMark).not.toHaveBeenCalled();
        expect(
            screen.queryByTestId("timeline-measure-row-input"),
        ).not.toBeInTheDocument();
        expect(toasts.info).toHaveBeenCalledWith(
            expect.stringContaining("B is already at m3"),
        );
    });
});

describe("R", () => {
    it("paused: names the playhead's measure after the previous mark", () => {
        // The playhead at 21 is in m6 (20–23); the mark before it is B
        const { measureRow } = renderRow();
        fireEvent.keyDown(window, { key: "r" });
        expect(input().value).toBe("C");
        expect(measureRow.onSetMark).not.toHaveBeenCalled();
        fireEvent.keyDown(input(), { key: "Enter" });
        expect(measureRow.onSetMark).toHaveBeenCalledWith(6, "C");
    });

    it("on a marked measure renames it", () => {
        renderRow({ positionBeat: 9 });
        fireEvent.keyDown(window, { key: "R" });
        expect(input().value).toBe("B");
    });

    it("playing: marks the nearest downbeat at once, then takes a name", () => {
        const { measureRow } = renderRow({
            isPlaying: true,
            // A little before m6's downbeat at 20
            livePositionBeat: () => 19.4,
        });
        fireEvent.keyDown(window, { key: "r" });
        expect(measureRow.onSetMark).toHaveBeenCalledWith(6, "C");
        expect(input().value).toBe("C");
        fireEvent.change(input(), { target: { value: "Hit" } });
        fireEvent.keyDown(input(), { key: "Enter" });
        expect(measureRow.onSetMark).toHaveBeenLastCalledWith(6, "Hit");
    });

    it("playing: before anything is typed, R marks again and Space pauses", () => {
        const onPlayingChange = vi.fn();
        let live = 19.4;
        const { measureRow } = renderRow({
            isPlaying: true,
            livePositionBeat: () => live,
            onPlayingChange,
        });
        fireEvent.keyDown(window, { key: "r" });
        live = 27.8;
        fireEvent.keyDown(input(), { key: "r" });
        expect(measureRow.onSetMark).toHaveBeenLastCalledWith(8, "C");
        fireEvent.keyDown(input(), { key: " " });
        expect(onPlayingChange).toHaveBeenCalledWith(false);
        expect(
            screen.queryByTestId("timeline-measure-row-input"),
        ).not.toBeInTheDocument();
    });

    it("without measures, offers to start one at the count", () => {
        const { measureRow } = renderRow({
            model: { ...model, measures: [] },
        });
        fireEvent.keyDown(window, { key: "r" });
        expect(input().value).toBe("A");
        expect(
            screen.getByText(/A rehearsal mark sits on a measure line/),
        ).toBeInTheDocument();
        fireEvent.keyDown(input(), { key: "Enter" });
        expect(measureRow.onStartMeasure).toHaveBeenCalledWith(21, "A");
    });

    it("leaves the key alone while typing elsewhere or without commands", () => {
        renderRow({ measureRow: undefined });
        fireEvent.keyDown(window, { key: "r" });
        expect(
            screen.queryByTestId("timeline-measure-row-input"),
        ).not.toBeInTheDocument();
    });
});

describe("measure numbers", () => {
    it("click to name a measure", () => {
        const { measureRow } = renderRow();
        fireEvent.click(screen.getByRole("button", { name: /^Measure 5\./ }));
        expect(input().value).toBe("C");
        fireEvent.change(input(), { target: { value: "D" } });
        fireEvent.keyDown(input(), { key: "Enter" });
        expect(measureRow.onSetMark).toHaveBeenCalledWith(5, "D");
    });
});

describe("the measure row's menu", () => {
    it("starts a measure at a count", () => {
        const { measureRow } = renderRow();
        rightClickRow(6);
        expect(screen.getByText("Count 3 of measure 2")).toBeInTheDocument();
        expect(screen.getByText("m2 becomes 2 + 2 beats")).toBeInTheDocument();
        fireEvent.click(screen.getByTestId("measure-row-start"));
        expect(measureRow.onStartMeasure).toHaveBeenCalledWith(6);
    });

    it("removes a measure line at a downbeat, but never measure 1's", () => {
        const { measureRow } = renderRow();
        rightClickRow(0);
        expect(
            screen.queryByTestId("measure-row-remove-line"),
        ).not.toBeInTheDocument();
        fireEvent.keyDown(document.activeElement ?? document.body, {
            key: "Escape",
        });
        cleanup();
        const second = renderRow();
        rightClickRow(16);
        expect(
            screen.getByText("Remove measure line (join with m4)"),
        ).toBeInTheDocument();
        fireEvent.click(screen.getByTestId("measure-row-remove-line"));
        expect(second.measureRow.onRemoveLine).toHaveBeenCalledWith(5);
        expect(measureRow.onRemoveLine).not.toHaveBeenCalled();
    });

    it("sets a measure's beats, later measures keeping theirs by default", () => {
        const { measureRow } = renderRow();
        // Between ticks in m3
        rightClickRow(9.5);
        expect(
            screen.getByText("Measure 3 · 4 beats · rehearsal B"),
        ).toBeInTheDocument();
        expect(screen.getByTestId("measure-row-beats-4")).toHaveAttribute(
            "aria-current",
            "true",
        );
        fireEvent.click(screen.getByTestId("measure-row-beats-3"));
        expect(measureRow.onSetBeats).toHaveBeenCalledWith(3, 3, true);
    });

    it("unchecking makes the next measure absorb the difference", () => {
        const { measureRow } = renderRow();
        rightClickRow(9.5);
        fireEvent.click(screen.getByTestId("measure-row-later-keep"));
        expect(screen.getByText(/Only m4 changes/)).toBeInTheDocument();
        fireEvent.click(screen.getByTestId("measure-row-beats-5"));
        expect(measureRow.onSetBeats).toHaveBeenCalledWith(3, 5, false);
    });

    it("Other… asks for a number of beats", () => {
        const { measureRow } = renderRow();
        rightClickRow(9.5);
        fireEvent.click(screen.getByTestId("measure-row-beats-other"));
        fireEvent.change(input(), { target: { value: "9" } });
        fireEvent.keyDown(input(), { key: "Enter" });
        expect(measureRow.onSetBeats).toHaveBeenCalledWith(3, 9, true);
    });

    it("on a tab: rename, remove and go to", () => {
        const { measureRow, onSeek } = renderRow();
        fireEvent.contextMenu(screen.getByTestId("timeline-rehearsal-tab"));
        fireEvent.click(screen.getByTestId("measure-row-go-to"));
        expect(onSeek).toHaveBeenCalledWith(8);
        fireEvent.contextMenu(screen.getByTestId("timeline-rehearsal-tab"));
        fireEvent.click(screen.getByTestId("measure-row-remove-mark"));
        expect(measureRow.onSetMark).toHaveBeenCalledWith(3, null);
    });

    it("offers Remove mN's counts on a plain measure number, with a lowercase m (E10)", () => {
        const onRemoveCounts = vi.fn();
        renderRow({ addSelectedMarchers: { onRemoveCounts } });
        // m5's number, on its downbeat tick
        rightClickRow(16);
        const item = screen.getByTestId("timeline-range-menu-remove-counts");
        expect(item).toHaveTextContent("Remove m5’s counts…");
        // Nothing drawn: the menu says how to draw a cut
        expect(
            screen.getByTestId("timeline-range-menu-cut-hint"),
        ).toHaveTextContent("Ctrl+drag across measures to remove counts");
        fireEvent.click(item);
        expect(onRemoveCounts).toHaveBeenCalledWith(
            expect.objectContaining({
                range: { startBeatIndex: 16, endBeatIndex: 20 },
                measure: "m5",
            }),
        );
    });

    it("on empty space, offers Add counts at the playhead… and how to draw a cut", () => {
        const onAddCountsAtPlayhead = vi.fn();
        renderRow({
            addSelectedMarchers: {
                onRemoveCounts: vi.fn(),
                onAddCountsAtPlayhead,
                onAdd: vi.fn(),
            },
        });
        // Below the measure row, on the waveform
        fireEvent.contextMenu(screen.getByTestId("timeline-pointer-surface"), {
            clientX: 10 * 16,
            clientY: 70,
        });
        const menu = screen.getByTestId("timeline-range-menu");
        expect(menu).toHaveTextContent("Add counts at the playhead…");
        expect(menu).toHaveTextContent(
            "Ctrl+drag across measures to remove counts",
        );
        expect(menu).not.toHaveTextContent("Add selected marchers");
        expect(
            screen.queryByTestId("timeline-range-menu-remove-counts"),
        ).not.toBeInTheDocument();
    });

    it("on a tab, names the measure in lowercase too", () => {
        renderRow({ addSelectedMarchers: { onRemoveCounts: vi.fn() } });
        fireEvent.contextMenu(screen.getByTestId("timeline-rehearsal-tab"));
        expect(
            screen.getByTestId("timeline-range-menu-remove-counts"),
        ).toHaveTextContent("Remove m3’s counts…");
    });

    it("inside a drawn range, Remove counts… acts on the range wherever the right-click lands", () => {
        const onRemoveCounts = vi.fn();
        const range = { startBeatIndex: 8, endBeatIndex: 16 };
        renderRow({
            addSelectedMarchers: { onRemoveCounts },
            selection: { kind: "range", range },
        });
        // On the measure row, on m3's tab
        fireEvent.contextMenu(screen.getByTestId("timeline-rehearsal-tab"), {
            clientX: 8 * 16,
            clientY: 36,
        });
        const item = screen.getByTestId("timeline-range-menu-remove-counts");
        expect(item).toHaveTextContent("Remove counts…");
        expect(
            screen.queryByTestId("timeline-range-menu-cut-hint"),
        ).not.toBeInTheDocument();
        fireEvent.click(item);
        expect(onRemoveCounts).toHaveBeenCalledWith(
            expect.objectContaining({ cut: range }),
        );
    });

    it("doesn't open on the measure row without commands", () => {
        renderRow({ measureRow: undefined });
        rightClickRow(6);
        expect(
            screen.queryByTestId("timeline-range-menu"),
        ).not.toBeInTheDocument();
    });
});
