import type { Resolver } from "@openmarch/core";
import { withTimelineWriteLock } from "@/db-functions/history";
import type { DbConnection } from "@/db-functions/types";
import type Page from "@/global/classes/Page";
import { readShowTiming } from "./convert/writePageConversion";
import { pageEndBeat } from "./timelineCanvas";
import { timelinePositionsSettled } from "./timelineCoordinateWrites";
import { acquireExportResolver } from "./timelineExport";

/**
 * "Marchers on page N" for the exports that still speak in pages (docs/timeline/phases/
 * 07-page-parity.md P7.12): each marcher's position at page N's end beat, sampled from the
 * resolver, never read from `marcher_pages`. Page mode never calls these.
 */

/** One marcher's position on one page, in canvas pixels (the `marcher_pages` x/y units). */
export interface TimelinePagePosition {
    marcher_id: number;
    page_id: number;
    x: number;
    y: number;
}

/**
 * Every marcher the resolver knows, on every page, at the page's end beat (the position the
 * canvas draws for that page). Pages come out in the order given, marchers in resolver order.
 */
export function sampleTimelinePagePositions(
    resolver: Pick<Resolver, "marcherIds" | "positionAt">,
    pages: readonly Pick<Page, "id" | "beats">[],
): TimelinePagePosition[] {
    const marcherIds = resolver.marcherIds();
    const out: TimelinePagePosition[] = [];
    for (const page of pages) {
        const beat = pageEndBeat(page);
        for (const marcherId of marcherIds) {
            const [x, y] = resolver.positionAt(marcherId, beat);
            out.push({ marcher_id: marcherId, page_id: page.id, x, y });
        }
    }
    return out;
}

/**
 * Every marcher's position on every page of the open file, from a resolver cold-built for this
 * read (`acquireExportResolver`), so an edit made while the export runs can't change it halfway.
 *
 * It first waits for queued timeline writes to commit (`timelinePositionsSettled`), so a nudge
 * made just before the export is included. Then it reads the timeline tables and the page grid
 * under the write lock, so both come from the same moment. Never call it from inside a wrapped
 * write: it waits for the write lock.
 */
export async function readTimelinePagePositions(
    db: DbConnection,
): Promise<TimelinePagePosition[]> {
    await timelinePositionsSettled();
    const [resolver, { pages }] = await withTimelineWriteLock(() =>
        Promise.all([acquireExportResolver(db), readShowTiming(db)]),
    );
    return sampleTimelinePagePositions(resolver, pages);
}
