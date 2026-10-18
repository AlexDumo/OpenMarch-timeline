import { schema } from "@/global/database/db";
import { pageFlagsToEnd } from "@/timeline/countsPastEnd";
import { FIRST_PAGE_ID } from "./page";
import { addPageFlagInTransaction, type AddedPageFlag } from "./pageFlags";
import { readPageGrid } from "./timelineRipple";
import { refuse } from "./timelineErrors";
import { transactionWithHistory } from "./history";
import type { DbConnection, DbTransaction } from "./types";

/**
 * Pages after the last one (endless counts: docs/timeline/endless-counts.md): **+ N counts**, and
 * "Create pages every N counts to the end" of the music.
 *
 * The counts go on past the last stored one, so both edits only add page flags; each flag stores
 * the counts up to it (`addPageFlagInTransaction` calls `ensureCountsInTransaction`), continuing
 * the last measure. Timeline rows hold plain count numbers, so no row moves: neither is ever
 * refused for the drill. Each is one undoable edit.
 */

/** Where the last page's flag is, as an ordinal: past the show's last count where the show ends first */
async function lastFlagBeat(tx: DbTransaction): Promise<number> {
    const grid = await readPageGrid(tx);
    const last = grid.pages[grid.pages.length - 1];
    if (!last) return 1;
    if (last.id === FIRST_PAGE_ID) return last.end;
    const utility = await tx
        .select({ lastPageCounts: schema.utility.last_page_counts })
        .from(schema.utility)
        .get();
    return Math.max(last.end, last.start + (utility?.lastPageCounts ?? 0));
}

/**
 * **+ N counts** after the last page, inside a `transactionWithHistory`: a new last page of
 * `counts` counts after the last page's flag, storing the counts it needs. Its flag is added as
 * **+** adds one (`addPageFlagInTransaction`). Returns the new page and its range, which the UI
 * selects.
 */
export async function appendPageOfCountsInTransaction({
    tx,
    counts,
}: {
    tx: DbTransaction;
    counts: number;
}): Promise<AddedPageFlag> {
    if (!Number.isInteger(counts) || counts < 1)
        refuse(`can't add a page of ${counts} counts`);
    const flag = (await lastFlagBeat(tx)) + counts;
    return await addPageFlagInTransaction({ tx, beat: flag });
}

/** **+ N counts** as one undoable edit. See `appendPageOfCountsInTransaction`. */
export async function appendPageOfCounts({
    db,
    counts,
}: {
    db: DbConnection;
    counts: number;
}): Promise<AddedPageFlag> {
    return await transactionWithHistory(
        db,
        "appendPageOfCounts",
        async (tx) => await appendPageOfCountsInTransaction({ tx, counts }),
    );
}

/**
 * **Pages every N counts to the end of the music** (EC-10), inside a `transactionWithHistory`: a
 * flag every `counts` counts after the last page's flag up to `untilBeat` (the first whole count at
 * or after the music's end), with a shorter last page for the rest (`pageFlagsToEnd`). Each flag
 * is added as **+** adds one, storing the counts up to it. Returns the pages added (0 when the
 * last flag is already there).
 */
export async function appendPagesToEndInTransaction({
    tx,
    counts,
    untilBeat,
}: {
    tx: DbTransaction;
    counts: number;
    untilBeat: number;
}): Promise<number> {
    if (!Number.isInteger(counts) || counts < 1)
        refuse(`can't add pages every ${counts} counts`);
    const flags = pageFlagsToEnd(
        await lastFlagBeat(tx),
        Math.floor(untilBeat),
        counts,
    );
    for (const beat of flags) await addPageFlagInTransaction({ tx, beat });
    return flags.length;
}

/** **Pages every N counts to the end of the music** (EC-10) as one undoable edit */
export async function appendPagesToEnd({
    db,
    counts,
    untilBeat,
}: {
    db: DbConnection;
    counts: number;
    untilBeat: number;
}): Promise<number> {
    const last = await db.transaction(lastFlagBeat);
    if (pageFlagsToEnd(last, Math.floor(untilBeat), counts).length === 0)
        return 0;
    return await transactionWithHistory(
        db,
        "appendPagesToEnd",
        async (tx) =>
            await appendPagesToEndInTransaction({ tx, counts, untilBeat }),
    );
}
