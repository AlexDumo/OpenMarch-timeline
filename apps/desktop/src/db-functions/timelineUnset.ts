import { and, eq, inArray } from "drizzle-orm";
import { createResolver, type XY } from "@openmarch/core";
import { schema } from "@/global/database/db";
import { readTimelineTables } from "@/timeline/timelineRows";
import type { DbConnection, DbTransaction } from "./types";
import { transactionWithHistory } from "./history";
import { readPageGrid } from "./timelineRipple";
import { FIRST_PAGE_ID } from "./rowMappers";
import { samePosition } from "./timelineMoves";
import { clearOwnPageMoves } from "./timelineMoveHelpers";
import { setAsShownOnPageInTransaction } from "./timelineSetAsShown";

/**
 * **Unset** (Set vs Following, #300): takes back the coordinate marchers have on one count, so
 * they follow from earlier there. Each marcher's moves ending on the count are deleted, with their
 * transitions and any timeline that leaves empty (`clearOwnPageMoves`).
 *
 * **Unset here** (#304) keeps the later pages that followed the deleted spot where they were: the
 * first page box starting on or after the count gets a move of the marcher's own, ending where it
 * stood there before the edit, for each marcher that follows there and would otherwise move
 * (Set as shown with `at`, as Only Page N writes it). That move walks somewhere, so its end is a
 * keyframe the designer can see and remove in turn (owner, 2026-10-20): an ordinary move (holds
 * decision 15). Pages after it follow it. **Unset here
 * and on Pages N–M** (#305) is the same delete without the stay (`keepLaterPages` false), so the
 * followers carry back to the earlier spot.
 *
 * Callers pass the marchers that are Set on the count (`timelineSetFollowing`); a marcher with no
 * move ending there is skipped. Nobody to unset writes nothing and adds no undo step.
 */

/** What an Unset did. */
export interface UnsetResult {
    /** The marchers whose coordinate on the count was deleted, ascending */
    unset: number[];
}

const ascending = (ids: Iterable<number>) =>
    [...new Set(ids)].sort((a, b) => a - b);

/** Thrown inside an edit that turned out to write nothing, so it rolls back with no undo step. */
class NothingToUnset extends Error {
    constructor(readonly result: UnsetResult) {
        super("nothing to unset");
    }
}

/**
 * Unset inside a caller's edit (see the module comment). With `tidyShared` (Basic), a shared
 * transition the delete leaves is compacted and one it empties is deleted, so Basic makes no
 * vacant slot; otherwise a slot in a shared move is left vacant (D-13).
 */
export async function unsetMarchersAtInTransaction({
    tx,
    beat,
    marcherIds,
    keepLaterPages,
    tidyShared = false,
}: {
    tx: DbTransaction;
    beat: number;
    marcherIds: readonly number[];
    keepLaterPages: boolean;
    tidyShared?: boolean;
}): Promise<UnsetResult> {
    const result: UnsetResult = { unset: [] };
    if (marcherIds.length === 0) return result;
    const a = schema.timeline_assignments;
    const rows = await tx
        .select()
        .from(a)
        .where(
            and(inArray(a.marcher_id, [...marcherIds]), eq(a.end_beat, beat)),
        )
        .all();
    if (rows.length === 0) return result;
    result.unset = ascending(rows.map((r) => r.marcher_id));

    // Where the later pages begin, and where each marcher stands there before the delete
    const box = keepLaterPages ? await nextPageBox(tx, beat) : null;
    const before = new Map<number, XY>();
    if (box) {
        const resolver = createResolver(
            (await readTimelineTables(tx)).snapshot,
        );
        for (const id of result.unset)
            before.set(id, resolver.positionAt(id, box.end));
    }

    await clearOwnPageMoves(tx, rows, { tidyShared });

    if (box) {
        const resolver = createResolver(
            (await readTimelineTables(tx)).snapshot,
        );
        const at = new Map<number, XY>();
        for (const [id, spot] of before)
            if (!samePosition(spot, resolver.positionAt(id, box.end)))
                at.set(id, spot);
        await setAsShownOnPageInTransaction({
            tx,
            pageBox: box,
            marcherIds: [...at.keys()],
            at,
        });
    }
    return result;
}

/** The first page box starting on or after `beat`, or null past the last page. */
async function nextPageBox(
    tx: DbTransaction,
    beat: number,
): Promise<{ start: number; end: number } | null> {
    const grid = await readPageGrid(tx);
    const next = grid.pages
        .filter((p) => p.id !== FIRST_PAGE_ID && p.start >= beat)
        .sort((x, y) => x.start - y.start)[0];
    return next && next.end > next.start
        ? { start: next.start, end: next.end }
        : null;
}

/**
 * **Unset here** as one undoable edit (`unsetMarchersAtInTransaction` with the stays), or with
 * `keepLaterPages` false **Unset here and on Pages N–M** (no stays: the followers carry back).
 */
export async function unsetMarchersAt({
    db,
    beat,
    marcherIds,
    keepLaterPages = true,
    tidyShared = false,
}: {
    db: DbConnection;
    beat: number;
    marcherIds: readonly number[];
    keepLaterPages?: boolean;
    tidyShared?: boolean;
}): Promise<UnsetResult> {
    try {
        return await transactionWithHistory(
            db,
            keepLaterPages ? "unsetMarchersAt" : "unsetMarchersAndFollowersAt",
            async (tx) => {
                const result = await unsetMarchersAtInTransaction({
                    tx,
                    beat,
                    marcherIds,
                    keepLaterPages,
                    tidyShared,
                });
                if (result.unset.length === 0) throw new NothingToUnset(result);
                return result;
            },
        );
    } catch (e) {
        if (e instanceof NothingToUnset) return e.result;
        throw e;
    }
}
