/**
 * Visuals mode's own timeline (performer-behavior.md section 7.1, owner
 * note 2026-10-17): the drill timeline's ruler, pages, measures, waveform,
 * playhead and transport, read-only, with the focused who's cue lanes as
 * its lanes in place of the drill clips.
 */
import { useMemo } from "react";
import { TimelineNavigationPanel } from "@/components/timeline/TimelineNavigationPanel";
import { useVisualsData } from "./VisualsProvider";
import { visualsTimelineBand } from "./VisualsCueBand";

export default function VisualsTimeline() {
    const data = useVisualsData();
    const band = useMemo(() => visualsTimelineBand(data), [data]);
    return <TimelineNavigationPanel band={band} />;
}
