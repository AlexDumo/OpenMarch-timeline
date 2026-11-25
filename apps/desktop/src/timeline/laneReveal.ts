/**
 * A cue added to a lane the user can't see shows itself (fork #1315): the timeline was dragged
 * short, so the lane sits below the fold, or the lane has only just appeared. The command that adds
 * the cue asks for its lane (`requestLaneReveal`) once the write lands; the lane, drawn with the
 * new cue, opens the timeline pane far enough to show itself, and scrolls the rest of the way
 * (`revealLane`).
 *
 * Only a request made by adding a cue reveals a lane, so opening a show never moves the timeline.
 */
import { useEffect, type RefObject } from "react";
import { create } from "zustand";
import { useUiSettingsStore } from "@/stores/UiSettingsStore";
import { maxTimelineHeight } from "@/components/timeline/timelineSplit";
import type { TimelineLaneId } from "./timelineLanes";

/** A request older than this is dropped: its lane was hidden, so the user didn't see it go */
const REQUEST_MS = 3000;

interface LaneRevealState {
    readonly lane: TimelineLaneId | null;
    readonly at: number;
}

export const useLaneRevealStore = create<LaneRevealState>(() => ({
    lane: null,
    at: 0,
}));

/** Asks lane `id` to show itself on the timeline the next time it draws */
export function requestLaneReveal(id: TimelineLaneId): void {
    useLaneRevealStore.setState({ lane: id, at: performance.now() });
}

/** Whether lane `id` has a request waiting, and takes it */
export function takeLaneReveal(id: TimelineLaneId): boolean {
    const { lane, at } = useLaneRevealStore.getState();
    if (lane !== id) return false;
    useLaneRevealStore.setState({ lane: null, at: 0 });
    return performance.now() - at < REQUEST_MS;
}

/**
 * How to bring a lane into view, in px, from where it and the timeline's scrolled view are on
 * screen: the pane's new height (null to leave it), and how far to scroll the view down (negative,
 * up) once it has grown. `paneHeight` is the height the user dragged the pane to, or null when it
 * fits its tracks (nothing to open). The lane's bottom comes into view; a lane taller than the
 * view shows its top.
 */
export function laneRevealPlan({
    laneTop,
    laneBottom,
    viewTop,
    viewBottom,
    paneHeight,
    maxPaneHeight,
}: {
    laneTop: number;
    laneBottom: number;
    viewTop: number;
    viewBottom: number;
    paneHeight: number | null;
    maxPaneHeight: number;
}): { paneHeight: number | null; scrollBy: number } {
    if (laneTop < viewTop)
        return { paneHeight: null, scrollBy: laneTop - viewTop };
    const below = laneBottom - viewBottom;
    if (below <= 0) return { paneHeight: null, scrollBy: 0 };
    const grown =
        paneHeight === null
            ? null
            : Math.max(paneHeight, Math.min(maxPaneHeight, paneHeight + below));
    const grew = grown === null ? 0 : grown - paneHeight!;
    // Growing the pane moves the view's top up and keeps its scroll: the lane stays where it is
    // under the top, and the view's bottom comes down to meet it
    const still = below - grew;
    const scrollBy = Math.max(0, Math.min(still, laneTop - viewTop + grew));
    return { paneHeight: grew > 0 ? grown : null, scrollBy };
}

/**
 * Brings `lane` (an element in the timeline's scrolled view) into view: opens the pane the user
 * dragged short, as far as the canvas allows, then scrolls the view the rest of the way.
 */
export function revealLane(lane: HTMLElement): void {
    const view = lane.closest<HTMLElement>('[data-testid="timeline-viewport"]');
    if (!view) return;
    const pane = lane.closest<HTMLElement>('[data-testid="timeline-pane"]');
    const { uiSettings, setTimelineHeight } = useUiSettingsStore.getState();
    const box = lane.getBoundingClientRect();
    const viewBox = view.getBoundingClientRect();
    // Under the page row and the ruler, which stay pinned to the top
    const pinned = parseFloat(view.style.scrollPaddingTop) || 0;
    const available = pane?.parentElement?.clientHeight ?? 0;
    const plan = laneRevealPlan({
        laneTop: box.top,
        laneBottom: box.bottom,
        viewTop: viewBox.top + view.clientTop + pinned,
        viewBottom: viewBox.top + view.clientTop + view.clientHeight,
        // A pane fitted to its tracks has nothing to open; one in Basic has no divider
        paneHeight:
            pane &&
            uiSettings.timelineHeight !== null &&
            pane.querySelector('[role="separator"]')
                ? pane.offsetHeight
                : null,
        maxPaneHeight: available > 0 ? maxTimelineHeight(available) : 0,
    });
    if (plan.paneHeight !== null) setTimelineHeight(plan.paneHeight);
    if (plan.scrollBy === 0) return;
    // After the pane has grown, so the scroll is measured against the taller view
    requestAnimationFrame(() => {
        view.scrollTop += plan.scrollBy;
    });
}

/**
 * Lane `id`'s side: once a request for it waits, and the lane has drawn, brings `ref`'s element
 * into view.
 */
export function useLaneReveal(
    id: TimelineLaneId,
    ref: RefObject<HTMLElement | null>,
): void {
    const waiting = useLaneRevealStore((s) => s.lane === id);
    useEffect(() => {
        if (!waiting) return;
        const frame = requestAnimationFrame(() => {
            if (ref.current && takeLaneReveal(id)) revealLane(ref.current);
        });
        return () => cancelAnimationFrame(frame);
    }, [waiting, id, ref]);
}
