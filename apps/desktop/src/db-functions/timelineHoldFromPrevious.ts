import { eq, inArray } from "drizzle-orm";
import { schema } from "@/global/database/db";
import { marcherSimpleOnBox, type BasicRow } from "@/timeline/basicSimple";
import { countsText } from "@/timeline/timelineRangeWords";
import type { DbConnection, DbTransaction } from "./types";
import { transactionWithHistory } from "./history";
import { refuse } from "./timelineErrors";
import { readPageGrid } from "./timelineRipple";
import { readBasicRows } from "./basicRows";
import { clearOwnPageMoves, isPageBox } from "./timelineMoves";
import { readHeldMarks } from "./timelineHeldMarks";

/**
 * **Hold from previous page** on a page box, in timeline mode (holds, fork #472; holds README
 * decisions 2 and 3, review R3; ADR 0001 amendment 2026-10-30).
 *
 * For each selected marcher, the page box `[start, end)` becomes one **Held** hold
 * (`timeline_held_marks`) over this page only. It grows out of the move that arrives at the
 * previous page's flag (`start`), so the marcher stands where that page puts it, and a drag
 * inside the hold edits that arrival (`splitHeldEditsInTransaction`). Earlier pages are
 * untouched.
 *
 * - The marcher's own moves inside the box go first, as Basic's Set to previous page removes them:
 *   a converted page's shared slot is compacted (`clearOwnPageMoves` with `tidyShared`).
 * - A Held hold starting at `end` (the next page held from this page's arrival, which this
 *   removes) is taken into the new one, since touching holds are one hold.
 *
 * Left alone and reported, with why:
 * - `noArrival`: no move of the marcher ends at `start` (a borrowed hold, #474, or the first page);
 * - `held`: it is Held over some of the box already;
 * - `crossesFlag`: a move of its runs over one of the box's flags (taking it out of part of a move
 *   is #469's cut in time);
 * - `expertMoves`: its moves in the box overlap, or use a path Basic doesn't edit;
 * - `shape`: a shape or a placed shape's recipe holds it on this page (fork #436 decisions 6–14:
 *   skipped and named until #504).
 *
 * One undo step; a run that holds nobody opens no edit.
 */

/** Why Hold from previous page left a marcher alone. */
export type HoldFromPreviousSkipReason =
    | "noArrival"
    | "held"
    | "crossesFlag"
    | "expertMoves"
    | "shape";

/** A marcher Hold from previous page left alone, with why. */
export interface HoldFromPreviousSkip {
    marcherId: number;
    reason: HoldFromPreviousSkipReason;
}

/** What **Hold from previous page** did, marcher ids ascending. */
export interface HoldFromPreviousResult {
    /** The marchers now Held over the box */
    held: number[];
    /** The others, with why */
    skipped: HoldFromPreviousSkip[];
}

/** Thrown inside an edit that turned out to write nothing, so it rolls back with no undo step. */
class NothingToDo extends Error {
    constructor(readonly result: HoldFromPreviousResult) {
        super("nothing to hold");
    }
}

/**
 * **Hold from previous page**: each of `marcherIds` that can be is Held over the page box
 * `pageBox` (see the module comment). Refused (E-ARGS) when `pageBox` isn't a page's box.
 */
export async function holdFromPreviousPage({
    db,
    pageBox,
    marcherIds,
}: {
    db: DbConnection;
    pageBox: { start: number; end: number };
    marcherIds: readonly number[];
}): Promise<HoldFromPreviousResult> {
    if (marcherIds.length === 0) return { held: [], skipped: [] };
    try {
        return await transactionWithHistory(
            db,
            "holdFromPreviousPage",
            async (tx) => {
                const result = await holdFromPreviousPageInTransaction({
                    tx,
                    pageBox,
                    marcherIds,
                });
                if (result.held.length === 0) throw new NothingToDo(result);
                return result;
            },
        );
    } catch (e) {
        if (e instanceof NothingToDo) return e.result;
        throw e;
    }
}

/** `holdFromPreviousPage` inside the caller's edit. */
export async function holdFromPreviousPageInTransaction({
    tx,
    pageBox,
    marcherIds,
}: {
    tx: DbTransaction;
    pageBox: { start: number; end: number };
    marcherIds: readonly number[];
}): Promise<HoldFromPreviousResult> {
    const grid = await readPageGrid(tx);
    if (!isPageBox(grid, pageBox))
        refuse(
            `Hold from previous page works on a whole page, not ${countsText(pageBox, grid.pages.slice(1))}`,
        );
    const ids = [...new Set(marcherIds)].sort((x, y) => x - y);
    const rows = await readBasicRows(tx, { marcherIds: ids });
    const marks = await readHeldMarks(tx, ids);
    const inShapeRecipe = await marchersInRecipesOf(
        tx,
        rows.filter((r) => overlaps(r, pageBox)).map((r) => r.timelineId),
    );

    const result: HoldFromPreviousResult = { held: [], skipped: [] };
    const toRemove: number[] = [];
    const toJoin: number[] = [];
    for (const marcherId of ids) {
        const own = rows.filter((r) => r.marcherId === marcherId);
        const inBox = own.filter((r) => overlaps(r, pageBox));
        const ownMarks = marks.filter((m) => m.marcherId === marcherId);
        const reason = skipReason(
            pageBox,
            own,
            inBox,
            ownMarks,
            inShapeRecipe.get(marcherId),
        );
        if (reason) {
            result.skipped.push({ marcherId, reason });
            continue;
        }
        toRemove.push(...inBox.map((r) => r.assignmentId));
        const next = ownMarks.find((m) => m.start === pageBox.end);
        if (next) toJoin.push(next.id);
        result.held.push(marcherId);
    }
    if (result.held.length === 0) return result;

    if (toRemove.length > 0) {
        const a = schema.timeline_assignments;
        const removed = await tx
            .select()
            .from(a)
            .where(inArray(a.id, toRemove))
            .all();
        await clearOwnPageMoves(tx, removed, { tidyShared: true });
    }
    const h = schema.timeline_held_marks;
    const joined = new Map(
        marks
            .filter((m) => toJoin.includes(m.id))
            .map((m) => [m.marcherId, m.end]),
    );
    if (toJoin.length > 0) await tx.delete(h).where(inArray(h.id, toJoin));
    await tx.insert(h).values(
        result.held.map((marcherId) => ({
            marcher_id: marcherId,
            start_beat: pageBox.start,
            end_beat: joined.get(marcherId) ?? pageBox.end,
        })),
    );
    return result;
}

const overlaps = (row: BasicRow, box: { start: number; end: number }) =>
    row.start < box.end && row.end > box.start;

/** Why a marcher can't be Held over `box`, or null when it can. */
function skipReason(
    box: { start: number; end: number },
    rows: readonly BasicRow[],
    inBox: readonly BasicRow[],
    marks: readonly { start: number; end: number }[],
    inShapeRecipe: boolean | undefined,
): HoldFromPreviousSkipReason | null {
    if (marks.some((m) => m.start < box.end && box.start < m.end))
        return "held";
    const verdict = marcherSimpleOnBox(inBox, box);
    if (!verdict.simple) {
        if (verdict.reason === "crossesFlag") return "crossesFlag";
        if (verdict.reason === "shape") return "shape";
        return "expertMoves";
    }
    if (inShapeRecipe) return "shape";
    if (!rows.some((r) => r.end === box.start)) return "noArrival";
    return null;
}

/** The marchers a placed shape's recipe holds in any of `timelineIds`. */
async function marchersInRecipesOf(
    tx: DbTransaction,
    timelineIds: readonly number[],
): Promise<Map<number, boolean>> {
    if (timelineIds.length === 0) return new Map();
    const r = schema.timeline_shape_recipes;
    const m = schema.timeline_shape_recipe_marchers;
    const rows = await tx
        .select({ marcherId: m.marcher_id })
        .from(m)
        .innerJoin(r, eq(r.id, m.recipe_id))
        .where(inArray(r.timeline_id, [...new Set(timelineIds)]))
        .all();
    return new Map(rows.map((row) => [row.marcherId, true]));
}
