import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExpandedTimeline } from "../TimelineVariants";
import { pageBoxLabelFits } from "../TimelinePrimitives";
import { timelineStoryModel } from "../TimelineStoryFixtures";
import { alignMove } from "../timelineAlign";
import type { TimelineAlign } from "../TimelineViewModel";

afterEach(cleanup);

// The Align view's strings, filled in from the English copy
vi.mock("@/global/singletons/Tolgee", async () => {
    const en = (await import("../../../../i18n/en.json")).default;
    return {
        default: {
            t: (key: string, params: Record<string, unknown> = {}) => {
                const template = key
                    .split(".")
                    .reduce<unknown>(
                        (node, part) =>
                            (node as Record<string, unknown>)?.[part],
                        en,
                    );
                return typeof template === "string"
                    ? template.replace(/\{(\w+)\}/g, (_, name: string) =>
                          String(params[name]),
                      )
                    : key;
            },
        },
    };
});

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

/** The story show (32 counts, pages of 8) at 120 BPM, with the hidden zero-length beat 0 */
const durations = [0, ...Array<number>(32).fill(0.5)];

const envelope = {
    peaks: Float32Array.from({ length: 200 * 20 }, (_, i) =>
        i % 100 < 5 ? 1 : 0.05,
    ),
    rate: 200,
};

const renderAlign = (
    overrides: Partial<TimelineAlign> = {},
    onSeek = vi.fn(),
) => {
    const align = {
        on: true,
        onToggle: vi.fn(),
        durations,
        synced: [] as number[],
        audioOffsetSeconds: 0,
        envelope,
        onRetime: vi.fn(),
        onSetSynced: vi.fn(),
        ...overrides,
    } satisfies TimelineAlign;
    const view = render(
        <ExpandedTimeline
            model={timelineStoryModel}
            positionBeat={11}
            isPlaying={false}
            pixelsPerBeat={16}
            onSeek={onSeek}
            align={{ ...align, offset: 1 }}
        />,
    );
    return { ...view, align };
};

/** Lets the drag's animation frame run */
const nextFrame = () =>
    act(
        () =>
            new Promise<void>((resolve) =>
                requestAnimationFrame(() => resolve()),
            ),
    );

const flag = (count: number) =>
    document.querySelector<HTMLElement>(
        `[data-testid="timeline-align-flag"][data-count="${count}"]`,
    )!;

describe("the Align view (E7)", () => {
    it("is a toggle in the transport, off until the user turns it on", () => {
        const { align } = renderAlign({ on: false });
        const toggle = screen.getByTestId("timeline-align-toggle");
        expect(toggle).toHaveAttribute("aria-pressed", "false");
        expect(screen.queryByTestId("timeline-align-times")).toBeNull();
        expect(screen.queryByTestId("timeline-align-flag")).toBeNull();
        fireEvent.click(toggle);
        expect(align.onToggle).toHaveBeenCalledWith(true);
    });

    it("toggles with A, not Esc, and not when A belongs to the selected marchers", () => {
        const { align, unmount } = renderAlign();
        fireEvent.keyDown(window, { key: "Escape" });
        expect(align.onToggle).not.toHaveBeenCalled();
        fireEvent.keyDown(window, { key: "a" });
        expect(align.onToggle).toHaveBeenCalledWith(false);
        unmount();
        const blocked = renderAlign({ keyBlocked: true });
        fireEvent.keyDown(window, { key: "a" });
        expect(blocked.align.onToggle).not.toHaveBeenCalled();
    });

    it("shows it's on in several ways: lit toggle with ✕, times, tempos, a taller waveform", () => {
        renderAlign();
        expect(screen.getByTestId("timeline-align-toggle")).toHaveAttribute(
            "aria-pressed",
            "true",
        );
        expect(screen.getByTestId("timeline-align-off")).toBeInTheDocument();
        // At 32 px/s a label every 2 s leaves room
        expect(screen.getByTestId("timeline-align-times")).toHaveTextContent(
            "0:000:020:04",
        );
        expect(
            screen.getAllByTestId("timeline-page-note")[0],
        ).toHaveTextContent("· 120");
        expect(screen.getByTestId("timeline-readout-note")).toHaveTextContent(
            "120 BPM",
        );
        expect(screen.getByTestId("timeline-align-waveform")).toHaveStyle({
            height: "64px",
        });
        // Count 1 and every page's flag have a handle; count 1 is always synced
        expect(
            screen
                .getAllByTestId("timeline-align-flag")
                .map((el) => el.getAttribute("data-count")),
        ).toEqual(["1", "9", "17", "25", "33"]);
        expect(flag(1)).toHaveAttribute("data-synced", "true");
        expect(flag(9)).not.toHaveAttribute("data-synced");
    });

    it("draws counts in seconds: x = time × px/s", () => {
        renderAlign();
        // Entering keeps the playhead page's width: 16 px a count over 0.5 s is 32 px/s
        expect(flag(9)).toHaveStyle({ left: `${4 * 32}px` });
    });

    it("previews a flag drag in memory and writes it once on release", async () => {
        const { align } = renderAlign();
        const handle = flag(9);
        fireEvent.pointerDown(handle, {
            button: 0,
            clientX: 100,
            pointerId: 1,
        });
        fireEvent.pointerMove(handle, { clientX: 105, pointerId: 1 });
        fireEvent.pointerMove(handle, { clientX: 110, pointerId: 1 });
        await nextFrame();
        expect(align.onRetime).not.toHaveBeenCalled();
        expect(screen.getByTestId("timeline-align-chip")).toHaveTextContent(
            "Pg 1 · 120 → 111 · Pg 2–4 move +0.31 s",
        );
        expect(screen.getByTestId("timeline-align-ghost")).toBeInTheDocument();
        // The flag already draws where the drag puts it
        expect(flag(9)).toHaveStyle({ left: `${(4 + 10 / 32) * 32}px` });
        fireEvent.pointerUp(handle, { clientX: 110, pointerId: 1 });
        expect(align.onRetime).toHaveBeenCalledTimes(1);
        const expected = alignMove({
            durations,
            index: 9,
            toTime: 4 + 10 / 32,
            synced: [],
        });
        expect(align.onRetime).toHaveBeenCalledWith({
            durations: expected.durations,
            originShift: 0,
            synced: [9],
        });
    });

    it("snaps back to where it was (no write), unless Alt is held", () => {
        const { align } = renderAlign();
        const handle = flag(9);
        fireEvent.pointerDown(handle, {
            button: 0,
            clientX: 100,
            pointerId: 1,
        });
        // Dropped back within 2 px of where it started (FB-8)
        fireEvent.pointerMove(handle, { clientX: 104, pointerId: 1 });
        fireEvent.pointerUp(handle, { clientX: 101, pointerId: 1 });
        expect(align.onRetime).not.toHaveBeenCalled();

        fireEvent.pointerDown(handle, {
            button: 0,
            clientX: 100,
            pointerId: 1,
        });
        fireEvent.pointerMove(handle, { clientX: 104, pointerId: 1 });
        fireEvent.pointerUp(handle, {
            clientX: 101,
            pointerId: 1,
            altKey: true,
        });
        expect(align.onRetime).toHaveBeenCalledTimes(1);
    });

    it("seeks on a click on a rehearsal tab, even with pointer jitter (Jo)", () => {
        const onSeek = vi.fn();
        const { align } = renderAlign({}, onSeek);
        const tab = screen.getByTestId("timeline-rehearsal-tab");
        fireEvent.pointerDown(tab, { button: 0, clientX: 50, pointerId: 1 });
        fireEvent.pointerMove(tab, { clientX: 51, pointerId: 1 });
        fireEvent.pointerUp(tab, { clientX: 51, pointerId: 1 });
        fireEvent.click(tab, { clientX: 51 });
        expect(onSeek).toHaveBeenCalledTimes(1);
        expect(align.onRetime).not.toHaveBeenCalled();
    });

    it("keeps a 4 px correction instead of snapping it back (FB-8)", () => {
        const { align } = renderAlign();
        const handle = flag(9);
        fireEvent.pointerDown(handle, {
            button: 0,
            clientX: 100,
            pointerId: 1,
        });
        fireEvent.pointerMove(handle, { clientX: 104, pointerId: 1 });
        fireEvent.pointerUp(handle, { clientX: 104, pointerId: 1 });
        expect(align.onRetime).toHaveBeenCalledTimes(1);
    });

    it("leaves the flag unsynced on a Shift drag", () => {
        const { align } = renderAlign({ synced: [17] });
        const handle = flag(9);
        fireEvent.pointerDown(handle, {
            button: 0,
            clientX: 100,
            pointerId: 1,
            shiftKey: true,
        });
        fireEvent.pointerMove(handle, { clientX: 120, pointerId: 1 });
        fireEvent.pointerUp(handle, { clientX: 120, pointerId: 1 });
        expect(align.onRetime).toHaveBeenCalledWith(
            expect.objectContaining({ synced: [17] }),
        );
    });

    it("moves the music's start when count 1 is dragged", () => {
        const { align } = renderAlign();
        const handle = flag(1);
        fireEvent.pointerDown(handle, { button: 0, clientX: 50, pointerId: 1 });
        fireEvent.pointerMove(handle, { clientX: 66, pointerId: 1 });
        fireEvent.pointerUp(handle, { clientX: 66, pointerId: 1 });
        expect(align.onRetime).toHaveBeenCalledWith(
            expect.objectContaining({ originShift: 0.5, synced: [] }),
        );
    });

    it("syncs a flag and takes the sync off from its right-click menu", () => {
        const { align, unmount } = renderAlign();
        fireEvent.contextMenu(flag(9));
        fireEvent.click(screen.getByText("Mark as synced"));
        expect(align.onSetSynced).toHaveBeenCalledWith([9]);
        unmount();
        const synced = renderAlign({ synced: [9, 17] });
        fireEvent.contextMenu(flag(9));
        fireEvent.click(screen.getByText("Unsync"));
        expect(synced.align.onSetSynced).toHaveBeenCalledWith([17]);
    });

    it("drags a count tick to hold the count before it", () => {
        const { align } = renderAlign();
        const tick = screen
            .getAllByTestId("timeline-align-tick")
            .find((el) => el.style.left === `${1.5 * 32}px`)!;
        fireEvent.pointerDown(tick, { button: 0, clientX: 48, pointerId: 1 });
        fireEvent.pointerMove(tick, { clientX: 80, pointerId: 1 });
        fireEvent.pointerUp(tick, { clientX: 80, pointerId: 1 });
        const edit = vi.mocked(align.onRetime).mock.calls[0]![0];
        // Count 3 (the 3rd count) now lasts 1.5 s; nothing new is synced
        expect(edit.durations[3]).toBeCloseTo(1.5, 9);
        expect(edit.synced).toEqual([]);
    });
});

describe("page box labels (FB-7)", () => {
    it("show the tempo note only when name and note fit on one line", () => {
        expect(pageBoxLabelFits("1", 62, "120")).toEqual({
            label: true,
            note: false,
        });
        expect(pageBoxLabelFits("1", 80, "120")).toEqual({
            label: true,
            note: true,
        });
        expect(pageBoxLabelFits("12A", 20, "120")).toEqual({
            label: false,
            note: false,
        });
        expect(pageBoxLabelFits("4", 200, null).note).toBe(false);
    });
});
