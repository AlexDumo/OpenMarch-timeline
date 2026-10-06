import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { countTimes, type TypedSection } from "@/timeline/tempo";
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
/** The same at 0.9 s a count (≈67 a minute): slow, so tapped count by count */
const slow = [0, ...Array<number>(32).fill(0.9)];
const slowTimes = countTimes(slow);

const envelope = {
    peaks: Float32Array.from({ length: 200 * 40 }, () => 0.1),
    rate: 200,
};

/** A typed tempo over the whole show (FX-5) */
const typed: TypedSection = {
    from: 1,
    to: 33,
    tempo: "♩=120",
    measures: "m1–8",
};

const setup = ({
    punch = {},
    synced = [],
    selection,
    show = durations,
    sections,
}: {
    punch?: Partial<TimelinePunchTapConfig>;
    synced?: number[];
    selection?: TimelineSelection;
    show?: number[];
    sections?: TypedSection[];
} = {}) => {
    const clock = { now: 0 };
    const punchTap: TimelinePunchTapConfig = {
        liveTime: vi.fn(() => clock.now),
        play: vi.fn(() => true),
        blocked: vi.fn(() => false),
        onApplied: vi.fn(),
        onNotice: vi.fn(),
        ...punch,
    };
    const align = {
        on: true,
        onToggle: vi.fn(),
        durations: show,
        synced,
        audioOffsetSeconds: 0,
        envelope,
        onRetime: vi.fn(),
        onSetSynced: vi.fn(),
        punchTap,
        ...(sections ? { tempoMap: { units: [], sections } } : {}),
    } satisfies TimelineAlign;
    const now = { isPlaying: false, positionBeat: 11, on: true, tool: false };
    const ui = () => (
        <ExpandedTimeline
            model={timelineStoryModel}
            positionBeat={now.positionBeat}
            isPlaying={now.isPlaying}
            pixelsPerBeat={16}
            onSeek={vi.fn()}
            selection={selection}
            align={{
                ...align,
                on: now.on,
                punchTap: { ...punchTap, otherToolOpen: now.tool },
                offset: 1,
            }}
        />
    );
    const view = render(ui());
    const update = (next: Partial<typeof now>) => {
        Object.assign(now, next);
        view.rerender(ui());
    };
    let stamp = 1000;
    return {
        align,
        punchTap,
        clock,
        play: (positionBeat = 8) => update({ isPlaying: true, positionBeat }),
        stop: (positionBeat = 20) => update({ isPlaying: false, positionBeat }),
        /** Leaves Align (A or ✕), or comes back */
        setAlign: (on: boolean) => update({ on }),
        /** Tap the beat's panel opens (another tool) */
        openOtherTool: () => update({ tool: true }),
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
const unit = () => screen.getByTestId("timeline-punch-tap-unit");
const drafts = () => screen.queryAllByTestId("timeline-punch-tap-draft");
const done = () => screen.queryByTestId("timeline-punch-tap-apply");

describe("punch-in tap (E9)", () => {
    it("is a Tap button, what a tap sets and a next-tap chip in Align, with the flag on", () => {
        setup();
        expect(
            screen.getByTestId("timeline-punch-tap-button"),
        ).toHaveTextContent("Tap");
        expect(unit()).toHaveTextContent("Page starts: steady page");
        // The playhead is on page 2A's count 3 (spec 12): the next flag is page 2A's
        expect(chip()).toHaveTextContent("Next tap → Pg 2 ct 8");
        expect(screen.getByTestId("timeline-punch-tap-target")).toBeVisible();
        expect(done()).toBeNull();
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
        expect(chip()).toHaveTextContent(
            "1 tap · Next tap → A · Pg 2A ct 8 → 4",
        );
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
        expect(chip()).toHaveTextContent(
            "1 tap · Next tap → A · Pg 2A ct 8 → 4",
        );
    });

    it("a slow page is tapped count by count, with an 8-count count-in", () => {
        const { punchTap, play, tapAt } = setup({ show: slow });
        expect(unit()).toHaveTextContent("Every count: slow page");
        expect(chip()).toHaveTextContent("Next tap → Pg 2 ct 3");
        tapAt(0);
        expect(punchTap.play).toHaveBeenCalledWith(4);
        play();
        tapAt(slowTimes[12]!);
        expect(chip()).toHaveTextContent("1 tap · Next tap → Pg 2 ct 4");
    });

    it("the user can choose what a tap sets for the take", () => {
        const { play, tapAt } = setup({ show: slow });
        fireEvent.keyDown(unit(), { key: "Enter" });
        fireEvent.click(screen.getByTestId("timeline-punch-tap-unit-page"));
        expect(unit()).toHaveTextContent("Page starts: this take");
        expect(chip()).toHaveTextContent("Next tap → Pg 2 ct 8");
        tapAt(0);
        play();
        tapAt(slowTimes[17]!);
        expect(chip()).toHaveTextContent("1 tap · Next tap → Pg 2A ct 8");
    });

    it("draws a tap out of step with the taps on both sides amber, and keeps it", () => {
        const { play, tapAt } = setup({ show: slow });
        tapAt(0);
        play();
        // Counts 12–16, but count 14's tap comes a count late: a missed tap
        for (const at of [12, 13, 15, 16, 17]) tapAt(slowTimes[at]!);
        const amber = screen
            .getAllByTestId("timeline-punch-tap-tag")
            .filter((tag) => tag.getAttribute("title")?.startsWith("Missed"));
        expect(amber).toHaveLength(1);
        expect(amber[0]).toHaveTextContent("3?");
        expect(drafts()).toHaveLength(5);
    });

    it("pausing keeps the take, playing again carries it on, and Done applies it as one write", async () => {
        const { align, punchTap, play, stop, tapAt } = setup({ synced: [25] });
        tapAt(0);
        play();
        tapAt(8.3);
        stop();
        expect(align.onRetime).not.toHaveBeenCalled();
        expect(drafts()).toHaveLength(1);
        // Space from page 2A: the next tap is the next flag the music reaches
        play(22);
        tapAt(12.2);
        expect(chip()).toHaveTextContent("2 taps");
        stop();
        expect(align.onRetime).not.toHaveBeenCalled();
        fireEvent.click(done()!);
        expect(align.onRetime).toHaveBeenCalledTimes(1);
        const edit = vi.mocked(align.onRetime).mock.calls[0]![0];
        expect(countTimes(edit.durations)[17]).toBeCloseTo(8.3);
        expect(countTimes(edit.durations)[25]).toBeCloseTo(12.2);
        expect(edit.synced).toEqual([17, 25]);
        await act(async () => {});
        expect(punchTap.onApplied).toHaveBeenCalledWith(
            "Lined up pages 2–2A to your taps.",
        );
        expect(drafts()).toHaveLength(0);
    });

    it("Enter applies the take; a stop with no taps writes nothing", () => {
        const { align, play, stop, tapAt, key } = setup();
        tapAt(0);
        play();
        stop();
        key("Enter");
        expect(align.onRetime).not.toHaveBeenCalled();
        tapAt(0);
        play();
        tapAt(8.3);
        key("Enter");
        expect(align.onRetime).toHaveBeenCalledTimes(1);
    });

    it("only Discard take throws the take away; Esc doesn't", () => {
        const { align, play, stop, tapAt, key } = setup();
        tapAt(0);
        play();
        tapAt(8.3);
        stop();
        key("Escape");
        key("Escape");
        expect(drafts()).toHaveLength(1);
        fireEvent.click(screen.getByTestId("timeline-punch-tap-discard"));
        expect(drafts()).toHaveLength(0);
        expect(align.onRetime).not.toHaveBeenCalled();
    });

    it("leaving Align applies the take", () => {
        const { align, play, stop, tapAt, setAlign } = setup();
        tapAt(0);
        play();
        tapAt(8.3);
        stop();
        setAlign(false);
        expect(align.onRetime).toHaveBeenCalledTimes(1);
    });

    it("opening Tap the beat applies the take", () => {
        const { align, play, tapAt, openOtherTool } = setup();
        tapAt(0);
        play();
        tapAt(8.3);
        openOtherTool();
        expect(align.onRetime).toHaveBeenCalledTimes(1);
    });

    it("a take over a typed tempo asks Override or Keep typed, as a drag does", () => {
        const { align, play, stop, tapAt } = setup({ sections: [typed] });
        tapAt(0);
        play();
        tapAt(8.3);
        stop();
        fireEvent.click(done()!);
        expect(align.onRetime).not.toHaveBeenCalled();
        expect(screen.getByTestId("timeline-align-confirm")).toHaveTextContent(
            "♩=120",
        );
        // Keep typed: nothing is written, and the take stays
        fireEvent.click(screen.getByTestId("timeline-align-keep-typed"));
        expect(screen.queryByTestId("timeline-align-confirm")).toBeNull();
        expect(drafts()).toHaveLength(1);
        fireEvent.click(done()!);
        fireEvent.click(screen.getByTestId("timeline-align-override"));
        expect(align.onRetime).toHaveBeenCalledTimes(1);
        expect(drafts()).toHaveLength(0);
    });

    it("leaving Align with a take over a typed tempo keeps it as drafts, and says so", () => {
        const { align, punchTap, play, stop, tapAt, setAlign } = setup({
            sections: [typed],
        });
        tapAt(0);
        play();
        tapAt(8.3);
        stop();
        setAlign(false);
        expect(align.onRetime).not.toHaveBeenCalled();
        expect(punchTap.onNotice).toHaveBeenCalledWith(
            expect.stringContaining("♩=120"),
        );
        setAlign(true);
        expect(drafts()).toHaveLength(1);
    });

    it("clicking a flag taps again from there, replacing only that draft", () => {
        const { align, play, stop, tapAt, key } = setup();
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
