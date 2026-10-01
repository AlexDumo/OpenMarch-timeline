import type {
    TimelineMarcherMove,
    TimelineMovePage,
} from "@/db-functions/timelineMoves";
import { pageEndBeat } from "./timelineCanvas";
import { useTimelineResolverStore } from "./timelineStore";

/**
 * The seam between the page-era coordinate tools and timeline writes in timeline mode
 * (docs/timeline/phases/07-page-parity.md P7.2). Canvas drag, nudges, snap, align, distribute,
 * flip, swap, circle, the line tool and the inspector's distribute buttons all compute new x/y
 * for the selected marchers on the selected page; in timeline mode they read the current x/y from
 * the resolver at the page's end beat (what the canvas draws) and write through
 * `moveMarchersOnPage`. With the flag off, nothing here runs.
 */

/** The x/y fields every page-era coordinate tool reads and writes. */
export interface MarcherXY {
    marcher_id: number;
    x: number;
    y: number;
}

/** The parts of a `Page` the timeline write path needs. */
export type TimelineWritePage = TimelineMovePage & { readonly id: number };

/** Thrown when timeline mode can't read positions because the resolver isn't ready yet. */
export class TimelineNotReadyError extends Error {
    constructor() {
        super("The timeline is still loading. Try again in a moment.");
        this.name = "TimelineNotReadyError";
    }
}

/**
 * `coordinates` with each x/y replaced by the resolver's position at the page's end beat, the
 * position the canvas draws in timeline mode. Other fields are kept, so `MarcherPage` objects can
 * go straight into the page-era helpers (`CoordinateActions`). Marchers the resolver doesn't know
 * are dropped.
 *
 * @throws TimelineNotReadyError when no resolver is ready
 */
export function withTimelinePositions<T extends MarcherXY>(
    page: TimelineMovePage,
    coordinates: readonly T[],
): T[] {
    const resolver = useTimelineResolverStore.getState().resolver;
    if (!resolver) throw new TimelineNotReadyError();
    const known = new Set(resolver.marcherIds());
    const beat = pageEndBeat(page);
    return coordinates
        .filter((c) => known.has(c.marcher_id))
        .map((c) => {
            const [x, y] = resolver.positionAt(c.marcher_id, beat);
            return { ...c, x, y };
        });
}

/** The timeline move for each changed coordinate. Any `page_id` on them is ignored. */
export const toTimelineMoves = (
    changes: readonly MarcherXY[],
): TimelineMarcherMove[] =>
    changes.map((c) => ({ marcherId: c.marcher_id, x: c.x, y: c.y }));

/** What a coordinate tool hands to the timeline write path: the page and its moves. */
export interface TimelineMoveRequest {
    page: TimelineWritePage;
    moves: TimelineMarcherMove[];
}

/**
 * The function the canvas calls when a drag or rotate ends (`OpenMarchCanvas.
 * updateMarcherPagesFunction`).
 *
 * - Flag off: `writePages` itself, so page mode is unchanged.
 * - Flag on: a function that writes the moves on `page`, the selected page. The canvas marchers'
 *   `coordinate.page_id` is not used: in timeline mode it can be left over from an earlier render.
 *   With no selected page, `onNoPage` runs instead (the canvas snaps the marchers back).
 */
export function canvasCoordinateWriter<A extends MarcherXY>({
    timelineMode,
    page,
    writePages,
    writeTimeline,
    onNoPage,
}: {
    timelineMode: boolean;
    page: TimelineWritePage | null | undefined;
    writePages: (changes: A[]) => void;
    writeTimeline: (request: TimelineMoveRequest) => void;
    onNoPage: () => void;
}): (changes: A[]) => void {
    if (!timelineMode) return writePages;
    return (changes) => {
        if (!page) {
            onNoPage();
            return;
        }
        writeTimeline({ page, moves: toTimelineMoves(changes) });
    };
}
