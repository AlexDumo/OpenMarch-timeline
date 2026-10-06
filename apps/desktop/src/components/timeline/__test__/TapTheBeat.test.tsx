import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import { TolgeeProvider } from "@tolgee/react";
import tolgee from "@/global/singletons/Tolgee";
import { workspaceSettingsQueryOptions } from "@/hooks/queries/useWorkspaceSettings";
import { defaultTempoLab, useUiSettingsStore } from "@/stores/UiSettingsStore";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { useAudioEnvelopeStore } from "@/timeline/timelineWaveform";
import { defaultWorkspaceSettings } from "@/settings/workspaceSettings";
import { ExpandedTimeline, CollapsedTimeline } from "../TimelineVariants";
import { timelineStoryModel } from "../TimelineStoryFixtures";
import {
    handlerDelaySeconds,
    LineUpStrip,
    TapTheBeatPanel,
    useTapTheBeatStore,
} from "../TapTheBeat";

const mocks = vi.hoisted(() => ({
    now: 0,
    isPlaying: true,
    apply: vi.fn(async () => [] as number[]),
    dismiss: vi.fn(async () => {}),
}));

vi.mock("@/global/database/db", () => ({ db: {} }));
vi.mock("../audio/AudioPlayer", () => ({
    getLivePlaybackPosition: () => mocks.now,
}));
vi.mock("@/context/IsPlayingContext", () => ({
    useIsPlaying: () => ({
        isPlaying: mocks.isPlaying,
        setIsPlaying: vi.fn(),
    }),
}));
vi.mock("@/db-functions/tapTheBeat", () => ({
    applyTapTheBeat: mocks.apply,
    dismissLineUpStrip: mocks.dismiss,
}));

/** A show: page 1 holds beat 0, page 2 has 16 counts of 0.5 s (120 per minute). */
const BEATS = Array.from({ length: 17 }, (_, i) => ({
    id: 100 + i,
    index: i,
    position: i,
    duration: i === 0 ? 0 : 0.5,
    timestamp: i === 0 ? 0 : (i - 1) * 0.5,
}));
const PAGES = [
    { id: 1, name: "1", beats: [BEATS[0]] },
    { id: 2, name: "2", beats: BEATS.slice(1) },
];
vi.mock("@/hooks", () => ({
    useTimingObjects: () => ({ beats: BEATS, pages: PAGES, measures: [] }),
}));
vi.mock("@/db-functions/tempo", () => ({
    readCountDurationsInTransaction: async () => ({
        beatIds: BEATS.map((b) => b.id),
        durations: BEATS.map((b) => b.duration),
    }),
    readTempoSyncedBeatIds: async () => [],
    durationsByBeatId: (ids: number[], durations: number[]) =>
        new Map(ids.map((id, i) => [id, durations[i]])),
}));

const setFlag = (on: boolean) =>
    useUiSettingsStore.setState((s) => ({
        uiSettings: {
            ...s.uiSettings,
            tempoLab: { ...defaultTempoLab, tapTheBeat: on },
        },
    }));

const withSettings = (
    children: ReactNode,
    settings: Partial<typeof defaultWorkspaceSettings> = {},
) => {
    const client = new QueryClient();
    client.setQueryData(workspaceSettingsQueryOptions().queryKey, {
        ...defaultWorkspaceSettings,
        ...settings,
    });
    return (
        <TolgeeProvider tolgee={tolgee} fallback="Loading...">
            <QueryClientProvider client={client}>
                {children}
            </QueryClientProvider>
        </TolgeeProvider>
    );
};

const ENVELOPE = { peaks: new Float32Array(200 * 20), rate: 200 };

beforeAll(async () => {
    await tolgee.run();
});

beforeEach(() => {
    setFlag(true);
    useAudioEnvelopeStore.getState().setEnvelope(ENVELOPE);
    useTapTheBeatStore.getState().setOpen(false);
    useTimelineSelectionStore.getState().selectHome();
    mocks.apply.mockClear();
    mocks.isPlaying = true;
});
afterEach(() => {
    cleanup();
    setFlag(false);
    useAudioEnvelopeStore.getState().setEnvelope(null);
});

describe("the line-up strip", () => {
    it("shows for music nobody lined up, and opens the panel", () => {
        render(withSettings(<LineUpStrip />));
        expect(
            screen.getByText("Counts aren't lined up with the music yet."),
        ).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Tap the beat" }));
        expect(useTapTheBeatStore.getState().open).toBe(true);
    });

    it.each([
        ["the flag is off", () => setFlag(false), {}],
        [
            "there is no music",
            () => useAudioEnvelopeStore.getState().setEnvelope(null),
            {},
        ],
        ["it was dismissed", () => {}, { tempoLineUpDismissed: true }],
        ["counts are synced", () => {}, { tempoSyncedBeatIds: [101] }],
    ])("hides when %s", (_, arrange, settings) => {
        arrange();
        render(withSettings(<LineUpStrip />, settings));
        expect(screen.queryByTestId("tempo-line-up-strip")).toBeNull();
    });

    it("dismisses for this file", () => {
        render(withSettings(<LineUpStrip />));
        fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
        expect(mocks.dismiss).toHaveBeenCalled();
    });
});

describe("the waveform notice", () => {
    const notice = <span data-testid="notice">notice</span>;
    it("sits over the waveform in the full timeline", () => {
        render(
            <ExpandedTimeline
                model={timelineStoryModel}
                positionBeat={0}
                isPlaying={false}
                pixelsPerBeat={16}
                showTransport={false}
                waveformNotice={notice}
            />,
        );
        expect(screen.getByTestId("notice")).toBeInTheDocument();
    });
    it("stays out of the compact timeline and a show without audio", () => {
        render(
            <CollapsedTimeline
                model={timelineStoryModel}
                positionBeat={0}
                isPlaying={false}
                pixelsPerBeat={16}
                showTransport={false}
                waveformNotice={notice}
            />,
        );
        expect(screen.queryByTestId("notice")).toBeNull();
        cleanup();
        render(
            <ExpandedTimeline
                model={{
                    ...timelineStoryModel,
                    waveform: {
                        peaksByBeat:
                            timelineStoryModel.waveform.peaksByBeat.map(
                                () => [],
                            ),
                    },
                }}
                positionBeat={0}
                isPlaying={false}
                pixelsPerBeat={16}
                showTransport={false}
                waveformNotice={notice}
            />,
        );
        expect(screen.queryByTestId("notice")).toBeNull();
    });
});

describe("tapping and applying", () => {
    const tapAt = (time: number) => {
        mocks.now = time;
        fireEvent.keyDown(window, { key: "t" });
    };

    it("turns taps from the start into one write with count 1 on the first tap", async () => {
        useTapTheBeatStore.getState().setOpen(true);
        render(withSettings(<TapTheBeatPanel />));
        const period = 60 / 132;
        for (let i = 0; i < 8; i++) tapAt(1.84 + i * period);
        expect(screen.getByTestId("tap-bpm")).toHaveTextContent(
            "≈ 132 per minute",
        );
        expect(screen.getByText("That's steady")).toBeInTheDocument();
        expect(screen.getByTestId("tap-sentence")).toHaveTextContent(
            "Count 1 will start at 0:01.84 in the music",
        );
        await act(async () => {
            fireEvent.click(screen.getByTestId("tap-apply"));
        });
        expect(mocks.apply).toHaveBeenCalledTimes(1);
        const args = mocks.apply.mock.calls[0]![0] as unknown as {
            newDurationsByBeatId: Map<number, number>;
            originShift: number;
        };
        expect(args.originShift).toBeCloseTo(1.84, 6);
        expect(args.newDurationsByBeatId.get(105)).toBeCloseTo(period, 6);
        expect(screen.getByTestId("tap-sentence")).toHaveTextContent(
            "Count 1 is at 0:01.84 in the music",
        );
    });

    it("asks for more taps, drops the last on Backspace and asks to play first", () => {
        useTapTheBeatStore.getState().setOpen(true);
        render(withSettings(<TapTheBeatPanel />));
        tapAt(1);
        tapAt(1.5);
        tapAt(2);
        expect(screen.getByText("Keep going…")).toBeInTheDocument();
        expect(screen.getByTestId("tap-apply")).toBeDisabled();
        fireEvent.keyDown(window, { key: "Backspace" });
        expect(screen.getByText(/2 taps/)).toBeInTheDocument();
        mocks.isPlaying = false;
        cleanup();
        render(withSettings(<TapTheBeatPanel />));
        tapAt(3);
        expect(
            screen.getByText("Play the music first, then tap along."),
        ).toBeInTheDocument();
    });

    it("keeps From here on the count tapping began at, after the playhead moves", async () => {
        useTimelineSelectionStore.getState().selectRange(1, 9);
        useTapTheBeatStore.getState().setOpen(true);
        render(withSettings(<TapTheBeatPanel />));
        expect(
            screen.getByRole("radio", { name: "From here" }),
        ).toHaveAttribute("aria-checked", "true");
        // The playhead's count 9 starts at 4 s; tap from there at 120 per minute
        for (let i = 0; i < 8; i++) tapAt(4 + i * 0.5);
        // Pausing a play-on run moves the playhead (UI-12)
        void act(() => useTimelineSelectionStore.getState().selectRange(9, 16));
        expect(screen.getByTestId("tap-sentence")).toHaveTextContent(
            "From page 2, count 9",
        );
        await act(async () => {
            fireEvent.click(screen.getByTestId("tap-apply"));
        });
        const args = mocks.apply.mock.calls[0]![0] as unknown as {
            newDurationsByBeatId: Map<number, number>;
            originShift: number;
        };
        expect(args.originShift).toBe(0);
        expect(args.newDurationsByBeatId.get(101)).toBe(0.5);
    });

    it("÷2 halves a tempo tapped on every half count", () => {
        useTapTheBeatStore.getState().setOpen(true);
        render(withSettings(<TapTheBeatPanel />));
        for (let i = 0; i < 8; i++) tapAt(i * 0.25);
        expect(screen.getByTestId("tap-bpm")).toHaveTextContent("≈ 240");
        fireEvent.click(screen.getByRole("button", { name: "÷2" }));
        expect(screen.getByTestId("tap-bpm")).toHaveTextContent("≈ 120");
    });
});

describe("handlerDelaySeconds", () => {
    it("measures how late a handler runs, ignoring odd timestamps", () => {
        expect(handlerDelaySeconds(1000, 1250)).toBeCloseTo(0.25, 9);
        expect(handlerDelaySeconds(0, 5000)).toBe(0);
        expect(handlerDelaySeconds(2000, 1000)).toBe(0);
    });
});
