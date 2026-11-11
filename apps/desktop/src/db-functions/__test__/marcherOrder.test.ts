import { afterEach, expect } from "vitest";
import { DbConnection, describeDbTests } from "@/test/base";
import { readShowTiming } from "@/timeline/showTiming";
import {
    startTimelineResolver,
    stopTimelineResolver,
    timelineResolverSettled,
    useTimelineResolverStore,
} from "@/timeline/timelineStore";
import { createLastPage, deletePages } from "@/db-functions/page";
import { moveMarchersInTarget } from "@/db-functions/timelineMoves";
import {
    readAllShapeRecipes,
    saveShapeRecipeInTransaction,
} from "@/db-functions/shapeRecipes";
import { readTimelineEndBeats } from "@/db-functions/timelines";
import { boxesAt } from "@/shapes/placed/placedBox";
import { performRedo, performUndo, transactionWithHistory } from "../history";
import { mergeMoves, splitMarchersIntoNewMove } from "../timelineSplitMoves";
import { rememberedOrderAt } from "../rememberedOrder";
import { followOrderAt } from "../timelineTrailDrag";
import {
    clearMarcherOrder,
    orderMoveAt,
    setMarcherOrder,
} from "../marcherOrder";

/**
 * A line's order set by hand (pathways step 4g, DL-26..DL-29, QA-DL-26..QA-DL-33): stored as an
 * order mark that `rememberedOrder` reads, moving no one and showing no shape.
 */

afterEach(() => stopTimelineResolver());

const PAGE2 = { kind: "range", start: 9, end: 17 } as const;
const resolver = () => useTimelineResolverStore.getState().resolver!;

/** Pages 1–4 of 8 counts, nobody moved yet; four marchers */
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
    return resolver().marcherIds().slice(0, 4);
};

/** The four in a row on page 2, left to right as `ids` are given, 20 apart */
const SPOTS = [100, 120, 140, 160].map((x) => ({ x, y: 40 }));
const inARow = async (db: DbConnection, along: readonly number[]) => {
    await moveMarchersInTarget({
        db,
        target: PAGE2,
        moves: along.map((marcherId, slot) => ({
            marcherId,
            ...SPOTS[slot]!,
        })),
    });
    await timelineResolverSettled();
};

const positions = (ids: readonly number[], beat: number) =>
    ids.map((id) => resolver().positionAt(id, beat));

const LINE = {
    points: [
        { x: 100, y: 40, tension: 0 },
        { x: 160, y: 40, tension: 0 },
    ],
    spacing: { mode: "fit" },
    spots: 4,
};

describeDbTests("A line's order set by hand", (it) => {
    it("QA-DL-26: Set order round-trips through rememberedOrder from the displayed beat on, and moves no one", async ({
        db,
        marchersAndPages: _,
    }) => {
        const ids = await show(db);
        await inARow(db, ids);
        const before = positions(ids, 25);
        // The 3rd leads, then the 1st, the 4th, the 2nd: not the order they stand in
        const order = [ids[2]!, ids[0]!, ids[3]!, ids[1]!];
        await setMarcherOrder(db, { beat: PAGE2.end, order });
        await timelineResolverSettled();

        expect(await rememberedOrderAt(db, ids, PAGE2.end)).toEqual(order);
        expect(await rememberedOrderAt(db, ids, 25)).toEqual(order);
        // Kept to a subset, in the same order
        expect(
            await rememberedOrderAt(db, [ids[1]!, ids[2]!], PAGE2.end),
        ).toEqual([ids[2]!, ids[1]!]);
        // Not before the page it was set on
        expect(await rememberedOrderAt(db, ids, PAGE2.start)).toBeNull();
        // Nobody moved
        expect(positions(ids, 25)).toEqual(before);
    });

    it("QA-DL-27: an order mark shows no placed shape, and leaves the shapes at its beat alone", async ({
        db,
        marchersAndPages: _,
    }) => {
        const ids = await show(db);
        // A Line placed on page 2, its spots left to right
        await moveMarchersInTarget({
            db,
            target: PAGE2,
            moves: ids.map((marcherId, slot) => ({
                marcherId,
                ...SPOTS[slot]!,
            })),
            afterWrite: async (tx, timelineId) => {
                await saveShapeRecipeInTransaction({
                    tx,
                    timelineId,
                    recipe: {
                        kind: "line",
                        kindVersion: 2,
                        params: LINE,
                        orderMode: "keep",
                        reverse: false,
                    },
                    members: ids.map((marcherId, slot) => ({
                        marcherId,
                        slot,
                        ...SPOTS[slot]!,
                    })),
                });
            },
        });
        await timelineResolverSettled();
        const shapesNow = async () => {
            const recipes = await readAllShapeRecipes(db);
            const ends = await readTimelineEndBeats(
                db,
                recipes.flatMap((r) =>
                    r.timelineId === null ? [] : [r.timelineId],
                ),
            );
            return boxesAt({
                recipes,
                endBeatOf: (id) => (id === null ? 0 : ends.get(id)),
                beat: PAGE2.end,
                positionOf: (id) => {
                    const [x, y] = resolver().positionAt(id, PAGE2.end);
                    return { x, y };
                },
            });
        };
        const shown = await shapesNow();
        expect(shown.map((b) => b.recipe.kind)).toEqual(["line"]);

        // Set by hand at the same beat: it wins over the Line, which keeps its members and shows
        const order = [...ids].reverse();
        await setMarcherOrder(db, { beat: PAGE2.end, order });
        expect(await rememberedOrderAt(db, ids, PAGE2.end)).toEqual(order);
        const after = await shapesNow();
        expect(after.map((b) => b.recipe.id)).toEqual(
            shown.map((b) => b.recipe.id),
        );
        expect(after[0]!.recipe.members.map((m) => m.marcherId)).toEqual(ids);

        // A shape placed after it at that beat takes them back: its order wins
        await transactionWithHistory(db, "placeLine", async (tx) => {
            await saveShapeRecipeInTransaction({
                tx,
                timelineId: shown[0]!.recipe.timelineId,
                recipe: {
                    kind: "line",
                    kindVersion: 2,
                    params: LINE,
                    orderMode: "keep",
                    reverse: false,
                },
                members: ids.map((marcherId, slot) => ({
                    marcherId,
                    slot,
                    ...SPOTS[slot]!,
                })),
            });
        });
        const kinds = (await readAllShapeRecipes(db)).map((r) => r.kind);
        expect(kinds).not.toContain("order");
        expect(await rememberedOrderAt(db, ids, PAGE2.end)).toEqual(ids);
    });

    it("QA-DL-28: Reverse and Clear are one undo step each", async ({
        db,
        marchersAndPages: _,
    }) => {
        const ids = await show(db);
        await inARow(db, ids);
        await setMarcherOrder(db, { beat: PAGE2.end, order: ids });
        const reversed = [...ids].reverse();
        await setMarcherOrder(db, {
            beat: PAGE2.end,
            order: reversed,
            operation: "reverseMarcherOrder",
        });
        expect(await rememberedOrderAt(db, ids, PAGE2.end)).toEqual(reversed);
        // One mark at the beat: the reversed one replaced the first's members
        expect(
            (await readAllShapeRecipes(db)).filter((r) => r.kind === "order"),
        ).toHaveLength(1);

        await clearMarcherOrder(db, { beat: PAGE2.end, marcherIds: ids });
        expect(await rememberedOrderAt(db, ids, PAGE2.end)).toBeNull();

        expect((await performUndo(db)).success).toBe(true);
        expect(await rememberedOrderAt(db, ids, PAGE2.end)).toEqual(reversed);
        expect((await performUndo(db)).success).toBe(true);
        expect(await rememberedOrderAt(db, ids, PAGE2.end)).toEqual(ids);
        expect((await performUndo(db)).success).toBe(true);
        expect(await rememberedOrderAt(db, ids, PAGE2.end)).toBeNull();
    });

    it("QA-DL-29: Clear on a later page ends the order from there; a later order sets one again", async ({
        db,
        marchersAndPages: _,
    }) => {
        const ids = await show(db);
        await inARow(db, ids);
        // Page 3 has its own move: one step forward each
        await moveMarchersInTarget({
            db,
            target: { kind: "range", start: 17, end: 25 },
            moves: ids.map((marcherId, slot) => ({
                marcherId,
                x: SPOTS[slot]!.x,
                y: SPOTS[slot]!.y + 8,
            })),
        });
        await timelineResolverSettled();
        await setMarcherOrder(db, { beat: PAGE2.end, order: ids });
        // Cleared on the next page: page 2 keeps it, page 3 on guesses
        await clearMarcherOrder(db, { beat: 25, marcherIds: ids });
        expect(await rememberedOrderAt(db, ids, PAGE2.end)).toEqual(ids);
        expect(await rememberedOrderAt(db, ids, 25)).toBeNull();
        expect(await rememberedOrderAt(db, ids, 33)).toBeNull();
        await setMarcherOrder(db, { beat: 33, order: [...ids].reverse() });
        expect(await rememberedOrderAt(db, ids, 33)).toEqual(
            [...ids].reverse(),
        );
    });

    it("QA-DL-32: the Follow tool takes a hand-set order over the guess", async ({
        db,
        marchersAndPages: _,
    }) => {
        const ids = await show(db);
        await inARow(db, ids);
        const starts = positions(ids, PAGE2.end).map(
            ([x, y]) => [x, y] as [number, number],
        );
        // Guessed from the row: left to right, or right to left
        const guess = await followOrderAt(db, ids, PAGE2.end, starts);
        expect(guess).not.toBeNull();
        const order = [ids[1]!, ids[3]!, ids[0]!, ids[2]!];
        await setMarcherOrder(db, { beat: PAGE2.end, order });
        // Its start flag on the page after: the order set there, as indexes into ids
        expect(await followOrderAt(db, ids, PAGE2.end, starts)).toEqual({
            order: order.map((id) => ids.indexOf(id)),
            leaderFirst: true,
        });
    });

    it("the order is made in the move ending at the displayed beat, or the last one before it", async ({
        db,
        marchersAndPages: _,
    }) => {
        const ids = await show(db);
        await inARow(db, ids);
        const move = await orderMoveAt(db, PAGE2.end, ids);
        expect(move).not.toBeNull();
        const ends = await readTimelineEndBeats(db, [move!]);
        expect(ends.get(move!)).toBe(PAGE2.end);
        // Mid-page: the last move ended before it
        expect(await orderMoveAt(db, PAGE2.end + 3, ids)).toBe(move);
        // Before any move ends: the homes
        expect(await orderMoveAt(db, 0, ids)).toBeNull();
    });

    it("redo brings back Set, Reverse and Clear in turn", async ({
        db,
        marchersAndPages: _,
    }) => {
        const ids = await show(db);
        await inARow(db, ids);
        const order = [ids[2]!, ids[0]!, ids[3]!, ids[1]!];
        const reversed = [...order].reverse();
        await setMarcherOrder(db, { beat: PAGE2.end, order });
        await setMarcherOrder(db, {
            beat: PAGE2.end,
            order: reversed,
            operation: "reverseMarcherOrder",
        });
        await clearMarcherOrder(db, { beat: PAGE2.end, marcherIds: ids });
        for (let i = 0; i < 3; i++)
            expect((await performUndo(db)).success).toBe(true);
        expect(await rememberedOrderAt(db, ids, PAGE2.end)).toBeNull();

        expect((await performRedo(db)).success).toBe(true);
        expect(await rememberedOrderAt(db, ids, PAGE2.end)).toEqual(order);
        expect((await performRedo(db)).success).toBe(true);
        expect(await rememberedOrderAt(db, ids, PAGE2.end)).toEqual(reversed);
        expect((await performRedo(db)).success).toBe(true);
        expect(await rememberedOrderAt(db, ids, PAGE2.end)).toBeNull();
    });

    it("splitting marchers off into a move of their own, and merging them back, keeps the whole order set by hand", async ({
        db,
        marchersAndPages: _,
    }) => {
        const ids = await show(db);
        await inARow(db, ids);
        // Interleaved, so either half split off breaks it up
        const order = [ids[3]!, ids[0]!, ids[2]!, ids[1]!];
        await setMarcherOrder(db, { beat: PAGE2.end, order });
        const pageMove = (await orderMoveAt(db, PAGE2.end, ids))!;
        const split = await splitMarchersIntoNewMove({
            db,
            timelineId: pageMove,
            marcherIds: [ids[0]!, ids[1]!],
        });
        await timelineResolverSettled();
        expect(await rememberedOrderAt(db, ids, PAGE2.end)).toEqual(order);
        const mark = (await readAllShapeRecipes(db)).find(
            (r) => r.kind === "order",
        )!;
        expect(mark.members.map((m) => m.marcherId)).toEqual(order);

        await mergeMoves({
            db,
            sourceId: split.timeline.id,
            targetId: pageMove,
        });
        await timelineResolverSettled();
        expect(await rememberedOrderAt(db, ids, PAGE2.end)).toEqual(order);
    });

    it("merging a move whose order mark holds some of a line into the move with the rest's mark keeps both", async ({
        db,
        marchersAndPages: _,
    }) => {
        const ids = await show(db);
        await inARow(db, ids);
        const pageMove = (await orderMoveAt(db, PAGE2.end, ids))!;
        const split = await splitMarchersIntoNewMove({
            db,
            timelineId: pageMove,
            marcherIds: [ids[0]!, ids[1]!],
        });
        await timelineResolverSettled();
        const left = [ids[1]!, ids[0]!];
        const right = [ids[3]!, ids[2]!];
        // Each half's order lives in the move that holds it
        await setMarcherOrder(db, { beat: PAGE2.end, order: left });
        await setMarcherOrder(db, { beat: PAGE2.end, order: right });
        expect(await orderMoveAt(db, PAGE2.end, left)).toBe(split.timeline.id);
        expect(await orderMoveAt(db, PAGE2.end, right)).toBe(pageMove);

        await mergeMoves({
            db,
            sourceId: split.timeline.id,
            targetId: pageMove,
        });
        expect(await rememberedOrderAt(db, left, PAGE2.end)).toEqual(left);
        expect(await rememberedOrderAt(db, right, PAGE2.end)).toEqual(right);
    });

    it("a Line placed reversed on purpose sets its order, though a member is dragged off it; a copy of an order set by hand either way carries that order on", async ({
        db,
        marchersAndPages: _,
    }) => {
        const ids = await show(db);
        await inARow(db, ids);
        const P3 = { kind: "range", start: 17, end: 25 } as const;
        await moveMarchersInTarget({
            db,
            target: P3,
            moves: ids.map((marcherId, slot) => ({
                marcherId,
                x: SPOTS[slot]!.x,
                y: SPOTS[slot]!.y + 8,
            })),
        });
        await timelineResolverSettled();
        const [a, b, c, d] = ids as [number, number, number, number];
        const place = async (
            beat: number,
            bySlot: readonly (number | null)[],
        ) => {
            const timelineId = await orderMoveAt(db, beat, ids);
            await transactionWithHistory(db, "placeLine", async (tx) => {
                await saveShapeRecipeInTransaction({
                    tx,
                    timelineId,
                    recipe: {
                        kind: "line",
                        kindVersion: 2,
                        params: { ...LINE, spots: bySlot.length },
                        orderMode: "keep",
                        reverse: false,
                    },
                    members: bySlot.flatMap((marcherId, slot) =>
                        marcherId === null
                            ? []
                            : [{ marcherId, slot, ...SPOTS[slot]! }],
                    ),
                });
            });
        };
        // A Line a→d on page 2, then on page 3 one placed d→a with c dragged off it
        await place(PAGE2.end, [a, b, c, d]);
        await place(25, [d, c, null, a]);
        expect(await rememberedOrderAt(db, [a, c, d], 25)).toEqual([d, c, a]);

        // Set by hand a→d on page 2 instead: the same copy carries the order set by hand on
        await setMarcherOrder(db, { beat: PAGE2.end, order: [a, b, c, d] });
        expect(await rememberedOrderAt(db, [a, c, d], 25)).toEqual([a, c, d]);
    });

    it("an order mark lives in the latest move that holds its marchers, or the latest move when none does", async ({
        db,
        marchersAndPages: _,
    }) => {
        const ids = await show(db);
        await inARow(db, ids);
        const pageMove = (await orderMoveAt(db, PAGE2.end, ids))!;
        // Page 3's move holds someone else only
        const other = resolver()
            .marcherIds()
            .find((m) => !ids.includes(m))!;
        await moveMarchersInTarget({
            db,
            target: { kind: "range", start: 17, end: 25 },
            moves: [{ marcherId: other, x: 10, y: 10 }],
        });
        await timelineResolverSettled();
        const page3 = (await orderMoveAt(db, 25, [other]))!;
        expect(page3).not.toBe(pageMove);
        expect((await readTimelineEndBeats(db, [page3])).get(page3)).toBe(25);
        // Their mark at page 3's end sits with their positions, in page 2's move
        expect(await orderMoveAt(db, 25, ids)).toBe(pageMove);
        await setMarcherOrder(db, { beat: 25, order: [...ids].reverse() });
        const mark = (await readAllShapeRecipes(db)).find(
            (r) => r.kind === "order",
        )!;
        expect(mark.timelineId).toBe(pageMove);
        expect(await rememberedOrderAt(db, ids, 25)).toEqual(
            [...ids].reverse(),
        );
        // Nobody of theirs in any move: the latest move
        expect(await orderMoveAt(db, 25, [])).toBe(page3);
    });
});
