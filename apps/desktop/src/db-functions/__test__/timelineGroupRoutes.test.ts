import { expect } from "vitest";
import { eq, getTableName } from "drizzle-orm";
import {
    createResolver,
    groupMemberWalk,
    groupSchedule,
    type Resolver,
    type RouteGeometry,
    type XY,
} from "@openmarch/core";
import { refusalText } from "@/test/refusalText";
import { DbConnection, describeDbTests, schema } from "@/test/base";
import { keepFixturesInPageMode } from "@/test/timelineMode";
import { convertPagesToTimeline } from "@/test/convertPages";
import { readTimelineTables } from "@/timeline/timelineRows";
import { performRedo, performUndo } from "../history";
import { TimelineWriteError } from "../timelineErrors";
import { splitTimelineAtBeat } from "../timelineSplitAtBeat";
import { deleteTimeline } from "../timelineCommands";
import { deleteTimelineTransitionRowsInTransaction } from "../timelineTransitionsInTransaction";
import { transactionWithHistory } from "../history";
import { drawRoute, readRoutes, removeRoute } from "../timelineRoutes";
import {
    drawGroupRoute,
    editGroupRoutePoints,
    meanOf,
    offsetOf,
    ownPath,
    readGroupPaths,
    rejoinGroupPath,
} from "../timelineGroupRoutes";

keepFixturesInPageMode("its tests convert the show themselves");

/**
 * Group paths, pathways step 15 (spec v0.9 R-14 group schedule, Appendix I.8 and I.9): AP-R8 to
 * AP-R10 and the step 15 changes to AP-R1, AP-R2, AP-R3 and AP-R7, on the converted
 * `marchersAndPages` show (page 2's box is `[9, 17)`, one shapeless direct transition holding
 * every marcher). QA-AP-R7 to QA-AP-R13 and QA-UNDO-R3: each edit is one undo step, redo restores
 * the same ids, a refused edit writes nothing, and the resolver walks the group schedule.
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
const positions = (r: Resolver, end: number) =>
    r
        .marcherIds()
        .map((id) =>
            Array.from({ length: 4 * end + 1 }, (_, i) =>
                r.positionAt(id, i / 4),
            ),
        );
const page2 = async (db: DbConnection) =>
    (await db
        .select()
        .from(schema.timelines)
        .where(eq(schema.timelines.start_beat, 9))
        .get())!;
const dist = (p: XY, q: XY) => Math.hypot(q[0] - p[0], q[1] - p[1]);

/** One undo step that restores the data exactly, and a redo that restores the same rows. */
const expectOneUndoStep = async (
    db: DbConnection,
    before: Awaited<ReturnType<typeof dataOf>>,
) => {
    const after = await dataOf(db);
    expect((await performUndo(db)).success).toBe(true);
    expect(await dataOf(db)).toEqual(before);
    expect((await performRedo(db)).success).toBe(true);
    expect(await dataOf(db)).toEqual(after);
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

/** A smooth point and a corner off the group's straight line, around the middle of its starts. */
const groupPoints = async (db: DbConnection, ids: number[]) => {
    const r = await resolverOf(db);
    const F = meanOf(ids.map((m) => r.positionAt(m, 9) as XY));
    const G = meanOf(ids.map((m) => r.positionAt(m, 17) as XY));
    return [
        { at: [F[0] + 30, F[1] - 40] as XY, tension: 1 },
        { at: [G[0] - 20, G[1] + 35] as XY },
    ];
};

const routeOf = async (db: DbConnection, routeId: number) =>
    JSON.parse(
        (await db
            .select()
            .from(schema.timeline_routes)
            .where(eq(schema.timeline_routes.id, routeId))
            .get())!.geometry,
    ) as RouteGeometry;

const transitionOf = async (db: DbConnection, id: number) =>
    (await db
        .select()
        .from(schema.timeline_transitions)
        .where(eq(schema.timeline_transitions.id, id))
        .get())!;

describeDbTests("Group paths (AP-R8 to AP-R10)", (it) => {
    it("a block travels along a curve on one group path and lands on its end set; one undo step, same ids on redo (QA-AP-R7)", async ({
        db,
        marchersAndPages: _,
    }) => {
        await convertPagesToTimeline(db);
        const timeline = await page2(db);
        const before = await resolverOf(db);
        const ids = before.marcherIds().slice(0, 4);
        const ends = ids.map((m) => before.positionAt(m, 17) as XY);
        const starts = ids.map((m) => before.positionAt(m, 9) as XY);
        const others = before.marcherIds().slice(4);
        const original = await dataOf(db);
        const points = await groupPoints(db, ids);

        const result = await drawGroupRoute({
            db,
            timelineId: timeline.id,
            marcherIds: ids,
            points,
        });
        const geometry = await routeOf(db, result.routeId);
        expect(geometry.from).toEqual(meanOf(starts));
        expect(geometry.to).toEqual(meanOf(ends));
        expect(geometry.points.map((p) => p.at)).toEqual(
            points.map((p) => p.at),
        );
        expect(geometry.points[0]!.tension).toBe(1);
        for (const [i, m] of ids.entries()) {
            const t = await transitionOf(db, result.transitions[m]!);
            expect(t.path_style).toBe("route");
            expect(t.route_id).toBe(result.routeId);
            expect(offsetOf(t.path_params)).toEqual([
                starts[i]![0] - geometry.from[0],
                starts[i]![1] - geometry.from[1],
            ]);
        }
        expect(await readGroupPaths(db, timeline.id)).toEqual([
            {
                routeId: result.routeId,
                marcherIds: [...ids].sort((a, b) => a - b),
            },
        ]);

        // Every member walks its lane: on its placed points at the moments, at its end on 17
        const after = await resolverOf(db);
        const schedule = groupSchedule(geometry);
        for (const [i, m] of ids.entries()) {
            const o = offsetOf(
                (await transitionOf(db, result.transitions[m]!)).path_params,
            )!;
            const walk = groupMemberWalk(schedule, starts[i]!, ends[i]!, o);
            const W1 = schedule.W.V[1]!;
            expect(
                dist(after.positionAt(m, 9 + 8 * schedule.uFirst) as XY, [
                    W1[0] + o[0],
                    W1[1] + o[1],
                ]),
            ).toBeLessThan(1e-6);
            expect(after.positionAt(m, 17)).toEqual(ends[i]);
            expect(after.positionAt(m, 9)).toEqual(starts[i]);
            expect(walk.first).not.toBeNull();
        }
        // Rigid between the first and last points
        const mid = 9 + 8 * ((schedule.uFirst + schedule.uLast) / 2);
        const d01 = (b: number) => {
            const p = after.positionAt(ids[0]!, b);
            const q = after.positionAt(ids[1]!, b);
            return [q[0] - p[0], q[1] - p[1]] as XY;
        };
        expect(dist(d01(mid), d01(9 + 8 * schedule.uFirst))).toBeLessThan(1e-6);
        // The others don't move
        for (const m of others)
            for (const b of [9, 11, 13, 15, 17])
                expect(after.positionAt(m, b)).toEqual(before.positionAt(m, b));

        await expectOneUndoStep(db, original);
    });

    it("draws again on the same marchers in place; on two of them a new path, the old keeps the other two (QA-AP-R8)", async ({
        db,
        marchersAndPages: _,
    }) => {
        await convertPagesToTimeline(db);
        const timeline = await page2(db);
        const ids = (await resolverOf(db)).marcherIds().slice(0, 4);
        const first = await drawGroupRoute({
            db,
            timelineId: timeline.id,
            marcherIds: ids,
            points: await groupPoints(db, ids),
        });
        const before = await dataOf(db);
        const again = await drawGroupRoute({
            db,
            timelineId: timeline.id,
            marcherIds: ids,
            points: [{ at: [10, 10] }],
        });
        expect(again.routeId).toBe(first.routeId);
        expect(
            (await routeOf(db, first.routeId)).points.map((p) => p.at),
        ).toEqual([[10, 10]]);
        await expectOneUndoStep(db, before);

        const offsets = async (ms: number[]) =>
            Promise.all(
                ms.map(
                    async (m) =>
                        (await transitionOf(db, first.transitions[m]!))
                            .path_params,
                ),
            );
        const kept = await offsets(ids.slice(2));
        const before2 = await dataOf(db);
        const pair = await drawGroupRoute({
            db,
            timelineId: timeline.id,
            marcherIds: ids.slice(0, 2),
            points: [{ at: [20, 0] }],
        });
        expect(pair.routeId).not.toBe(first.routeId);
        expect(await offsets(ids.slice(2))).toEqual(kept);
        const groups = await readGroupPaths(db, timeline.id);
        expect(groups).toHaveLength(2);
        await expectOneUndoStep(db, before2);
    });

    it("one member breaks off with Own path and rejoins: line kept, positions back bit for bit; each one undo step (QA-AP-R9)", async ({
        db,
        marchersAndPages: _,
    }) => {
        await convertPagesToTimeline(db);
        const timeline = await page2(db);
        const r0 = await resolverOf(db);
        const ids = r0.marcherIds().slice(0, 4);
        const drawn = await drawGroupRoute({
            db,
            timelineId: timeline.id,
            marcherIds: ids,
            points: await groupPoints(db, ids),
        });
        const onGroup = positions(await resolverOf(db), 30);
        const m = ids[1]!;
        const index = r0.marcherIds().indexOf(m);
        const group = await routeOf(db, drawn.routeId);
        const t = await transitionOf(db, drawn.transitions[m]!);
        const o = offsetOf(t.path_params)!;

        const before = await dataOf(db);
        const own = await ownPath({
            db,
            timelineId: timeline.id,
            marcherIds: [m],
        });
        const copy = await routeOf(db, own.routes[m]!);
        expect(copy.from).toEqual([group.from[0] + o[0], group.from[1] + o[1]]);
        expect(copy.points.map((p) => p.id)).toEqual(
            group.points.map((p) => p.id),
        );
        expect(copy.points[0]!.tension).toBe(group.points[0]!.tension);
        expect((await transitionOf(db, t.id)).path_params).toBeNull();
        // The others are untouched, bit for bit
        const afterOwn = positions(await resolverOf(db), 30);
        afterOwn.forEach((row, i) => {
            if (i !== index) expect(row).toEqual(onGroup[i]);
        });
        // It still starts and ends where it did
        expect(afterOwn[index]![36]).toEqual(onGroup[index]![36]);
        expect(afterOwn[index]![68]).toEqual(onGroup[index]![68]);
        await expectOneUndoStep(db, before);

        const before2 = await dataOf(db);
        await rejoinGroupPath({
            db,
            timelineId: timeline.id,
            routeId: drawn.routeId,
            marcherIds: [m],
        });
        expect(offsetOf((await transitionOf(db, t.id)).path_params)).toEqual(o);
        expect(positions(await resolverOf(db), 30)).toEqual(onGroup);
        expect(await readRoutes(db)).toHaveLength(4);
        await expectOneUndoStep(db, before2);
    });

    it("Own path for every member deletes the group path; Rejoin adds a straight marcher to the group (QA-AP-R9)", async ({
        db,
        marchersAndPages: _,
    }) => {
        await convertPagesToTimeline(db);
        const timeline = await page2(db);
        const r0 = await resolverOf(db);
        const ids = r0.marcherIds().slice(0, 3);
        const drawn = await drawGroupRoute({
            db,
            timelineId: timeline.id,
            marcherIds: ids,
            points: await groupPoints(db, ids),
        });
        const extra = r0.marcherIds()[3]!;
        const before = await dataOf(db);
        const joined = await rejoinGroupPath({
            db,
            timelineId: timeline.id,
            routeId: drawn.routeId,
            marcherIds: [extra],
        });
        const g = await routeOf(db, drawn.routeId);
        const A = r0.positionAt(extra, 9);
        const t = await transitionOf(db, joined.transitions[extra]!);
        expect(t.route_id).toBe(drawn.routeId);
        expect(offsetOf(t.path_params)).toEqual([
            A[0] - g.from[0],
            A[1] - g.from[1],
        ]);
        expect((await resolverOf(db)).positionAt(extra, 17)).toEqual(
            r0.positionAt(extra, 17),
        );
        await expectOneUndoStep(db, before);

        const before2 = await dataOf(db);
        await ownPath({
            db,
            timelineId: timeline.id,
            marcherIds: [...ids, extra],
        });
        expect(
            await db
                .select()
                .from(schema.timeline_routes)
                .where(eq(schema.timeline_routes.id, drawn.routeId))
                .get(),
        ).toBeUndefined();
        expect(await readGroupPaths(db, timeline.id)).toEqual([]);
        await expectOneUndoStep(db, before2);
    });

    it("refuses with a reason, writing nothing (QA-AP-R10)", async ({
        db,
        marchersAndPages: _,
    }) => {
        await convertPagesToTimeline(db);
        const timeline = await page2(db);
        const ids = (await resolverOf(db)).marcherIds();
        await expectRefused(
            db,
            () =>
                drawGroupRoute({
                    db,
                    timelineId: timeline.id,
                    marcherIds: [ids[0]!],
                    points: [],
                }),
            /two or more marchers/,
        );
        await expectRefused(
            db,
            () =>
                ownPath({ db, timelineId: timeline.id, marcherIds: [ids[0]!] }),
            /doesn't follow a group path/,
        );
        const drawn = await drawGroupRoute({
            db,
            timelineId: timeline.id,
            marcherIds: ids.slice(0, 2),
            points: [{ at: [5, 5] }],
        });
        // Split at the playhead on a group path: refused with how to go on
        await expectRefused(
            db,
            () =>
                splitTimelineAtBeat({ db, timelineId: timeline.id, beat: 13 }),
            /Own path/,
        );
        // A marcher with its own path refuses Own path
        await drawRoute({
            db,
            timelineId: timeline.id,
            marcherId: ids[2]!,
            points: [{ at: [1, 1] }],
        });
        await expectRefused(
            db,
            () =>
                ownPath({ db, timelineId: timeline.id, marcherIds: [ids[2]!] }),
            /doesn't follow a group path/,
        );
        // Rejoin onto a route that isn't a group path
        const own = (await readRoutes(db)).find((r) => r.marcherId === ids[2]);
        await expectRefused(
            db,
            () =>
                rejoinGroupPath({
                    db,
                    timelineId: timeline.id,
                    routeId: own!.routeId,
                    marcherIds: [ids[3]!],
                }),
            /no group path/,
        );
        expect(drawn.routeId).toBeGreaterThan(0);
    });

    it("Remove path on one member removes the whole group's; deleting one member leaves the path to the others, the move takes it (QA-AP-R11)", async ({
        db,
        marchersAndPages: _,
    }) => {
        await convertPagesToTimeline(db);
        const timeline = await page2(db);
        const ids = (await resolverOf(db)).marcherIds().slice(0, 4);
        const drawn = await drawGroupRoute({
            db,
            timelineId: timeline.id,
            marcherIds: ids,
            points: await groupPoints(db, ids),
        });
        const before = await dataOf(db);
        const removed = await removeRoute({
            db,
            transitionId: drawn.transitions[ids[2]!]!,
        });
        expect(removed.marcherIds).toEqual([...ids].sort((a, b) => a - b));
        for (const m of ids)
            expect(await transitionOf(db, drawn.transitions[m]!)).toMatchObject(
                {
                    path_style: "direct",
                    route_id: null,
                    path_params: null,
                },
            );
        expect(await db.select().from(schema.timeline_routes).all()).toEqual(
            [],
        );
        await expectOneUndoStep(db, before);
        expect((await performUndo(db)).success).toBe(true);

        const before2 = await dataOf(db);
        await transactionWithHistory(db, "deleteOne", (tx) =>
            deleteTimelineTransitionRowsInTransaction({
                tx,
                transitionIds: new Set([drawn.transitions[ids[0]!]!]),
            }),
        );
        expect(await readGroupPaths(db, timeline.id)).toEqual([
            {
                routeId: drawn.routeId,
                marcherIds: [...ids.slice(1)].sort((a, b) => a - b),
            },
        ]);
        await expectOneUndoStep(db, before2);
        expect((await performUndo(db)).success).toBe(true);

        await deleteTimeline({ db, timelineId: timeline.id });
        expect(await db.select().from(schema.timeline_routes).all()).toEqual(
            [],
        );
    });

    it("a point edit moves every lane, offsets unchanged; `from` kept, then rewritten when the first point moves (QA-AP-R12)", async ({
        db,
        marchersAndPages: _,
    }) => {
        await convertPagesToTimeline(db);
        const timeline = await page2(db);
        const ids = (await resolverOf(db)).marcherIds().slice(0, 3);
        const drawn = await drawGroupRoute({
            db,
            timelineId: timeline.id,
            marcherIds: ids,
            points: [{ at: [0, 0] }, { at: [10, 0] }, { at: [20, 5] }],
        });
        const g = await routeOf(db, drawn.routeId);
        const params = async () =>
            Promise.all(
                ids.map(
                    async (m) =>
                        (await transitionOf(db, drawn.transitions[m]!))
                            .path_params,
                ),
            );
        const offsetsBefore = await params();
        const before = await dataOf(db);
        await editGroupRoutePoints({
            db,
            routeId: drawn.routeId,
            points: [
                { id: g.points[0]!.id, at: [0, 0] },
                { id: g.points[1]!.id, at: [10, 8] },
                { id: g.points[2]!.id, at: [20, 5] },
            ],
        });
        const moved = await routeOf(db, drawn.routeId);
        expect(moved.from).toEqual(g.from);
        expect(moved.to).toEqual(g.to);
        expect(moved.points.map((p) => p.id)).toEqual(
            g.points.map((p) => p.id),
        );
        expect(await params()).toEqual(offsetsBefore);
        const r = await resolverOf(db);
        const schedule = groupSchedule(moved);
        const mid = 9 + 8 * ((schedule.uFirst + schedule.uLast) / 2);
        const o = offsetOf(offsetsBefore[0]!)!;
        const want = schedule.W.V; // the lanes moved with the point: member 0 passes (10, 8) + o
        expect(want[2]).toEqual([10, 8]);
        expect(Number.isFinite(r.positionAt(ids[0]!, mid)[0])).toBe(true);
        await expectOneUndoStep(db, before);

        await editGroupRoutePoints({
            db,
            routeId: drawn.routeId,
            points: [
                { id: g.points[0]!.id, at: [3, 3] },
                { id: g.points[1]!.id, at: [10, 8] },
                { id: g.points[2]!.id, at: [20, 5] },
            ],
        });
        // Nothing moved the members, so the rewritten `from` is F within rounding
        const again = await routeOf(db, drawn.routeId);
        expect(dist(again.from, g.from)).toBeLessThan(1e-9);
        expect(o).toHaveLength(2);
    });

    it("a member drawing its own path leaves the group (AP-R1)", async ({
        db,
        marchersAndPages: _,
    }) => {
        await convertPagesToTimeline(db);
        const timeline = await page2(db);
        const ids = (await resolverOf(db)).marcherIds().slice(0, 3);
        const drawn = await drawGroupRoute({
            db,
            timelineId: timeline.id,
            marcherIds: ids,
            points: [{ at: [0, 0] }],
        });
        const before = await dataOf(db);
        await drawRoute({
            db,
            timelineId: timeline.id,
            marcherId: ids[0]!,
            points: [{ at: [4, 4] }],
        });
        const t = await transitionOf(db, drawn.transitions[ids[0]!]!);
        expect(t.path_params).toBeNull();
        expect(t.route_id).not.toBe(drawn.routeId);
        expect(await readGroupPaths(db, timeline.id)).toEqual([
            {
                routeId: drawn.routeId,
                marcherIds: [...ids.slice(1)].sort((a, b) => a - b),
            },
        ]);
        await expectOneUndoStep(db, before);
    });
});
