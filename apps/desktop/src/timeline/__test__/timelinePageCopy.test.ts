import { afterEach, describe, expect, it as plainIt } from "vitest";
import { and, eq, getTableName } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { DbConnection, describeDbTests, schema } from "@/test/base";
import { performRedo, performUndo } from "@/db-functions/history";
import {
    marcherPagesByPageId,
    updateMarcherPages,
} from "@/db-functions/marcherPage";
import { moveMarchersOnPage } from "@/db-functions/timelineMoves";
import type Page from "@/global/classes/Page";
import {
    convertPagesToTimeline,
    readShowTiming,
} from "../convert/writePageConversion";
import { pageEndBeat } from "../timelineCanvas";
import {
    copyPagePositions,
    TimelineNotReadyError,
} from "../timelineCoordinateWrites";
import {
    startTimelineResolver,
    stopTimelineResolver,
    timelineResolverSettled,
    useTimelineResolverStore,
} from "../timelineStore";

/**
 * "Set all or selected marchers to the previous or next page" in timeline mode
 * (docs/timeline/phases/07-page-parity.md P7.6), as `RegisteredActionsHandler` runs it: plan the
 * moves with `copyPagePositions` (resolver positions at the source page's end beat), then write them
 * with `moveMarchersOnPage` on the selected page, as one undoable edit.
 */

afterEach(() => stopTimelineResolver());

const sortedPages = async (db: DbConnection): Promise<Page[]> => {
    const { pages } = await readShowTiming(db);
    return [...pages].sort((a, b) => a.order - b.order);
};

const resolver = () => useTimelineResolverStore.getState().resolver!;
const positionAt = (marcherId: number, beat: number) =>
    resolver().positionAt(marcherId, beat);
const positionsAt = (beat: number) =>
    Object.fromEntries(
        resolver()
            .marcherIds()
            .map((id) => [id, positionAt(id, beat)]),
    );

const tableRows = async (
    db: DbConnection,
    tables: readonly SQLiteTable[],
): Promise<Record<string, unknown[]>> => {
    const out: Record<string, unknown[]> = {};
    for (const table of tables)
        out[getTableName(table)] = await db.select().from(table).all();
    return out;
};
const pageEraRows = (db: DbConnection) =>
    tableRows(db, [schema.marcher_pages, schema.pathways]);
const timelineRows = (db: DbConnection) =>
    tableRows(db, [
        schema.marchers,
        schema.timeline_transitions,
        schema.timeline_assignments,
        schema.timeline_slot_destinations,
    ]);

/** Deletes a marcher's assignment in the page move ending at `endBeat`, leaving its slot vacant. */
const deleteAssignmentEndingAt = async (
    db: DbConnection,
    marcherId: number,
    endBeat: number,
) => {
    const pageMove = await db
        .select()
        .from(schema.timeline_transitions)
        .where(eq(schema.timeline_transitions.end_beat, endBeat))
        .get();
    await db
        .delete(schema.timeline_assignments)
        .where(
            and(
                eq(schema.timeline_assignments.marcher_id, marcherId),
                eq(schema.timeline_assignments.transition_id, pageMove!.id),
            ),
        );
};

/** What the handler does: plan, then write the planned moves on `page` (if any). */
const copyAndWrite = async (
    db: DbConnection,
    page: Page,
    source: Page,
    marcherIds?: readonly number[],
) => {
    const copy = copyPagePositions({ page, source, marcherIds });
    if (copy.moves.length > 0)
        await moveMarchersOnPage({ db, page, moves: copy.moves });
    await timelineResolverSettled();
    return copy;
};

describe("copyPagePositions without a resolver", () => {
    plainIt("refuses to guess", () => {
        const page = { previousPageId: 1, beats: [{ index: 3 }] };
        expect(() =>
            copyPagePositions({
                page,
                source: { previousPageId: null, beats: [{ index: 0 }] },
            }),
        ).toThrow(TimelineNotReadyError);
    });
});

describeDbTests("set marchers to the previous or next page, flag off", (it) => {
    it("page mode is unchanged: copies the previous page's marcher_pages rows, no timeline row", async ({
        db,
        marchersAndPages: _,
    }) => {
        await convertPagesToTimeline(db);
        const pages = await sortedPages(db);
        const page = pages[3]!;
        const previous = await marcherPagesByPageId({
            db,
            pageId: pages[2]!.id,
        });
        const timelineBefore = await timelineRows(db);

        // RegisteredActionsHandler's setAllMarchersToPreviousPage with the flag off
        await updateMarcherPages({
            db,
            modifiedMarcherPages: previous.map((mp) => ({
                marcher_id: mp.marcher_id,
                page_id: page.id,
                x: mp.x,
                y: mp.y,
            })),
        });

        const after = await marcherPagesByPageId({ db, pageId: page.id });
        for (const mp of previous)
            expect(
                after.find((a) => a.marcher_id === mp.marcher_id),
            ).toMatchObject({ x: mp.x, y: mp.y });
        expect(await timelineRows(db)).toEqual(timelineBefore);
    });
});

describeDbTests("set marchers to the previous or next page, flag on", (it) => {
    it("all to previous: every marcher on the page takes its previous-page position, in one undoable edit", async ({
        db,
        marchersAndPages: _,
    }) => {
        await convertPagesToTimeline(db);
        await startTimelineResolver(db);
        const pages = await sortedPages(db);
        const page = pages[3]!;
        const previous = pages[2]!;
        const endBeat = pageEndBeat(page);
        const before = positionsAt(endBeat);
        const target = positionsAt(pageEndBeat(previous));
        const otherPages = pages
            .filter((p) => p !== page)
            .map((p) => [p, positionsAt(pageEndBeat(p))] as const);
        const pageEraBefore = await pageEraRows(db);
        expect(before).not.toEqual(target);

        const copy = await copyAndWrite(db, page, previous);

        expect(copy.marcherIds.sort()).toEqual(
            [...resolver().marcherIds()].sort(),
        );
        expect(positionsAt(endBeat)).toEqual(target);
        // Only the selected page's positions change, and marcher_pages is never touched
        for (const [p, positions] of otherPages)
            expect(positionsAt(pageEndBeat(p)), `page ${p.name}`).toEqual(
                positions,
            );
        expect(await pageEraRows(db)).toEqual(pageEraBefore);

        // One edit: one undo restores every marcher, redo applies it again
        const undo = await performUndo(db);
        expect(undo.success, undo.error?.message).toBe(true);
        await timelineResolverSettled();
        expect(positionsAt(endBeat)).toEqual(before);
        const redo = await performRedo(db);
        expect(redo.success, redo.error?.message).toBe(true);
        await timelineResolverSettled();
        expect(positionsAt(endBeat)).toEqual(target);
    });

    it("selected to next: only the selected marchers move, to their next-page positions", async ({
        db,
        marchersAndPages: _,
    }) => {
        await convertPagesToTimeline(db);
        await startTimelineResolver(db);
        const pages = await sortedPages(db);
        const page = pages[2]!;
        const next = pages[3]!;
        const endBeat = pageEndBeat(page);
        const before = positionsAt(endBeat);
        const target = positionsAt(pageEndBeat(next));

        // A marcher id the resolver doesn't know is dropped
        const copy = await copyAndWrite(db, page, next, [2, 5, 9999]);

        expect(copy.marcherIds).toEqual([2, 5]);
        const after = positionsAt(endBeat);
        for (const id of resolver().marcherIds())
            expect(after[id], `marcher ${id}`).toEqual(
                [2, 5].includes(id) ? target[id] : before[id],
            );
    });

    it("page 0 to next: sets the homes", async ({
        db,
        marchersAndPages: _,
    }) => {
        await convertPagesToTimeline(db);
        await startTimelineResolver(db);
        const pages = await sortedPages(db);
        const first = pages[0]!;
        expect(first.previousPageId).toBeNull();
        const target = positionsAt(pageEndBeat(pages[1]!));

        await copyAndWrite(db, first, pages[1]!, [1, 3]);

        const homes = await db.select().from(schema.marchers).all();
        for (const id of [1, 3]) {
            const marcher = homes.find((m) => m.id === id)!;
            expect([marcher.home_x, marcher.home_y]).toEqual(target[id]);
            expect(positionAt(id, pageEndBeat(first))).toEqual(target[id]);
        }
    });

    it("a marcher already at the source position gets no move, so a hold through the page isn't refused", async ({
        db,
        marchersAndPages: _,
    }) => {
        await convertPagesToTimeline(db);
        await startTimelineResolver(db);
        const pages = await sortedPages(db);
        const page = pages[3]!;
        const previous = pages[2]!;
        const endBeat = pageEndBeat(page);

        // Marcher 1 stops moving on this page: its assignment in the page's move goes (a vacant
        // slot), so it holds through the page and has no move ending at its end beat
        await deleteAssignmentEndingAt(db, 1, endBeat);
        await startTimelineResolver(db);
        expect(positionAt(1, endBeat)).toEqual(
            positionAt(1, pageEndBeat(previous)),
        );
        const target = positionsAt(pageEndBeat(previous));

        const copy = await copyAndWrite(db, page, previous);

        expect(copy.marcherIds).toContain(1);
        expect(copy.moves.map((m) => m.marcherId)).not.toContain(1);
        expect(positionsAt(endBeat)).toEqual(target);
    });

    it("nothing to move: no edit is written", async ({
        db,
        marchersAndPages: _,
    }) => {
        await convertPagesToTimeline(db);
        await startTimelineResolver(db);
        const pages = await sortedPages(db);
        const page = pages[3]!;
        const previous = pages[2]!;
        await copyAndWrite(db, page, previous, [4]);
        const history = await db.select().from(schema.history_undo).all();

        // Marcher 4 is already there
        const copy = await copyAndWrite(db, page, previous, [4]);

        expect(copy).toEqual({ marcherIds: [4], moves: [] });
        expect(await db.select().from(schema.history_undo).all()).toEqual(
            history,
        );
    });

    it("a marcher with no move ending at the page is refused, and nothing is written", async ({
        db,
        marchersAndPages: _,
    }) => {
        await convertPagesToTimeline(db);
        await startTimelineResolver(db);
        const pages = await sortedPages(db);
        const page = pages[3]!;
        const next = pages[4]!;
        const endBeat = pageEndBeat(page);
        // Marcher 1 holds through this page (its assignment in the page's move goes), but still
        // moves on the next page, so its next-page position differs and needs a move here
        await deleteAssignmentEndingAt(db, 1, endBeat);
        await startTimelineResolver(db);
        const before = positionsAt(endBeat);
        const history = await db.select().from(schema.history_undo).all();

        const copy = copyPagePositions({ page, source: next });
        expect(copy.moves.map((m) => m.marcherId)).toContain(1);
        await expect(
            moveMarchersOnPage({ db, page, moves: copy.moves }),
        ).rejects.toMatchObject({ code: "E-ARGS" });

        await timelineResolverSettled();
        expect(positionsAt(endBeat)).toEqual(before);
        expect(await db.select().from(schema.history_undo).all()).toEqual(
            history,
        );
    });
});
