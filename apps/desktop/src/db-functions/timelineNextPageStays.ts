import { createResolver, type XY } from "@openmarch/core";
import { readTimelineTables } from "@/timeline/timelineRows";
import type { DbTransaction } from "./types";
import { readPageGrid } from "./timelineRipple";
import { FIRST_PAGE_ID } from "./rowMappers";
import { samePosition } from "./timelineMoves";
import { setAsShownOnPageInTransaction } from "./timelineSetAsShown";

/**
 * Keeps the page after an edit where it was, for an edit that takes a spot back: **Remove
 * keyframe** (#304) and **Clear Page N** (#573). Read the spots before the edit
 * (`readNextPageSpots`), then, after it, give each marcher that would otherwise move there a move
 * of its own back to its old spot (`keepNextPageInTransaction`, Set as shown with `at`). That move
 * walks somewhere, so its end is a keyframe like any other (holds decision 15), and the pages
 * after it follow it. Without this step the later pages follow back to the earlier spot (**…,
 * Pages N–M follow back**).
 */

/** The first page box starting on or after `beat`, or null past the last page. */
export async function nextPageBox(
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

/** The page box after `beat` and where each marcher stands at its end, before an edit. */
export interface NextPageSpots {
    readonly box: { start: number; end: number };
    readonly before: ReadonlyMap<number, XY>;
}

/** `marcherIds`' spots at the end of the page box starting at or after `beat`; null past the end. */
export async function readNextPageSpots(
    tx: DbTransaction,
    beat: number,
    marcherIds: readonly number[],
): Promise<NextPageSpots | null> {
    if (marcherIds.length === 0) return null;
    const box = await nextPageBox(tx, beat);
    if (!box) return null;
    const resolver = createResolver((await readTimelineTables(tx)).snapshot);
    return {
        box,
        before: new Map(
            marcherIds.map((id) => [id, resolver.positionAt(id, box.end)]),
        ),
    };
}

/**
 * After the edit: the marchers in `spots` that now stand elsewhere at the next page's end get a
 * move of their own over it, back to their old spot, unless in `except`. Marchers Set or Held
 * there are left alone (`setAsShownOnPageInTransaction`).
 *
 * @returns the marchers given a move, ascending
 */
export async function keepNextPageInTransaction(
    tx: DbTransaction,
    spots: NextPageSpots | null,
    except: ReadonlySet<number> = new Set(),
): Promise<number[]> {
    if (!spots) return [];
    const resolver = createResolver((await readTimelineTables(tx)).snapshot);
    const at = new Map<number, XY>();
    for (const [id, spot] of spots.before)
        if (
            !except.has(id) &&
            !samePosition(spot, resolver.positionAt(id, spots.box.end))
        )
            at.set(id, spot);
    if (at.size === 0) return [];
    const { changed } = await setAsShownOnPageInTransaction({
        tx,
        pageBox: spots.box,
        marcherIds: [...at.keys()],
        at,
    });
    return changed;
}
