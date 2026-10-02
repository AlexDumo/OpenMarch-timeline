import type { ModifiedMarcherPageArgs } from "@/db-functions/marcherPage";
import type { TimelineMarcherMove } from "@/db-functions/timelineMoves";
import type { MarcherPagesByMarcher } from "@/global/classes/MarcherPageIndex";
import type Page from "@/global/classes/Page";
import { getNextPage, getPreviousPage } from "@/global/classes/Page";
import {
    normalizePlayheadBeat,
    type StoredTimelineMembership,
} from "@/stores/TimelineSelectionStore";
import {
    TimelineNotReadyError,
    timelinePositionsSettled,
    type TimelineMoveRequest,
    type TimelineWritePage,
} from "@/timeline/timelineCoordinateWrites";
import { toastTimelineError } from "@/timeline/timelineErrorMessages";
import { pageAtPlayhead, pageFlags } from "@/timeline/timelinePlayhead";
import { useTimelineResolverStore } from "@/timeline/timelineStore";

/**
 * "Set all or selected marchers to the previous or next page", the four batch-edit actions in
 * `RegisteredActionsHandler`, as a plain function so both modes can be tested without React.
 *
 * - **Page mode** (unchanged): copies the neighbor page's `marcher_pages` rows to the selected page.
 * - **Timeline mode** (docs/timeline/ui.md UI-9 Page-relative tools; P7.6, P8.12): edits the
 *   **selected timeline**. Each marcher's ending in it is set to its position at the timeline's
 *   start (previous: a hold) or at the next flag after its end (next). "All" is every marcher in
 *   the timeline; "selected" is the selected marchers in it. Refused with no stored timeline
 *   selected. Waits for earlier timeline writes to reach the resolver, plans from the resolver,
 *   and writes the moves as one `moveMarchersOnPage` edit at the timeline's end beat.
 *   `marcher_pages` is never read. The success message shows only once the edit is written; a
 *   refused edit writes nothing and the write's own error handler shows why.
 */

export type NeighborPageDirection = "previous" | "next";
export type NeighborPageScope = "all" | "selected";

export interface SetMarchersToNeighborPageArgs {
    timelineMode: boolean;
    direction: NeighborPageDirection;
    scope: NeighborPageScope;
    /** Page mode: the selected page. Not read in timeline mode. */
    selectedPage: Page | null;
    /**
     * Timeline mode: the stored timeline the selection resolves to (`selectedStoredTimeline`), or
     * null with home, nothing or a range nobody is in yet. Not read in page mode.
     */
    selectedTimeline: StoredTimelineMembership | null;
    pages: Page[];
    selectedMarcherIds: readonly number[];
    /** Page mode only: the neighbor page's rows by marcher id. Not read in timeline mode. */
    neighborMarcherPages: MarcherPagesByMarcher | undefined;
    /** Page mode's write (`updateMarcherPages`) */
    writePages: (changes: ModifiedMarcherPageArgs[]) => void;
    /**
     * Timeline mode's write (`moveMarchersOnPage`'s `mutateAsync`). It rejects when the edit is
     * refused, after its own error handler has shown the reason.
     */
    writeTimeline: (request: TimelineMoveRequest) => Promise<unknown>;
    notify: {
        success: (message: string) => unknown;
        error: (message: string) => unknown;
    };
    t: (key: string, params?: Record<string, string | number>) => string;
    /** Shows a timeline planning error; `toastTimelineError` by default */
    reportError?: (error: unknown) => void;
}

const MESSAGES = {
    previous: {
        none: "actions.batchEdit.noPreviousPage",
        all: "actions.batchEdit.setAllToPreviousSuccess",
        selected: "actions.batchEdit.setSelectedToPreviousSuccess",
        param: "previousPage",
    },
    next: {
        none: "actions.batchEdit.noNextPage",
        all: "actions.batchEdit.setAllToNextSuccess",
        selected: "actions.batchEdit.setSelectedToNextSuccess",
        param: "nextPage",
    },
} as const;

/** Timeline mode's refusal with no stored timeline selected */
export const NO_TIMELINE_SELECTED_MESSAGE =
    "actions.batchEdit.noTimelineSelected";

/**
 * Where the moves are written: a page ending at the timeline's end beat, so `moveMarchersOnPage`
 * sets the endings of the marchers' moves there. Named after the page containing that beat.
 *
 * TODO(P8.15): write by the selected timeline's id once the canvas edits do, instead of by its
 * end beat.
 */
const timelineEndPage = (
    pages: readonly Page[],
    timeline: StoredTimelineMembership,
): TimelineWritePage | null => {
    const page = pageAtPlayhead(pages, timeline.end);
    if (!page) return null;
    return {
        id: page.id,
        name: page.name,
        previousPageId: page.previousPageId,
        beats: [{ index: timeline.end - 1 }],
    };
};

/**
 * Runs one of the four actions (see the module comment).
 *
 * @returns the number of marchers set, or null when nothing was set (no neighbor page, no
 *   timeline selected, nothing selected, a planning error or a refused write)
 */
export async function setMarchersToNeighborPage(
    args: SetMarchersToNeighborPageArgs,
): Promise<number | null> {
    return args.timelineMode
        ? setInSelectedTimeline(args)
        : setOnSelectedPage(args);
}

/** Page mode (unchanged). */
function setOnSelectedPage({
    direction,
    scope,
    selectedPage,
    pages,
    selectedMarcherIds,
    neighborMarcherPages,
    writePages,
    notify,
    t,
}: SetMarchersToNeighborPageArgs): number | null {
    if (!selectedPage) return null;
    const messages = MESSAGES[direction];
    const neighbor =
        direction === "previous"
            ? getPreviousPage(selectedPage, pages)
            : getNextPage(selectedPage, pages);
    if (!neighbor || !neighborMarcherPages) {
        notify.error(t(messages.none));
        return null;
    }
    const rows =
        scope === "all"
            ? Object.values(neighborMarcherPages)
            : selectedMarcherIds
                  .map((id) => neighborMarcherPages[id])
                  .filter(Boolean);
    if (scope === "selected" && rows.length === 0) return null;
    writePages(
        rows.map((marcherPage) => ({
            marcher_id: marcherPage.marcher_id,
            page_id: selectedPage.id,
            x: marcherPage.x as number,
            y: marcherPage.y as number,
            notes: marcherPage.notes || undefined,
        })),
    );
    notify.success(
        t(messages[scope], {
            count: rows.length,
            currentPage: selectedPage.name,
            [messages.param]: neighbor.name,
        }),
    );
    return rows.length;
}

/** Timeline mode (UI-9 Page-relative tools). */
// eslint-disable-next-line max-lines-per-function
async function setInSelectedTimeline({
    direction,
    scope,
    selectedTimeline: timeline,
    pages,
    selectedMarcherIds,
    writeTimeline,
    notify,
    t,
    reportError = (e) => toastTimelineError(e),
}: SetMarchersToNeighborPageArgs): Promise<number | null> {
    const messages = MESSAGES[direction];
    if (!timeline) {
        notify.error(t(NO_TIMELINE_SELECTED_MESSAGE));
        return null;
    }
    const sourceBeat =
        direction === "previous"
            ? timeline.start
            : pageFlags(pages).find((f) => f.flag > timeline.end)?.flag;
    const target = timelineEndPage(pages, timeline);
    if (sourceBeat === undefined || !target) {
        notify.error(t(messages.none));
        return null;
    }
    const marcherIds =
        scope === "all"
            ? [...timeline.marcherIds]
            : selectedMarcherIds.filter((id) => timeline.marcherIds.has(id));
    if (marcherIds.length === 0) return null;

    // A write still in flight (a nudge pressed just before) must reach the resolver first, or the
    // plan starts from stale positions
    await timelinePositionsSettled();
    const resolver = useTimelineResolverStore.getState().resolver;
    if (!resolver) {
        reportError(new TimelineNotReadyError());
        return null;
    }
    const known = new Set(resolver.marcherIds());
    const ids = marcherIds.filter((id) => known.has(id));
    // Marchers already at the source position get no move, so nothing is written for them
    const moves: TimelineMarcherMove[] = [];
    for (const marcherId of ids) {
        const [x, y] = resolver.positionAt(marcherId, sourceBeat);
        const [currentX, currentY] = resolver.positionAt(
            marcherId,
            timeline.end,
        );
        if (x !== currentX || y !== currentY) moves.push({ marcherId, x, y });
    }
    if (ids.length === 0) return null;
    if (moves.length > 0) {
        try {
            await writeTimeline({ page: target, moves });
        } catch {
            // Refused or failed: nothing was written, and the write's error handler said why
            return null;
        }
    }
    const neighbor = pageAtPlayhead(pages, normalizePlayheadBeat(sourceBeat));
    notify.success(
        t(messages[scope], {
            count: ids.length,
            currentPage: target.name ?? "",
            [messages.param]: neighbor?.name ?? "",
        }),
    );
    return ids.length;
}
