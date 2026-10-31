import { afterEach, expect, vi } from "vitest";
import { eq, getTableName } from "drizzle-orm";
import type { XY } from "@openmarch/core";
import { DbConnection, describeDbTests, schema } from "@/test/base";
import { mockNCAAFieldProperties } from "@/__mocks__/globalMocks";
import { FieldProperties } from "@openmarch/core";
import { performUndo, transactionWithHistory } from "@/db-functions/history";
import { createTimelineAssignmentsInTransaction } from "@/db-functions/timelineAssignments";
import {
    moveMarchersFromFlagInstead,
    moveMarchersInTarget,
    type TimelineMarcherMove,
} from "@/db-functions/timelineMoves";
import {
    createTimelinesInTransaction,
    deleteTimelinesInTransaction,
} from "@/db-functions/timelines";
import { createTimelineTransitionsInTransaction } from "@/db-functions/timelineTransitions";
import type Page from "@/global/classes/Page";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import {
    alignHorizontally,
    evenlyDistributeHorizontally,
} from "@/utilities/CoordinateActions";
import {
    setMarchersToNeighborPage,
    type NeighborPageDirection,
} from "@/utilities/setMarchersToNeighborPage";
import { keepFixturesInPageMode } from "@/test/timelineMode";
import { setAsShownOnPage } from "@/db-functions/timelineSetAsShown";
import {
    clearFollowingPages,
    clearPageFollowingLabel,
    clearPageLabel,
    clearPageMenu,
    clearPageScopedLabel,
} from "../timelineClearPage";
import type { PageBox } from "@/stores/TimelineSelectionStore";
import { useBasicLocksStore } from "../basicLocks";
import { moveMarchersAndOfferFollowUp } from "../timelineMoveThemToo";
import { readShowTiming } from "@/timeline/showTiming";
import { convertPagesToTimeline } from "@/test/convertPages";
import { pageEndBeat } from "../timelineCanvas";
import {
    neighborPageTarget,
    transformMarchersInSelection,
    type CanvasEditPlan,
    type TimelineNeighborPageRequest,
} from "../timelineCoordinateWrites";
import {
    startTimelineResolver,
    stopTimelineResolver,
    timelineResolverSettled,
    useTimelineResolverStore,
} from "../timelineStore";

// These tests write their own timeline rows and start the resolver themselves
keepFixturesInPageMode("its tests write timeline rows themselves");

/**
 * Timeline-mode writers under sparse rows (docs/timeline/research/defined-coordinates/README.md,
 * Recommendation 2, 3 and 5; 07a §3-4, 07c §1-2): a write that moves nobody writes nothing, a drag
 * back to where a page starts clears the marcher's own move there, set to previous and next page
 * work on pages the marchers only hold through, and the pass-through toast shows for every window
 * over a page flag.
 *
 * Every test starts from the `marchersAndPages` show with **no** timeline rows (the converted rows
 * are deleted), so marchers hold on their homes through every page, as a show built with the **+**
 * flag does, whether or not anything writes automatic stays. Page boxes: page 1 `[1, 9)`, page 2
 * `[9, 17)`, page 3 `[17, 25)`, page 4 `[25, 33)`.
 */

afterEach(() => {
    stopTimelineResolver();
    useTimelineSelectionStore.getState().reset();
});

const TABLES = [
    schema.marchers,
    schema.timelines,
    schema.timeline_transitions,
    schema.timeline_assignments,
    schema.timeline_slot_destinations,
];

const snapshot = async (db: DbConnection) => {
    const out: Record<string, unknown[]> = {};
    for (const table of TABLES)
        out[getTableName(table)] = await db.select().from(table).all();
    return out;
};

const undoRows = (db: DbConnection) =>
    db.select().from(schema.history_undo).all();

const resolver = () => useTimelineResolverStore.getState().resolver!;
const at = (marcherId: number, beat: number): XY => {
    const [x, y] = resolver().positionAt(marcherId, beat);
    return [x, y];
};

/** The homes the tests use: marchers 1-4 on one line, x 100, 150, 200 and 230. */
const HOMES: TimelineMarcherMove[] = [
    { marcherId: 1, x: 100, y: 100 },
    { marcherId: 2, x: 150, y: 100 },
    { marcherId: 3, x: 200, y: 100 },
    { marcherId: 4, x: 230, y: 100 },
];

/** Converts the show, deletes every timeline row and sets `HOMES`; returns pages in show order. */
const setUp = async (db: DbConnection): Promise<Page[]> => {
    await convertPagesToTimeline(db);
    await transactionWithHistory(db, "clearTimelines", async (tx) => {
        const ids = (
            await tx
                .select({ id: schema.timelines.id })
                .from(schema.timelines)
                .all()
        ).map((r) => r.id);
        await deleteTimelinesInTransaction({ tx, timelineIds: new Set(ids) });
    });
    await moveMarchersInTarget({ db, target: { kind: "home" }, moves: HOMES });
    await startTimelineResolver(db);
    const { pages } = await readShowTiming(db);
    return [...pages].sort((a, b) => a.order - b.order);
};

/** `page`'s box as a range target. */
const box = (page: Page) => {
    const target = neighborPageTarget(page);
    if (target.kind !== "range") throw new Error("not a page box");
    return target;
};

/** A canvas edit over `range`, as `planCanvasEdit` returns for a window selection. */
const planFor = (range: { start: number; end: number }): CanvasEditPlan => ({
    ok: true,
    target: { kind: "range", ...range },
    beat: range.end,
});

const move = async (
    db: DbConnection,
    range: { start: number; end: number },
    moves: TimelineMarcherMove[],
) => {
    const result = await moveMarchersInTarget({
        db,
        target: { kind: "range", ...range },
        moves,
    });
    await timelineResolverSettled();
    return result;
};

/** Every assignment of `marcherId`, as `[start, end, layer]`. */
const rowsOf = async (db: DbConnection, marcherId: number) =>
    (
        await db
            .select()
            .from(schema.timeline_assignments)
            .where(eq(schema.timeline_assignments.marcher_id, marcherId))
            .all()
    ).map((r) => [r.start_beat, r.end_beat, r.layer]);

const timelineCount = async (db: DbConnection) =>
    (await db.select().from(schema.timelines).all()).length;

const fieldProperties = new FieldProperties(mockNCAAFieldProperties);

/** English with the parameters filled in, as the labels' defaults read */
const english = (
    _key: string,
    defaultValue: string,
    params: Record<string, string> = {},
) =>
    defaultValue.replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? "");

describeDbTests("sparse timeline writes: no-op writes write nothing", (it) => {
    it("align on an inherited page writes no row for a marcher it leaves still, so an upstream edit still carries it (owner bug via align, 07a §3)", async ({
        db,
        marchersAndPages: _,
    }) => {
        const pages = await setUp(db);
        const page2 = box(pages[2]!);
        const page3 = box(pages[3]!);
        // Page 3 only holds; its marchers are on their homes. Align 1-3 horizontally there: the
        // average x is marcher 2's own, so it stays still
        const next = await transformMarchersInSelection({
            db,
            marcherIds: [1, 2, 3],
            transform: (current) =>
                alignHorizontally({ marcherPages: current }),
            plan: planFor(page3),
        });
        expect(next.find((c) => c.marcher_id === 2)).toMatchObject({ x: 150 });
        await timelineResolverSettled();
        expect(await rowsOf(db, 2), "marcher 2 got no row").toEqual([]);
        expect(await rowsOf(db, 1)).toEqual([[page3.start, page3.end, 0]]);
        expect(await rowsOf(db, 3)).toEqual([[page3.start, page3.end, 0]]);

        // An upstream edit on page 2 carries marcher 2 through page 3 and on
        await move(db, page2, [{ marcherId: 2, x: 160, y: 300 }]);
        expect(at(2, page3.end)).toEqual([160, 300]);
        expect(at(2, box(pages[4]!).end)).toEqual([160, 300]);
        // Marchers 1 and 3 keep their aligned page 3
        expect(at(1, page3.end)).toEqual([150, 100]);
        expect(at(3, page3.end)).toEqual([150, 100]);
    });

    it("distribute writes no row for the endpoints it keeps", async ({
        db,
        marchersAndPages: _,
    }) => {
        const pages = await setUp(db);
        const page3 = box(pages[3]!);
        await transformMarchersInSelection({
            db,
            marcherIds: [1, 2, 4],
            transform: (current) =>
                evenlyDistributeHorizontally({
                    marcherPages: current,
                    fieldProperties,
                }),
            plan: planFor(page3),
        });
        await timelineResolverSettled();
        expect(await rowsOf(db, 1)).toEqual([]);
        expect(await rowsOf(db, 4)).toEqual([]);
        expect(await rowsOf(db, 2)).toEqual([[page3.start, page3.end, 0]]);
        expect(at(2, page3.end)).toEqual([165, 100]);
    });

    it("a write that moves nobody creates no timeline and no undo step", async ({
        db,
        marchersAndPages: _,
    }) => {
        const pages = await setUp(db);
        const page3 = box(pages[3]!);
        const before = await snapshot(db);
        const history = await undoRows(db);

        const result = await move(db, page3, [
            { marcherId: 1, x: 100, y: 100 },
            // Within the tolerance of where it is
            { marcherId: 2, x: 150 + 1e-7, y: 100 - 1e-7 },
        ]);

        expect(result.slots).toEqual([]);
        expect(result.passThrough).toBeUndefined();
        expect(await snapshot(db)).toEqual(before);
        expect(await undoRows(db)).toEqual(history);
    });

    it("a marcher already in the window's timeline moved to where it is writes nothing for it", async ({
        db,
        marchersAndPages: _,
    }) => {
        const pages = await setUp(db);
        const page3 = box(pages[3]!);
        await move(db, page3, [
            { marcherId: 1, x: 120, y: 140 },
            { marcherId: 2, x: 170, y: 140 },
        ]);
        const before = await snapshot(db);
        const history = await undoRows(db);
        const result = await move(db, page3, [
            { marcherId: 1, x: 120, y: 140 },
            { marcherId: 2, x: 170, y: 140 },
        ]);
        expect(result.slots).toEqual([]);
        expect(await snapshot(db)).toEqual(before);
        expect(await undoRows(db)).toEqual(history);
    });
});

describeDbTests(
    "sparse timeline writes: a shape's members are all set where it's edited",
    (it) => {
        it("with setUnmoved, an edit that moves anyone writes a stay for the one it leaves still (the member at a shape's pivot)", async ({
            db,
            marchersAndPages: _,
        }) => {
            const pages = await setUp(db);
            const page3 = box(pages[3]!);
            await transformMarchersInSelection({
                db,
                marcherIds: [1, 2, 3],
                // Turned half way round marcher 2, which stays where it is
                transform: (current) =>
                    current.map((c) => ({ ...c, x: 300 - c.x })),
                plan: planFor(page3),
                setUnmoved: true,
            });
            await timelineResolverSettled();
            for (const id of [1, 2, 3])
                expect(await rowsOf(db, id), `marcher ${id}`).toEqual([
                    [page3.start, page3.end, 0],
                ]);
            expect(at(2, page3.end)).toEqual([150, 100]);
            expect(at(1, page3.end)).toEqual([200, 100]);
            expect(await rowsOf(db, 4)).toEqual([]);
        });

        it("with setUnmoved, an edit that moves nobody still writes nothing", async ({
            db,
            marchersAndPages: _,
        }) => {
            const pages = await setUp(db);
            const page3 = box(pages[3]!);
            const before = await snapshot(db);
            const history = await undoRows(db);
            await transformMarchersInSelection({
                db,
                marcherIds: [1, 2],
                transform: (current) => current,
                plan: planFor(page3),
                setUnmoved: true,
            });
            await timelineResolverSettled();
            expect(await snapshot(db)).toEqual(before);
            expect(await undoRows(db)).toEqual(history);
        });

        it("Basic's point writer writes a stay with keepUnchanged, and nothing without it", async ({
            db,
            marchersAndPages: _,
        }) => {
            const pages = await setUp(db);
            const page3 = box(pages[3]!);
            const target = {
                kind: "point" as const,
                beat: page3.end,
                box: { start: page3.start, end: page3.end },
            };
            const moves = [
                { marcherId: 1, x: 120, y: 140 },
                { marcherId: 2, x: 150, y: 100 },
            ];
            await moveMarchersInTarget({ db, target, moves });
            await timelineResolverSettled();
            expect(await rowsOf(db, 2)).toEqual([]);
            await moveMarchersInTarget({
                db,
                target,
                moves: [{ marcherId: 1, x: 130, y: 140 }, moves[1]!],
                keepUnchanged: true,
            });
            await timelineResolverSettled();
            expect(await rowsOf(db, 2)).toEqual([[page3.start, page3.end, 0]]);
            expect(at(2, page3.end)).toEqual([150, 100]);
        });

        it("a second edit with keepUnchanged keeps the stay the first wrote, in Basic's point writer and the range writer", async ({
            db,
            marchersAndPages: _,
        }) => {
            const pages = await setUp(db);
            const page3 = box(pages[3]!);
            const page4 = box(pages[4]!);
            const point = {
                kind: "point" as const,
                beat: page3.end,
                box: { start: page3.start, end: page3.end },
            };
            const still = { marcherId: 2, x: 150, y: 100 };
            for (const x of [130, 160])
                await moveMarchersInTarget({
                    db,
                    target: point,
                    moves: [{ marcherId: 1, x, y: 140 }, still],
                    keepUnchanged: true,
                });
            await timelineResolverSettled();
            expect(await rowsOf(db, 2)).toEqual([[page3.start, page3.end, 0]]);
            expect(at(1, page3.end)).toEqual([160, 140]);

            for (const x of [130, 160])
                await move(db, page4, [{ marcherId: 1, x, y: 180 }]).then(() =>
                    moveMarchersInTarget({
                        db,
                        target: { kind: "range", ...page4 },
                        moves: [{ marcherId: 1, x: x + 5, y: 180 }, still],
                        keepUnchanged: true,
                    }),
                );
            await timelineResolverSettled();
            expect(await rowsOf(db, 2)).toEqual([
                [page3.start, page3.end, 0],
                [page4.start, page4.end, 0],
            ]);
            expect(at(2, page4.end)).toEqual([150, 100]);
        });

        it("in Basic, a shape edit whose only mover is locked writes no stays for the others", async ({
            db,
            marchersAndPages: _,
        }) => {
            const pages = await setUp(db);
            const page3 = box(pages[3]!);
            useBasicLocksStore.setState({
                boxes: [{ start: page3.start, end: page3.end } as PageBox],
                locked: new Map([[0, new Map([[1, "shape" as never]])]]),
            });
            try {
                await moveMarchersAndOfferFollowUp({
                    database: db,
                    target: {
                        kind: "point",
                        beat: page3.end,
                        box: { start: page3.start, end: page3.end },
                    },
                    moves: [
                        { marcherId: 1, x: 130, y: 140 },
                        { marcherId: 2, x: 150, y: 100 },
                    ],
                    setUnmovedFrom: new Map([
                        [1, { x: 100, y: 100 }],
                        [2, { x: 150, y: 100 }],
                    ]),
                });
            } finally {
                useBasicLocksStore.setState({ boxes: [], locked: new Map() });
            }
            await timelineResolverSettled();
            expect(await rowsOf(db, 1)).toEqual([]);
            expect(await rowsOf(db, 2)).toEqual([]);
        });
    },
);

describeDbTests("sparse timeline writes: a drag back clears the move", (it) => {
    it("drag away and back on an inherited page deletes the move and its timeline, and the page follows again", async ({
        db,
        marchersAndPages: _,
    }) => {
        const pages = await setUp(db);
        const page2 = box(pages[2]!);
        const page3 = box(pages[3]!);
        const timelinesBefore = await timelineCount(db);
        await move(db, page3, [{ marcherId: 1, x: 300, y: 300 }]);
        expect(await rowsOf(db, 1)).toHaveLength(1);
        const away = await snapshot(db);

        const back = await move(db, page3, [{ marcherId: 1, x: 100, y: 100 }]);
        expect(back.cleared).toEqual([1]);
        expect(await rowsOf(db, 1)).toEqual([]);
        expect(await timelineCount(db), "the emptied timeline goes").toBe(
            timelinesBefore,
        );
        expect(at(1, page3.end)).toEqual([100, 100]);

        // One undo brings the move back
        const undo = await performUndo(db);
        expect(undo.success, undo.error?.message).toBe(true);
        expect(await snapshot(db)).toEqual(away);
        const redo = await moveMarchersInTarget({
            db,
            target: { kind: "range", ...page3 },
            moves: [{ marcherId: 1, x: 100, y: 100 }],
        });
        expect(redo.cleared).toEqual([1]);

        // Page 3 follows an upstream edit again
        await move(db, page2, [{ marcherId: 1, x: 50, y: 60 }]);
        expect(at(1, page3.end)).toEqual([50, 60]);
    });

    it("a drag back keeps the timeline while others are still in it", async ({
        db,
        marchersAndPages: _,
    }) => {
        const pages = await setUp(db);
        const page3 = box(pages[3]!);
        await move(db, page3, [
            { marcherId: 1, x: 300, y: 300 },
            { marcherId: 2, x: 310, y: 300 },
        ]);
        const timelines = await timelineCount(db);
        await move(db, page3, [{ marcherId: 1, x: 100, y: 100 }]);
        expect(await rowsOf(db, 1)).toEqual([]);
        expect(await rowsOf(db, 2)).toHaveLength(1);
        expect(await timelineCount(db)).toBe(timelines);
        expect(at(2, page3.end)).toEqual([310, 300]);
    });

    it("a zero-motion ending is kept in a window that isn't a page's box (cross-page window)", async ({
        db,
        marchersAndPages: _,
    }) => {
        const pages = await setUp(db);
        const window = { start: box(pages[2]!).start, end: box(pages[3]!).end };
        await move(db, window, [{ marcherId: 1, x: 300, y: 300 }]);
        const back = await move(db, window, [{ marcherId: 1, x: 100, y: 100 }]);
        expect(back.cleared).toBeUndefined();
        expect(await rowsOf(db, 1)).toEqual([[window.start, window.end, 0]]);
        expect(at(1, window.end)).toEqual([100, 100]);
    });

    it("a drag back in a transition shared with other marchers takes the marcher out of it, so the page is Not set (holds 16, M6)", async ({
        db,
        marchersAndPages: _,
    }) => {
        // The converted show: one shared transition per page
        await convertPagesToTimeline(db);
        await startTimelineResolver(db);
        const { pages: unsorted } = await readShowTiming(db);
        const pages = [...unsorted].sort((a, b) => a.order - b.order);
        const page3 = box(pages[3]!);
        const origin = at(5, page3.start);
        const others = at(6, page3.end);
        const back = await move(db, page3, [
            { marcherId: 5, x: origin[0], y: origin[1] },
        ]);
        expect(back.cleared).toEqual([5]);
        expect(
            (await rowsOf(db, 5)).filter(
                ([start, end]) => start! < page3.end && end! > page3.start,
            ),
        ).toEqual([]);
        expect(at(5, page3.end)).toEqual(origin);
        expect(at(6, page3.end)).toEqual(others);
    });

    it("a drag back over a track underneath cuts the track at the page's flag and takes the marcher out of both", async ({
        db,
        marchersAndPages: _,
    }) => {
        const pages = await setUp(db);
        const page2 = box(pages[2]!);
        const page3 = box(pages[3]!);
        // A long track over pages 2-3, then a page 3 move on top of it
        await move(db, { start: page2.start, end: page3.end }, [
            { marcherId: 1, x: 400, y: 100 },
        ]);
        await move(db, page3, [{ marcherId: 1, x: 300, y: 300 }]);
        const origin = at(1, page3.start);
        const onPage2 = [page2.start, page2.start + 2, page3.start].map((b) =>
            at(1, b),
        );
        const back = await move(db, page3, [
            { marcherId: 1, x: origin[0], y: origin[1] },
        ]);
        expect(back.cleared).toEqual([1]);
        // The track's page 2 part is left, so page 2 plays as before
        expect(await rowsOf(db, 1)).toEqual([[page2.start, page3.start, 0]]);
        expect(
            [page2.start, page2.start + 2, page3.start].map((b) => at(1, b)),
        ).toEqual(onPage2);
        expect(at(1, page3.end)).toEqual(origin);
    });

    it("an own zero-motion move left still by an edit isn't cleared (only an edit that moves it back is)", async ({
        db,
        marchersAndPages: _,
    }) => {
        const pages = await setUp(db);
        const page3 = box(pages[3]!);
        // A deliberate stay: marcher 1's own page 3 move, ending where it starts
        await transactionWithHistory(db, "stay", async (tx) => {
            const [timeline] = await createTimelinesInTransaction({
                tx,
                newTimelines: [{ startBeat: page3.start, endBeat: page3.end }],
            });
            const [transition] = await createTimelineTransitionsInTransaction({
                tx,
                newTransitions: [
                    {
                        timelineId: timeline!.id,
                        slotCount: 1,
                        destination: {
                            kind: "individual",
                            points: [[100, 100]],
                        },
                    },
                ],
            });
            await createTimelineAssignmentsInTransaction({
                tx,
                newAssignments: [
                    {
                        marcherId: 1,
                        transitionId: transition!.id,
                        slotIndex: 0,
                        startBeat: page3.start,
                        endBeat: page3.end,
                        layer: 0,
                    },
                ],
            });
        });
        await timelineResolverSettled();
        // An align that leaves marcher 1 where it is doesn't clear its stay
        await transformMarchersInSelection({
            db,
            marcherIds: [1],
            transform: (current) =>
                alignHorizontally({ marcherPages: current }),
            plan: planFor(page3),
        });
        await timelineResolverSettled();
        expect(await rowsOf(db, 1)).toEqual([[page3.start, page3.end, 0]]);
    });
});

describeDbTests(
    "sparse timeline writes: set to previous and next page",
    (it) => {
        const t = (key: string, params?: Record<string, string | number>) =>
            params ? `${key} ${JSON.stringify(params)}` : key;

        const run = async (
            db: DbConnection,
            pages: Page[],
            page: Page,
            direction: NeighborPageDirection,
            selected: number[],
            followBack = false,
        ) => {
            const writeTimeline = vi.fn(
                (request: TimelineNeighborPageRequest) =>
                    moveMarchersInTarget({ db, ...request }),
            );
            const notify = { success: vi.fn(), error: vi.fn() };
            const result = await setMarchersToNeighborPage({
                direction,
                scope: "selected",
                selectedPage: page,
                pages,
                selectedMarcherIds: selected,
                followBack,
                writeTimeline,
                notify,
                t,
                reportError: (e) => {
                    throw e;
                },
            });
            await timelineResolverSettled();
            return { result, writeTimeline, notify };
        };

        it("set to next on an inherited page writes the next page's position there (07a §3)", async ({
            db,
            marchersAndPages: _,
        }) => {
            const pages = await setUp(db);
            const page3 = box(pages[3]!);
            const page4 = box(pages[4]!);
            await move(db, page4, [{ marcherId: 1, x: 300, y: 320 }]);
            expect(at(1, page3.end)).toEqual([100, 100]);

            const { result, notify } = await run(
                db,
                pages,
                pages[3]!,
                "next",
                [1],
            );

            expect(result).toBe(1);
            expect(notify.success).toHaveBeenCalledTimes(1);
            expect(at(1, page3.end)).toEqual([300, 320]);
            expect(await rowsOf(db, 1)).toContainEqual([
                page3.start,
                page3.end,
                0,
            ]);
        });

        it("set to previous clears the page's own move, so the page follows a later upstream edit", async ({
            db,
            marchersAndPages: _,
        }) => {
            const pages = await setUp(db);
            const page2 = box(pages[2]!);
            const page3 = box(pages[3]!);
            await move(db, page2, [{ marcherId: 1, x: 200, y: 200 }]);
            await move(db, page3, [{ marcherId: 1, x: 300, y: 300 }]);
            expect(await rowsOf(db, 1)).toHaveLength(2);

            // Page 4 follows back too, so the marcher has nothing after Page 2
            const { result } = await run(
                db,
                pages,
                pages[3]!,
                "previous",
                [1],
                true,
            );
            expect(result).toBe(1);
            expect(await rowsOf(db, 1)).toEqual([[page2.start, page2.end, 0]]);
            expect(at(1, page3.end)).toEqual([200, 200]);

            // An edit on page 2 now carries through page 3
            await move(db, page2, [{ marcherId: 1, x: 220, y: 240 }]);
            expect(at(1, page3.end)).toEqual([220, 240]);
        });

        it("#573's open question: a later page that takes the cleared page's spot follows back to the page before", async ({
            db,
            marchersAndPages: _,
        }) => {
            const pages = await setUp(db);
            const page2 = box(pages[2]!);
            const page3 = box(pages[3]!);
            const page4 = box(pages[4]!);
            await move(db, page2, [{ marcherId: 1, x: 200, y: 200 }]);
            await move(db, page3, [{ marcherId: 1, x: 300, y: 300 }]);
            // Page 4 has no move of its own: it shows Page 3's spot
            expect(at(1, page4.end)).toEqual([300, 300]);

            await run(db, pages, pages[3]!, "previous", [1], true);

            expect(at(1, page3.end)).toEqual([200, 200]);
            expect(at(1, page4.end)).toEqual([200, 200]);
            expect(await rowsOf(db, 1)).toEqual([[page2.start, page2.end, 0]]);
        });

        it("plain Clear Page N keeps the later page where it was, with a move of its own, in one undo step (#573)", async ({
            db,
            marchersAndPages: _,
        }) => {
            const pages = await setUp(db);
            const page2 = box(pages[2]!);
            const page3 = box(pages[3]!);
            const page4 = box(pages[4]!);
            await move(db, page2, [{ marcherId: 1, x: 200, y: 200 }]);
            await move(db, page3, [{ marcherId: 1, x: 300, y: 300 }]);
            const before = await snapshot(db);
            const steps = async () =>
                new Set((await undoRows(db)).map((r) => r.history_group)).size;
            const history = await steps();

            const { result, notify } = await run(
                db,
                pages,
                pages[3]!,
                "previous",
                [1],
            );

            expect(result).toBe(1);
            expect(notify.success).not.toHaveBeenCalled();
            // Page 3 is Not set; Page 4 walks back to where it stood
            expect(at(1, page3.end)).toEqual([200, 200]);
            expect(at(1, page4.end)).toEqual([300, 300]);
            expect(await rowsOf(db, 1)).toEqual([
                [page2.start, page2.end, 0],
                [page4.start, page4.end, 0],
            ]);
            expect(await steps()).toBe(history + 1);

            const undo = await performUndo(db);
            expect(undo.success, undo.error?.message).toBe(true);
            await timelineResolverSettled();
            expect(await snapshot(db)).toEqual(before);
        });

        it("the follow-back item shows only when a later page takes the page's spot, and names those pages (#573)", async ({
            db,
            marchersAndPages: _,
        }) => {
            const pages = await setUp(db);
            const page2 = box(pages[2]!);
            const page3 = box(pages[3]!);
            const boxes = pages
                .slice(1)
                .map((p) => ({ ...box(p), name: p.name }));
            const following = (marcherIds: number[]) =>
                clearFollowingPages({
                    resolver: resolver(),
                    boxes,
                    marcherIds,
                    box: page3,
                });
            // Nothing of its own on Page 3: nothing to clear
            expect(following([1])).toBeNull();

            await move(db, page2, [{ marcherId: 1, x: 200, y: 200 }]);
            await move(db, page3, [{ marcherId: 1, x: 300, y: 300 }]);
            const later = pages.slice(4).map((p) => p.name);
            expect(following([1, 2])).toEqual(later);
            expect(
                clearPageFollowingLabel(pages[3]!.name, later, english),
            ).toBe(
                later.length === 1
                    ? `Clear Page ${pages[3]!.name}, Page ${later[0]} follows back`
                    : `Clear Page ${pages[3]!.name}, Pages ${later[0]}–${later.at(-1)} follow back`,
            );
            expect(clearPageLabel(pages[3]!.name, english)).toBe(
                `Clear Page ${pages[3]!.name}`,
            );

            // The next page Set: it doesn't follow, so only Clear Page 3 is offered
            await move(db, box(pages[4]!), [{ marcherId: 1, x: 350, y: 300 }]);
            expect(following([1])).toBeNull();
        });

        it("the page box menu's Clear Page N entries: the selection, or every performer with words that say so (#573)", async ({
            db,
            marchersAndPages: _,
        }) => {
            const pages = await setUp(db);
            await move(db, box(pages[2]!), [{ marcherId: 1, x: 200, y: 200 }]);
            await move(db, box(pages[3]!), [{ marcherId: 1, x: 300, y: 300 }]);
            useTimelineSelectionStore.setState({
                pageBoxes: pages
                    .slice(1)
                    .map((p) => ({ ...box(p), name: p.name })),
            });
            const page = pages[3]!;
            const later = pages.slice(4).map((p) => p.name);
            const run = vi.fn(() => Promise.resolve(1));

            const selected = clearPageMenu({
                pages,
                selectedIds: [1],
                performerIds: [1, 2, 3, 4],
                run,
            });
            expect(selected.labelsFor(pages[0]!.id)).toBeUndefined();
            expect(selected.labelsFor(page.id)).toEqual({
                clear: clearPageLabel(page.name),
                followBack: clearPageFollowingLabel(page.name, later),
            });
            selected.onClear(String(page.id), true);
            expect(run).toHaveBeenCalledExactlyOnceWith({
                page,
                pages,
                scope: "selected",
                marcherIds: [1],
                followBack: true,
            });

            const all = clearPageMenu({
                pages,
                selectedIds: [],
                performerIds: [1, 2, 3, 4],
                run,
            });
            expect(all.labelsFor(page.id)?.clear).toBe(
                clearPageScopedLabel(clearPageLabel(page.name), "all"),
            );
            // Marcher 2 has nothing of its own on Page 3, so only Marcher 1 makes the item show
            expect(all.labelsFor(page.id)?.followBack).toBe(
                clearPageScopedLabel(
                    clearPageFollowingLabel(page.name, later),
                    "all",
                ),
            );
            all.onClear(page.id, false);
            expect(run).toHaveBeenLastCalledWith({
                page,
                pages,
                scope: "all",
                marcherIds: [1, 2, 3, 4],
                followBack: false,
            });
        });

        it("a page whose own move goes nowhere offers no follow-back item", async ({
            db,
            marchersAndPages: _,
        }) => {
            const pages = await setUp(db);
            const page3 = box(pages[3]!);
            await setAsShownOnPage({
                db,
                pageBox: page3,
                marcherIds: [1],
            });
            await timelineResolverSettled();
            expect(await rowsOf(db, 1)).toEqual([[page3.start, page3.end, 0]]);
            expect(
                clearFollowingPages({
                    resolver: resolver(),
                    boxes: pages
                        .slice(1)
                        .map((p) => ({ ...box(p), name: p.name })),
                    marcherIds: [1],
                    box: page3,
                }),
            ).toBeNull();
        });

        it("set to previous clears an own move that already goes nowhere (a stay)", async ({
            db,
            marchersAndPages: _,
        }) => {
            const pages = await setUp(db);
            const page2 = box(pages[2]!);
            const page3 = box(pages[3]!);
            await move(db, page2, [{ marcherId: 1, x: 200, y: 200 }]);
            // Page 3's own move, then made a stay: it ends where page 2 left the marcher
            await move(db, page3, [{ marcherId: 1, x: 300, y: 300 }]);
            await transactionWithHistory(db, "stay", async (tx) => {
                await tx
                    .update(schema.timeline_slot_destinations)
                    .set({ x: 200, y: 200 })
                    .where(eq(schema.timeline_slot_destinations.x, 300));
            });
            await timelineResolverSettled();
            expect(at(1, page3.end)).toEqual([200, 200]);

            await run(db, pages, pages[3]!, "previous", [1]);
            expect(await rowsOf(db, 1)).toEqual([[page2.start, page2.end, 0]]);
        });

        it("set to previous on a page that already follows writes nothing", async ({
            db,
            marchersAndPages: _,
        }) => {
            const pages = await setUp(db);
            const before = await snapshot(db);
            const history = await undoRows(db);
            const { result } = await run(
                db,
                pages,
                pages[3]!,
                "previous",
                [1, 2],
            );
            expect(result).toBe(2);
            expect(await snapshot(db)).toEqual(before);
            expect(await undoRows(db)).toEqual(history);
        });

        it("Clear this page takes the marcher out of a move shared with others, so the page is Not set (holds 16, M4)", async ({
            db,
            marchersAndPages: _,
        }) => {
            await convertPagesToTimeline(db);
            await startTimelineResolver(db);
            const { pages: unsorted } = await readShowTiming(db);
            const pages = [...unsorted].sort((a, b) => a.order - b.order);
            const page3 = box(pages[3]!);
            const target = at(5, pageEndBeat(pages[2]!));
            expect(at(5, page3.end)).not.toEqual(target);

            await run(db, pages, pages[3]!, "previous", [5]);
            expect(at(5, page3.end)).toEqual(target);
            expect(
                (await rowsOf(db, 5)).filter(
                    ([start, end]) => start! < page3.end && end! > page3.start,
                ),
            ).toEqual([]);
        });

        it("Clear this page inside a longer move cuts it at the page's flag; the page before keeps its motion", async ({
            db,
            marchersAndPages: _,
        }) => {
            const pages = await setUp(db);
            const page2 = box(pages[2]!);
            const page3 = box(pages[3]!);
            await move(db, { start: page2.start, end: page3.end }, [
                { marcherId: 1, x: 300, y: 100 },
            ]);
            const target = at(1, page2.end);
            const midPage2 = at(1, page2.start + 3);
            const page4 = box(pages[4]!);
            const onPage4 = at(1, page4.end);
            await run(db, pages, pages[3]!, "previous", [1]);
            // Page 4 keeps where it was, with a move of its own (#573)
            expect(await rowsOf(db, 1)).toEqual([
                [page2.start, page2.end, 0],
                [page4.start, page4.end, 0],
            ]);
            expect(at(1, page4.end)).toEqual(onPage4);
            expect(at(1, page3.end)).toEqual(target);
            expect(at(1, page2.end)).toEqual(target);
            expect(at(1, page2.start + 3)).toEqual(midPage2);
        });

        it("Clear this page cutting a window move whose rest lands on a later page with its own move leaves that page's move the page's (Expert)", async ({
            db,
            marchersAndPages: _,
        }) => {
            const pages = await setUp(db);
            const page2 = box(pages[2]!);
            const page3 = box(pages[3]!);
            // "Move 1": A and B in a window from page 2's start to page 3's end
            await move(db, { start: page2.start, end: page3.end }, [
                { marcherId: 1, x: 300, y: 100 },
                { marcherId: 2, x: 350, y: 100 },
            ]);
            const window = (await db.select().from(schema.timelines).all())[0]!;
            // Page 3's own move: C dragged there
            await move(db, page3, [{ marcherId: 3, x: 200, y: 300 }]);
            const page3Move = (await db.select().from(schema.timelines).all())
                .filter(
                    (l) =>
                        l.start_beat === page3.start &&
                        l.end_beat === page3.end,
                )
                .sort((x, y) => x.id - y.id)[0]!;
            const beforeAt = [1, 2, 3].map((id) => at(id, page3.end));

            await run(db, pages, pages[2]!, "previous", [1]);

            const overPage3 = (await db.select().from(schema.timelines).all())
                .filter(
                    (l) =>
                        l.start_beat === page3.start &&
                        l.end_beat === page3.end,
                )
                .sort((x, y) => x.id - y.id);
            // The page's own move (the oldest over its box) is still C's
            expect(overPage3[0]!.id).toBe(page3Move.id);
            expect(overPage3).toHaveLength(2);
            // The window move's original id (and name) stays with its part over page 2
            const kept = (await db
                .select()
                .from(schema.timelines)
                .where(eq(schema.timelines.id, window.id))
                .get())!;
            expect([kept.start_beat, kept.end_beat]).toEqual([
                page2.start,
                page2.end,
            ]);
            expect(kept.name).toBe(window.name);
            expect(await rowsOf(db, 1)).toEqual([[page3.start, page3.end, 0]]);
            expect([1, 2, 3].map((id) => at(id, page3.end))).toEqual(beforeAt);
        });
    },
);

describeDbTests("sparse timeline writes: the pass-through toast", (it) => {
    it("a window over inherited pages reports the flags it passes, though it overrides no rows", async ({
        db,
        marchersAndPages: _,
    }) => {
        const pages = await setUp(db);
        const page2 = box(pages[2]!);
        const page3 = box(pages[3]!);
        const window = { start: page2.start, end: page3.end };
        const result = await move(db, window, [
            { marcherId: 1, x: 300, y: 300 },
            // Already there: not added, so not listed
            { marcherId: 2, x: 150, y: 100 },
        ]);
        expect(result.passThrough).toEqual({
            range: window,
            marcherIds: [1],
            labels: [expect.any(String)],
            overridden: [],
            caughtUp: [],
            flags: [page2.end],
            createdTimelineId: expect.any(Number),
        });
        // Page 2's flag shows marcher 1 mid-glide
        expect(at(1, page2.end)).toEqual([200, 200]);
    });

    it("Keep Page N as a keyframe works with no rows underneath: the long move goes and page 3 alone moves", async ({
        db,
        marchersAndPages: _,
    }) => {
        const pages = await setUp(db);
        const page2 = box(pages[2]!);
        const page3 = box(pages[3]!);
        const window = { start: page2.start, end: page3.end };
        const { passThrough } = await move(db, window, [
            { marcherId: 1, x: 300, y: 300 },
        ]);
        const passed = await snapshot(db);

        await moveMarchersFromFlagInstead({
            db,
            range: window,
            from: passThrough!.flags[0]!,
            marcherIds: passThrough!.marcherIds,
            deleteIfEmpty: passThrough!.createdTimelineId,
        });
        await timelineResolverSettled();
        expect(await rowsOf(db, 1)).toEqual([[page3.start, page3.end, 0]]);
        expect(at(1, page2.end)).toEqual([100, 100]);
        expect(at(1, page3.end)).toEqual([300, 300]);

        const undo = await performUndo(db);
        expect(undo.success, undo.error?.message).toBe(true);
        expect(await snapshot(db)).toEqual(passed);
    });

    it("a window inside one page passes no flag and says nothing", async ({
        db,
        marchersAndPages: _,
    }) => {
        const pages = await setUp(db);
        const page3 = box(pages[3]!);
        const result = await move(
            db,
            { start: page3.start, end: page3.start + 4 },
            [{ marcherId: 1, x: 300, y: 300 }],
        );
        expect(result.passThrough).toBeUndefined();
    });
});
