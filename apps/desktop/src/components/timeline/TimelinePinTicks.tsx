import { memo, useMemo } from "react";
import tolgee from "@/global/singletons/Tolgee";
import type { TimelinePageMarker } from "./TimelineViewModel";
import {
    beatToX,
    getPageCountAt,
    TIMELINE_PAGE_ROW_BOTTOM,
} from "./TimelineGeometry";
import { ShortcutTooltip, TransportTooltipProvider } from "./ShortcutTooltip";

/** A pinned count of the open path (pathways step 5), as the timeline draws it */
export interface TimelinePinTick {
    /** Its beat: spec beats into the timeline, view beats inside it */
    readonly beat: number;
    /** Its count into the move ("pin on count 6"), for the tooltip */
    readonly count: number;
}

/** A tick's height above the page row's bottom edge, and its press target's width (px) */
const TICK_HEIGHT = 10;
const TARGET_WIDTH = 9;

/**
 * The open path's pins as ticks on the timeline (pathways step 5, spec Appendix M): a short
 * upright mark at each pinned count, standing on the page row's bottom edge over the move, so a
 * midset or quarter set reads in counts. A click seeks there, as a keyframe's diamond does;
 * the page boxes around it still select and scrub. Only while a path with pins is open.
 */
export const TimelinePinTicks = memo(function TimelinePinTicks({
    ticks,
    pages,
    pixelsPerBeat,
    onSeek,
}: {
    ticks: readonly TimelinePinTick[];
    pages: readonly TimelinePageMarker[];
    pixelsPerBeat: number;
    onSeek?: (beat: number) => void;
}) {
    const labels = useMemo(
        () =>
            ticks.map((tick) => {
                const { pageLabel, count } = getPageCountAt(
                    { pages },
                    tick.beat,
                );
                return tolgee.t(
                    "timeline.pinTicks.title",
                    "Pin on count {pin} of the move · Page {page}, count {count}",
                    { pin: tick.count, page: pageLabel, count },
                );
            }),
        [ticks, pages],
    );
    return (
        <TransportTooltipProvider disableHoverableContent>
            {ticks.map((tick, index) => (
                <ShortcutTooltip
                    key={tick.beat}
                    label={labels[index]!}
                    side="top"
                    closeOnPress
                >
                    <button
                        type="button"
                        aria-label={labels[index]}
                        data-testid={`timeline-pin-tick-${tick.count}`}
                        data-timeline-interactive="true"
                        // Under the keyframes (z-36), the start flag and the playhead
                        className="group/pin pointer-events-auto absolute z-[35] flex -translate-x-1/2 cursor-pointer items-end justify-center border-0 bg-transparent p-0"
                        style={{
                            left: beatToX(tick.beat, pixelsPerBeat),
                            top: TIMELINE_PAGE_ROW_BOTTOM - TICK_HEIGHT,
                            width: TARGET_WIDTH,
                            height: TICK_HEIGHT,
                        }}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => onSeek?.(tick.beat)}
                    >
                        <span
                            aria-hidden="true"
                            className="bg-accent block w-[2px] group-hover/pin:w-[3px]"
                            style={{ height: TICK_HEIGHT }}
                        />
                    </button>
                </ShortcutTooltip>
            ))}
        </TransportTooltipProvider>
    );
});
