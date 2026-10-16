import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type Beat from "@/global/classes/Beat";
import type Page from "@/global/classes/Page";
import { Timeline, TimelineWaveformProvider } from "../Timeline";
import type { TimelineAppendCounts } from "../TimelineViewModel";

/**
 * The end of the show on the timeline: **+ N counts** after the last page's flag (E1), and the
 * END line where the counts go on past it (endless counts).
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
        counts: id === 1 ? 0 : beats.length,
        notes: null,
        order: id - 1,
        nextPageId: id < 3 ? id + 1 : null,
        previousPageId: id === 1 ? null : id - 1,
        isSubset: false,
        duration: beats.length * 0.5,
        beats,
        measures: null,
        measureBeatToStartOn: null,
        measureBeatToEndOn: null,
        timestamp: beats[0]!.timestamp,
    }) as unknown as Page;
// Page "2" ends at the last count: its flag is at view beat 16
const PAGES = [
    page(1, "0", [BEATS[0]!]),
    page(2, "1", BEATS.slice(1, 9)),
    page(3, "2", BEATS.slice(9, 17)),
];

const PX = 16;

const show = ({
    positionBeat = 5,
    isPlaying = false,
    appendCounts,
    onAddPageFlag,
    beats = BEATS,
    showEndBeat,
    onShowEndMove,
}: {
    positionBeat?: number;
    isPlaying?: boolean;
    appendCounts?: TimelineAppendCounts;
    onAddPageFlag?: () => void;
    beats?: Beat[];
    showEndBeat?: number;
    onShowEndMove?: (beat: number) => void;
}) =>
    render(
        <TimelineWaveformProvider
            waveform={{
                peaksByBeat: Array.from({ length: 16 }, () => [0.5, 0.5]),
            }}
        >
            <Timeline
                mode="expanded"
                beats={beats}
                pages={PAGES}
                measures={[]}
                timelines={[]}
                showTransport={false}
                pixelsPerBeat={PX}
                playback={{ positionBeat, isPlaying }}
                selection={null}
                onSelectionChange={vi.fn()}
                onAddPageFlag={onAddPageFlag}
                appendCounts={appendCounts}
                showEndBeat={showEndBeat}
                onShowEndMove={onShowEndMove}
            />
        </TimelineWaveformProvider>,
    );

const appendCounts = (onAppend = vi.fn()): TimelineAppendCounts => ({
    label: "16 counts",
    title: "Add a page of 16 counts after the last page",
    onAppend,
});

const pill = () => screen.queryByTestId("timeline-append-counts");

describe("+ N counts after the last page (E1)", () => {
    it("sits just after the last flag, says what it adds, and adds it", () => {
        const onAppend = vi.fn();
        show({ appendCounts: appendCounts(onAppend) });
        const button = screen.getByRole("button", {
            name: "Add a page of 16 counts after the last page",
        });
        expect(button.textContent).toContain("16 counts");
        expect(parseFloat(button.style.left)).toBe(16 * PX + 8);
        fireEvent.click(button);
        expect(onAppend).toHaveBeenCalledTimes(1);
    });

    it("offers pages to the end in its right-click menu, not as a pill (FB-7)", () => {
        const onPages = vi.fn();
        show({
            appendCounts: {
                ...appendCounts(),
                counts: 16,
                onCountsChange: vi.fn(),
                toEnd: {
                    label: "Create pages every 16 counts to the end",
                    title: "Add pages every 16 counts to the end of the music",
                    onAppend: onPages,
                },
            },
        });
        expect(screen.queryByTestId("timeline-pages-to-end")).toBeNull();
        fireEvent.contextMenu(pill()!, { clientX: 300, clientY: 200 });
        fireEvent.click(
            screen.getByRole("menuitem", {
                name: "Create pages every 16 counts to the end",
            }),
        );
        expect(onPages).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId("timeline-append-counts-menu")).toBeNull();
    });

    it("moves past + at the playhead instead of hiding under it", () => {
        show({
            appendCounts: appendCounts(),
            onAddPageFlag: vi.fn(),
            positionBeat: 16,
        });
        const plus = screen.getByTestId("timeline-add-page-flag");
        expect(parseFloat(pill()!.style.left)).toBeGreaterThanOrEqual(
            parseFloat(plus.style.left) + 16,
        );
    });

    it("doesn't show while playing, or without the command", () => {
        show({ appendCounts: appendCounts(), isPlaying: true });
        expect(pill()).toBeNull();
        cleanup();
        show({});
        expect(pill()).toBeNull();
    });
});

describe("changing how many counts + N counts adds", () => {
    it("right-click asks for the number, and sets the default", () => {
        const onCountsChange = vi.fn();
        show({
            appendCounts: { ...appendCounts(), counts: 16, onCountsChange },
        });
        fireEvent.contextMenu(pill()!, { clientX: 300, clientY: 200 });
        expect(screen.getByTestId("timeline-append-counts-menu")).toBeTruthy();
        expect(screen.queryAllByRole("menuitem")).toEqual([]);
        const field = screen.getByRole("textbox", {
            name: "Counts for new pages",
        }) as HTMLInputElement;
        expect(field.value).toBe("16");
        fireEvent.change(field, { target: { value: "0" } });
        expect(
            (screen.getByRole("button", { name: "Set" }) as HTMLButtonElement)
                .disabled,
        ).toBe(true);
        fireEvent.change(field, { target: { value: "20" } });
        fireEvent.submit(field.closest("form")!);
        expect(onCountsChange).toHaveBeenCalledWith(20);
        expect(screen.queryByTestId("timeline-append-counts-menu")).toBeNull();
    });

    it("without the command, a right-click opens no menu", () => {
        show({ appendCounts: appendCounts() });
        fireEvent.contextMenu(pill()!);
        expect(screen.queryByTestId("timeline-append-counts-menu")).toBeNull();
    });
});

describe("the END line (endless counts rule 4)", () => {
    it("draws a quiet line at the show's end, with the counts going on past it", () => {
        // 16 stored counts, and 24 more drawn past them (as the panel draws endless counts)
        show({ beats: appBeats(40), showEndBeat: 17 });
        const line = screen.getByTestId("timeline-show-end");
        expect(parseFloat(line.style.left)).toBe(16 * PX);
        expect(screen.getByText("END")).toBeTruthy();
        const surface = screen.getByTestId("timeline-pointer-surface");
        expect(parseFloat(surface.style.width)).toBe(40 * PX);
    });

    it("drags on whole counts, not before the last page's start, and commits on release", () => {
        const onShowEndMove = vi.fn();
        show({ beats: appBeats(40), showEndBeat: 17, onShowEndMove });
        const grip = screen.getByTestId("timeline-show-end-grip");
        grip.setPointerCapture = vi.fn();
        fireEvent.pointerDown(grip, { button: 0, pointerId: 1, clientX: 256 });
        fireEvent.pointerMove(grip, { pointerId: 1, clientX: 24.6 * PX });
        expect(
            parseFloat(screen.getByTestId("timeline-show-end").style.left),
        ).toBe(25 * PX);
        fireEvent.pointerUp(grip, { pointerId: 1, clientX: 24.6 * PX });
        // View beat 25 is spec beat 26
        expect(onShowEndMove).toHaveBeenCalledWith(26);
        // Back before page 2's start, it stops one count after it
        fireEvent.pointerDown(grip, { button: 0, pointerId: 2, clientX: 256 });
        fireEvent.pointerUp(grip, { pointerId: 2, clientX: 0 });
        expect(onShowEndMove).toHaveBeenLastCalledWith(10);
    });

    it("can't be dragged while playing, and isn't there without a show end", () => {
        show({
            beats: appBeats(40),
            showEndBeat: 17,
            onShowEndMove: vi.fn(),
            isPlaying: true,
        });
        expect(screen.queryByTestId("timeline-show-end-grip")).toBeNull();
        expect(screen.getByTestId("timeline-show-end")).toBeTruthy();
        cleanup();
        show({});
        expect(screen.queryByTestId("timeline-show-end")).toBeNull();
    });
});
