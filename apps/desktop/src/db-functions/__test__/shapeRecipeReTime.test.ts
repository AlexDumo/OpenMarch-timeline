import { afterEach, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { DbConnection, describeDbTests, schema } from "@/test/base";
import { readShowTiming } from "@/timeline/showTiming";
import {
    startTimelineResolver,
    stopTimelineResolver,
    timelineResolverSettled,
    useTimelineResolverStore,
} from "@/timeline/timelineStore";
import { deleteCounts, insertCounts } from "@/tempo/tempoWrites";
import { performRedo, performUndo, transactionWithHistory } from "../history";
import { createLastPage, deletePages } from "../page";
import { movePageFlag } from "../pageFlags";
import {
    moveMarchersInTarget,
    type TimelineEditTarget,
} from "../timelineMoves";
import { mergeMoves, splitMarchersIntoNewMove } from "../timelineSplitMoves";
import { shiftTimeline } from "../timelineCommands";
import { resizeTimeline } from "../timelineResize";
import { splitTimelineAtBeat } from "../timelineSplitAtBeat";
import { readPageGrid } from "../timelinePageGrid";
import {
    readAllShapeRecipes,
    saveShapeRecipeInTransaction,
    type ShapeRecipeRecord,
} from "../shapeRecipes";

/**
 * A shape stands at a count (ADR 0006 revision of 2026-11-22), so it no longer rides along with
 * its move's end. §4's re-time row: an edit that re-times the arrival of **every** member at the
 * shape's count to one new count moves the shape there, in the same undo step; otherwise the shape
 * stays and its members are listed, the re-timed ones off their spots (`shapeRecipeUpkeep.ts`).
 * Page and beat edits (flag drags, tempo) move it with the page ripple, as an order mark's count.
 * One test per beat-moving edit, each undone and redone.
 */

afterEach(() => stopTimelineResolver());

const PAGE2 = { start: 9, end: 17 };
/** A move inside page 2, ending mid-page */
const INSIDE = { start: 10, end: 14 };
const ARC: ShapeRecipeRecord = {
    kind: "arc",
    kindVersion: 1,
    params: { bulge: 4 },
    orderMode: "keep",
    reverse: false,
};

const resolver = () => useTimelineResolverStore.getState().resolver!;

/** Pages 1–4 of 8 counts, nobody moved yet */
const show = async (db: DbConnection) => {
    const pages = [...(await readShowTiming(db)).pages].sort(
        (a, b) => a.order - b.order,
    );
    await deletePages({
        db,
        pageIds: new Set(pages.filter((p) => p.order >= 2).map((p) => p.id)),
    });
    for (let i = 0; i < 3; i++) await createLastPage({ db, newPageCounts: 8 });
    await startTimelineResolver(db);
    const [a, b, c] = resolver().marcherIds();
    return { a: a!, b: b!, c: c! };
};

/** Places `ids` over `range` at x = 100, 120, ... with a shape, like the Shape tool's Place */
const place = async (
    db: DbConnection,
    ids: number[],
    range: { start: number; end: number },
) => {
    let saved: number | null = null;
    const target: TimelineEditTarget = { kind: "range", ...range };
    await moveMarchersInTarget({
        db,
        target,
        moves: ids.map((marcherId, i) => ({
            marcherId,
            x: 100 + 20 * i,
            y: 50,
        })),
        afterWrite: async (tx, beat) => {
            saved = await saveShapeRecipeInTransaction({
                tx,
                beat,
                recipe: ARC,
                members: ids.map((marcherId, i) => ({
                    marcherId,
                    slot: i,
                    x: 100 + 20 * i,
                    y: 50,
                })),
            });
        },
    });
    await timelineResolverSettled();
    return saved!;
};

/** Moves `ids` over `range` with no shape, to x = 40, 50, ... at `y` */
const moveOnly = async (
    db: DbConnection,
    ids: number[],
    range: { start: number; end: number },
    y = 20,
) => {
    await moveMarchersInTarget({
        db,
        target: { kind: "range", ...range },
        moves: ids.map((marcherId, i) => ({
            marcherId,
            x: 40 + 10 * i,
            y,
        })),
    });
    await timelineResolverSettled();
};

/** The move marcher `id` arrives at count `beat` in */
const moveArriving = async (db: DbConnection, id: number, beat: number) => {
    const a = schema.timeline_assignments;
    const t = schema.timeline_transitions;
    const row = await db
        .select({ timelineId: t.timeline_id })
        .from(a)
        .innerJoin(t, eq(t.id, a.transition_id))
        .where(and(eq(a.marcher_id, id), eq(a.end_beat, beat)))
        .get();
    return row!.timelineId;
};

/** Where recipe `id` stands and who it lists, or null once it's gone */
const recipe = async (db: DbConnection, id: number) => {
    const found = (await readAllShapeRecipes(db)).find((r) => r.id === id);
    return found
        ? {
              beat: found.beat,
              members: found.members.map((m) => m.marcherId).sort(),
          }
        : null;
};

/**
 * Runs `edit`, then checks recipe `id` stands at `to` listing `members`, that undo puts it back at
 * `from` and redo at `to` again, with the same members each time
 */
const expectShapeAt = async (
    db: DbConnection,
    id: number,
    members: number[],
    { from, to }: { from: number; to: number },
    edit: () => Promise<unknown>,
) => {
    const listed = [...members].sort();
    expect(await recipe(db, id)).toEqual({ beat: from, members: listed });
    await edit();
    expect(await recipe(db, id)).toEqual({ beat: to, members: listed });
    await performUndo(db);
    expect(await recipe(db, id)).toEqual({ beat: from, members: listed });
    await performRedo(db);
    expect(await recipe(db, id)).toEqual({ beat: to, members: listed });
};

describeDbTests("Shapes follow re-timed moves", (it) => {
    it("a clip dragged 2 counts later takes its shape along, 14 → 16", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { a, b } = await show(db);
        const id = await place(db, [a, b], INSIDE);
        const move = await moveArriving(db, a, INSIDE.end);
        await expectShapeAt(db, id, [a, b], { from: 14, to: 16 }, () =>
            shiftTimeline({ db, timelineId: move, delta: 2 }),
        );
    });

    it("a clip dragged earlier takes its shape along, 14 → 13", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { a, b } = await show(db);
        const id = await place(db, [a, b], INSIDE);
        const move = await moveArriving(db, a, INSIDE.end);
        await expectShapeAt(db, id, [a, b], { from: 14, to: 13 }, () =>
            shiftTimeline({ db, timelineId: move, delta: -1 }),
        );
    });

    it("a clip dragged past the show's end takes its shape along, onto the counts it adds", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { a, b } = await show(db);
        const grid = await db.transaction((tx) => readPageGrid(tx));
        const end = grid.beatIds.length;
        const id = await place(db, [a, b], { start: end - 4, end });
        const move = await moveArriving(db, a, end);
        await expectShapeAt(db, id, [a, b], { from: end, to: end + 3 }, () =>
            shiftTimeline({ db, timelineId: move, delta: 3 }),
        );
    });

    it("resizing a clip's end takes its shape along, 14 → 16", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { a, b } = await show(db);
        const id = await place(db, [a, b], INSIDE);
        const move = await moveArriving(db, a, INSIDE.end);
        await expectShapeAt(db, id, [a, b], { from: 14, to: 16 }, () =>
            resizeTimeline({ db, timelineId: move, start: 10, end: 16 }),
        );
    });

    it("resizing a clip's start leaves its shape at its count: the arrival didn't move", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { a, b } = await show(db);
        const id = await place(db, [a, b], INSIDE);
        const move = await moveArriving(db, a, INSIDE.end);
        await expectShapeAt(db, id, [a, b], { from: 14, to: 14 }, () =>
            resizeTimeline({ db, timelineId: move, start: 12, end: 14 }),
        );
    });

    it("merging a shorter move into the page's refits it and takes its shape along, 14 → 17", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { a, b, c } = await show(db);
        await moveOnly(db, [c], PAGE2);
        const id = await place(db, [a, b], INSIDE);
        const source = await moveArriving(db, a, INSIDE.end);
        const target = await moveArriving(db, c, PAGE2.end);
        await expectShapeAt(db, id, [a, b], { from: 14, to: 17 }, () =>
            mergeMoves({ db, sourceId: source, targetId: target }),
        );
    });

    it("dragging the page flag the shape stands on takes it along, 17 → 19", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { a, b } = await show(db);
        const id = await place(db, [a, b], PAGE2);
        const grid = await db.transaction((tx) => readPageGrid(tx));
        const page = grid.pages.find((p) => p.end === PAGE2.end)!;
        await expectShapeAt(db, id, [a, b], { from: 17, to: 19 }, () =>
            movePageFlag({ db, pageId: page.id, beat: 19 }),
        );
    });

    it("adding counts inside the page before the shape takes it along, 17 → 19", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { a, b } = await show(db);
        const id = await place(db, [a, b], PAGE2);
        await expectShapeAt(db, id, [a, b], { from: 17, to: 19 }, () =>
            insertCounts({ at: 12, count: 2, duration: 0.5, drill: "adjust" }),
        );
    });

    it("removing counts inside the page before the shape takes it along, 17 → 15", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { a, b } = await show(db);
        const id = await place(db, [a, b], PAGE2);
        await expectShapeAt(db, id, [a, b], { from: 17, to: 15 }, () =>
            deleteCounts({ from: 12, to: 14, drill: "adjust" }),
        );
    });

    it("adding a page's worth of counts moves back-to-back shapes once each, with their flags", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { a, b } = await show(db);
        const first = await place(db, [a, b], PAGE2);
        const second = await place(db, [a, b], { start: 17, end: 25 });
        await insertCounts({
            at: 12,
            count: 8,
            duration: 0.5,
            drill: "adjust",
        });
        expect(await recipe(db, first)).toEqual({
            beat: 25,
            members: [a, b].sort(),
        });
        expect(await recipe(db, second)).toEqual({
            beat: 33,
            members: [a, b].sort(),
        });
        await performUndo(db);
        expect((await recipe(db, first))?.beat).toBe(17);
        expect((await recipe(db, second))?.beat).toBe(25);
    });

    it("adding counts moves a shape with its count once, even onto a count whose arrivals moved on", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { a, b } = await show(db);
        // a and b arrive at 12, stand still in a shape at 14, then move on over 14–16
        await moveOnly(db, [a, b], { start: 10, end: 12 });
        const id = await transactionWithHistory(db, "place", (tx) =>
            saveShapeRecipeInTransaction({
                tx,
                beat: 14,
                recipe: ARC,
                members: [a, b].map((marcherId, i) => ({
                    marcherId,
                    slot: i,
                    x: 40 + 10 * i,
                    y: 20,
                })),
            }),
        );
        await moveOnly(db, [a, b], { start: 14, end: 16 }, 60);
        // Two counts at 13: the shape's count 14 goes to 16, the move after it to 16–18. The
        // re-time rule must not then take the shape on to 18 with that move's arrival
        await expectShapeAt(db, id, [a, b], { from: 14, to: 16 }, () =>
            insertCounts({ at: 13, count: 2, duration: 0.5, drill: "adjust" }),
        );
        expect(await moveArriving(db, a, 18)).toBeDefined();
    });

    it("a clip dragged with only some members leaves the shape at its count, everyone listed", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { a, b } = await show(db);
        const id = await place(db, [a, b], INSIDE);
        const split = await splitMarchersIntoNewMove({
            db,
            timelineId: await moveArriving(db, a, INSIDE.end),
            marcherIds: [b],
        });
        await timelineResolverSettled();
        await expectShapeAt(db, id, [a, b], { from: 14, to: 14 }, () =>
            shiftTimeline({ db, timelineId: split.timeline.id, delta: 2 }),
        );
        // b now arrives late, at 16; a still at 14
        expect(await moveArriving(db, b, 16)).toBe(split.timeline.id);
        expect(await moveArriving(db, a, 14)).toBeDefined();
    });

    it("a split at the playhead leaves the shape at its count: its members still arrive there", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { a, b } = await show(db);
        const id = await place(db, [a, b], INSIDE);
        const move = await moveArriving(db, a, INSIDE.end);
        await expectShapeAt(db, id, [a, b], { from: 14, to: 14 }, () =>
            splitTimelineAtBeat({ db, timelineId: move, beat: 12 }),
        );
    });

    it("a shape dragged onto another shape's count settles one shape per marcher there, and undo brings both back", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { a, b } = await show(db);
        const first = await place(db, [a, b], INSIDE);
        // A second shape of the same marchers at 16, where they stand still
        const second = await transactionWithHistory(db, "place", (tx) =>
            saveShapeRecipeInTransaction({
                tx,
                beat: 16,
                recipe: ARC,
                members: [a, b].map((marcherId, i) => ({
                    marcherId,
                    slot: i,
                    x: 100 + 20 * i,
                    y: 50,
                })),
            }),
        );
        const move = await moveArriving(db, a, INSIDE.end);
        await shiftTimeline({ db, timelineId: move, delta: 2 });
        // The shape already at 16 keeps its marchers; the one that came is left with nobody
        expect(await recipe(db, first)).toBeNull();
        expect(await recipe(db, second)).toEqual({
            beat: 16,
            members: [a, b].sort(),
        });
        await performUndo(db);
        expect(await recipe(db, first)).toEqual({
            beat: 14,
            members: [a, b].sort(),
        });
        expect((await recipe(db, second))?.beat).toBe(16);
    });
});
