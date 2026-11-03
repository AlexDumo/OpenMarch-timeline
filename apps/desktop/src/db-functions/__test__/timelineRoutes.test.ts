import { expect } from "vitest";
import { asc, eq, getTableName } from "drizzle-orm";
import {
    createResolver,
    routePath,
    routePoint,
    type Resolver,
    type RouteGeometry,
    type XY,
} from "@openmarch/core";
import { sql } from "drizzle-orm";
import { refusalText } from "@/test/refusalText";
import { DbConnection, describeDbTests, schema } from "@/test/base";
import { keepFixturesInPageMode } from "@/test/timelineMode";
import { convertPagesToTimeline } from "@/test/convertPages";
import { readTimelineTables } from "@/timeline/timelineRows";
import { performRedo, performUndo, transactionWithHistory } from "../history";
import { TimelineWriteError } from "../timelineErrors";
import { createTimelinesInTransaction } from "../timelines";
import { createTimelineShapesInTransaction } from "../timelineShapes";
import {
    createTimelineTransitionsInTransaction,
    setTimelineTransitionDestinationInTransaction,
} from "../timelineTransitionsInTransaction";
import { createTimelineAssignmentsInTransaction } from "../timelineAssignments";
import { splitTimelineAtBeat } from "../timelineSplitAtBeat";
import { mergeMoves, splitMarchersIntoNewMove } from "../timelineSplitMoves";
import { deleteTimeline, setMovePath } from "../timelineCommands";
import { splitMovesAtBeatInTransaction } from "../timelinePointMoves";
import { drawRoute, readRoutes, removeRoute } from "../timelineRoutes";

keepFixturesInPageMode("its tests convert the show themselves");

/**
 * Routes, pathways step 1 (spec v0.9 Appendix I.2 and I.3): the app procedures AP-R1 to AP-R7 on
 * the converted `marchersAndPages` show (pages of 8 counts; page 2's box is `[9, 17)`, one
 * shapeless direct transition per page move holding every marcher). QA-AP-R1 to QA-AP-R4,
 * QA-UNDO-R1, and QA-RT-7's procedure side: each edit is one undo step, a refused edit writes
 * nothing, and the app's resolver agrees with the path the route describes.
 */

const TABLES = [
    schema.timelines,
    schema.timeline_shapes,
    schema.timeline_transitions,
    schema.timeline_assignments,
    schema.timeline_slot_destinations,
    schema.timeline_routes,
];

const dataOf = async (db: DbConnection) => {
    const out: Record<string, unknown[]> = {};
    for (const table of TABLES)
        out[getTableName(table)] = await db.select().from(table).all();
    return out;
};

const snapshot = async (db: DbConnection) => ({
    data: await dataOf(db),
    undo: await db.select().from(schema.history_undo).all(),
    redo: await db.select().from(schema.history_redo).all(),
});

const resolverOf = async (db: DbConnection): Promise<Resolver> =>
    createResolver((await readTimelineTables(db)).snapshot);

/** Every marcher's position at each half beat from 0 to `end`. */
const positions = (r: Resolver, end: number) =>
    r
        .marcherIds()
        .map((id) =>
            Array.from({ length: 2 * end + 1 }, (_, i) =>
                r.positionAt(id, i / 2),
            ),
        );

const expectSamePositions = (
    a: XY[][],
    b: XY[][],
    tolerance: number,
    skip: (m: number) => boolean = () => false,
) => {
    expect(b.length).toBe(a.length);
    a.forEach((row, m) => {
        if (skip(m)) return;
        row.forEach((p, i) => {
            expect(Math.abs(p[0] - b[m]![i]![0])).toBeLessThanOrEqual(
                tolerance,
            );
            expect(Math.abs(p[1] - b[m]![i]![1])).toBeLessThanOrEqual(
                tolerance,
            );
        });
    });
};

/** Page 2's timeline, over [9, 17), and its one transition. */
const page2 = async (db: DbConnection) => {
    const timeline = (await db
        .select()
        .from(schema.timelines)
        .where(eq(schema.timelines.start_beat, 9))
        .get())!;
    expect(timeline.end_beat).toBe(17);
    return timeline;
};

const expectRefused = async (
    db: DbConnection,
    write: () => Promise<unknown>,
    message: RegExp,
) => {
    const before = await snapshot(db);
    const error = await write().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TimelineWriteError);
    expect((error as TimelineWriteError).code).toBe("E-ARGS");
    expect(refusalText(error)).toMatch(message);
    expect(await snapshot(db)).toEqual(before);
};

/** A one-marcher move over `[start, end)` on layer 1, heading for `point`. */
const overlay = (
    db: DbConnection,
    marcherId: number,
    start: number,
    end: number,
    point: XY,
) =>
    transactionWithHistory(db, "overlay", async (tx) => {
        const [t] = await createTimelinesInTransaction({
            tx,
            newTimelines: [{ startBeat: start, endBeat: end }],
        });
        const [made] = await createTimelineTransitionsInTransaction({
            tx,
            newTransitions: [
                {
                    timelineId: t!.id,
                    slotCount: 1,
                    destination: { kind: "individual", points: [point] },
                },
            ],
        });
        await createTimelineAssignmentsInTransaction({
            tx,
            newAssignments: [
                {
                    marcherId,
                    transitionId: made!.id,
                    slotIndex: 0,
                    startBeat: start,
                    endBeat: end,
                    layer: 1,
                },
            ],
        });
        return t!;
    });

const userVersion = async (db: DbConnection) =>
    (
        (await db.all(sql`PRAGMA user_version`)) as
            | { user_version: number }[]
            | number[][]
    ).map((r) => (Array.isArray(r) ? r[0] : r.user_version))[0];

/** Two corners off the straight line between where `m` stands at 9 and where it is at 17. */
const cornersFor = async (db: DbConnection, m: number): Promise<XY[]> => {
    const r = await resolverOf(db);
    const a = r.positionAt(m, 9);
    const b = r.positionAt(m, 17);
    return [
        [a[0] + 40, a[1] - 30],
        [b[0] - 25, b[1] + 50],
    ];
};

/** Where the route of `m` in page 2 says it is at `beat`, from its stored corners (R-14). */
const onRoute = async (db: DbConnection, m: number, beat: number) => {
    const r = await resolverOf(db);
    const [route] = (await readRoutes(db)).filter((x) => x.marcherId === m);
    const A = r.explain(m, route!.start).origin;
    const B = r.positionAt(m, route!.end);
    const path = routePath(
        A,
        route!.geometry.points.map((p) => p.at),
        B,
    );
    return routePoint(
        path,
        (beat - route!.start) / (route!.end - route!.start),
    );
};

describeDbTests("Routes: draw a path (AP-R1, AP-R2, AP-R3)", (it) => {
    it("draws a route for one marcher of a shared move: own transition, one undo step, others unchanged; redo restores the same ids", async ({
        db,
        marchersAndPages: _,
    }) => {
        await convertPagesToTimeline(db);
        const timeline = await page2(db);
        const before = await resolverOf(db);
        const m = before.marcherIds()[0]!;
        const positionsBefore = positions(before, 56);
        const original = await snapshot(db);
        const corners = await cornersFor(db, m);

        const result = await drawRoute({
            db,
            timelineId: timeline.id,
            marcherId: m,
            points: corners.map((at) => ({ at })),
        });
        expect(result.ownTransition).toBe(true);
        const [route] = await readRoutes(db);
        expect(route).toMatchObject({
            routeId: result.routeId,
            transitionId: result.transitionId,
            timelineId: timeline.id,
            marcherId: m,
            start: 9,
            end: 17,
        });
        expect(route!.geometry.points.map((p) => p.at)).toEqual(corners);
        expect(route!.geometry.from).toEqual(before.positionAt(m, 9));
        expect(route!.geometry.to).toEqual(before.positionAt(m, 17));
        expect(await userVersion(db)).toBe(10);

        // The others are where they were at every beat; the marcher walks the route
        const after = await resolverOf(db);
        const index = after.marcherIds().indexOf(m);
        expectSamePositions(
            positionsBefore,
            positions(after, 56),
            0,
            (i) => i === index,
        );
        for (const beat of [9, 10, 11.5, 13, 15, 16.5, 17]) {
            const want = await onRoute(db, m, beat);
            const got = after.positionAt(m, beat);
            expect(Math.abs(got[0] - want[0])).toBeLessThan(1e-9);
            expect(Math.abs(got[1] - want[1])).toBeLessThan(1e-9);
        }
        // The marcher left the straight line between its ends
        const mid = after.positionAt(m, 13);
        const straight = before.positionAt(m, 13);
        expect(
            Math.hypot(mid[0] - straight[0], mid[1] - straight[1]),
        ).toBeGreaterThan(1);

        const drawn = await dataOf(db);
        expect((await performUndo(db)).success).toBe(true);
        expect((await snapshot(db)).data).toEqual(original.data);
        expect(positions(await resolverOf(db), 56)).toEqual(positionsBefore);
        expect((await performRedo(db)).success).toBe(true);
        expect(await dataOf(db)).toEqual(drawn);
    });

    it("draws a route for a marcher of a shape move: own transition, others unchanged, undo exact (QA-AP-R2)", async ({
        db,
        marchersAndPages: _,
    }) => {
        await convertPagesToTimeline(db);
        const timeline = await page2(db);
        const transition = (await db
            .select()
            .from(schema.timeline_transitions)
            .where(eq(schema.timeline_transitions.timeline_id, timeline.id))
            .get())!;
        await transactionWithHistory(db, "shape", async (tx) => {
            const [shape] = await createTimelineShapesInTransaction({
                tx,
                newShapes: [
                    {
                        kind: "line",
                        geometry: {
                            points: [
                                [0, 0],
                                [100, 40],
                            ],
                        },
                    },
                ],
            });
            await setTimelineTransitionDestinationInTransaction({
                tx,
                transitionId: transition.id,
                destination: { kind: "shape", shapeId: shape!.id },
            });
        });
        const before = await resolverOf(db);
        const m = before.marcherIds()[1]!;
        const positionsBefore = positions(before, 56);
        const original = await snapshot(db);

        await drawRoute({
            db,
            timelineId: timeline.id,
            marcherId: m,
            points: (await cornersFor(db, m)).map((at) => ({ at })),
        });
        const after = await resolverOf(db);
        const index = after.marcherIds().indexOf(m);
        expectSamePositions(
            positionsBefore,
            positions(after, 56),
            0,
            (i) => i === index,
        );
        // It arrives where its shape slot did
        expect(after.positionAt(m, 17)).toEqual(before.positionAt(m, 17));

        expect((await performUndo(db)).success).toBe(true);
        expect((await snapshot(db)).data).toEqual(original.data);
    });

    it("draws it again in place: the route keeps its id, a dragged point keeps its id, a new point gets a fresh one", async ({
        db,
        marchersAndPages: _,
    }) => {
        await convertPagesToTimeline(db);
        const timeline = await page2(db);
        const m = (await resolverOf(db)).marcherIds()[0]!;
        const corners = await cornersFor(db, m);
        const first = await drawRoute({
            db,
            timelineId: timeline.id,
            marcherId: m,
            points: corners.map((at) => ({ at })),
        });
        const [drawn] = await readRoutes(db);
        const [p1, p2] = drawn!.geometry.points;
        const again = await drawRoute({
            db,
            timelineId: timeline.id,
            marcherId: m,
            points: [
                { id: p1!.id, at: [p1!.at[0] + 1, p1!.at[1]] },
                { at: [5, 5] },
                { id: p2!.id, at: p2!.at },
            ],
        });
        expect(again).toMatchObject({
            routeId: first.routeId,
            transitionId: first.transitionId,
            ownTransition: false,
        });
        const [redrawn] = await readRoutes(db);
        const ids = redrawn!.geometry.points.map((p) => p.id);
        expect(ids[0]).toBe(p1!.id);
        expect(ids[2]).toBe(p2!.id);
        expect([p1!.id, p2!.id]).not.toContain(ids[1]);
        // One undo step: the first drawing is back
        expect((await performUndo(db)).success).toBe(true);
        expect((await readRoutes(db))[0]!.geometry).toEqual(drawn!.geometry);
        // An id from another route is refused (E-ARGS), written nowhere
        await expect(
            drawRoute({
                db,
                timelineId: timeline.id,
                marcherId: m,
                points: [{ id: "nope", at: [0, 0] }],
            }),
        ).rejects.toMatchObject({ code: "E-ARGS" });
    });

    it("Remove path, and deleting the move with a route, are each one undo step that restores the database (QA-UNDO-R1)", async ({
        db,
        marchersAndPages: _,
    }) => {
        await convertPagesToTimeline(db);
        const timeline = await page2(db);
        const m = (await resolverOf(db)).marcherIds()[0]!;
        const result = await drawRoute({
            db,
            timelineId: timeline.id,
            marcherId: m,
            points: (await cornersFor(db, m)).map((at) => ({ at })),
        });
        const drawn = await snapshot(db);
        const drawnPositions = positions(await resolverOf(db), 56);

        await removeRoute({ db, transitionId: result.transitionId });
        expect(await readRoutes(db)).toEqual([]);
        const t = (await db
            .select()
            .from(schema.timeline_transitions)
            .where(eq(schema.timeline_transitions.id, result.transitionId))
            .get())!;
        expect(t).toMatchObject({
            path_style: "direct",
            route_id: null,
            path_params: null,
        });
        const removed = await dataOf(db);
        expect((await performUndo(db)).success).toBe(true);
        expect((await snapshot(db)).data).toEqual(drawn.data);
        expect(positions(await resolverOf(db), 56)).toEqual(drawnPositions);
        expect((await performRedo(db)).success).toBe(true);
        expect(await dataOf(db)).toEqual(removed);
        expect((await performUndo(db)).success).toBe(true);

        // AP-R3: the move goes with its route
        await deleteTimeline({ db, timelineId: timeline.id });
        expect(await db.select().from(schema.timeline_routes).all()).toEqual(
            [],
        );
        const deleted = await dataOf(db);
        expect((await performUndo(db)).success).toBe(true);
        expect((await snapshot(db)).data).toEqual(drawn.data);
        expect((await performRedo(db)).success).toBe(true);
        expect(await dataOf(db)).toEqual(deleted);
    });

    it("refuses, writing nothing: a join, Straight and Arc on a move with a path, split by marchers, merge (QA-AP-R1)", async ({
        db,
        marchersAndPages: _,
    }) => {
        await convertPagesToTimeline(db);
        const timeline = await page2(db);
        const ids = (await resolverOf(db)).marcherIds();
        const [m, other, taken] = [ids[0]!, ids[1]!, ids[2]!];

        // Taken over at the start of the move by a later move on a higher layer
        await overlay(db, taken, 9, 12, [3, 3]);
        await expectRefused(
            db,
            () =>
                drawRoute({
                    db,
                    timelineId: timeline.id,
                    marcherId: taken,
                    points: [],
                }),
            /taken over at the start of this move/,
        );

        await drawRoute({
            db,
            timelineId: timeline.id,
            marcherId: m,
            points: (await cornersFor(db, m)).map((at) => ({ at })),
        });
        await expectRefused(
            db,
            () => setMovePath({ db, timelineId: timeline.id, style: "direct" }),
            /has a drawn path: remove it first/,
        );
        await expectRefused(
            db,
            () =>
                setMovePath({
                    db,
                    timelineId: timeline.id,
                    style: "arc",
                    bulge: 0.3,
                }),
            /has a drawn path: remove it first/,
        );
        await expectRefused(
            db,
            () =>
                splitMarchersIntoNewMove({
                    db,
                    timelineId: timeline.id,
                    marcherIds: [m],
                }),
            /has a drawn path, which this edit can't keep yet/,
        );
        const page3 = (await db
            .select()
            .from(schema.timelines)
            .where(eq(schema.timelines.start_beat, 17))
            .get())!;
        await expectRefused(
            db,
            () => mergeMoves({ db, sourceId: page3.id, targetId: timeline.id }),
            /has a drawn path, which this edit can't keep yet/,
        );
        // Splitting off a marcher without a path still works
        await splitMarchersIntoNewMove({
            db,
            timelineId: timeline.id,
            marcherIds: [other],
        });
    });

    it("Basic's + page flag inside a page leaves a marcher with a route alone (QA-AP-R4)", async ({
        db,
        marchersAndPages: _,
    }) => {
        await convertPagesToTimeline(db);
        const timeline = await page2(db);
        const m = (await resolverOf(db)).marcherIds()[0]!;
        await drawRoute({
            db,
            timelineId: timeline.id,
            marcherId: m,
            points: (await cornersFor(db, m)).map((at) => ({ at })),
        });
        const routesBefore = await readRoutes(db);
        const result = await transactionWithHistory(db, "split", (tx) =>
            splitMovesAtBeatInTransaction({
                tx,
                beat: 13,
                box: { start: 9, end: 17 },
            }),
        );
        expect(result.leftAlone).toContain(m);
        expect(await readRoutes(db)).toEqual(routesBefore);
    });
});

describeDbTests("Routes: cut at a count (AP-R7, QA-AP-R3)", (it) => {
    /** Draws the route; returns what the cut test compares. */
    const setUp = async (
        db: DbConnection,
        corners?: (m: number) => Promise<XY[]>,
    ) => {
        await convertPagesToTimeline(db);
        const timeline = await page2(db);
        const m = (await resolverOf(db)).marcherIds()[0]!;
        await drawRoute({
            db,
            timelineId: timeline.id,
            marcherId: m,
            points: ((await corners?.(m)) ?? (await cornersFor(db, m))).map(
                (at) => ({ at }),
            ),
        });
        return { timeline, m };
    };

    const tolerance = (L: number) => 1e-9 + 1e-9 * Math.max(1, L);

    it("cuts between corners and on a corner with no change in motion; ids kept; one undo step", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { timeline, m } = await setUp(db);
        const [route] = await readRoutes(db);
        const before = await resolverOf(db);
        const positionsBefore = positions(before, 56);
        const original = await snapshot(db);
        const C = before.positionAt(m, 12);

        const result = await splitTimelineAtBeat({
            db,
            timelineId: timeline.id,
            beat: 12,
        });
        const after = await resolverOf(db);
        expectSamePositions(
            positionsBefore,
            positions(after, 56),
            tolerance(200),
        );
        expect(after.positionAt(m, 12)).toEqual(C);

        const routes = await readRoutes(db);
        expect(routes).toHaveLength(2);
        const later = routes.find((r) => r.timelineId === result.after.id)!;
        const earlier = routes.find((r) => r.timelineId === result.before.id)!;
        // The route from the count keeps its id; corners are split between the halves, ids kept
        expect(later.routeId).toBe(route!.routeId);
        expect(later.geometry.from).toEqual(C);
        expect(earlier.geometry.to).toEqual(C);
        expect(
            [...earlier.geometry.points, ...later.geometry.points].map(
                (p) => p.id,
            ),
        ).toEqual(route!.geometry.points.map((p) => p.id));
        // No corner within EPS_GEOM of C
        for (const p of [...earlier.geometry.points, ...later.geometry.points])
            expect(Math.hypot(p.at[0] - C[0], p.at[1] - C[1])).toBeGreaterThan(
                1e-9,
            );

        expect((await performUndo(db)).success).toBe(true);
        expect((await snapshot(db)).data).toEqual(original.data);
    });

    it("cuts exactly on a corner: the corner goes to neither half", async ({
        db,
        marchersAndPages: _,
    }) => {
        // Corners where the marcher is at counts 11 and 14 of a path walked at constant speed:
        // put the first corner on the straight line at 3/8 so the cut at 12 lands on it
        const { timeline, m } = await setUp(db, async (marcher) => {
            const r = await resolverOf(db);
            const a = r.positionAt(marcher, 9);
            const b = r.positionAt(marcher, 17);
            const at = (f: number): XY => [
                a[0] + (b[0] - a[0]) * f,
                a[1] + (b[1] - a[1]) * f,
            ];
            return [at(3 / 8)];
        });
        const before = await resolverOf(db);
        const positionsBefore = positions(before, 56);
        await splitTimelineAtBeat({ db, timelineId: timeline.id, beat: 12 });
        const routes = await readRoutes(db);
        expect(routes.flatMap((r) => r.geometry.points)).toEqual([]);
        expectSamePositions(
            positionsBefore,
            positions(await resolverOf(db), 56),
            tolerance(200),
        );
        void m;
    });

    it("cuts while a higher layer hides the marcher at the count (it resumes after); and a takeover after the count", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { timeline, m } = await setUp(db);
        await overlay(db, m, 11, 14, [7, 7]);
        const positionsBefore = positions(await resolverOf(db), 56);
        await splitTimelineAtBeat({ db, timelineId: timeline.id, beat: 12 });
        expectSamePositions(
            positionsBefore,
            positions(await resolverOf(db), 56),
            tolerance(200),
        );
    });

    it("refuses a row taken over and resumed before the count, or resumed exactly at it", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { timeline, m } = await setUp(db);
        const steal = await overlay(db, m, 10, 11, [7, 7]);
        await expectRefused(
            db,
            () =>
                splitTimelineAtBeat({ db, timelineId: timeline.id, beat: 12 }),
            /taken over earlier in this move/,
        );
        await deleteTimeline({ db, timelineId: steal.id });
        await overlay(db, m, 10, 12, [7, 7]);
        await expectRefused(
            db,
            () =>
                splitTimelineAtBeat({ db, timelineId: timeline.id, beat: 12 }),
            /taken over earlier in this move/,
        );
        void (asc as unknown);
    });
});

/** Keeps the type import used in assertions readable. */
export type _RouteGeometry = RouteGeometry;
