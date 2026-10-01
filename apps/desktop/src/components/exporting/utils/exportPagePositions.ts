import type MarcherPage from "@/global/classes/MarcherPage";
import type { DbConnection } from "@/db-functions/types";
import { withTimelineWriteLock } from "@/db-functions/history";
import {
    isTimelineModeEnabled,
    workspaceSettingsSchema,
} from "@/settings/workspaceSettings";
import {
    readTimelinePageSnapshot,
    sampleTimelinePagePositions,
} from "@/timeline/timelinePagePositions";

/**
 * Page positions for the coordinate sheet and drill chart exports
 * (docs/timeline/phases/07-page-parity.md P7.7).
 *
 * In page mode the exports keep reading `marcher_pages` through the existing queries. In
 * timeline mode those rows are frozen page-era data, so the exports take each marcher's position
 * on each page from the resolver at the page's end beat instead. Only x and y exist there: the
 * per-page appearance, rotation and notes of `marcher_pages` are dropped in timeline mode (P7.14).
 */

/** A marcher's position on a page: what the exports read from a `marcher_pages` row. */
export type PagePosition = Pick<
    MarcherPage,
    "marcher_id" | "page_id" | "x" | "y"
>;

/**
 * Positions indexed both ways, with the same shape as `MarcherPageMap`, so a page-mode
 * `MarcherPageMap` can be passed wherever this is expected.
 */
export interface PagePositionMap<T extends PagePosition = PagePosition> {
    /** marcher id → page id → position */
    marcherPagesByMarcher: Record<number, Record<number, T>>;
    /** page id → marcher id → position */
    marcherPagesByPage: Record<number, Record<number, T>>;
}

/** Indexes positions by marcher and by page. A later row for the same pair wins. */
export function pagePositionMapFromRows<T extends PagePosition>(
    rows: readonly T[],
): PagePositionMap<T> {
    const marcherPagesByMarcher: Record<number, Record<number, T>> = {};
    const marcherPagesByPage: Record<number, Record<number, T>> = {};
    for (const row of rows) {
        (marcherPagesByMarcher[row.marcher_id] ??= {})[row.page_id] = row;
        (marcherPagesByPage[row.page_id] ??= {})[row.marcher_id] = row;
    }
    return { marcherPagesByMarcher, marcherPagesByPage };
}

/**
 * One marcher's positions, sorted by page order. Positions on pages missing from `pages` sort
 * first, as the page-mode sheet export always did (`order ?? 0`).
 */
export function positionsForMarcherInPageOrder<T extends PagePosition>(
    map: Pick<PagePositionMap<T>, "marcherPagesByMarcher">,
    marcherId: number,
    pages: readonly { id: number; order: number }[],
): T[] {
    const orderById = new Map(pages.map((page) => [page.id, page.order]));
    return Object.values(map.marcherPagesByMarcher[marcherId] ?? {}).sort(
        (a, b) =>
            (orderById.get(a.page_id) ?? 0) - (orderById.get(b.page_id) ?? 0),
    );
}

async function readTimelineFlag(db: DbConnection): Promise<boolean> {
    const row = await db.query.workspace_settings.findFirst({
        columns: { json_data: true },
    });
    if (!row) return false;
    return isTimelineModeEnabled(
        workspaceSettingsSchema.parse(JSON.parse(row.json_data)),
    );
}

/**
 * In timeline mode, every marcher's position on every page, sampled from a private resolver at
 * each page's end beat; `null` in page mode, where the caller reads `marcher_pages` as before.
 *
 * The flag, the timeline tables and the pages are read inside one `withTimelineWriteLock`, so
 * they come from the same committed state; sampling runs after the lock is released, on the
 * private resolver, so a later edit can't change the export halfway. Never call it from inside a
 * wrapped write: it would wait for itself.
 */
export async function readTimelineExportPositions(
    db: DbConnection,
): Promise<PagePositionMap | null> {
    if (!(await readTimelineFlag(db))) return null;
    const snapshot = await withTimelineWriteLock(async () =>
        // The flag can change while the lock is awaited; the one read under it decides
        (await readTimelineFlag(db)) ? readTimelinePageSnapshot(db) : null,
    );
    if (!snapshot) return null;
    return pagePositionMapFromRows(await sampleTimelinePagePositions(snapshot));
}
