import type Beat from "@/global/classes/Beat";
import type Measure from "@/global/classes/Measure";
import type Page from "@/global/classes/Page";
import {
    createContext,
    type ReactNode,
    useContext,
    useMemo,
    useState,
} from "react";
import { clamp } from "./TimelineGeometry";
import { CollapsedTimeline, ExpandedTimeline } from "./TimelineVariants";
import type {
    TimelineActivitySpan,
    TimelineCreateTrackRequest,
    TimelineNavigation,
    TimelineRangeChange,
    TimelineSelection,
    TimelineTarget,
    TimelineTrack,
    TimelineViewModel,
    TimelineWaveform,
} from "./TimelineViewModel";

export type TimelineMode = "expanded" | "collapsed";

export interface TimelineLegInput {
    readonly id: string | number;
    readonly startBeatIndex: number;
    readonly endBeatIndex: number;
    readonly texture: "move" | "hold";
}

/** Renderer-ready aggregate assembled outside the visual component. */
export interface TimelineInput {
    readonly id: string | number;
    readonly targetId: string | number;
    readonly targetType: TimelineTarget["type"];
    readonly label: string;
    readonly color: string;
    readonly startBeatIndex: number;
    readonly endBeatIndex: number;
    readonly legs: readonly TimelineLegInput[];
    readonly activitySpans: readonly TimelineActivitySpan[];
}

/**
 * The playback state the timeline shows and the commands it sends. The caller owns the clock: the
 * app feeds it from its audio playback (see `useTimelinePlayback`), and stories keep local state.
 * 0.2 read the frame clock store here instead; that clock isn't wired into the app yet (P5.9).
 */
export interface TimelinePlayback {
    /** The beat under the playback cursor, a beat index in `[0, beats.length)` */
    readonly positionBeat: number;
    readonly isPlaying: boolean;
    /** Seek to a whole beat index, already clamped to the show */
    readonly onSeek?: (beatIndex: number) => void;
    readonly onPlayingChange?: (isPlaying: boolean) => void;
    /** Page navigation from the transport; without it, the transport seeks to page starts */
    readonly onNavigate?: (direction: TimelineNavigation) => void;
}

const STOPPED_AT_START: TimelinePlayback = {
    positionBeat: 0,
    isPlaying: false,
};

export interface TimelineProps {
    readonly mode: TimelineMode;
    readonly beats: readonly Beat[];
    readonly pages: readonly Page[];
    readonly measures: readonly Measure[];
    readonly timelines: readonly TimelineInput[];
    readonly playback?: TimelinePlayback;
    /** The playback clock shown in the transport */
    readonly transportClock?: ReactNode;
    /** Extra transport controls, such as volume, the metronome and fullscreen */
    readonly transportAccessories?: ReactNode;
    readonly showTransport?: boolean;
    readonly selection?: TimelineSelection;
    readonly selectedTarget?: TimelineTarget | null;
    readonly className?: string;
    readonly onSelectionChange?: (selection: TimelineSelection) => void;
    readonly onCreateTrack?: (request: TimelineCreateTrackRequest) => void;
    readonly onTimelineRangeCommit?: (change: TimelineRangeChange) => void;
}

const TimelineWaveformContext = createContext<TimelineWaveform | null>(null);

/** Internal injection point used by Storybook until the audio adapter lands. */
export function TimelineWaveformProvider({
    waveform,
    children,
}: {
    waveform: TimelineWaveform;
    children: ReactNode;
}) {
    return (
        <TimelineWaveformContext.Provider value={waveform}>
            {children}
        </TimelineWaveformContext.Provider>
    );
}

const useTimelineWaveform = (beatCount: number): TimelineWaveform => {
    const injected = useContext(TimelineWaveformContext);
    return useMemo(() => {
        if (injected?.peaksByBeat.length === beatCount) return injected;
        return {
            peaksByBeat: Array.from({ length: beatCount }, () => []),
        };
    }, [beatCount, injected]);
};

const toTrack = (timeline: TimelineInput): TimelineTrack => ({
    id: timeline.id,
    targetId: String(timeline.targetId),
    targetType: timeline.targetType,
    label: timeline.label,
    color: timeline.color,
    legs: timeline.legs.map((leg) => ({
        id: leg.id,
        startBeat: leg.startBeatIndex,
        endBeat: leg.endBeatIndex,
        texture: leg.texture,
    })),
    activitySpans: timeline.activitySpans,
});

export const createTimelineViewModel = ({
    beats,
    pages,
    measures,
    timelines,
    waveform,
}: Pick<TimelineProps, "beats" | "pages" | "measures" | "timelines"> & {
    waveform: TimelineWaveform;
}): TimelineViewModel => ({
    beatCount: beats.length,
    pages: pages.flatMap((page) => {
        const atBeat = page.beats[0]?.index;
        return atBeat == null
            ? []
            : [
                  {
                      id: page.id,
                      label: page.name,
                      atBeat,
                      isInitial:
                          page.previousPageId === null && page.counts === 0,
                  },
              ];
    }),
    measures: measures.map((measure) => ({
        id: measure.id,
        label: `M${measure.number}`,
        atBeat: measure.startBeat.index,
        rehearsalMark: measure.rehearsalMark,
    })),
    tracks: timelines.map(toTrack),
    waveform,
});

export function Timeline(props: TimelineProps) {
    const waveform = useTimelineWaveform(props.beats.length);
    const model = useMemo(
        () =>
            createTimelineViewModel({
                beats: props.beats,
                pages: props.pages,
                measures: props.measures,
                timelines: props.timelines,
                waveform,
            }),
        [props.beats, props.measures, props.pages, props.timelines, waveform],
    );
    const playback = props.playback ?? STOPPED_AT_START;
    const [pixelsPerBeat, setPixelsPerBeat] = useState(16);

    const positionBeat = clamp(
        playback.positionBeat,
        0,
        Math.max(model.beatCount - 1, 0),
    );
    const seekToBeat = playback.onSeek
        ? (beatIndex: number) => {
              const nextIndex = clamp(
                  Math.round(beatIndex),
                  0,
                  Math.max(props.beats.length - 1, 0),
              );
              if (!props.beats[nextIndex]) return;
              playback.onSeek?.(nextIndex);
          }
        : undefined;
    const commonProps = {
        model,
        positionBeat,
        isPlaying: playback.isPlaying,
        pixelsPerBeat,
        selection: props.selection,
        selectedTarget: props.selectedTarget,
        className: props.className,
        onSeek: seekToBeat,
        onPlayingChange: playback.onPlayingChange,
        onNavigate: playback.onNavigate,
        onPixelsPerBeatChange: setPixelsPerBeat,
        onSelectionChange: props.onSelectionChange,
        onCreateTrack: props.onCreateTrack,
        onTimelineRangeCommit: props.onTimelineRangeCommit,
        showTransport: props.showTransport ?? true,
        transportClock: props.transportClock,
        transportAccessories: props.transportAccessories,
    };

    return props.mode === "expanded" ? (
        <ExpandedTimeline {...commonProps} />
    ) : (
        <CollapsedTimeline {...commonProps} />
    );
}

export type {
    TimelineActivitySpan,
    TimelineBeatRange,
    TimelineCreateTrackRequest,
    TimelineSelection,
    TimelineTarget,
} from "./TimelineViewModel";
