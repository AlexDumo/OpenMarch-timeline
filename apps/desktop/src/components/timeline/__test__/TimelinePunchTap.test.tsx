import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { countTimes } from "@/timeline/tempo";
import { ExpandedTimeline } from "../TimelineVariants";
import { timelineStoryModel } from "../TimelineStoryFixtures";
import type {
    TimelineAlign,
    TimelinePunchTapConfig,
    TimelineSelection,
} from "../TimelineViewModel";

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
                if (typeof template !== "string") return key;
                // "{count, plural, one {# tap} other {# taps}}" reads "N taps" here
                return template
                    .replace(
                        /\{(\w+), plural, one \{# (\w+)\} other \{# (\w+)\}\}/g,
                        (_, name: string, one: string, other: string) =>
                            `${String(params[name])} ${params[name] === 1 ? one : other}`,
                    )
                    .replace(/\{(\w+)\}/g, (_, name: string) =>
                        String(params[name]),
                    );
            },
        },
    };
});

/** The story show (32 counts, pages 1, 2, 2A and 4 of 8) at 120 BPM, after the hidden beat 0 */
const durations = [0, ...Array<number>(32).fill(0.5)];
const times = countTimes(durations);

const envelope = {
    peaks: Float32Array.from({ length: 200 * 20 }, () => 0.1),
    rate: 200,
};

const setup = ({
    punch = {},
    synced = [],
    selection,
}: {
    punch?: Partial<TimelinePunchTapConfig>;
    synced?: number[];
    selection?: TimelineSelection;
} = {}) => {
    const clock = { now: 0 };
    const punchTap: TimelinePunchTapConfig = {
        apply: "stop",
        unit: "page",
        liveTime: vi.fn(() => clock.now),
        play: vi.fn(() => true),
        blocked: vi.fn(() => false),
        onApplied: vi.fn(),
        ...punch,
    };
    const align = {
        on: true,
        onToggle: vi.fn(),
        durations,
        synced,
        audioOffsetSeconds: 0,
        envelope,
        onRetime: vi.fn(),
        onSetSynced: vi.fn(),
        punchTap,
    } satisfies TimelineAlign;
    const ui = (isPlaying: boolean, positionBeat: number) => (
        <ExpandedTimeline
            model={timelineStoryModel}
            positionBeat={positionBeat}
            isPlaying={isPlaying}
            pixelsPerBeat={16}
            onSeek={vi.fn()}
            selection={selection}
            align={{ ...align, offset: 1 }}
        />
    );
    const view = render(ui(false, 11));
    let stamp = 1000;
    return {
        align,
        punchTap,
        clock,
        play: (positionBeat = 8) => view.rerender(ui(true, positionBeat)),
        stop: (positionBeat = 20) => view.rerender(ui(false, positionBeat)),
        /** T at show time `time`, 400 ms after the last key */
        tapAt: (time: number) => {
            clock.now = time;
            stamp += 400;
            keyAt("t", stamp);
        },
        key: (key: string) => fireEvent.keyDown(window, { key }),
    };
};

/** A key press whose input event happened at `timeStamp` ms (jsdom ignores it in the init) */
const keyAt = (key: string, timeStamp: number, init: KeyboardEventInit = {}) =>
    act(() => {
        const event = new KeyboardEvent("keydown", {
            key,
            bubbles: true,
            cancelable: true,
            ...init,
        });
        Object.defineProperty(event, "timeStamp", { value: timeStamp });
        window.dispatchEvent(event);
    });

const chip = () => screen.getByTestId("timeline-punch-tap-chip");
const drafts = () => screen.queryAllByTestId("timeline-punch-tap-draft");

describe("punch-in tap (E9)", () => {
    it("is a Tap button and a next-tap chip in Align, with the flag on", () => {
        setup();
        expect(
            screen.getByTestId("timeline-punch-tap-button"),
        ).toHaveTextContent("Tap");
        // The playhead is on page 2A's count 3 (spec 12): the next flag is page 2A's
        expect(chip()).toHaveTextContent("Next tap → Pg 2 ct 8");
        expect(screen.getByTestId("timeline-punch-tap-target")).toBeVisible();
    });

    it("from a selected page, the next tap is that page's start, until the playhead has gone past it", () => {
        // Page 2 (spec counts 9–17) is selected and the playhead is in it
        setup({
            selection: {
                kind: "range",
                range: { startBeatIndex: 8, endBeatIndex: 16 },
            },
        });
        // Page 2 starts on page 1's flag, its last count (UI-13)
        expect(chip()).toHaveTextContent("Next tap → Pg 1 ct 8");
        cleanup();
        // Page 1 is selected but a take played on past it: carry on from the playhead
        setup({
            selection: {
                kind: "range",
                range: { startBeatIndex: 0, endBeatIndex: 8 },
            },
        });
        expect(chip()).toHaveTextContent("Next tap → Pg 2 ct 8");
    });

    it("paused, T plays from a page before the target; playing, each tap sets the next flag", () => {
        const { punchTap, play, tapAt } = setup();
        tapAt(0);
        expect(punchTap.play).toHaveBeenCalledWith(9);
        expect(drafts()).toHaveLength(0);
        play();
        tapAt(8.3);
        expect(chip()).toHaveTextContent("1 tap · Next tap → Pg 2A ct 8");
        tapAt(12.4);
        expect(drafts()).toHaveLength(2);
        expect(chip()).toHaveTextContent("2 taps · No flag left to tap");
    });

    it("T doesn't tap while Tap the beat's panel has it", () => {
        const { punchTap, tapAt } = setup({ punch: { blocked: () => true } });
        tapAt(0);
        expect(punchTap.play).not.toHaveBeenCalled();
    });

    it("leaves Shift+T to the tempo map", () => {
        const { punchTap } = setup();
        fireEvent.keyDown(window, { key: "T", shiftKey: true });
        expect(punchTap.play).not.toHaveBeenCalled();
    });

    it("Backspace drops the last tap and steps the chip back; a bounce is ignored", () => {
        const { play, tapAt, key, clock } = setup();
        tapAt(0);
        play();
        tapAt(8.3);
        // 50 ms later: a bounce
        clock.now = 8.35;
        keyAt("t", 1000 + 800 + 50);
        expect(drafts()).toHaveLength(1);
        tapAt(12.4);
        key("Backspace");
        expect(drafts()).toHaveLength(1);
        expect(chip()).toHaveTextContent("1 tap · Next tap → Pg 2A ct 8");
    });

    it("draws a tap implying a big tempo jump amber, and keeps it", () => {
        const { play, tapAt } = setup();
        tapAt(0);
        play();
        tapAt(8);
        // Page 2A in 8 s instead of 4: half the tempo
        tapAt(16);
        const tags = screen.getAllByTestId("timeline-punch-tap-tag");
        expect(tags[1]).toHaveTextContent("2?");
        expect(tags[1]!.getAttribute("title")).toMatch(/^Missed a tap\?/);
        expect(drafts()).toHaveLength(2);
    });

    it("stop mode: stopping applies the take as one write, with the tapped flags synced", async () => {
        const { align, punchTap, play, stop, tapAt } = setup({ synced: [25] });
        tapAt(0);
        play();
        tapAt(8.3);
        expect(align.onRetime).not.toHaveBeenCalled();
        stop();
        expect(align.onRetime).toHaveBeenCalledTimes(1);
        const edit = vi.mocked(align.onRetime).mock.calls[0]![0];
        expect(countTimes(edit.durations)[17]).toBeCloseTo(8.3);
        // The synced flag after the tap stays put
        expect(countTimes(edit.durations)[25]).toBeCloseTo(times[25]!);
        expect(edit.synced).toEqual([17, 25]);
        await act(async () => {});
        expect(punchTap.onApplied).toHaveBeenCalledWith(
            "Lined up page 2 to your taps.",
        );
        expect(drafts()).toHaveLength(0);
    });

    it("stop mode: a stop with no taps writes nothing", () => {
        const { align, play, stop, tapAt } = setup();
        tapAt(0);
        play();
        stop();
        expect(align.onRetime).not.toHaveBeenCalled();
    });

    it("drafts mode: stopping keeps the drafts; Enter applies them", () => {
        const { align, play, stop, tapAt, key } = setup({
            punch: { apply: "drafts" },
        });
        tapAt(0);
        play();
        tapAt(8.3);
        tapAt(12.4);
        stop();
        expect(align.onRetime).not.toHaveBeenCalled();
        expect(drafts()).toHaveLength(2);
        expect(screen.getByTestId("timeline-punch-tap-apply")).toBeVisible();
        key("Enter");
        expect(align.onRetime).toHaveBeenCalledTimes(1);
        expect(vi.mocked(align.onRetime).mock.calls[0]![0].synced).toEqual([
            17, 25,
        ]);
    });

    it("drafts mode: Esc twice discards; once only asks", () => {
        const { align, play, stop, tapAt, key } = setup({
            punch: { apply: "drafts" },
        });
        tapAt(0);
        play();
        tapAt(8.3);
        stop();
        key("Escape");
        expect(chip()).toHaveTextContent("Esc again to discard 1 tap");
        expect(drafts()).toHaveLength(1);
        key("Escape");
        expect(drafts()).toHaveLength(0);
        expect(align.onRetime).not.toHaveBeenCalled();
    });

    it("clicking a flag taps again from there, replacing only that draft", () => {
        const { align, play, stop, tapAt, key } = setup({
            punch: { apply: "drafts" },
        });
        tapAt(0);
        play();
        tapAt(8.3);
        tapAt(12.4);
        stop();
        fireEvent.click(
            document.querySelector(
                '[data-testid="timeline-align-flag"][data-count="17"]',
            )!,
        );
        expect(chip()).toHaveTextContent("Next tap → Pg 2 ct 8");
        play(14);
        tapAt(8.1);
        key("Enter");
        const edit = vi.mocked(align.onRetime).mock.calls[0]![0];
        expect(countTimes(edit.durations)[17]).toBeCloseTo(8.1);
        expect(countTimes(edit.durations)[25]).toBeCloseTo(12.4);
    });

    it("count mode: each tap sets the next count, with an 8-count count-in", () => {
        const { punchTap, play, tapAt } = setup({ punch: { unit: "count" } });
        expect(chip()).toHaveTextContent("Next tap → Pg 2 ct 3");
        tapAt(0);
        expect(punchTap.play).toHaveBeenCalledWith(4);
        play();
        tapAt(5.6);
        expect(chip()).toHaveTextContent("1 tap · Next tap → Pg 2 ct 4");
    });

    it("has no Tap without the Tempo lab flag", () => {
        render(
            <ExpandedTimeline
                model={timelineStoryModel}
                positionBeat={11}
                isPlaying={false}
                pixelsPerBeat={16}
                onSeek={vi.fn()}
                align={{
                    on: true,
                    onToggle: vi.fn(),
                    durations,
                    synced: [],
                    audioOffsetSeconds: 0,
                    envelope,
                    onRetime: vi.fn(),
                    onSetSynced: vi.fn(),
                    offset: 1,
                }}
            />,
        );
        expect(screen.queryByTestId("timeline-punch-tap")).toBeNull();
    });
});
