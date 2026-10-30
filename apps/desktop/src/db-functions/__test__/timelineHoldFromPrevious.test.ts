import { afterEach, expect } from "vitest";
import { countDistinct, getTableName } from "drizzle-orm";
import type { XY } from "@openmarch/core";
import { DbConnection, describeDbTests, schema } from "@/test/base";
import { keepFixturesInPageMode } from "@/test/timelineMode";
import { getTestWithHistory } from "@/test/history";
import { readShowTiming } from "@/timeline/showTiming";
import { pageEndBeat } from "@/timeline/timelineCanvas";
import {
    startTimelineResolver,
    stopTimelineResolver,
    timelineResolverSettled,
    useTimelineResolverStore,
} from "@/timeline/timelineStore";
import { timelineErrorCode } from "@/timeline/timelineErrorMessages";
import { performRedo, performUndo, transactionWithHistory } from "../history";
import { createLastPage, deletePages } from "../page";
import {
    moveMarchersInTarget,
    type TimelineEditTarget,
} from "../timelineMoves";
import { timelineDisplayVersion } from "../timelineDisplay";
import { readHeldMarks } from "../timelineHeldMarks";
import { holdFromPreviousPage } from "../timelineHoldFromPrevious";

keepFixturesInPageMode(
    "its tests trim the show, write timeline rows and set the flag themselves",
);

/**
 * **Hold from previous page** and the drag inside a Held hold (holds, fork #472; holds README
 * decisions 2, 3 and 4; ADR 0001 amendment 2026-10-30).
 *
 * The show: home, page 1 [1, 9), page 2 [9, 17), page 3 [17, 25), page 4 [25, 33); beat ids equal
 * their ordinals. Marchers `a` and `b` move on page 2 and are Not set on pages 3 and 4; `c` never
 * moves.
 */

afterEach(() => stopTimelineResolver());

const UP: XY = [100, 100];
const UP2: XY = [200, 100];
const ELSEWHERE: XY = [400, 400];
const FAR: XY = [500, 260];
const LEFT: XY = [60, 300];
const PAGE1 = { start: 1, end: 9 };
const PAGE2 = { start: 9, end: 17 };
const PAGE3 = { start: 17, end: 25 };
const PAGE4 = { start: 25, end: 33 };

const TABLES = [
    schema.timelines,
    schema.timeline_transitions,
    schema.timeline_assignments,
    schema.timeline_slot_destinations,
    schema.timeline_kept_assignments,
    schema.timeline_held_marks,
];

const snapshot = async (db: DbConnection) => {
    const out: Record<string, unknown[]> = {};
    for (const table of TABLES)
        out[getTableName(table)] = await db.select().from(table).all();
    return out;
};

const undoGroups = async (db: DbConnection) =>
    (
        await db
            .select({ n: countDistinct(schema.history_undo.history_group) })
            .from(schema.history_undo)
            .get()
    )?.n ?? 0;

const resolver = () => useTimelineResolverStore.getState().resolver!;

const pagesInOrder = async (db: DbConnection) =>
    [...(await readShowTiming(db)).pages].sort((a, b) => a.order - b.order);

/** Where `marcherId` stands at each flag: home, pages 1–4. */
const atFlags = async (db: DbConnection, marcherId: number) => {
    await timelineResolverSettled();
    return (await pagesInOrder(db))
        .map((p) => (p.id === 0 ? 0 : pageEndBeat(p)))
        .map((b) => resolver().positionAt(marcherId, b) as XY);
};

const edit = async (
    db: DbConnection,
    target: TimelineEditTarget,
    moves: { marcherId: number; xy: XY }[],
) => {
    const result = await moveMarchersInTarget({
        db,
        target,
        moves: moves.map(({ marcherId, xy: [x, y] }) => ({ marcherId, x, y })),
    });
    await timelineResolverSettled();
    return result;
};

const move = (
    db: DbConnection,
    range: { start: number; end: number },
    moves: { marcherId: number; xy: XY }[],
) => edit(db, { kind: "range", ...range }, moves);

const rowsOf = async (db: DbConnection, marcherId: number) =>
    (await db.select().from(schema.timeline_assignments).all()).filter(
        (r) => r.marcher_id === marcherId,
    );

const marksOf = async (db: DbConnection, marcherId: number) =>
    (await readHeldMarks(db, [marcherId])).map(({ start, end }) => ({
        start,
        end,
    }));

const setTimelineFlag = async (db: DbConnection) => {
    await db.delete(schema.workspace_settings);
    await db.insert(schema.workspace_settings).values({
        id: 1,
        json_data: JSON.stringify({ timelineMode: true }),
    });
};

/** Pages 1–4 in timeline mode; `a` and `b` moved on page 2, Not set on 3 and 4. */
const show = async (db: DbConnection) => {
    const pages = await pagesInOrder(db);
    await deletePages({
        db,
        pageIds: new Set(pages.filter((p) => p.order >= 2).map((p) => p.id)),
    });
    for (let i = 0; i < 3; i++) await createLastPage({ db, newPageCounts: 8 });
    await setTimelineFlag(db);
    await startTimelineResolver(db);
    const [a, b, c] = resolver().marcherIds();
    await move(db, PAGE2, [
        { marcherId: a!, xy: UP },
        { marcherId: b!, xy: UP2 },
    ]);
    return { a: a!, b: b!, c: c! };
};

describeDbTests("Hold from previous page", (it) => {
    it("holds this page only, growing out of the previous page's arrival", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { a, b } = await show(db);
        const before = await atFlags(db, a);
        const result = await holdFromPreviousPage({
            db,
            pageBox: PAGE3,
            marcherIds: [b, a],
        });
        expect(result).toEqual({
            held: [a, b].sort((x, y) => x - y),
            skipped: [],
        });
        // Nothing moves; the mark runs over page 3 from page 2's flag, where a move ends
        expect(await atFlags(db, a)).toEqual(before);
        expect(await marksOf(db, a)).toEqual([PAGE3]);
        expect(await marksOf(db, b)).toEqual([PAGE3]);
        expect(
            (await rowsOf(db, a)).filter((r) => r.end_beat === PAGE3.start),
        ).toHaveLength(1);
        // Page 4 is still Not set: no mark there
        expect(
            (await readHeldMarks(db)).filter((m) => m.end > PAGE3.end),
        ).toEqual([]);
    });

    it("takes the marcher's own move on the page out first", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { a } = await show(db);
        await move(db, PAGE3, [{ marcherId: a, xy: ELSEWHERE }]);
        expect((await atFlags(db, a))[3]).toEqual(ELSEWHERE);

        const result = await holdFromPreviousPage({
            db,
            pageBox: PAGE3,
            marcherIds: [a],
        });
        expect(result.held).toEqual([a]);
        expect(
            (await rowsOf(db, a)).filter(
                (r) => r.start_beat < PAGE3.end && r.end_beat > PAGE3.start,
            ),
        ).toEqual([]);
        // It stands where page 2 put it, through pages 3 and 4
        expect((await atFlags(db, a)).slice(2)).toEqual([UP, UP, UP]);
        expect(await marksOf(db, a)).toEqual([PAGE3]);
    });

    it("skips, and names, marchers it can't hold", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { a, b, c } = await show(db);
        // b runs one move over pages 3 and 4; c never moved, so nothing arrives at page 2's flag
        await move(db, { start: 17, end: 33 }, [{ marcherId: b, xy: FAR }]);
        await holdFromPreviousPage({ db, pageBox: PAGE3, marcherIds: [a] });
        const rows = await snapshot(db);
        const groups = await undoGroups(db);

        const result = await holdFromPreviousPage({
            db,
            pageBox: PAGE3,
            marcherIds: [a, b, c],
        });
        expect(result.held).toEqual([]);
        expect(result.skipped).toEqual(
            [
                { marcherId: a, reason: "held" },
                { marcherId: b, reason: "crossesFlag" },
                { marcherId: c, reason: "noArrival" },
            ].sort((x, y) => x.marcherId - y.marcherId),
        );
        // Nobody held: nothing written, and no undo step
        expect(await snapshot(db)).toEqual(rows);
        expect(await undoGroups(db)).toBe(groups);
    });

    it("joins a Held hold on the next page that grew out of this page's arrival", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { a } = await show(db);
        await move(db, PAGE1, [{ marcherId: a, xy: LEFT }]);
        await holdFromPreviousPage({ db, pageBox: PAGE3, marcherIds: [a] });
        expect(await marksOf(db, a)).toEqual([PAGE3]);

        await holdFromPreviousPage({ db, pageBox: PAGE2, marcherIds: [a] });
        // One hold over pages 2 and 3, from page 1's arrival
        expect(await marksOf(db, a)).toEqual([
            { start: PAGE2.start, end: PAGE3.end },
        ]);
        expect((await atFlags(db, a)).slice(1, 4)).toEqual([LEFT, LEFT, LEFT]);
    });

    it("refuses a box that isn't a page's, worded in pages and counts", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { a } = await show(db);
        const rows = await snapshot(db);
        const notABox = await holdFromPreviousPage({
            db,
            pageBox: { start: 17, end: 21 },
            marcherIds: [a],
        }).catch((e: unknown) => e);
        expect(timelineErrorCode(notABox)).toBe("E-ARGS");
        expect((notABox as Error).message).toContain(
            "Hold from previous page works on a whole page, not Page 3, counts 1–4",
        );
        expect(await snapshot(db)).toEqual(rows);
    });
});

describeDbTests("A drag inside a Held hold", (it) => {
    for (const [mode, target] of [
        ["Expert, the page's window", { kind: "range", ...PAGE3 }],
        ["Basic, mid-page", { kind: "point", beat: 21, box: PAGE3 }],
        ["Basic, on the page's flag", { kind: "point", beat: 25, box: PAGE3 }],
    ] as const) {
        it(`moves the arrival and the whole hold (${mode}); earlier and later pages as before`, async ({
            db,
            marchersAndPages: _,
        }) => {
            const { a, b } = await show(db);
            // b: page 4 is Set, so it keeps its own spot whatever page 2 does
            await move(db, PAGE4, [{ marcherId: b, xy: LEFT }]);
            await holdFromPreviousPage({
                db,
                pageBox: PAGE3,
                marcherIds: [a, b],
            });
            const aBefore = await atFlags(db, a);
            const bBefore = await atFlags(db, b);

            await edit(db, target, [
                { marcherId: a, xy: ELSEWHERE },
                { marcherId: b, xy: FAR },
            ]);
            // Page 2's arrival moved, and the hold with it; nothing new on page 3
            expect(await atFlags(db, a)).toEqual([
                ...aBefore.slice(0, 2),
                ELSEWHERE,
                ELSEWHERE,
                // Page 4 is Not set: it shows the last set spot, as before
                ELSEWHERE,
            ]);
            expect(await atFlags(db, b)).toEqual([
                ...bBefore.slice(0, 2),
                FAR,
                FAR,
                LEFT,
            ]);
            for (const id of [a, b]) {
                expect(await marksOf(db, id)).toEqual([PAGE3]);
                expect(
                    (await rowsOf(db, id)).filter(
                        (r) =>
                            r.start_beat < PAGE3.end &&
                            r.end_beat > PAGE3.start,
                    ),
                ).toEqual([]);
            }
        });
    }

    it("edits each marcher by its own kind in a mixed selection", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { a, b } = await show(db);
        await holdFromPreviousPage({ db, pageBox: PAGE3, marcherIds: [a] });

        await move(db, PAGE3, [
            { marcherId: a, xy: ELSEWHERE },
            { marcherId: b, xy: FAR },
        ]);
        // a (Held) moves page 2's spot; b (Not set) gets a move of its own on page 3
        expect((await atFlags(db, a)).slice(2, 4)).toEqual([
            ELSEWHERE,
            ELSEWHERE,
        ]);
        expect((await atFlags(db, b)).slice(2, 4)).toEqual([UP2, FAR]);
    });
});

describeDbTests("Held marks at commit", (it) => {
    it("rejects a move inside a mark (E-H1), writing nothing", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { a } = await show(db);
        await holdFromPreviousPage({ db, pageBox: PAGE3, marcherIds: [a] });
        const rows = await snapshot(db);
        // A window over pages 3 and 4 ends outside the hold, so it writes a move over it
        const error = await move(db, { start: 17, end: 33 }, [
            { marcherId: a, xy: FAR },
        ]).catch((e: unknown) => e);
        expect(timelineErrorCode(error)).toBe("E-H1");
        expect(await snapshot(db)).toEqual(rows);
    });

    it("rejects overlapping marks of one marcher (E-H3)", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { a, b } = await show(db);
        await holdFromPreviousPage({ db, pageBox: PAGE3, marcherIds: [a] });
        const rows = await snapshot(db);
        const write = (marcherId: number) =>
            transactionWithHistory(db, "test", async (tx) => {
                await tx.insert(schema.timeline_held_marks).values({
                    marcher_id: marcherId,
                    start_beat: 21,
                    end_beat: 33,
                });
            });
        const error = await write(a).catch((e: unknown) => e);
        expect(timelineErrorCode(error)).toBe("E-H3");
        expect(await snapshot(db)).toEqual(rows);
        // Another marcher's mark over the same counts is fine
        await write(b);
    });
});

describeDbTests("Held marks: undo, redo and views", (it) => {
    it("is one undo step, exactly undone and redone, and a mark-only edit refreshes the views", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { a, b } = await show(db);
        const rows = await snapshot(db);
        const groups = await undoGroups(db);
        let display = timelineDisplayVersion();
        // a and b are Not set on page 3: the hold writes only marks
        await holdFromPreviousPage({ db, pageBox: PAGE3, marcherIds: [a, b] });
        const held = await snapshot(db);
        expect(await undoGroups(db)).toBe(groups + 1);
        expect(timelineDisplayVersion()).toBeGreaterThan(display);

        display = timelineDisplayVersion();
        expect((await performUndo(db)).success).toBe(true);
        expect(await snapshot(db)).toEqual(rows);
        expect(timelineDisplayVersion()).toBeGreaterThan(display);

        display = timelineDisplayVersion();
        expect((await performRedo(db)).success).toBe(true);
        expect(await snapshot(db)).toEqual(held);
        expect(timelineDisplayVersion()).toBeGreaterThan(display);
    });

    it("undoes a hold that took the marcher's own move out, rows and mark together", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { a } = await show(db);
        await move(db, PAGE3, [{ marcherId: a, xy: ELSEWHERE }]);
        const rows = await snapshot(db);
        await holdFromPreviousPage({ db, pageBox: PAGE3, marcherIds: [a] });
        const held = await snapshot(db);
        expect((await performUndo(db)).success).toBe(true);
        expect(await snapshot(db)).toEqual(rows);
        expect((await atFlags(db, a))[3]).toEqual(ELSEWHERE);
        expect((await performRedo(db)).success).toBe(true);
        expect(await snapshot(db)).toEqual(held);
    });
});

describeDbTests("Held marks: history round trips", (it) => {
    const testWithHistory = getTestWithHistory(it, TABLES);

    testWithHistory(
        "Hold from previous page, then a drag inside the hold: one undo group each",
        async ({ db, marchersAndPages: _, expectNumberOfChanges }) => {
            const { a, b } = await show(db);
            await move(db, PAGE3, [{ marcherId: b, xy: ELSEWHERE }]);
            const state = await expectNumberOfChanges.getDatabaseState(db);
            await holdFromPreviousPage({
                db,
                pageBox: PAGE3,
                marcherIds: [a, b],
            });
            await timelineResolverSettled();
            await move(db, PAGE3, [{ marcherId: a, xy: FAR }]);
            await expectNumberOfChanges.test(db, 2, state);
        },
    );
});
