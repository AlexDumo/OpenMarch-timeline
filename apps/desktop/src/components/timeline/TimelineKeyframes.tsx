import { memo, useMemo } from "react";
import clsx from "clsx";
import tolgee from "@/global/singletons/Tolgee";
import type { SelectionKeyframe } from "@/timeline/timelineSetFollowing";
import type { TimelinePageMarker } from "./TimelineViewModel";
import {
    beatToX,
    getPageCountAt,
    TIMELINE_PAGE_ROW_BOTTOM,
} from "./TimelineGeometry";
import { ShortcutTooltip, TransportTooltipProvider } from "./ShortcutTooltip";

/** A diamond's size (px), and the press target around it */
const DIAMOND_SIZE = 9;
const TARGET_SIZE = 13;

/**
 * The selection's keyframes (#303, `useSelectionKeyframes`): a diamond at every count where a
 * selected marcher is Set, filled where all of them are, hollow where only some are. Drawn on the
 * page row's bottom edge, half over the measure row, so it covers no page label, keep chain or the
 * playhead's handle, and only the bottom few pixels of a flag's grip (above it there, so a
 * diamond on a flag still seeks). Only the diamond takes the pointer: the page boxes around it
 * still select and scrub. Nothing selected, no diamonds.
 */
export const TimelineKeyframes = memo(function TimelineKeyframes({
    keyframes,
    pages,
    pixelsPerBeat,
    onSeek,
}: {
    keyframes: readonly SelectionKeyframe[];
    pages: readonly TimelinePageMarker[];
    pixelsPerBeat: number;
    onSeek?: (beat: number) => void;
}) {
    // Worked out when the keyframes or pages change, not on every render (a scrub re-renders)
    const labels = useMemo(
        () => keyframes.map((keyframe) => keyframeLabel(keyframe, pages)),
        [keyframes, pages],
    );
    if (keyframes.length === 0) return null;
    return (
        <TransportTooltipProvider disableHoverableContent>
            {keyframes.map((keyframe, index) => (
                <KeyframeDiamond
                    key={keyframe.beat}
                    keyframe={keyframe}
                    label={labels[index]!}
                    left={beatToX(keyframe.beat, pixelsPerBeat)}
                    onSeek={onSeek}
                />
            ))}
        </TransportTooltipProvider>
    );
});

/** A diamond's name: its page and count, and how many selected marchers are Set there. */
function keyframeLabel(
    keyframe: SelectionKeyframe,
    pages: readonly TimelinePageMarker[],
): string {
    const { pageLabel, count } = getPageCountAt({ pages }, keyframe.beat);
    return keyframe.total === 1
        ? tolgee.t(
              "timeline.keyframes.labelOne",
              "Page {page}, count {count}: Set",
              { page: pageLabel, count },
          )
        : tolgee.t(
              "timeline.keyframes.label",
              "Page {page}, count {count}: {set} of {total} selected marchers Set",
              {
                  page: pageLabel,
                  count,
                  set: keyframe.set,
                  total: keyframe.total,
              },
          );
}

/**
 * One keyframe's diamond (`TimelineKeyframes`). Its own component so its right-click menu (#306)
 * can wrap it as the Basic points' menu wraps theirs.
 */
const KeyframeDiamond = memo(function KeyframeDiamond({
    keyframe,
    label,
    left,
    onSeek,
}: {
    keyframe: SelectionKeyframe;
    label: string;
    left: number;
    onSeek?: (beat: number) => void;
}) {
    const filled = keyframe.set === keyframe.total;
    return (
        <ShortcutTooltip label={label} side="top" closeOnPress>
            <button
                type="button"
                data-testid={`timeline-keyframe-${keyframe.beat}-${filled ? "filled" : "hollow"}`}
                data-timeline-interactive="true"
                aria-label={label}
                // Under the start flag (z-40) and the playhead (z-50), over the flag grips (z-35)
                className="group/keyframe focus-visible:ring-accent pointer-events-auto absolute z-[36] flex -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 outline-hidden focus-visible:ring-2"
                style={{
                    left,
                    top: TIMELINE_PAGE_ROW_BOTTOM,
                    width: TARGET_SIZE,
                    height: TARGET_SIZE,
                }}
                // A press here is the diamond's: the timeline under it mustn't scrub
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => onSeek?.(keyframe.beat)}
            >
                <span
                    aria-hidden="true"
                    className={clsx(
                        "border-text block rotate-45 border-[1.5px] group-hover/keyframe:scale-125",
                        filled ? "bg-text" : "bg-bg-1",
                    )}
                    style={{
                        width: DIAMOND_SIZE - 2,
                        height: DIAMOND_SIZE - 2,
                    }}
                />
            </button>
        </ShortcutTooltip>
    );
});
