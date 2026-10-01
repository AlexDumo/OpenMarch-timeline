import type { ChangeBatch, RowImage } from "@openmarch/core";
import { inArray } from "drizzle-orm";
import { DB, schema } from "../global/database/db";
import { DbConnection, DbTransaction } from "./types";
import {
    type GridPage,
    readPageGrid,
    timelineModeInTransaction,
} from "./timelineRipple";

/**
 * Where to look after an undo or redo in timeline mode (docs/timeline/phases/07-page-parity.md
 * P7.13).
 *
 * In page mode the app jumps to the page whose `marcher_pages` rows the action changed and selects
 * those marchers. In timeline mode those rows are frozen page-era data, so the same answer comes
 * from the action's committed change batch instead:
 *
 * - **Page of a change:** a marcher's home is where it stands on the first page. A transition,
 *   assignment or slot destination belongs to the page its move ends on: the page whose beats
 *   `(start, end]` hold the row's end beat, which is the page "move a marcher on page N" edits
 *   (D-16). A shape belongs to the pages of the transitions that end on it. Rows are read as they
 *   are after the action: the row image after it, or the one before it for a deleted row.
 * - **Marchers of a change:** the marcher whose home changed; the assignment's marcher; for a slot
 *   destination, the marcher in that slot; for a transition (or a shape), every marcher with an
 *   assignment in it, unless the batch also changes that transition's assignments or destinations,
 *   which then name the marchers (so a slot count grown for a new marcher selects only that
 *   marcher). Assignments the action deleted count too: the caller drops marchers that no longer
 *   exist, and undoing a marcher delete selects the restored marchers.
 * - **Page to show:** the current page if the action changed it, so undoing an edit on the page
 *   you are looking at doesn't move you; otherwise the earliest changed page, which is where a
 *   ripple or a marcher add begins.
 * - **Marchers to select:** the marchers changed on that page, or no change to the selection when
 *   there are none (for example a shape no transition uses).
 */

type Change = ChangeBatch["changes"][number];

export interface TimelineHistoryFocus {
    pageIdToGoTo: number | undefined;
    marcherIdsToSelect: Set<number> | undefined;
    /** Every changed page with its changed marchers, in show order */
    marcherIdsByPageId: Map<number, Set<number>>;
}

const NO_FOCUS = (): TimelineHistoryFocus => ({
    pageIdToGoTo: undefined,
    marcherIdsToSelect: undefined,
    marcherIdsByPageId: new Map(),
});

const num = (image: RowImage | null, key: string): number | undefined => {
    const value = image?.[key];
    return typeof value === "number" ? value : undefined;
};

/** The row as it is after the action: its image after it, or before it if it was deleted. */
const current = (change: Change): RowImage | null =>
    change.after ?? change.before;

/** The page whose beats `(start, end]` hold `endBeat`; the last page past the show's end. */
export const pageForEndBeat = (
    pages: readonly GridPage[],
    endBeat: number,
): GridPage | undefined =>
    pages.find((p) => p.start < endBeat && endBeat <= p.end) ??
    (pages.length > 0 && endBeat > pages[pages.length - 1]!.end
        ? pages[pages.length - 1]
        : pages[0]);

/**
 * Works out the page and marchers to show after an undo or redo whose committed batch is `batch`.
 *
 * Reads the page grid and the timeline rows as they are now; call it after the action commits,
 * under `withTimelineWriteLock` so no other edit runs in between.
 *
 * @param currentPageId the page the user is on, kept when the action changed it
 */
export async function timelineHistoryFocus(
    db: DbConnection | DB | DbTransaction,
    batch: ChangeBatch,
    currentPageId?: number,
): Promise<TimelineHistoryFocus> {
    if (batch.changes.length === 0) return NO_FOCUS();
    const reader = db as DbTransaction;
    const { pages } = await readPageGrid(reader);
    if (pages.length === 0) return NO_FOCUS();

    // What the batch says about transitions and assignments, so deleted rows still count
    const transitionEnd = new Map<number, number>();
    const batchAssignments: RowImage[] = [];
    const shapeIds = new Set<number>();
    const transitionIds = new Set<number>();
    /** Transitions whose assignments or destinations changed: those name the marchers */
    const transitionsWithSlotChanges = new Set<number>();
    for (const change of batch.changes) {
        const image = current(change);
        if (change.table === "transitions") {
            const end = num(image, "end");
            if (end !== undefined) transitionEnd.set(change.rowId, end);
            transitionIds.add(change.rowId);
        } else if (change.table === "assignments") {
            if (change.before) batchAssignments.push(change.before);
            if (change.after) batchAssignments.push(change.after);
            const transition = num(image, "transition");
            if (transition !== undefined) {
                transitionIds.add(transition);
                transitionsWithSlotChanges.add(transition);
            }
        } else if (change.table === "slot_destinations") {
            transitionIds.add(change.rowId);
            transitionsWithSlotChanges.add(change.rowId);
        } else if (change.table === "shapes") {
            shapeIds.add(change.rowId);
        }
    }

    // Transitions into a changed shape
    const shapeTransitions =
        shapeIds.size > 0
            ? await reader
                  .select({ id: schema.timeline_transitions.id })
                  .from(schema.timeline_transitions)
                  .where(
                      inArray(schema.timeline_transitions.dest_shape_id, [
                          ...shapeIds,
                      ]),
                  )
                  .all()
            : [];
    for (const { id } of shapeTransitions) transitionIds.add(id);

    // The rows as they are now, for transitions the batch only names
    const ids = [...transitionIds];
    const liveTransitions =
        ids.length > 0
            ? await reader
                  .select({
                      id: schema.timeline_transitions.id,
                      end: schema.timeline_transitions.end_beat,
                  })
                  .from(schema.timeline_transitions)
                  .where(inArray(schema.timeline_transitions.id, ids))
                  .all()
            : [];
    for (const t of liveTransitions) transitionEnd.set(t.id, t.end);
    const liveAssignments =
        ids.length > 0
            ? await reader
                  .select({
                      marcher: schema.timeline_assignments.marcher_id,
                      transition: schema.timeline_assignments.transition_id,
                      slot: schema.timeline_assignments.slot_index,
                  })
                  .from(schema.timeline_assignments)
                  .where(
                      inArray(schema.timeline_assignments.transition_id, ids),
                  )
                  .all()
            : [];

    /** Marchers with an assignment in `transitionId` (in `slot`, if given), now or in the batch */
    const marchersIn = (transitionId: number, slot?: number): number[] => {
        const out: number[] = [];
        for (const a of liveAssignments)
            if (
                a.transition === transitionId &&
                (slot === undefined || a.slot === slot)
            )
                out.push(a.marcher);
        for (const image of batchAssignments) {
            const marcher = num(image, "marcher");
            if (
                marcher !== undefined &&
                num(image, "transition") === transitionId &&
                (slot === undefined || num(image, "slot") === slot)
            )
                out.push(marcher);
        }
        return out;
    };

    const byPage = new Map<number, Set<number>>();
    const add = (page: GridPage | undefined, marchers: Iterable<number>) => {
        if (!page) return;
        const set = byPage.get(page.id) ?? new Set<number>();
        for (const m of marchers) set.add(m);
        byPage.set(page.id, set);
    };
    const addForTransition = (transitionId: number, marchers: number[]) => {
        const end = transitionEnd.get(transitionId);
        if (end !== undefined) add(pageForEndBeat(pages, end), marchers);
    };

    for (const change of batch.changes) {
        const image = current(change);
        switch (change.table) {
            case "marchers":
                add(pages[0], [change.rowId]);
                break;
            case "assignments": {
                const end = num(image, "end");
                const marcher = num(image, "marcher");
                if (end !== undefined)
                    add(
                        pageForEndBeat(pages, end),
                        marcher === undefined ? [] : [marcher],
                    );
                break;
            }
            case "transitions":
                // A slot count grown for a new marcher shouldn't select everyone in the move
                addForTransition(
                    change.rowId,
                    transitionsWithSlotChanges.has(change.rowId)
                        ? []
                        : marchersIn(change.rowId),
                );
                break;
            case "slot_destinations":
                addForTransition(
                    change.rowId,
                    marchersIn(change.rowId, num(image, "slot")),
                );
                break;
            case "shapes":
                for (const { id } of shapeTransitions)
                    addForTransition(id, marchersIn(id));
                break;
        }
    }
    // A shape-only change (to a shape no transition uses) has no page
    if (byPage.size === 0) return NO_FOCUS();

    const marcherIdsByPageId = new Map<number, Set<number>>();
    for (const page of pages) {
        const marchers = byPage.get(page.id);
        if (marchers) marcherIdsByPageId.set(page.id, marchers);
    }
    const pageIdToGoTo =
        currentPageId !== undefined && marcherIdsByPageId.has(currentPageId)
            ? currentPageId
            : marcherIdsByPageId.keys().next().value!;
    const marchers = marcherIdsByPageId.get(pageIdToGoTo)!;
    return {
        pageIdToGoTo,
        marcherIdsToSelect: marchers.size > 0 ? marchers : undefined,
        marcherIdsByPageId,
    };
}

/** Whether the file's timeline flag is on (read from `workspace_settings`). */
export const timelineModeOn = (db: DbConnection | DB | DbTransaction) =>
    timelineModeInTransaction(db as DbTransaction);
