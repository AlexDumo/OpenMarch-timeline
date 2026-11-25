import { expect } from "vitest";
import { eq, getTableName, sql } from "drizzle-orm";
import {
    createResolver,
    exactPathOnSpots,
    exactPointAt,
    followExactEnds,
    TICKS_PER_BEAT,
    type ExactPath,
    type Resolver,
    type XY,
} from "@openmarch/core";
import { refusalText } from "@/test/refusalText";
import { DbConnection, describeDbTests, schema } from "@/test/base";
import { keepFixturesInPageMode } from "@/test/timelineMode";
import { convertPagesToTimeline } from "@/test/convertPages";
import { readTimelineTables } from "@/timeline/timelineRows";
import { performRedo, performUndo, transactionWithHistory } from "../history";
import { TimelineWriteError } from "../timelineErrors";
import {
    setTimelineRangeInTransaction,
    setTimelineTransitionDestinationInTransaction,
} from "../timelineTransitionsInTransaction";
import { splitTimelineAtBeat } from "../timelineSplitAtBeat";
import { drawRoute, removeRoute } from "../timelineRoutes";
import { editPathPoints } from "../timelinePathEdits";
import { setExactPath } from "../timelineExactPaths";

keepFixturesInPageMode("its tests convert the show themselves");

/**
 * Exact paths, ADR 0018 step 3 (spec Appendix M): `setExactPath` stores one marcher's walk on the
 * converted `marchersAndPages` show (page 2's box is `[9, 17)`, 8 counts, 3840 ticks), and the
 * app's resolver plays it back from the file as `exactPointAt` says. One undo step per write, redo
 * restores the same ids; the ends follow the spots with the stored keys unchanged (QA-EP-5); a cut
 * and a resize keep it exact; the file is written as version 19.
 */

const TABLES = [
    schema.timelines,
    schema.timeline_transitions,
    schema.timeline_assignments,
    schema.timeline_slot_destinations,
    schema.timeline_routes,
    schema.timeline_lanes,
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

const userVersion = async (db: DbConnection): Promise<number> => {
    const row = (await db.get(
        sql`SELECT user_version AS v FROM pragma_user_version`,
    )) as { v: number } | unknown[];
    return Number(Array.isArray(row) ? row[0] : row.v);
};

const near = (a: XY, b: XY, tol = 1e-9) =>
    Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol;

/** Page 2's timeline, over [9, 17). */
const page2 = async (db: DbConnection) => {
    const timeline = (await db
        .select()
        .from(schema.timelines)
        .where(eq(schema.timelines.start_beat, 9))
        .get())!;
    expect(timeline.end_beat).toBe(17);
    return timeline;
};

/**
 * A path for marcher `m` over page 2: a corner off to the side on count 4 (a two-count hold there
 * from tick 1920 to 2880), then an arc into its spot. Starts and ends on its real spots.
 */
const pathFor = async (db: DbConnection, m: number): Promise<ExactPath> => {
    const r = await resolverOf(db);
    const A = r.positionAt(m, 9);
    const B = r.positionAt(m, 17);
    const corner: XY = [A[0] + 30, A[1] - 20];
    return {
        v: 1,
        from: [A[0], A[1]],
        shapes: [
            { kind: "points", points: [corner] },
            { kind: "arc", to: [B[0], B[1]], bend: 0.3 },
        ],
        keys: [
            { tick: 0, u: 0 },
            { tick: 1920, u: 1 },
            { tick: 2880, u: 1 },
            { tick: 3840, u: 2 },
        ],
    };
};

const setUp = async (db: DbConnection) => {
    await convertPagesToTimeline(db);
    const timeline = await page2(db);
    const m = (await resolverOf(db)).marcherIds()[0]!;
    const path = await pathFor(db, m);
    return { timeline, m, path };
};

const storedPath = async (db: DbConnection, routeId: number) => {
    const row = (await db
        .select()
        .from(schema.timeline_routes)
        .where(eq(schema.timeline_routes.id, routeId))
        .get())!;
    return row.exact_path === null
        ? null
        : (JSON.parse(row.exact_path) as ExactPath);
};

/** Expects marcher `m` to walk `path` over [start, start + its length) at every tick. */
const expectPlays = (
    r: Resolver,
    m: number,
    start: number,
    path: ExactPath,
) => {
    const last = path.keys[path.keys.length - 1]!.tick;
    for (let tick = 0; tick <= last; tick++) {
        const got = r.positionAt(m, start + tick / TICKS_PER_BEAT);
        const want = exactPointAt(path, tick);
        if (!near(got, want))
            expect.fail(`at tick ${tick}: ${String(got)} ≠ ${String(want)}`);
    }
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

describeDbTests("Exact paths: store and play (ADR 0018 step 3)", (it) => {
    it("stores a path on an own lane, plays it as exactPointAt at every tick, writes version 19; one undo step, redo restores the same ids", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { timeline, m, path } = await setUp(db);
        const others = await resolverOf(db);
        const original = await snapshot(db);
        expect(await userVersion(db)).toBeLessThan(19);

        const result = await setExactPath({
            db,
            timelineId: timeline.id,
            marcherId: m,
            path,
        });
        expect(await storedPath(db, result.routeId)).toEqual(path);
        expect(
            await db.select().from(schema.timeline_lanes).all(),
        ).toMatchObject([
            {
                transition_id: result.transitionId,
                slot_index: result.slot,
                route_id: result.routeId,
                offset_x: null,
                offset_y: null,
                adjust: null,
            },
        ]);
        // its plain geometry is the path's ends, no points: a straight own path to older readers
        const route = (await db.select().from(schema.timeline_routes).get())!;
        expect(JSON.parse(route.geometry)).toEqual({
            v: 1,
            from: path.from,
            to: (path.shapes[1] as { to: XY }).to,
            points: [],
        });
        expect(await userVersion(db)).toBe(19);

        const r = await resolverOf(db);
        expectPlays(r, m, 9, path);
        // nobody else moves
        for (const id of r.marcherIds())
            if (id !== m)
                for (let b = 0; b <= 40; b += 0.5)
                    expect(r.positionAt(id, b)).toEqual(
                        others.positionAt(id, b),
                    );

        const after = await snapshot(db);
        await performUndo(db);
        expect((await snapshot(db)).data).toEqual(original.data);
        await performRedo(db);
        expect((await snapshot(db)).data).toEqual(after.data);
        expectPlays(await resolverOf(db), m, 9, path);
        // the version is not lowered by undo (as 11 to 14 aren't)
        await performUndo(db);
        expect(await userVersion(db)).toBe(19);
    });

    it("QA-EP-5: moving the end spot moves the path's end; the stored keys are unchanged", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { timeline, m, path } = await setUp(db);
        const { routeId, transitionId, slot } = await setExactPath({
            db,
            timelineId: timeline.id,
            marcherId: m,
            path,
        });
        const D = schema.timeline_slot_destinations;
        const spots = await db
            .select()
            .from(D)
            .where(eq(D.transition_id, transitionId))
            .orderBy(D.slot_index)
            .all();
        const moved: XY = [spots[slot]!.x + 24, spots[slot]!.y + 12];
        await transactionWithHistory(db, "moveSpot", (tx) =>
            setTimelineTransitionDestinationInTransaction({
                tx,
                transitionId,
                destination: {
                    kind: "individual",
                    points: spots.map((s) =>
                        s.slot_index === slot ? moved : [s.x, s.y],
                    ),
                },
            }),
        );
        expect(await storedPath(db, routeId)).toEqual(path);
        const r = await resolverOf(db);
        const followed = followExactEnds(path, { to: moved });
        expect(followed.keys).toEqual(path.keys);
        expectPlays(r, m, 9, followed);
        // still on the corner from count 4 to count 6, at the moved spot on count 8
        expect(
            near(
                r.positionAt(m, 13),
                path.shapes[0]!.kind === "points"
                    ? path.shapes[0]!.points[0]!
                    : [0, 0],
            ),
        ).toBe(true);
        expect(near(r.positionAt(m, 15), r.positionAt(m, 13))).toBe(true);
        expect(near(r.positionAt(m, 17), moved)).toBe(true);
    });

    it("QA-EP-5: moving the start spot moves the path's start; the stored keys are unchanged", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { timeline, m, path } = await setUp(db);
        const { routeId } = await setExactPath({
            db,
            timelineId: timeline.id,
            marcherId: m,
            path,
        });
        // the start spot is page 1's end spot for m: move it
        const page1 = (await db
            .select()
            .from(schema.timelines)
            .where(eq(schema.timelines.end_beat, 9))
            .get())!;
        const t1 = (await db
            .select()
            .from(schema.timeline_transitions)
            .where(eq(schema.timeline_transitions.timeline_id, page1.id))
            .get())!;
        const row = (await db
            .select()
            .from(schema.timeline_assignments)
            .where(eq(schema.timeline_assignments.transition_id, t1.id))
            .all())!.find((a) => a.marcher_id === m)!;
        const D = schema.timeline_slot_destinations;
        const spots = await db
            .select()
            .from(D)
            .where(eq(D.transition_id, t1.id))
            .orderBy(D.slot_index)
            .all();
        const moved: XY = [
            spots[row.slot_index]!.x - 18,
            spots[row.slot_index]!.y,
        ];
        await transactionWithHistory(db, "moveSpot", (tx) =>
            setTimelineTransitionDestinationInTransaction({
                tx,
                transitionId: t1.id,
                destination: {
                    kind: "individual",
                    points: spots.map((s) =>
                        s.slot_index === row.slot_index ? moved : [s.x, s.y],
                    ),
                },
            }),
        );
        expect(await storedPath(db, routeId)).toEqual(path);
        const r = await resolverOf(db);
        expect(near(r.positionAt(m, 9), moved)).toBe(true);
        expectPlays(r, m, 9, followExactEnds(path, { from: moved }));
        // the corner is reached on count 4 as before
        expect(
            near(
                r.positionAt(m, 13),
                (path.shapes[0] as { points: XY[] }).points[0]!,
            ),
        ).toBe(true);
    });

    it("split at the playhead cuts it in two exact paths that play as before; one undo step", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { timeline, m, path } = await setUp(db);
        await setExactPath({ db, timelineId: timeline.id, marcherId: m, path });
        const before = await resolverOf(db);
        const original = await snapshot(db);
        await splitTimelineAtBeat({ db, timelineId: timeline.id, beat: 12 });
        const routes = await db.select().from(schema.timeline_routes).all();
        expect(routes).toHaveLength(2);
        const halves = routes.map(
            (r) => JSON.parse(r.exact_path!) as ExactPath,
        );
        // 3 counts and 5 counts
        expect(
            halves
                .map((h) => h.keys[h.keys.length - 1]!.tick)
                .sort((a, b) => a - b),
        ).toEqual([1440, 2400]);
        const r = await resolverOf(db);
        for (let tick = 0; tick <= 3840; tick += 3) {
            const b = 9 + tick / TICKS_PER_BEAT;
            expect(
                near(r.positionAt(m, b), before.positionAt(m, b), 1e-6),
            ).toBe(true);
        }
        await performUndo(db);
        expect((await snapshot(db)).data).toEqual(original.data);
    });

    it("a resize retimes the keys to the move's new length (EP-T)", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { timeline, m, path } = await setUp(db);
        const { routeId } = await setExactPath({
            db,
            timelineId: timeline.id,
            marcherId: m,
            path,
        });
        await transactionWithHistory(db, "resize", (tx) =>
            setTimelineRangeInTransaction({
                tx,
                timelineId: timeline.id,
                start: 9,
                end: 13,
            }),
        );
        const retimed = (await storedPath(db, routeId))!;
        expect(retimed.keys).toEqual([
            { tick: 0, u: 0 },
            { tick: 960, u: 1 },
            { tick: 1440, u: 1 },
            { tick: 1920, u: 2 },
        ]);
        expect(retimed.shapes).toEqual(path.shapes);
        const r = await resolverOf(db);
        const B = r.positionAt(m, 13);
        expectPlays(r, m, 9, exactPathOnSpots(retimed, path.from, B));
    });

    it("refuses a point edit with the reason; drawing the path again replaces it; Remove path removes it", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { timeline, m, path } = await setUp(db);
        const { routeId } = await setExactPath({
            db,
            timelineId: timeline.id,
            marcherId: m,
            path,
        });
        await expectRefused(
            db,
            () =>
                editPathPoints({
                    db,
                    routeId,
                    points: [{ at: [path.from[0] + 5, path.from[1] + 5] }],
                }),
            /Exact paths are fixed/,
        );
        const drawn = await drawRoute({
            db,
            timelineId: timeline.id,
            marcherId: m,
            points: [{ at: [path.from[0] + 5, path.from[1] + 5] }],
        });
        expect(drawn.routeId).toBe(routeId);
        expect(await storedPath(db, routeId)).toBeNull();
        await performUndo(db);
        expect(await storedPath(db, routeId)).toEqual(path);
        await removeRoute({ db, routeId });
        expect(await db.select().from(schema.timeline_routes).all()).toEqual(
            [],
        );
        expect(await db.select().from(schema.timeline_lanes).all()).toEqual([]);
    });

    it("refuses a path that breaks a rule or isn't its move's length, writing nothing", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { timeline, m, path } = await setUp(db);
        await expectRefused(
            db,
            () =>
                setExactPath({
                    db,
                    timelineId: timeline.id,
                    marcherId: m,
                    path: {
                        ...path,
                        keys: path.keys.map((k, i) =>
                            i === path.keys.length - 1
                                ? { ...k, tick: 3000 }
                                : k,
                        ),
                    },
                }),
            /3000 ticks long but its move is 3840/,
        );
        await expectRefused(
            db,
            () =>
                setExactPath({
                    db,
                    timelineId: timeline.id,
                    marcherId: m,
                    path: {
                        ...path,
                        keys: [
                            { tick: 0, u: 0 },
                            { tick: 3840, u: 1 },
                        ],
                    },
                }),
            /EP-5/,
        );
    });
});
