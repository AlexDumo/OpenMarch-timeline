import { useTimingObjects } from "@/hooks";
import { useUiSettingsStore } from "@/stores/UiSettingsStore";
import {
    BasicCountsLabel,
    BasicCountsStrip,
    BasicPlayhead,
    useBasicTimeAxis,
} from "./BasicTimelineOverlay";
import { useBasicPoints } from "./useBasicPoints";

/**
 * Basic mode's rows under the page boxes (UI-19): the counts strip, and the playhead line over the
 * whole bar. `contentRef` is the bar's positioned content (the playhead spans it); `scrollRef` is
 * the bar's scroller, which playback keeps the playhead in view of.
 */
export default function BasicPageBarRows({
    contentRef,
    scrollRef,
}: {
    contentRef: React.RefObject<HTMLDivElement | null>;
    scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
    const { pages, beats } = useTimingObjects()!;
    const pixelsPerSecond = useUiSettingsStore(
        (s) => s.uiSettings.timelinePixelsPerSecond,
    );
    const axis = useBasicTimeAxis(contentRef, pages);
    const { points, onPointContextMenu, menu } = useBasicPoints();
    const last = pages[pages.length - 1];
    // The page boxes' width: home's 40px box, then each page's duration
    const width = last
        ? 40 + (last.timestamp + last.duration) * pixelsPerSecond + 2
        : 0;
    return (
        <>
            <div className="flex h-fit items-center">
                <BasicCountsLabel />
                <BasicCountsStrip
                    axis={axis}
                    beats={beats}
                    pages={pages}
                    pixelsPerSecond={pixelsPerSecond}
                    width={width}
                    points={points}
                    onPointContextMenu={onPointContextMenu}
                />
            </div>
            <BasicPlayhead
                scrollRef={scrollRef}
                axis={axis}
                beats={beats}
                pixelsPerSecond={pixelsPerSecond}
            />
            {menu}
        </>
    );
}
