import { asc } from "drizzle-orm";
import { schema } from "@/global/database/db";
import {
    continuedCounts,
    countContinuation,
    countsToReach,
    type CountContinuation,
} from "@/timeline/showLength";
import { createBeatsInTransaction } from "./beat";
import { createMeasuresInTransaction } from "./measures";
import { ensureSecondBeatHasPage, FIRST_PAGE_ID } from "./page";
import { addPageFlagInTransaction, type AddedPageFlag } from "./pageFlags";
import { readPageGrid, withTimelinePageRipple } from "./timelineRipple";
import { refuse } from "./timelineErrors";
import { transactionWithHistory } from "./history";
import type { DbConnection, DbTransaction } from "./types";

/**
 * Counts after the end of the show (tempo experiment E1, "a show is as long as its music").
 *
 * Both edits append counts after the show's last count, continuing its last tempo and meter
 * (`countContinuation`): measure lines carry on with appended counts, and nothing else changes.
 * The append runs inside `withTimelinePageRipple`, like every beat edit, but nothing lies after
 * the end of the show, so no timeline row moves (the last page grows only where its flag was
 * already past the show's last count). Each is one undoable edit.
 */

/** `countContinuation` for the show in `tx`, and the show's end in seconds */
async function readContinuation(tx: DbTransaction): Promise<{
    continuation: CountContinuation;
    beatCount: number;
    endSeconds: number;
}> {
    const beats = await tx
        .select({ id: schema.beats.id, duration: schema.beats.duration })
        .from(schema.beats)
        .orderBy(asc(schema.beats.position), asc(schema.beats.id))
        .all();
    const ordinal = new Map(beats.map((b, i) => [b.id, i]));
    const measures = await tx
        .select({ startBeat: schema.measures.start_beat })
        .from(schema.measures)
        .all();
    const measureStarts = measures.flatMap((m) => {
        const index = ordinal.get(m.startBeat);
        return index === undefined ? [] : [index];
    });
    return {
        continuation: countContinuation({ beats, measureStarts }),
        beatCount: beats.length,
        endSeconds: beats.reduce((sum, b) => sum + b.duration, 0),
    };
}

/**
 * Appends `counts` counts after the show's last count, continuing its tempo and meter, with a
 * measure line on each appended count that starts a measure. Call it inside a
 * `transactionWithHistory`. Returns the show's beat count afterwards (beat 0 included).
 */
export async function appendCountsInTransaction({
    tx,
    counts,
}: {
    tx: DbTransaction;
    counts: number;
}): Promise<number> {
    if (!Number.isInteger(counts) || counts < 0)
        refuse(`can't add ${counts} counts: it must be a whole number`);
    const { continuation, beatCount } = await readContinuation(tx);
    if (counts === 0) return beatCount;
    const appended = continuedCounts(continuation, counts);
    await withTimelinePageRipple(tx, async () => {
        const created = await createBeatsInTransaction({
            tx,
            newBeats: appended.map((count) => ({
                duration: count.duration,
                include_in_measure: true,
            })),
        });
        const downbeats = appended.flatMap((count, k) =>
            count.downbeat && created[k] ? [created[k].id] : [],
        );
        if (downbeats.length > 0)
            await createMeasuresInTransaction({
                tx,
                newItems: downbeats.map((start_beat) => ({
                    start_beat,
                    rehearsal_mark: null,
                    notes: null,
                })),
            });
        // A show with no counts gets its first page with its first count
        await ensureSecondBeatHasPage({ tx });
    });
    return beatCount + counts;
}

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
 * **+ N counts** after the last page (E1), inside a `transactionWithHistory`: a new last page of
 * `counts` counts after the last page's flag, with counts appended where the show ends before its
 * flag (all of them when the show ends at its last flag, the usual case). Nothing lies after the
 * end of the show, so it is never refused for the drill. Its flag is added as **+** adds one
 * (`addPageFlagInTransaction`), so it refuses outside timeline mode. Returns the new page and its
 * range, which the UI selects.
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
    const { beatCount } = await readContinuation(tx);
    const flag = (await lastFlagBeat(tx)) + counts;
    await appendCountsInTransaction({
        tx,
        counts: Math.max(0, flag - beatCount),
    });
    return await addPageFlagInTransaction({ tx, beat: flag });
}

/** **+ N counts** (E1) as one undoable edit. See `appendPageOfCountsInTransaction`. */
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
 * **Extend counts to the end** (E1), inside a `transactionWithHistory`: appends counts until the
 * show lasts until `untilSeconds` (the end of the music on the show's clock), finishing the last
 * measure (`countsToReach`). No page flag is added. Returns how many counts were added (0 when
 * the show already lasts that long).
 */
export async function extendCountsToInTransaction({
    tx,
    untilSeconds,
}: {
    tx: DbTransaction;
    untilSeconds: number;
}): Promise<number> {
    if (!Number.isFinite(untilSeconds))
        refuse(`can't extend the show to ${untilSeconds} seconds`);
    const { continuation, endSeconds } = await readContinuation(tx);
    const counts = countsToReach({ continuation, endSeconds, untilSeconds });
    await appendCountsInTransaction({ tx, counts });
    return counts;
}

/** **Extend counts to the end** (E1) as one undoable edit. See `extendCountsToInTransaction`. */
export async function extendCountsTo({
    db,
    untilSeconds,
}: {
    db: DbConnection;
    untilSeconds: number;
}): Promise<number> {
    // An edit that writes nothing would leave an empty undo step (and history refuses it)
    const { continuation, endSeconds } = await db.transaction(readContinuation);
    if (countsToReach({ continuation, endSeconds, untilSeconds }) === 0)
        return 0;
    return await transactionWithHistory(
        db,
        "extendCountsTo",
        async (tx) => await extendCountsToInTransaction({ tx, untilSeconds }),
    );
}
