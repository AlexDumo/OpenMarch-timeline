import { afterEach, describe, expect, it as plainIt } from "vitest";
import { eq } from "drizzle-orm";
import { DbConnection, describeDbTests, schema } from "@/test/base";
import type Page from "@/global/classes/Page";
import {
    convertPagesToTimeline,
    readShowTiming,
} from "@/timeline/convert/writePageConversion";
import { pageEndBeat } from "@/timeline/timelineCanvas";
import { createTimelineHost } from "@/timeline/timelineHost";
import { readTimelineTables } from "@/timeline/timelineRows";
import {
    startTimelineResolver,
    stopTimelineResolver,
    timelineResolverSettled,
    useTimelineResolverStore,
} from "@/timeline/timelineStore";
import {
    getUndoStackLength,
    performHistoryAction,
    performUndo,
    transactionWithHistory,
} from "../history";
import { deletePages } from "../page";
import { createMarchers } from "../marcher";
import { moveMarchersOnPage } from "../timelineMoves";
import { pageForEndBeat } from "../timelineHistoryFocus";

/**
 * Undo and redo in timeline mode (docs/timeline/phases/07-page-parity.md P7.13): the page to jump
 * to and the marchers to select come from the action's timeline change batch, and the resolver
 * store follows the action. On a converted `marchersAndPages` show: page 0 plus six pages, one
 * page move per page N ≥ 1.
 */

afterEach(() => stopTimelineResolver());

const setTimelineFlag = async (db: DbConnection, on: boolean) => {
    await db.delete(schema.workspace_settings);
    await db.insert(schema.workspace_settings).values({
        id: 1,
        json_data: JSON.stringify({ timelineMode: on }),
    });
};

/** Converts the show with the flag on (or off), starts the store, and returns the pages. */
const setUp = async (db: DbConnection, flag = true): Promise<Page[]> => {
    await setTimelineFlag(db, flag);
    await convertPagesToTimeline(db);
    await startTimelineResolver(db);
    const { pages } = await readShowTiming(db);
    return [...pages].sort((a, b) => a.order - b.order);
};

const marcherIds = async (db: DbConnection) =>
    (await db.select({ id: schema.marchers.id }).from(schema.marchers).all())
        .map((m) => m.id)
        .sort((a, b) => a - b);

/** The store's positions equal a fresh cold build's at every page end and mid-page. */
const expectStoreMatchesColdBuild = async (
    db: DbConnection,
    pages: readonly Page[],
) => {
    await timelineResolverSettled();
    const store = useTimelineResolverStore.getState().resolver;
    expect(store, "the resolver store is ready").not.toBeNull();
    const cold = createTimelineHost(await readTimelineTables(db)).resolver;
    expect([...store!.marcherIds()]).toEqual([...cold.marcherIds()]);
    const beats = pages.flatMap((p) => [pageEndBeat(p), pageEndBeat(p) - 0.5]);
    for (const id of cold.marcherIds())
        for (const beat of beats)
            expect(
                store!.positionAt(id, beat),
                `marcher ${id} at ${beat}`,
            ).toEqual(cold.positionAt(id, beat));
};

describeDbTests("undo and redo in timeline mode", (it) => {
    it("a move on page N: undo and redo go to page N and select the moved marchers", async ({
        db,
        marchersAndPages: _,
    }) => {
        const pages = await setUp(db);
        const [a, b] = await marcherIds(db);
        const page = pages[3]!;
        await moveMarchersOnPage({
            db,
            page,
            moves: [
                { marcherId: a!, x: 123.5, y: 45 },
                { marcherId: b!, x: -20, y: 70.25 },
            ],
        });
        await timelineResolverSettled();
        const moved = useTimelineResolverStore
            .getState()
            .resolver!.positionAt(a!, pageEndBeat(page));
        expect(moved).toEqual([123.5, 45]);

        const undo = await performHistoryAction("undo", db, {
            currentPageId: pages[0]!.id,
        });
        expect(undo.pageIdToGoTo).toBe(page.id);
        expect(undo.marcherIdsToSelect).toEqual(new Set([a, b]));
        // No timeline React Query keys to invalidate
        expect(
            undo.queriesToInvalidate!.some((key) =>
                String(key[0]).startsWith("timeline"),
            ),
        ).toBe(false);
        await expectStoreMatchesColdBuild(db, pages);
        expect(
            useTimelineResolverStore
                .getState()
                .resolver!.positionAt(a!, pageEndBeat(page)),
        ).not.toEqual(moved);

        const redo = await performHistoryAction("redo", db, {
            currentPageId: pages[1]!.id,
        });
        expect(redo.pageIdToGoTo).toBe(page.id);
        expect(redo.marcherIdsToSelect).toEqual(new Set([a, b]));
        await expectStoreMatchesColdBuild(db, pages);
        expect(
            useTimelineResolverStore
                .getState()
                .resolver!.positionAt(a!, pageEndBeat(page)),
        ).toEqual(moved);
    });

    it("stays on the current page when the action changed it", async ({
        db,
        marchersAndPages: _,
    }) => {
        const pages = await setUp(db);
        const [a] = await marcherIds(db);
        const page = pages[2]!;
        await moveMarchersOnPage({
            db,
            page,
            moves: [{ marcherId: a!, x: 1, y: 2 }],
        });
        const undo = await performHistoryAction("undo", db, {
            currentPageId: page.id,
        });
        expect(undo.pageIdToGoTo).toBe(page.id);
        expect(undo.marcherIdsToSelect).toEqual(new Set([a]));
    });

    it("a home move goes to the first page", async ({
        db,
        marchersAndPages: _,
    }) => {
        const pages = await setUp(db);
        const [, b] = await marcherIds(db);
        await moveMarchersOnPage({
            db,
            page: pages[0]!,
            moves: [{ marcherId: b!, x: 3, y: 4 }],
        });
        const undo = await performHistoryAction("undo", db, {
            currentPageId: pages[4]!.id,
        });
        expect(undo.pageIdToGoTo).toBe(pages[0]!.id);
        expect(undo.marcherIdsToSelect).toEqual(new Set([b]));
        await expectStoreMatchesColdBuild(db, pages);
    });

    it("a marcher add: undo and redo stay on the current page and select the new marcher", async ({
        db,
        marchersAndPages: _,
    }) => {
        const pages = await setUp(db);
        const [created] = await createMarchers({
            db,
            newMarchers: [
                { section: "Trumpet", drill_prefix: "N", drill_order: 1 },
            ],
            timelineMode: true,
        });
        const id = created!.id;

        // The add touched every page (a home and a slot in each page move)
        const undo = await performHistoryAction("undo", db, {
            currentPageId: pages[4]!.id,
        });
        expect(undo.pageIdToGoTo).toBe(pages[4]!.id);
        expect(undo.marcherIdsToSelect).toEqual(new Set([id]));
        await expectStoreMatchesColdBuild(db, pages);
        expect(
            useTimelineResolverStore.getState().resolver!.marcherIds(),
        ).not.toContain(id);

        // With no current page, the earliest changed page
        const redo = await performHistoryAction("redo", db);
        expect(redo.pageIdToGoTo).toBe(pages[0]!.id);
        expect(redo.marcherIdsToSelect).toEqual(new Set([id]));
        await expectStoreMatchesColdBuild(db, pages);
        expect(
            useTimelineResolverStore.getState().resolver!.marcherIds(),
        ).toContain(id);
    });

    it("a change to a move's path selects everyone in it, on its page", async ({
        db,
        marchersAndPages: _,
    }) => {
        const pages = await setUp(db);
        const page = pages[3]!;
        const t = schema.timeline_transitions;
        const transition = (await db.select().from(t).all()).find(
            (row) => row.end_beat === pageEndBeat(page),
        )!;
        await transactionWithHistory(db, "arcPageMove", async (tx) => {
            await tx
                .update(t)
                .set({ path_style: "arc", path_params: '{"bulge":0.2}' })
                .where(eq(t.id, transition.id))
                .run();
        });
        const assigned = new Set(
            (
                await db
                    .select({ marcher: schema.timeline_assignments.marcher_id })
                    .from(schema.timeline_assignments)
                    .where(
                        eq(
                            schema.timeline_assignments.transition_id,
                            transition.id,
                        ),
                    )
                    .all()
            ).map((r) => r.marcher),
        );
        expect(assigned.size).toBeGreaterThan(1);

        const undo = await performHistoryAction("undo", db, {
            currentPageId: pages[0]!.id,
        });
        expect(undo.pageIdToGoTo).toBe(page.id);
        expect(undo.marcherIdsToSelect).toEqual(assigned);
        await expectStoreMatchesColdBuild(db, pages);
    });

    it("a page delete (ripple): undo goes to the earliest changed page, redo to the page before it", async ({
        db,
        marchersAndPages: _,
    }) => {
        const pages = await setUp(db);
        const deleted = pages[3]!;
        const before = pages[2]!;
        await deletePages({ db, pageIds: new Set([deleted.id]) });
        await timelineResolverSettled();

        // The page before shrinks back and the deleted page's move returns
        const undo = await performHistoryAction("undo", db);
        expect(undo.pageIdToGoTo).toBe(before.id);
        expect(undo.marcherIdsToSelect?.size).toBeGreaterThan(0);
        await expectStoreMatchesColdBuild(db, pages);

        const onDeleted = await performHistoryAction("redo", db, {
            currentPageId: deleted.id,
        });
        // The deleted page is gone, so the page before it, which took its beats
        expect(onDeleted.pageIdToGoTo).toBe(before.id);
        const { pages: after } = await readShowTiming(db);
        await expectStoreMatchesColdBuild(
            db,
            [...after].sort((a, b) => a.order - b.order),
        );
    });

    it("with the flag off, the page-mode rule applies and timeline rows are ignored", async ({
        db,
        marchersAndPages: _,
    }) => {
        const pages = await setUp(db, false);
        const [a] = await marcherIds(db);
        await moveMarchersOnPage({
            db,
            page: pages[3]!,
            moves: [{ marcherId: a!, x: 9, y: 9 }],
        });
        const undo = await performHistoryAction("undo", db, {
            currentPageId: pages[0]!.id,
        });
        // Page mode looks only at marcher_pages statements; this action had none
        expect(undo.pageIdToGoTo).toBeUndefined();
        expect(undo.marcherIdsToSelect).toBeUndefined();
    });

    it("an empty undo stack changes nothing", async ({
        db,
        marchersAndPages: _,
    }) => {
        const pages = await setUp(db);
        while ((await getUndoStackLength(db)) > 0) await performUndo(db);
        const undo = await performHistoryAction("undo", db, {
            currentPageId: pages[2]!.id,
        });
        expect(undo.pageIdToGoTo).toBeUndefined();
        expect(undo.marcherIdsToSelect).toBeUndefined();
    });
});

describe("pageForEndBeat", () => {
    const pages = [
        { id: 0, start: 0, end: 1 },
        { id: 7, start: 1, end: 5 },
        { id: 3, start: 5, end: 9 },
    ];
    plainIt("finds the page whose beats (start, end] hold the end beat", () => {
        expect(pageForEndBeat(pages, 1)?.id).toBe(0);
        expect(pageForEndBeat(pages, 2)?.id).toBe(7);
        expect(pageForEndBeat(pages, 5)?.id).toBe(7);
        expect(pageForEndBeat(pages, 6)?.id).toBe(3);
        expect(pageForEndBeat(pages, 9)?.id).toBe(3);
    });
    plainIt(
        "past the show's end is the last page; at or before beat 0 the first",
        () => {
            expect(pageForEndBeat(pages, 40)?.id).toBe(3);
            expect(pageForEndBeat(pages, 0)?.id).toBe(0);
            expect(pageForEndBeat([], 3)).toBeUndefined();
        },
    );
});
