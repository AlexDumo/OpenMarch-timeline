import { useRef, useState } from "react";
import clsx from "clsx";
import { PlusIcon } from "@phosphor-icons/react";
import { beatToX, TIMELINE_PAGE_ROW_TOP } from "./TimelineGeometry";
import { useScrubFollow } from "./TimelinePrimitives";
import type { TimelineLiveValue } from "./timelineLiveValue";
import type { TimelineAppendAtPlayhead as AppendAtPlayhead } from "./TimelineViewModel";

/** About how wide the button is, to keep it on the surface: past the right end it goes left */
const BUTTON_ROOM = 140;

/**
 * **+ Add N-Count Page** beside the paused playhead past the last page (UI-9, owner 2026-10-20):
 * one click adds the page from the last flag to the playhead. Hovering or focusing it shades that
 * range, unless the window (start flag to playhead) already covers exactly it. Like the playhead,
 * a scrub carries it along.
 */
export function TimelineAppendAtPlayhead({
    append,
    positionBeat,
    lastFlagBeat,
    pixelsPerBeat,
    height,
    surfaceWidth,
    windowShowsPage,
    scrubLine,
}: {
    append: AppendAtPlayhead;
    positionBeat: number;
    /** The last page's flag, where the new page starts (view beats) */
    lastFlagBeat: number;
    pixelsPerBeat: number;
    height: number;
    surfaceWidth: number;
    /** The window already shades the new page's range: the start flag is on the last flag */
    windowShowsPage: boolean;
    scrubLine?: TimelineLiveValue<number | null>;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const [previewing, setPreviewing] = useState(false);
    const playheadX = Math.round(beatToX(positionBeat, pixelsPerBeat));
    useScrubFollow(ref, scrubLine, playheadX, pixelsPerBeat);
    // Room for it on the playhead's right, else on its left
    const flipped = playheadX + 8 + BUTTON_ROOM > surfaceWidth;
    const startX = beatToX(lastFlagBeat, pixelsPerBeat);
    return (
        <>
            {previewing && !windowShowsPage && (
                <div
                    data-testid="timeline-append-preview"
                    aria-hidden="true"
                    className="bg-accent/15 border-accent pointer-events-none absolute z-30 border-x"
                    style={{
                        left: startX,
                        width: Math.max(0, playheadX - startX),
                        top: TIMELINE_PAGE_ROW_TOP,
                        height: Math.max(0, height - TIMELINE_PAGE_ROW_TOP),
                    }}
                />
            )}
            <div
                ref={ref}
                className="pointer-events-none absolute z-[60]"
                style={{ left: playheadX, top: TIMELINE_PAGE_ROW_TOP + 6 }}
            >
                <button
                    type="button"
                    data-testid="timeline-append-at-playhead"
                    data-timeline-interactive="true"
                    aria-label={append.title}
                    title={append.title}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={append.onAppend}
                    onPointerEnter={() => setPreviewing(true)}
                    onPointerLeave={() => setPreviewing(false)}
                    onFocus={() => setPreviewing(true)}
                    onBlur={() => setPreviewing(false)}
                    className={clsx(
                        "border-accent text-accent bg-bg-1 hover:bg-accent hover:text-text-invert focus-visible:ring-accent pointer-events-auto absolute top-0 flex h-16 items-center gap-2 rounded-full border px-6 text-[10px] leading-none font-medium whitespace-nowrap outline-hidden focus-visible:ring-2",
                        flipped ? "right-8" : "left-8",
                    )}
                >
                    <PlusIcon size={9} weight="bold" />
                    {append.label}
                </button>
            </div>
        </>
    );
}
