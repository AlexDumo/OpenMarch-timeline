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
import type { CountGrid } from "@/timeline/countGrid";
import { musicEndBeat } from "@/timeline/countsPastEnd";
import { beatsThrough } from "@/timeline/endlessTimeline";
import {
    useMusicEndSeconds,
    usePlaybackStopBeat,
} from "@/timeline/usePlaybackStopBeat";
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

/**
 * UI-12: the waveform lane, from the audio player's envelope, per beat on the view axis, as the
 * drill timeline's panel draws it: in full, past the stored counts to the music's end (endless
 * counts). Hidden in settings, the lane goes away as it does with no audio.
 */
function useWaveformLane(beats: readonly Beat[], countGrid: CountGrid) {
    const envelope = useAudioEnvelopeStore((s) => s.envelope);
    const waveformHidden = useUiSettingsStore(
        (s) => s.uiSettings.timelineWaveformStyle === "hidden",
    );
    const musicEnd = useMusicEndSeconds();
    return useMemo(() => {
        if (!envelope || waveformHidden) return null;
        const through =
            musicEnd === null ? 0 : musicEndBeat(countGrid, musicEnd);
        return {
            peaksByBeat: peaksByBeat(
                envelope,
                beatsThrough(countGrid, beats, through),
                createTimelineBeatAxis(beats).offset,
            ),
        };
    }, [envelope, beats, countGrid, musicEnd, waveformHidden]);
}

/**
 * The timeline as a ruler for someone else's lanes (Visuals mode, performer-behavior.md section
 * 7.1): the same pages, measures, waveform, playhead, transport and zoom as the drill timeline,
 * read-only (`TimelineProps.readOnly`), with `band` in place of the clip rows. Always expanded.
 */
export function TimelineNavigationPanel({ band }: { band: TimelineBand }) {
    const { beats, pages, measures, countGrid } = useTimingObjects()!;
    const waveform = useWaveformLane(beats, countGrid);
    // The counts go on past the stored ones, as on the drill timeline (endless counts)
    const stopBeat = usePlaybackStopBeat();
    const { isPlaying } = useIsPlaying()!;
    // A page box or home goes to that page, as in the drill timeline (UI-9), without the loop
    const goTo = (next: TimelineSelection) => {
        if (isPlaying && next?.kind === "home") {
            jumpTimelinePlayback(countGrid, 0);
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
    const zoomFitted = useUiSettingsStore(
        (s) => s.uiSettings.timelineZoomFitted,
    );
    const setZoomFitted = useUiSettingsStore((s) => s.setTimelineZoomFitted);
    return (
        <TimelineWaveformProvider waveform={waveform ?? NO_WAVEFORM}>
            <PlayingTimeline
                mode="expanded"
                readOnly
                band={band}
                showTransport
                zoomFitted={zoomFitted}
                onZoomFittedChange={setZoomFitted}
                className="w-full"
                beats={beats}
                pages={pages}
                measures={measures}
                timelines={NO_CLIPS}
                transportAccessories={LOOP_BUTTONS}
                transportSecondary={SOUND_BUTTON}
                onSelectionChange={goTo}
                countGrid={countGrid}
                fitBeat={stopBeat}
            />
        </TimelineWaveformProvider>
    );
}
