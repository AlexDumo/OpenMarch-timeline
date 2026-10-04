import { useEffect } from "react";
import { Button } from "@openmarch/ui";
import { useTimingObjects } from "@/hooks";
import { useAlignmentEventStore } from "@/stores/AlignmentEventStore";
import {
    isolatedTimeline,
    useTimelineSelectionStore,
} from "@/stores/TimelineSelectionStore";
import { pageFlags, type FlagPage } from "@/timeline/timelinePlayhead";

/**
 * How the isolation bar names a timeline: "Page 3's move" when a page box has exactly its range,
 * else "The move over beats 9–25" (spec beats, as the timeline's messages write them).
 */
export function isolatedTimelineName(
    range: { readonly start: number; readonly end: number },
    pages: readonly (FlagPage & { readonly name: string })[],
): string {
    const page = pageFlags(pages).find(
        (f) => f.range?.start === range.start && f.range.end === range.end,
    );
    return page
        ? `Page ${page.page.name}'s move`
        : `The move over beats ${range.start}–${range.end}`;
}

const isTyping = (target: EventTarget | null) =>
    target instanceof HTMLElement &&
    (target.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/**
 * Esc ends isolation, unless the key goes to a text field or the line or lasso tool is open (Esc
 * cancels those first).
 */
export function useIsolationEscape(): void {
    const isolated = useTimelineSelectionStore((s) => s.isolation !== null);
    useEffect(() => {
        if (!isolated) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape" || event.defaultPrevented) return;
            if (isTyping(event.target)) return;
            if (useAlignmentEventStore.getState().alignmentEvent !== "default")
                return;
            useTimelineSelectionStore.getState().exitIsolation();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [isolated]);
}

/**
 * The bar over the field while a timeline is isolated (docs/timeline/research/ownership/09-isolation.md,
 * _prototype_): which move is isolated, how many marchers are in it, a key for the gray ghosts,
 * and the way out. Renders nothing when no timeline is isolated.
 */
export default function TimelineIsolationBar() {
    useIsolationEscape();
    const timeline = useTimelineSelectionStore(isolatedTimeline);
    const { pages } = useTimingObjects()!;
    if (!timeline) return null;
    const count = timeline.marcherIds.size;
    return (
        <div
            data-testid="timeline-isolation-bar"
            role="status"
            className="border-accent bg-bg-1 text-text rounded-6 text-sub pointer-events-auto absolute top-8 left-1/2 z-10 flex max-w-[calc(100%-32px)] -translate-x-1/2 items-center gap-12 border px-12 py-6 whitespace-nowrap shadow-md"
        >
            <span className="text-accent font-medium">Isolated</span>
            <span>
                {isolatedTimelineName(timeline, pages)} · {count}{" "}
                {count === 1 ? "marcher" : "marchers"}
            </span>
            <span className="text-text-subtitle flex min-w-0 items-center gap-4 truncate text-[11px]">
                <svg width="20" height="6" aria-hidden="true">
                    <line
                        x1="0"
                        y1="3"
                        x2="20"
                        y2="3"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeDasharray="2 4"
                    />
                </svg>
                <span className="truncate">
                    where this move would take marchers who left it
                </span>
            </span>
            <Button
                size="compact"
                variant="secondary"
                onClick={() =>
                    useTimelineSelectionStore.getState().exitIsolation()
                }
            >
                Done (Esc)
            </Button>
        </div>
    );
}
