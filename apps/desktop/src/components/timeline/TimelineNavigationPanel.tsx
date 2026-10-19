import { useMemo } from "react";
import { useTimingObjects } from "@/hooks";
import { useIsPlaying } from "@/context/IsPlayingContext";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { useUiSettingsStore } from "@/stores/UiSettingsStore";
import { jumpTimelinePlayback } from "@/timeline/timelineTransport";
import {
    peaksByBeat,
    useAudioEnvelopeStore,
} from "@/timeline/timelineWaveform";
import { createTimelineBeatAxis } from "@/timeline/timelineViewModel";
import type Beat from "@/global/classes/Beat";
import {
    TimelineWaveformProvider,
    type TimelineInput,
    type TimelineSelection,
} from "./Timeline";
import type { TimelineBand } from "./TimelineBand";
import {
    TimelineLoopButton,
    TimelineSoundButton,
    TimelineSpeedButton,
} from "./TimelineControls";
import { PlayingTimeline } from "./TimelineModePanel";

const NO_WAVEFORM = { peaksByBeat: [] };
const NO_CLIPS: TimelineInput[] = [];

// The transport's controls read their own state: the same elements every render, as in the drill
// timeline's panel
const SOUND_BUTTON = <TimelineSoundButton />;
const LOOP_BUTTONS = (
    <>
        <TimelineLoopButton />
        <TimelineSpeedButton />
    </>
);
const SPEED_BUTTON = <TimelineSpeedButton />;

/**
 * UI-12: the waveform lane, from the audio player's envelope, per beat on the view axis, as the
 * drill timeline's panel draws it. Hidden in settings, the lane goes away as it does with no audio.
 * In page boxes (`inBoxes`, as Basic draws them) a silent placeholder counts as no audio too, as
 * the lane sets the pane's height there (UI-19).
 */
function useWaveformLane(beats: readonly Beat[], inBoxes = false) {
    const envelope = useAudioEnvelopeStore((s) => s.envelope);
    const waveformHidden = useUiSettingsStore(
        (s) => s.uiSettings.timelineWaveformStyle === "hidden",
    );
    return useMemo(() => {
        if (!envelope || waveformHidden) return null;
        const peaks = peaksByBeat(
            envelope,
            beats,
            createTimelineBeatAxis(beats).offset,
        );
        if (inBoxes && !peaks.some((beat) => beat.some((peak) => peak > 0)))
            return null;
        return { peaksByBeat: peaks };
    }, [envelope, beats, waveformHidden, inBoxes]);
}

/** A page box or home goes to that page, as in the drill timeline (UI-9), without the loop */
function useGoToPage(beats: readonly Beat[]) {
    const { isPlaying } = useIsPlaying()!;
    return (next: TimelineSelection) => {
        if (isPlaying && next?.kind === "home") {
            jumpTimelinePlayback(beats, 0);
            return;
        }
        if (isPlaying) return;
        const store = useTimelineSelectionStore.getState();
        if (next?.kind === "home") store.selectHome();
        else if (next?.kind === "range")
            store.selectRange(
                next.range.startBeatIndex,
                next.range.endBeatIndex,
            );
    };
}

/** The timeline's zoom, fitted to the show or not, as saved (UI-12) */
function useSavedZoomFit() {
    const zoomFitted = useUiSettingsStore(
        (s) => s.uiSettings.timelineZoomFitted,
    );
    const setZoomFitted = useUiSettingsStore((s) => s.setTimelineZoomFitted);
    return { zoomFitted, onZoomFittedChange: setZoomFitted };
}

/**
 * The timeline as a ruler for someone else's lanes (Visuals mode, performer-behavior.md section
 * 7.1): the same pages, measures, waveform, playhead, transport and zoom as the drill timeline,
 * read-only (`TimelineProps.readOnly`), with `band` in place of the clip rows. Always expanded.
 */
export function TimelineNavigationPanel({ band }: { band: TimelineBand }) {
    const { beats, pages, measures } = useTimingObjects()!;
    const waveform = useWaveformLane(beats);
    const goTo = useGoToPage(beats);
    const zoomFit = useSavedZoomFit();
    return (
        <TimelineWaveformProvider waveform={waveform ?? NO_WAVEFORM}>
            <PlayingTimeline
                mode="expanded"
                readOnly
                band={band}
                showTransport
                {...zoomFit}
                className="w-full"
                beats={beats}
                pages={pages}
                measures={measures}
                timelines={NO_CLIPS}
                transportAccessories={LOOP_BUTTONS}
                transportSecondary={SOUND_BUTTON}
                onSelectionChange={goTo}
            />
        </TimelineWaveformProvider>
    );
}

/**
 * Preview's timeline (`PreviewModeStore`): only the music, the pages and the playhead, as one row
 * of page boxes with the music inside them (Basic's look, in either mode), read-only. No start
 * flag, loop or way-back mark: Preview always plays on. The transport keeps navigation, speed and
 * sound.
 */
export function PreviewTimelinePanel() {
    const { beats, pages, measures } = useTimingObjects()!;
    const waveform = useWaveformLane(beats, true);
    const goTo = useGoToPage(beats);
    const zoomFit = useSavedZoomFit();
    return (
        <TimelineWaveformProvider waveform={waveform ?? NO_WAVEFORM}>
            <PlayingTimeline
                mode="basic"
                basic
                readOnly
                hideStartFlag
                showTransport
                {...zoomFit}
                className="w-full"
                beats={beats}
                pages={pages}
                measures={measures}
                timelines={NO_CLIPS}
                transportAccessories={SPEED_BUTTON}
                transportSecondary={SOUND_BUTTON}
                onSelectionChange={goTo}
            />
        </TimelineWaveformProvider>
    );
}
