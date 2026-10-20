import { useLayoutEffect, useRef, useState } from "react";
import clsx from "clsx";
import { PlusIcon } from "@phosphor-icons/react";
import { beatToX, TIMELINE_PAGE_ROW_TOP } from "./TimelineGeometry";
import { useScrubFollow } from "./TimelinePrimitives";
import type { TimelineLiveValue } from "./timelineLiveValue";
import type { TimelineAppendAtPlayhead as AppendAtPlayhead } from "./TimelineViewModel";

/**
 * **+ Add N-Count Page** beside the paused playhead past the last page (UI-9, owner 2026-10-20):
 * one click adds the page from the last flag to the playhead. Hovering or focusing it shades that
 * range, unless the window (start flag to playhead) already covers exactly it. Like the playhead,
 * a scrub carries it along. Where it wouldn't fit before the scroller's visible right edge, it
 * sits on the playhead's left.
 */
export function TimelineAppendAtPlayhead({
    append,
    positionBeat,
    lastFlagBeat,
    pixelsPerBeat,
    height,
    windowShowsPage,
    scrubLine,
}: {
    append: AppendAtPlayhead;
    positionBeat: number;
    /** The last page's flag, where the new page starts (view beats) */
    lastFlagBeat: number;
    pixelsPerBeat: number;
    height: number;
    /** The window already shades the new page's range: the start flag is on the last flag */
    windowShowsPage: boolean;
    scrubLine?: TimelineLiveValue<number | null>;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const [previewing, setPreviewing] = useState(false);
    const playheadX = Math.round(beatToX(positionBeat, pixelsPerBeat));
    useScrubFollow(ref, scrubLine, playheadX, pixelsPerBeat);
    // Room for it on the playhead's right, else on its left; scrolling or a new spot re-measures
    const [flipped, setFlipped] = useState(false);
    useLayoutEffect(() => {
        const anchor = ref.current;
        const button = buttonRef.current;
        // The scroller it sits in; found in the DOM, since its ref isn't set yet on the first
        // layout effect (React attaches a parent's ref after its children's layout effects)
        const viewport = anchor?.closest<HTMLElement>(
            "[data-testid=timeline-viewport]",
        );
        if (!viewport || !anchor || !button) return;
        const place = () => {
            const edge = viewport.getBoundingClientRect();
            // Not laid out (no width): leave it on the right
            setFlipped(
                edge.width > 0 &&
                    anchor.getBoundingClientRect().left +
                        8 +
                        button.offsetWidth >
                        edge.right,
            );
        };
        place();
        viewport.addEventListener("scroll", place, { passive: true });
        return () => viewport.removeEventListener("scroll", place);
    }, [playheadX, append.label]);
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
                    ref={buttonRef}
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
