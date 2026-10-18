import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type Beat from "@/global/classes/Beat";
import type Page from "@/global/classes/Page";
import type Measure from "@/global/classes/Measure";
import { Timeline, TimelineWaveformProvider } from "../Timeline";
import type { TimelineAppendCounts } from "../TimelineViewModel";

/**
 * The end of the show on the timeline: **+ N counts** after the last page's flag, and its
 * right-click menu (endless counts).
 */

afterEach(cleanup);

// jsdom has no PointerEvent, so fireEvent's pointer events would lose clientX
if (typeof window.PointerEvent === "undefined") {
    class TestPointerEvent extends MouseEvent {
        readonly pointerId: number;
        readonly pointerType: string;
        constructor(type: string, init: PointerEventInit = {}) {
            super(type, init);
            this.pointerId = init.pointerId ?? 1;
            this.pointerType = init.pointerType ?? "mouse";
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
    measures = [],
}: {
    positionBeat?: number;
    isPlaying?: boolean;
    appendCounts?: TimelineAppendCounts;
    onAddPageFlag?: () => void;
    beats?: Beat[];
    measures?: Measure[];
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
                measures={measures}
                timelines={[]}
                showTransport={false}
                pixelsPerBeat={PX}
                playback={{ positionBeat, isPlaying }}
                selection={null}
                onSelectionChange={vi.fn()}
                onAddPageFlag={onAddPageFlag}
                appendCounts={appendCounts}
            />
        </TimelineWaveformProvider>,
    );

const appendCounts = (onAppend = vi.fn()): TimelineAppendCounts => ({
    label: "16 counts",
    title: "Add a page of 16 counts after the last page",
    onAppend,
});

const pill = () => screen.queryByTestId("timeline-append-counts");

describe("+ N counts after the last page", () => {
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

    it("offers pages to the end in its right-click menu, not as a pill (EC-10)", () => {
        const onPages = vi.fn();
        show({
            appendCounts: {
                ...appendCounts(),
                counts: 16,
                onCountsChange: vi.fn(),
                toEnd: {
                    label: (n) => `Create pages every ${n} counts to the end`,
                    title: (n) =>
                        `Add pages every ${n} counts to the end of the music`,
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
        expect(screen.queryByRole("button", { name: "Set" })).toBeNull();
        // Not a whole number: leaving the box keeps 16, and closes the menu
        fireEvent.change(field, { target: { value: "0" } });
        fireEvent.blur(field);
        expect(onCountsChange).not.toHaveBeenCalled();
        expect(screen.queryByTestId("timeline-append-counts-menu")).toBeNull();
        // Enter saves and closes
        fireEvent.contextMenu(pill()!, { clientX: 300, clientY: 200 });
        const again = screen.getByRole("textbox", {
            name: "Counts for new pages",
        });
        fireEvent.change(again, { target: { value: "20" } });
        fireEvent.submit(again.closest("form")!);
        expect(onCountsChange).toHaveBeenCalledWith(20);
        expect(onCountsChange).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId("timeline-append-counts-menu")).toBeNull();
    });

    it("saves when the box loses focus to outside the menu, and Escape cancels", () => {
        const onCountsChange = vi.fn();
        show({
            appendCounts: { ...appendCounts(), counts: 16, onCountsChange },
        });
        fireEvent.contextMenu(pill()!, { clientX: 300, clientY: 200 });
        let field = screen.getByRole("textbox", {
            name: "Counts for new pages",
        });
        fireEvent.change(field, { target: { value: "12" } });
        fireEvent.blur(field);
        expect(onCountsChange).toHaveBeenCalledWith(12);
        cleanup();
        onCountsChange.mockClear();
        show({
            appendCounts: { ...appendCounts(), counts: 16, onCountsChange },
        });
        fireEvent.contextMenu(pill()!, { clientX: 300, clientY: 200 });
        field = screen.getByRole("textbox", { name: "Counts for new pages" });
        fireEvent.change(field, { target: { value: "9" } });
        fireEvent.keyDown(field, { key: "Escape" });
        fireEvent.blur(field);
        expect(onCountsChange).not.toHaveBeenCalled();
    });

    it("a hover on the menu's action neither saves a half-typed number nor takes the typing", () => {
        const onCountsChange = vi.fn();
        show({
            appendCounts: {
                ...appendCounts(),
                counts: 16,
                onCountsChange,
                toEnd: {
                    label: (n) => `Create pages every ${n} counts to the end`,
                    title: (n) =>
                        `Add pages every ${n} counts to the end of the music`,
                    onAppend: vi.fn(),
                },
            },
        });
        fireEvent.contextMenu(pill()!, { clientX: 300, clientY: 200 });
        const field = screen.getByRole("textbox", {
            name: "Counts for new pages",
        }) as HTMLInputElement;
        const action = screen.getByRole("menuitem", {
            name: "Create pages every 16 counts to the end",
        });
        field.focus();
        // "1" on the way to "12"
        fireEvent.change(field, { target: { value: "1" } });
        fireEvent.pointerMove(action, { pointerType: "mouse" });
        expect(document.activeElement).toBe(field);
        fireEvent.pointerLeave(action, { pointerType: "mouse" });
        expect(document.activeElement).toBe(field);
        // Focus moving within the menu (a keyboard, a click on the action) saves nothing
        fireEvent.blur(field, { relatedTarget: action });
        expect(onCountsChange).not.toHaveBeenCalled();
        expect(screen.getByTestId("timeline-append-counts-menu")).toBeTruthy();
        // The typing stays in the box: the menu's typeahead would jump to "Create pages…" on "c"
        fireEvent.keyDown(field, { key: "c" });
        expect(document.activeElement).toBe(field);
        fireEvent.change(field, { target: { value: "12" } });
        fireEvent.submit(field.closest("form")!);
        expect(onCountsChange).toHaveBeenCalledTimes(1);
        expect(onCountsChange).toHaveBeenCalledWith(12);
    });

    it("the to-the-end action follows the typed number, makes pages of it and saves it", () => {
        const onCountsChange = vi.fn();
        const onPages = vi.fn();
        show({
            appendCounts: {
                ...appendCounts(),
                counts: 16,
                onCountsChange,
                toEnd: {
                    label: (n) => `Create pages every ${n} counts to the end`,
                    title: (n) =>
                        `Add pages every ${n} counts to the end of the music`,
                    onAppend: onPages,
                },
            },
        });
        fireEvent.contextMenu(pill()!, { clientX: 300, clientY: 200 });
        const field = screen.getByRole("textbox", {
            name: "Counts for new pages",
        });
        // Not a whole number: it reads the saved length
        fireEvent.change(field, { target: { value: "" } });
        expect(
            screen.getByRole("menuitem", {
                name: "Create pages every 16 counts to the end",
            }),
        ).toBeTruthy();
        fireEvent.change(field, { target: { value: "12" } });
        const action = screen.getByRole("menuitem", {
            name: "Create pages every 12 counts to the end",
        });
        expect(action.getAttribute("title")).toBe(
            "Add pages every 12 counts to the end of the music",
        );
        fireEvent.click(action);
        expect(onPages).toHaveBeenCalledWith(12);
        expect(onCountsChange).toHaveBeenCalledTimes(1);
        expect(onCountsChange).toHaveBeenCalledWith(12);
        expect(screen.queryByTestId("timeline-append-counts-menu")).toBeNull();
    });

    it("with nothing usable typed, the to-the-end action makes the saved length and saves nothing", () => {
        const onCountsChange = vi.fn();
        const onPages = vi.fn();
        show({
            appendCounts: {
                ...appendCounts(),
                counts: 16,
                onCountsChange,
                toEnd: {
                    label: (n) => `Create pages every ${n} counts to the end`,
                    title: (n) =>
                        `Add pages every ${n} counts to the end of the music`,
                    onAppend: onPages,
                },
            },
        });
        fireEvent.contextMenu(pill()!, { clientX: 300, clientY: 200 });
        fireEvent.change(
            screen.getByRole("textbox", { name: "Counts for new pages" }),
            { target: { value: "0" } },
        );
        fireEvent.click(
            screen.getByRole("menuitem", {
                name: "Create pages every 16 counts to the end",
            }),
        );
        expect(onPages).toHaveBeenCalledWith(16);
        expect(onCountsChange).not.toHaveBeenCalled();
    });

    it("saves what was typed when the menu closes another way", async () => {
        const onCountsChange = vi.fn();
        show({
            appendCounts: { ...appendCounts(), counts: 16, onCountsChange },
        });
        fireEvent.contextMenu(pill()!, { clientX: 300, clientY: 200 });
        const field = screen.getByRole("textbox", {
            name: "Counts for new pages",
        });
        fireEvent.change(field, { target: { value: "24" } });
        // An outside press dismisses the menu (Radix listens for it from the next task)
        await new Promise((resolve) => setTimeout(resolve, 0));
        fireEvent.pointerDown(document.body);
        expect(screen.queryByTestId("timeline-append-counts-menu")).toBeNull();
        expect(onCountsChange).toHaveBeenCalledTimes(1);
        expect(onCountsChange).toHaveBeenCalledWith(24);
    });

    it("without the command, a right-click opens no menu", () => {
        show({ appendCounts: appendCounts() });
        fireEvent.contextMenu(pill()!);
        expect(screen.queryByTestId("timeline-append-counts-menu")).toBeNull();
    });
});
