import { expect } from "vitest";
import { and, eq, getTableName } from "drizzle-orm";
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
import { transactionWithHistory } from "../history";
import { laneOffset, type DatabaseTimelineLane } from "../timelineLanes";
import { setTimelineTransitionDestinationInTransaction } from "../timelineTransitionsInTransaction";
import { removeAssignmentRowsInTransaction } from "../timelineMembership";
import { drawRoute, readRoutes, removeRoute } from "../timelineRoutes";
import {
    drawGroupRoute,
    editGroupRoutePoints,
    meanOf,
    ownPath,
    readGroupPaths,
    rejoinGroupPath,
} from "../timelineGroupRoutes";

keepFixturesInPageMode("its tests convert the show themselves");

/**
 * Group paths, pathways steps 15 and 24 (spec v0.10 R-14′, Appendix J.8): AP-R8 to AP-R10 and
 * their changes to AP-R1, AP-R2, AP-R3, AP-R7 and AP-R15, on the converted `marchersAndPages`
 * show (page 2's box is `[9, 17)`, one shapeless direct transition holding every marcher).
 * QA-AP-R7 to QA-AP-R13, QA-AP-L1 and QA-UNDO-R3: each edit is one undo step, redo restores the
 * same ids, a refused edit writes nothing, the resolver walks the group schedule, and since step
 * 24 a path is lanes on the members' own slots: no transition or row is written.
 */

const TABLES = [
    schema.timelines,
    schema.timeline_shapes,
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

/** The lane on marcher `m`'s slot in move `timelineId` (its first row there). */
const laneOf = async (
    db: DbConnection,
    m: number,
    timelineId: number,
): Promise<DatabaseTimelineLane | undefined> => {
    const A = schema.timeline_assignments;
    const T = schema.timeline_transitions;
    const L = schema.timeline_lanes;
    const found = await db
        .select({ lane: L })
        .from(A)
        .innerJoin(T, eq(T.id, A.transition_id))
        .innerJoin(
            L,
            and(
                eq(L.transition_id, A.transition_id),
                eq(L.slot_index, A.slot_index),
            ),
        )
        .where(and(eq(A.marcher_id, m), eq(T.timeline_id, timelineId)))
        .get();
    return found?.lane;
};
const offsetOfMarcher = async (db: DbConnection, m: number, tl: number) => {
    const lane = await laneOf(db, m, tl);
    return lane ? laneOffset(lane) : null;
};
const transitionRows = (db: DbConnection) =>
    db.select().from(schema.timeline_transitions).all();
const assignmentRows = (db: DbConnection) =>
    db.select().from(schema.timeline_assignments).all();

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
        const transitionsBefore = await transitionRows(db);
        const rowsBefore = await assignmentRows(db);

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
        // Step 24 (QA-AP-L1): lanes on the members' own slots; no transition or row is written
        expect(await transitionRows(db)).toEqual(transitionsBefore);
        expect(await assignmentRows(db)).toEqual(rowsBefore);
        for (const [i, m] of ids.entries()) {
            const lane = (await laneOf(db, m, timeline.id))!;
            expect(lane.transition_id).toBe(result.transitions[m]);
            expect(lane.route_id).toBe(result.routeId);
            expect(laneOffset(lane)).toEqual([
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
            const o = (await offsetOfMarcher(db, m, timeline.id))!;
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

    it("a block four rows deep (16 marchers) holds its shape along a curve and lands on its end set; redo keeps the ids (review of #683)", async ({
        db,
        marchersAndPages: _,
    }) => {
        await convertPagesToTimeline(db);
        const timeline = await page2(db);
        // The move ends in one line across the field: not the start block moved over
        const D = schema.timeline_slot_destinations;
        const own = new Set(
            (
                await db
                    .select()
                    .from(schema.timeline_transitions)
                    .where(
                        eq(
                            schema.timeline_transitions.timeline_id,
                            timeline.id,
                        ),
                    )
                    .all()
            ).map((t) => t.id),
        );
        const destinations = (await db.select().from(D).all()).filter((d) =>
            own.has(d.transition_id),
        );
        expect(destinations.length).toBeGreaterThan(16);
        for (const d of destinations)
            await db
                .update(D)
                .set({ x: 200 + 9 * d.slot_index, y: 520 })
                .where(eq(D.id, d.id));
        const before = await resolverOf(db);
        // Four marchers from each of four rows (by where they stand at the move's start)
        const rows = new Map<number, number[]>();
        for (const m of before.marcherIds()) {
            const y = Math.round(before.positionAt(m, 9)[1]);
            rows.set(y, [...(rows.get(y) ?? []), m]);
        }
        const deep = [...rows.values()].filter((r) => r.length >= 4);
        expect(deep.length).toBeGreaterThanOrEqual(4);
        const ids = deep.slice(0, 4).flatMap((r) => r.slice(0, 4));
        expect(ids).toHaveLength(16);
        const starts = ids.map((m) => before.positionAt(m, 9) as XY);
        const ends = ids.map((m) => before.positionAt(m, 17) as XY);
        // The end set isn't the start block moved over, so the legs differ
        const shifts = ids.map((_, i) => [
            ends[i]![0] - starts[i]![0],
            ends[i]![1] - starts[i]![1],
        ]);
        expect(shifts.some((d) => dist(d as XY, shifts[0] as XY) > 1e-3)).toBe(
            true,
        );
        const original = await dataOf(db);
        const result = await drawGroupRoute({
            db,
            timelineId: timeline.id,
            marcherIds: ids,
            points: await groupPoints(db, ids),
        });
        const geometry = await routeOf(db, result.routeId);
        const schedule = groupSchedule(geometry);
        const after = await resolverOf(db);
        const shape = (b: number) => {
            const p0 = after.positionAt(ids[0]!, b);
            return ids.map((m) => {
                const p = after.positionAt(m, b);
                return [p[0] - p0[0], p[1] - p0[1]] as XY;
            });
        };
        // Rigid from the first point to the last: every member's place in the block is kept
        const first = 9 + 8 * schedule.uFirst;
        const last = 9 + 8 * schedule.uLast;
        const ref = shape(first);
        for (const f of [0.25, 0.5, 0.75, 1]) {
            const now = shape(first + (last - first) * f);
            for (const [i, d] of now.entries())
                expect(dist(d, ref[i]!)).toBeLessThan(1e-6);
        }
        // Everyone starts and lands where they should
        for (const [i, m] of ids.entries()) {
            expect(after.positionAt(m, 9)).toEqual(starts[i]);
            expect(after.positionAt(m, 17)).toEqual(ends[i]);
        }
        await expectOneUndoStep(db, original);
    });

    it("Rejoin naming only marchers already on the group path is refused, writing nothing (review of #683)", async ({
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
        await expectRefused(
            db,
            () =>
                rejoinGroupPath({
                    db,
                    timelineId: timeline.id,
                    routeId: drawn.routeId,
                    marcherIds: [ids[0]!, ids[1]!],
                }),
            /already follow the group path/,
        );
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
            Promise.all(ms.map((m) => offsetOfMarcher(db, m, timeline.id)));
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
        const o = (await offsetOfMarcher(db, m, timeline.id))!;

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
        // An own lane on its slot, in its move as before
        const ownLane = (await laneOf(db, m, timeline.id))!;
        expect(ownLane.route_id).toBe(own.routes[m]);
        expect(laneOffset(ownLane)).toBeNull();
        expect(ownLane.transition_id).toBe(drawn.transitions[m]);
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
        expect(await offsetOfMarcher(db, m, timeline.id)).toEqual(o);
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
        const lane = (await laneOf(db, extra, timeline.id))!;
        expect(lane.transition_id).toBe(joined.transitions[extra]);
        expect(lane.route_id).toBe(drawn.routeId);
        expect(laneOffset(lane)).toEqual([A[0] - g.from[0], A[1] - g.from[1]]);
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
        const removed = await removeRoute({ db, routeId: drawn.routeId });
        expect(removed.marcherIds).toEqual([...ids].sort((a, b) => a - b));
        // The members never left their move: it is as it was before the path
        for (const m of ids)
            expect(await transitionOf(db, drawn.transitions[m]!)).toMatchObject(
                { path_style: "direct", route_id: null, path_params: null },
            );
        expect(await db.select().from(schema.timeline_routes).all()).toEqual(
            [],
        );
        expect(await db.select().from(schema.timeline_lanes).all()).toEqual([]);
        await expectOneUndoStep(db, before);
        expect((await performUndo(db)).success).toBe(true);

        // Deleting one member (a marcher delete compacts the shared move, AP-R15): the last
        // slot's marcher moves down into its slot with its lane, and nobody else moves
        const before2 = await dataOf(db);
        const walking = positions(await resolverOf(db), 30);
        const order = (await resolverOf(db)).marcherIds();
        const gone = (await db
            .select()
            .from(schema.timeline_assignments)
            .where(
                and(
                    eq(schema.timeline_assignments.marcher_id, ids[0]!),
                    eq(schema.timeline_assignments.start_beat, 9),
                ),
            )
            .get())!;
        await transactionWithHistory(db, "deleteOne", (tx) =>
            removeAssignmentRowsInTransaction({
                tx,
                removed: [gone],
                compact: true,
            }),
        );
        expect(await readGroupPaths(db, timeline.id)).toEqual([
            {
                routeId: drawn.routeId,
                marcherIds: [...ids.slice(1)].sort((a, b) => a - b),
            },
        ]);
        const after = positions(await resolverOf(db), 30);
        order.forEach((m, i) => {
            if (m !== ids[0]) expect(after[i]).toEqual(walking[i]);
        });
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
            Promise.all(ids.map((m) => offsetOfMarcher(db, m, timeline.id)));
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
        const o = offsetsBefore[0]!;
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
        const lane = (await laneOf(db, ids[0]!, timeline.id))!;
        expect(laneOffset(lane)).toBeNull();
        expect(lane.route_id).not.toBe(drawn.routeId);
        expect(await readGroupPaths(db, timeline.id)).toEqual([
            {
                routeId: drawn.routeId,
                marcherIds: [...ids.slice(1)].sort((a, b) => a - b),
            },
        ]);
        await expectOneUndoStep(db, before);
    });

    it("on a shaped move a group path writes only lanes: the move stays a shape, a reshape moves the walkers' end spots, Remove path leaves the shape (QA-AP-L1)", async ({
        db,
        marchersAndPages: _,
    }) => {
        await convertPagesToTimeline(db);
        const timeline = await page2(db);
        const tr = (
            await db
                .select()
                .from(schema.timeline_transitions)
                .where(eq(schema.timeline_transitions.timeline_id, timeline.id))
                .all()
        )[0]!;
        const block = (cols: number, spacing: number) =>
            JSON.stringify({
                origin: [250, 150],
                rows: 4,
                cols,
                spacing: [spacing, spacing],
            });
        const shapeId = await transactionWithHistory(
            db,
            "shape",
            async (tx) => {
                const shape = (await tx
                    .insert(schema.timeline_shapes)
                    .values({
                        kind: "block",
                        geometry: block(Math.ceil(tr.slot_count / 4), 22.5),
                    })
                    .returning()
                    .get())!;
                await setTimelineTransitionDestinationInTransaction({
                    tx,
                    transitionId: tr.id,
                    destination: { kind: "shape", shapeId: shape.id },
                });
                return shape.id;
            },
        );
        const ids = (await resolverOf(db)).marcherIds().slice(0, 4);
        const shaped = positions(await resolverOf(db), 30);
        const before = await dataOf(db);
        const drawn = await drawGroupRoute({
            db,
            timelineId: timeline.id,
            marcherIds: ids,
            points: await groupPoints(db, ids),
        });
        expect((await dataOf(db))["timeline_transitions"]).toEqual(
            before["timeline_transitions"],
        );
        expect((await dataOf(db))["timeline_assignments"]).toEqual(
            before["timeline_assignments"],
        );
        expect(
            (await transitionOf(db, drawn.transitions[ids[0]!]!)).dest_shape_id,
        ).toBe(shapeId);
        await expectOneUndoStep(db, before);

        // Reshape the end shape: the path walkers land on their new spots (step 15 froze them)
        await transactionWithHistory(db, "reshape", (tx) =>
            tx
                .update(schema.timeline_shapes)
                .set({ geometry: block(Math.ceil(tr.slot_count / 4), 30) })
                .where(eq(schema.timeline_shapes.id, shapeId)),
        );
        const reshaped = await resolverOf(db);
        const index = reshaped.marcherIds().indexOf(ids[3]!);
        expect(reshaped.positionAt(ids[3]!, 17)).not.toEqual(
            shaped[index]![68],
        );
        const lanes = await db.select().from(schema.timeline_lanes).all();
        expect(lanes).toHaveLength(4);
        expect((await performUndo(db)).success).toBe(true);

        // Remove path: the block walks straight into its shape again, bit for bit as before
        await removeRoute({ db, routeId: drawn.routeId });
        expect(positions(await resolverOf(db), 30)).toEqual(shaped);
        expect(await dataOf(db)).toEqual(before);
    });
});
