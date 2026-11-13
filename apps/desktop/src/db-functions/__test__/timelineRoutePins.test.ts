/**
 * Pins on the stored show, pathways step 5 (spec Appendix M: AP-P1 to AP-P5, AP-R4, AP-H1 and
 * AP-R7 with pins, E-R7, file version 15). On the converted `marchersAndPages` show page 2's move
 * is `[9, 17)`, eight counts, one shapeless transition holding every marcher.
 */
import { expect } from "vitest";
import { eq, getTableName, sql } from "drizzle-orm";
import {
    createResolver,
    groupSchedule,
    placeOnCounts,
    type Resolver,
    type RouteGeometry,
    type RoutePin,
    type XY,
} from "@openmarch/core";
import { DbConnection, describeDbTests, schema } from "@/test/base";
import { keepFixturesInPageMode } from "@/test/timelineMode";
import { convertPagesToTimeline } from "@/test/convertPages";
import { readTimelineTables } from "@/timeline/timelineRows";
import { performRedo, performUndo, transactionWithHistory } from "../history";
import { drawRoute, readRoutes } from "../timelineRoutes";
import { drawGroupRoute } from "../timelineGroupRoutes";
import {
    editPathPoints,
    editPathPointsInTransaction,
} from "../timelinePathEdits";
import {
    cornerPins,
    pinAtPlayheadInTransaction,
    pinPoint,
    putCornersOnCounts,
    removePin,
    readMovePinSets,
    retimePins,
    scaleMovePins,
} from "../timelineRoutePins";
import { readTimelineResizeLimits, resizeTimeline } from "../timelineResize";
import { shiftTimeline } from "../timelineCommands";
import { splitTimelineAtBeat } from "../timelineSplitAtBeat";
import { movePageFlag, pageFlagMoveLimits } from "../pageFlags";
import { withTimelinePageRipple } from "../timelineRipple";
import { createBeatsInTransaction, deleteBeatsInTransaction } from "../beat";
import {
    openPinsKeptOffer,
    takePinsKeptOffer,
    usePinsKeptOffer,
} from "@/timeline/pinsKeptOffer";

keepFixturesInPageMode("its tests convert the show themselves");

const TABLES = [
    schema.timelines,
    schema.timeline_transitions,
    schema.timeline_assignments,
    schema.timeline_routes,
    schema.timeline_lanes,
];
const dataOf = async (db: DbConnection) => {
    const out: Record<string, unknown[]> = {};
    for (const table of TABLES)
        out[getTableName(table)] = await db.select().from(table).all();
    return out;
};
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
const resolverOf = async (db: DbConnection): Promise<Resolver> =>
    createResolver((await readTimelineTables(db)).snapshot);
const routeRow = async (db: DbConnection, routeId: number) =>
    (await db
        .select()
        .from(schema.timeline_routes)
        .where(eq(schema.timeline_routes.id, routeId))
        .get())!;
const pinsOf = async (
    db: DbConnection,
    routeId: number,
): Promise<RoutePin[]> => {
    const t = (await routeRow(db, routeId)).timing;
    return t === null ? [] : (JSON.parse(t) as { pins: RoutePin[] }).pins;
};
const fileVersion = async (db: DbConnection) =>
    (
        await db
            .select({ version: sql<number>`user_version` })
            .from(sql`pragma_user_version`)
            .get()
    )?.version;
const close = (a: XY, b: XY, eps = 1e-9) =>
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(eps);

/** A group path for the first two marchers on page 2: three corners in a row, 100 and 200 apart. */
async function groupFixture(db: DbConnection) {
    await convertPagesToTimeline(db);
    const timeline = (await db
        .select()
        .from(schema.timelines)
        .where(eq(schema.timelines.start_beat, 9))
        .get())!;
    const r0 = await resolverOf(db);
    const [m1, m2] = r0.marcherIds() as [number, number];
    const A1 = r0.positionAt(m1, 9) as XY;
    const base: XY = [A1[0] + 100, A1[1] + 100];
    const { routeId } = await drawGroupRoute({
        db,
        timelineId: timeline.id,
        marcherIds: [m1, m2],
        points: [
            { at: [base[0], base[1]] },
            { at: [base[0] + 200, base[1]] },
            { at: [base[0] + 300, base[1]] },
        ],
    });
    const geometry = JSON.parse(
        (await routeRow(db, routeId)).geometry,
    ) as RouteGeometry;
    const [p, q, s] = geometry.points.map((x) => x.id) as [
        string,
        string,
        string,
    ];
    const lanes = await db
        .select()
        .from(schema.timeline_lanes)
        .where(eq(schema.timeline_lanes.route_id, routeId))
        .all();
    return { timeline, routeId, geometry, m1, m2, p, q, s, lanes };
}

describeDbTests("Pins (AP-P1, AP-P3)", (it) => {
    it("pins a group path's point: every member passes its copy on the count; one undo step; file version 15", async ({
        db,
        marchersAndPages: _,
    }) => {
        const f = await groupFixture(db);
        const before = await dataOf(db);
        expect(await fileVersion(db)).toBe(11);
        await pinPoint({ db, routeId: f.routeId, pointId: f.q, count: 4 });
        expect(await pinsOf(db, f.routeId)).toEqual([{ point: f.q, at: 4 }]);
        expect(await fileVersion(db)).toBe(15);
        const r = await resolverOf(db);
        const q = f.geometry.points[1]!.at;
        for (const lane of f.lanes) {
            const m = (
                await db
                    .select()
                    .from(schema.timeline_assignments)
                    .where(
                        eq(
                            schema.timeline_assignments.transition_id,
                            lane.transition_id,
                        ),
                    )
                    .all()
            ).find((a) => a.slot_index === lane.slot_index)!.marcher_id;
            close(r.positionAt(m, 13), [
                q[0] + lane.offset_x!,
                q[1] + lane.offset_y!,
            ]);
        }
        await expectOneUndoStep(db, before);
    });

    it("moves a pin, keeps pins in path order, refuses counts outside the move or not whole", async ({
        db,
        marchersAndPages: _,
    }) => {
        const f = await groupFixture(db);
        await pinPoint({ db, routeId: f.routeId, pointId: f.q, count: 4 });
        await pinPoint({ db, routeId: f.routeId, pointId: f.q, count: 5 });
        expect(await pinsOf(db, f.routeId)).toEqual([{ point: f.q, at: 5 }]);
        await pinPoint({ db, routeId: f.routeId, pointId: f.p, count: 2 });
        expect(await pinsOf(db, f.routeId)).toEqual([
            { point: f.p, at: 2 },
            { point: f.q, at: 5 },
        ]);
        const data = await dataOf(db);
        for (const [pointId, count, says] of [
            [f.s, 4, "pin.afterPin"],
            [f.p, 6, "pin.beforePin"],
            [f.s, 0, "pin.countRange"],
            [f.s, 8, "pin.countRange"],
            [f.s, 6.5, "pin.countRange"],
            ["gone", 3, "pin.noPoint"],
        ] as const)
            await expect(
                pinPoint({ db, routeId: f.routeId, pointId, count }),
            ).rejects.toThrow(says);
        expect(await dataOf(db)).toEqual(data);
    });

    it("removing the last pin writes NULL; the file version stays", async ({
        db,
        marchersAndPages: _,
    }) => {
        const f = await groupFixture(db);
        await pinPoint({ db, routeId: f.routeId, pointId: f.q, count: 4 });
        const before = await dataOf(db);
        await removePin({ db, routeId: f.routeId, pointId: f.q });
        expect((await routeRow(db, f.routeId)).timing).toBeNull();
        expect(await fileVersion(db)).toBe(15);
        await expectOneUndoStep(db, before);
    });

    it("E-R7: a pin on a missing point or outside the move is refused at commit", async ({
        db,
        marchersAndPages: _,
    }) => {
        const f = await groupFixture(db);
        for (const timing of [
            { v: 1, pins: [{ point: "gone", at: 3 }] },
            { v: 1, pins: [{ point: f.q, at: 0 }] },
            { v: 1, pins: [{ point: f.q, at: 8 }] },
        ])
            await expect(
                transactionWithHistory(db, "raw", async (tx) => {
                    await tx
                        .update(schema.timeline_routes)
                        .set({ timing: JSON.stringify(timing) })
                        .where(eq(schema.timeline_routes.id, f.routeId));
                }),
            ).rejects.toThrow(/E-R7/);
    });
});

describeDbTests("Pin at the playhead (AP-P2)", (it) => {
    it("on a straight stretch adds a corner there and pins it, in one undo step", async ({
        db,
        marchersAndPages: _,
    }) => {
        const f = await groupFixture(db);
        const before = await dataOf(db);
        const [P, Q] = [f.geometry.points[0]!.at, f.geometry.points[1]!.at];
        const mid: XY = [(P[0] + Q[0]) / 2, (P[1] + Q[1]) / 2];
        const id = await transactionWithHistory(db, "pinAtPlayhead", (tx) =>
            pinAtPlayheadInTransaction({
                tx,
                routeId: f.routeId,
                count: 3,
                drop: { kind: "stretch", before: 1, at: mid },
                editPoints: (t, routeId, points) =>
                    editPathPointsInTransaction({ tx: t, routeId, points }),
            }),
        );
        const g = JSON.parse(
            (await routeRow(db, f.routeId)).geometry,
        ) as RouteGeometry;
        expect(g.points.map((x) => x.id)).toEqual([f.p, id, f.q, f.s]);
        expect(g.points[1]!.at).toEqual(mid);
        expect(await pinsOf(db, f.routeId)).toEqual([{ point: id, at: 3 }]);
        await expectOneUndoStep(db, before);
    });

    it("on a point pins it; a group path's leg onto it and a count off the grid are refused", async ({
        db,
        marchersAndPages: _,
    }) => {
        const f = await groupFixture(db);
        const run = (
            count: number,
            drop: Parameters<typeof pinAtPlayheadInTransaction>[0]["drop"],
        ) =>
            transactionWithHistory(db, "pinAtPlayhead", (tx) =>
                pinAtPlayheadInTransaction({
                    tx,
                    routeId: f.routeId,
                    count,
                    drop,
                    editPoints: (t, routeId, points) =>
                        editPathPointsInTransaction({ tx: t, routeId, points }),
                }),
            );
        await run(6, { kind: "point", pointId: f.s });
        expect(await pinsOf(db, f.routeId)).toEqual([{ point: f.s, at: 6 }]);
        await expect(
            run(2, { kind: "stretch", before: 0, at: [0, 0] }),
        ).rejects.toThrow("pin.dropOnPoint");
        await expect(run(2.5, { kind: "point", pointId: f.p })).rejects.toThrow(
            "pin.playheadOff",
        );
    });
});

describeDbTests("Put corners on counts (AP-P4)", (it) => {
    it("pins every corner by length on whole counts; again says so; one undo step", async ({
        db,
        marchersAndPages: _,
    }) => {
        const f = await groupFixture(db);
        const W = groupSchedule(f.geometry).W;
        const expected = placeOnCounts(
            [1, 2, 3].map((k) => (8 * W.D[k]!) / W.L),
            8,
        )!;
        const before = await dataOf(db);
        await putCornersOnCounts({ db, routeId: f.routeId });
        expect(await pinsOf(db, f.routeId)).toEqual([
            { point: f.p, at: expected[0] },
            { point: f.q, at: expected[1] },
            { point: f.s, at: expected[2] },
        ]);
        await expectOneUndoStep(db, before);
        await expect(
            putCornersOnCounts({ db, routeId: f.routeId }),
        ).rejects.toThrow("pin.alreadyOnCounts");
    });

    it("trades counts when two corners round to one, and refuses more corners than counts", () => {
        const g: RouteGeometry = {
            v: 1,
            from: [0, 0],
            to: [100, 0],
            points: [
                { id: "a", at: [10, 0] },
                { id: "b", at: [12, 0] },
                { id: "c", at: [50, 0], tension: 1 },
            ],
        };
        const W = groupSchedule(g).W;
        expect(cornerPins(g, W, 8)).toEqual([
            { point: "a", at: 1 },
            { point: "b", at: 2 },
        ]);
        const many: RouteGeometry = {
            ...g,
            points: Array.from({ length: 8 }, (_, i) => ({
                id: `k${i}`,
                at: [10 * (i + 1), i % 2] as XY,
            })),
        };
        expect(() => cornerPins(many, groupSchedule(many).W, 8)).toThrow(
            "pin.tooManyCorners",
        );
    });
});

describeDbTests("Range edits with pins (AP-R4, AP-P5)", (it) => {
    it("retimePins: keep from the edge not moved, unchanged by a shift, scaled onto whole counts", () => {
        const pins = [
            { point: "a", at: 2 },
            { point: "b", at: 4 },
            { point: "c", at: 6 },
        ];
        const from = { start: 9, end: 17 };
        expect(retimePins(pins, from, { start: 9, end: 20 }, "keep")).toEqual(
            pins,
        );
        expect(retimePins(pins, from, { start: 7, end: 17 }, "keep")).toEqual(
            pins.map((p) => ({ ...p, at: p.at + 2 })),
        );
        expect(retimePins(pins, from, { start: 12, end: 20 }, "keep")).toEqual(
            pins,
        );
        expect(retimePins(pins, from, { start: 9, end: 15 }, "scale")).toEqual([
            { point: "a", at: 1 },
            { point: "b", at: 3 },
            { point: "c", at: 4 },
        ]);
        expect(() =>
            retimePins(pins, from, { start: 9, end: 15 }, "keep"),
        ).toThrow("pin.pastPin");
        expect(() =>
            retimePins(pins, from, { start: 9, end: 12 }, "scale"),
        ).toThrow("pin.noRoomToScale");
    });

    it("resizing keeps pinned counts, stops short of a pin, scales with Alt; a shift changes nothing", async ({
        db,
        marchersAndPages: _,
    }) => {
        const f = await groupFixture(db);
        await pinPoint({ db, routeId: f.routeId, pointId: f.p, count: 2 });
        await pinPoint({ db, routeId: f.routeId, pointId: f.q, count: 5 });
        const limits = (await readTimelineResizeLimits(db, f.timeline.id))!;
        expect(limits.endEdge.min).toEqual({
            beat: 15,
            stop: { kind: "pin", count: 5 },
        });
        expect(limits.startEdge.max).toEqual({
            beat: 10,
            stop: { kind: "pin", count: 2 },
        });
        expect(limits.scaled?.endEdge.min).toEqual({
            beat: 12,
            stop: { kind: "pin", count: 2 },
        });
        await expect(
            resizeTimeline({
                db,
                timelineId: f.timeline.id,
                start: 9,
                end: 14,
            }),
        ).rejects.toThrow("pin.pastPin");

        // End edge: counts from the start kept
        await resizeTimeline({
            db,
            timelineId: f.timeline.id,
            start: 9,
            end: 19,
        });
        expect((await pinsOf(db, f.routeId)).map((p) => p.at)).toEqual([2, 5]);
        // Start edge: counts from the end kept
        const before = await dataOf(db);
        await resizeTimeline({
            db,
            timelineId: f.timeline.id,
            start: 10,
            end: 19,
        });
        expect((await pinsOf(db, f.routeId)).map((p) => p.at)).toEqual([1, 4]);
        await expectOneUndoStep(db, before);
        // Alt: scaled with the move, onto whole counts
        await resizeTimeline({
            db,
            timelineId: f.timeline.id,
            start: 10,
            end: 28,
            scalePins: true,
        });
        expect((await pinsOf(db, f.routeId)).map((p) => p.at)).toEqual([2, 8]);
        // A shift moves the move and its pins together
        await shiftTimeline({ db, timelineId: f.timeline.id, delta: 4 });
        expect((await pinsOf(db, f.routeId)).map((p) => p.at)).toEqual([2, 8]);
    });
});

describeDbTests("Pins and path edits (AP-H1, AP-R7, AP-R9)", (it) => {
    it("deleting a pinned point drops its pin in the same edit and says so", async ({
        db,
        marchersAndPages: _,
    }) => {
        const f = await groupFixture(db);
        await pinPoint({ db, routeId: f.routeId, pointId: f.p, count: 2 });
        await pinPoint({ db, routeId: f.routeId, pointId: f.q, count: 5 });
        const report = await editPathPoints({
            db,
            routeId: f.routeId,
            points: f.geometry.points
                .filter((x) => x.id !== f.q)
                .map((x) => ({ id: x.id, at: x.at })),
        });
        expect(report.droppedPins).toBe(1);
        expect(await pinsOf(db, f.routeId)).toEqual([{ point: f.p, at: 2 }]);
    });

    it("split at the playhead on a pinned own path: no change in motion; pins split by count", async ({
        db,
        marchersAndPages: _,
    }) => {
        await convertPagesToTimeline(db);
        const timeline = (await db
            .select()
            .from(schema.timelines)
            .where(eq(schema.timelines.start_beat, 9))
            .get())!;
        const r0 = await resolverOf(db);
        const m = r0.marcherIds()[0]!;
        const A = r0.positionAt(m, 9) as XY;
        const corners: XY[] = [
            [A[0] + 40, A[1]],
            [A[0] + 40, A[1] + 60],
            [A[0] + 100, A[1] + 60],
        ];
        const { routeId } = await drawRoute({
            db,
            timelineId: timeline.id,
            marcherId: m,
            points: corners.map((at) => ({ at })),
        });
        const [route] = await readRoutes(db);
        const [a, b, c] = route!.geometry.points.map((x) => x.id);
        await pinPoint({ db, routeId, pointId: a!, count: 2 });
        await pinPoint({ db, routeId, pointId: b!, count: 4 });
        await pinPoint({ db, routeId, pointId: c!, count: 7 });
        const before = await resolverOf(db);
        const positions = (r: Resolver) =>
            Array.from({ length: 8 * 16 + 1 }, (_, i) =>
                r.positionAt(m, 9 + i / 16),
            );
        const p0 = positions(before);
        await splitTimelineAtBeat({ db, timelineId: timeline.id, beat: 14 });
        const after = await resolverOf(db);
        positions(after).forEach((p, i) => close(p, p0[i]!, 1e-6));
        const routes = await readRoutes(db);
        const pinsByRoute = await Promise.all(
            routes.map(async (r) => ({
                id: r.routeId,
                start: r.start,
                pins: await pinsOf(db, r.routeId),
            })),
        );
        const first = pinsByRoute.find((r) => r.start === 9)!;
        const second = pinsByRoute.find((r) => r.start === 14)!;
        expect(first.pins).toEqual([
            { point: a, at: 2 },
            { point: b, at: 4 },
        ]);
        expect(second.pins).toEqual([{ point: c, at: 2 }]);
        expect(second.id).toBe(routeId);
    });
});

describeDbTests(
    "Page flags and counts with pins (AP-R4 ripple, QA-AP-P5)",
    (it) => {
        /** Page 2's group path pinned on counts 2 and 5 (beats 11 and 14) */
        const pinned = async (db: DbConnection) => {
            const f = await groupFixture(db);
            await pinPoint({ db, routeId: f.routeId, pointId: f.p, count: 2 });
            await pinPoint({ db, routeId: f.routeId, pointId: f.q, count: 5 });
            return f;
        };
        const counts = async (db: DbConnection, routeId: number) =>
            (await pinsOf(db, routeId)).map((p) => p.at);

        it("dragging the move's start flag keeps each pin on its beat, as a clip resize does; one undo step", async ({
            db,
            marchersAndPages: _,
        }) => {
            const f = await pinned(db);
            const before = await dataOf(db);
            await movePageFlag({ db, pageId: 1, beat: 10 });
            expect(await counts(db, f.routeId)).toEqual([1, 4]);
            // Every member still passes the pinned corner on beat 14
            const r = await resolverOf(db);
            const q = f.geometry.points[1]!.at;
            const lane = f.lanes[0]!;
            const m = (
                await db
                    .select()
                    .from(schema.timeline_assignments)
                    .where(
                        eq(
                            schema.timeline_assignments.transition_id,
                            lane.transition_id,
                        ),
                    )
                    .all()
            ).find((a) => a.slot_index === lane.slot_index)!.marcher_id;
            close(r.positionAt(m, 14), [
                q[0] + lane.offset_x!,
                q[1] + lane.offset_y!,
            ]);
            await expectOneUndoStep(db, before);
        });

        it("a flag can't pass a pin: the drag stops before it, and a drop past it is refused in words", async ({
            db,
            marchersAndPages: _,
        }) => {
            const f = await pinned(db);
            const limits = (await pageFlagMoveLimits({ db, pageId: 2 }))!;
            expect(limits.min).toBe(15);
            expect(limits.minBlock).toMatchObject({
                kind: "move",
                reason: "pin",
                count: 5,
            });
            const start = (await pageFlagMoveLimits({ db, pageId: 1 }))!;
            expect(start.max).toBe(10);
            expect(start.maxBlock).toMatchObject({ reason: "pin", count: 2 });
            const data = await dataOf(db);
            await expect(
                movePageFlag({ db, pageId: 2, beat: 14 }),
            ).rejects.toThrow("pin.pastPin");
            expect(await dataOf(db)).toEqual(data);
            expect(await counts(db, f.routeId)).toEqual([2, 5]);
        });

        it("a count inserted between two pins moves the later one with its beat; deleting it moves it back", async ({
            db,
            marchersAndPages: _,
        }) => {
            const f = await pinned(db);
            await transactionWithHistory(db, "insertBeat", (tx) =>
                withTimelinePageRipple(tx, () =>
                    createBeatsInTransaction({
                        tx,
                        newBeats: [{ duration: 0.5, include_in_measure: true }],
                        startingPosition: 12,
                    }),
                ),
            );
            expect(await counts(db, f.routeId)).toEqual([2, 6]);
            await performUndo(db);
            expect(await counts(db, f.routeId)).toEqual([2, 5]);
            await transactionWithHistory(db, "deleteBeat", (tx) =>
                withTimelinePageRipple(tx, () =>
                    deleteBeatsInTransaction({ tx, beatIds: new Set([12]) }),
                ),
            );
            expect(await counts(db, f.routeId)).toEqual([2, 4]);
        });

        it("deleting the counts between two pins would put them on one count: refused in words", async ({
            db,
            marchersAndPages: _,
        }) => {
            // Pins on counts 2 and 4: the ends of beats 10 and 12
            const f = await groupFixture(db);
            await pinPoint({ db, routeId: f.routeId, pointId: f.p, count: 2 });
            await pinPoint({ db, routeId: f.routeId, pointId: f.q, count: 4 });
            const data = await dataOf(db);
            await expect(
                transactionWithHistory(db, "deleteBeats", (tx) =>
                    withTimelinePageRipple(tx, () =>
                        deleteBeatsInTransaction({
                            tx,
                            beatIds: new Set([11, 12]),
                        }),
                    ),
                ),
            ).rejects.toThrow("pin.collide");
            expect(await dataOf(db)).toEqual(data);
            expect(await counts(db, f.routeId)).toEqual([2, 4]);
        });
    },
);

describeDbTests("Scale pins instead (AP-P5)", (it) => {
    it("scales the pins read before the resize, in an edit of its own, as Alt would have", async ({
        db,
        marchersAndPages: _,
    }) => {
        const f = await groupFixture(db);
        await pinPoint({ db, routeId: f.routeId, pointId: f.p, count: 2 });
        await pinPoint({ db, routeId: f.routeId, pointId: f.q, count: 5 });
        const pinsBefore = await readMovePinSets(db, f.timeline.id);
        await resizeTimeline({
            db,
            timelineId: f.timeline.id,
            start: 9,
            end: 21,
        });
        expect((await pinsOf(db, f.routeId)).map((p) => p.at)).toEqual([2, 5]);
        const before = await dataOf(db);
        await scaleMovePins({
            db,
            timelineId: f.timeline.id,
            before: { start: 9, end: 17 },
            after: { start: 9, end: 21 },
            pinsBefore,
        });
        // 2 × 12 / 8 = 3; 5 × 12 / 8 = 7.5, a tie: the earlier count
        expect((await pinsOf(db, f.routeId)).map((p) => p.at)).toEqual([3, 7]);
        await expectOneUndoStep(db, before);
    });

    it("refuses, writing nothing, when another edit came after the resize", async ({
        db,
        marchersAndPages: _,
    }) => {
        const f = await groupFixture(db);
        await pinPoint({ db, routeId: f.routeId, pointId: f.q, count: 5 });
        const pinsBefore = await readMovePinSets(db, f.timeline.id);
        await resizeTimeline({
            db,
            timelineId: f.timeline.id,
            start: 9,
            end: 21,
        });
        await pinPoint({ db, routeId: f.routeId, pointId: f.q, count: 6 });
        const data = await dataOf(db);
        await expect(
            scaleMovePins({
                db,
                timelineId: f.timeline.id,
                before: { start: 9, end: 17 },
                after: { start: 9, end: 21 },
                pinsBefore,
            }),
        ).rejects.toThrow("pin.moveChanged");
        expect(await dataOf(db)).toEqual(data);
    });
});

describeDbTests("Scale pins instead: stale offers (AP-P5 re-check)", (it) => {
    /** Page 2's move pinned on 2 and 5, read, then resized from 8 counts to `end − 9` */
    const resized = async (db: DbConnection, end: number) => {
        const f = await groupFixture(db);
        await pinPoint({ db, routeId: f.routeId, pointId: f.p, count: 2 });
        await pinPoint({ db, routeId: f.routeId, pointId: f.q, count: 5 });
        const pinsBefore = await readMovePinSets(db, f.timeline.id);
        await resizeTimeline({ db, timelineId: f.timeline.id, start: 9, end });
        return {
            f,
            offer: {
                database: db,
                timelineId: f.timeline.id,
                before: { start: 9, end: 17 },
                after: { start: 9, end },
                pinsBefore,
            },
        };
    };

    it("refuses after the resize was undone, writing nothing; the resize can still be redone", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { f, offer } = await resized(db, 21);
        await performUndo(db);
        const data = await dataOf(db);
        await expect(scaleMovePins({ db, ...offer })).rejects.toThrow(
            "pin.moveChanged",
        );
        expect(await dataOf(db)).toEqual(data);
        expect((await performRedo(db)).success).toBe(true);
        expect((await pinsOf(db, f.routeId)).map((p) => p.at)).toEqual([2, 5]);
    });

    it("refuses after a page-flag drag moved the move, writing nothing", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { offer } = await resized(db, 15);
        await movePageFlag({ db, pageId: 1, beat: 10 });
        const data = await dataOf(db);
        await expect(scaleMovePins({ db, ...offer })).rejects.toThrow(
            "pin.moveChanged",
        );
        expect(await dataOf(db)).toEqual(data);
    });

    it("refuses when scaling would change nothing (no empty undo step)", async ({
        db,
        marchersAndPages: _,
    }) => {
        const f = await groupFixture(db);
        await pinPoint({ db, routeId: f.routeId, pointId: f.q, count: 3 });
        const pinsBefore = await readMovePinSets(db, f.timeline.id);
        await resizeTimeline({
            db,
            timelineId: f.timeline.id,
            start: 9,
            end: 18,
        });
        const data = await dataOf(db);
        // 3 × 9 / 8 = 3.375: still count 3
        await expect(
            scaleMovePins({
                db,
                timelineId: f.timeline.id,
                before: { start: 9, end: 17 },
                after: { start: 9, end: 18 },
                pinsBefore,
            }),
        ).rejects.toThrow("pin.scaleNoChange");
        expect(await dataOf(db)).toEqual(data);
    });

    it("the offer lives only until the next edit, undo or redo, or its close", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { f, offer } = await resized(db, 21);
        let closed = 0;
        const close = openPinsKeptOffer(offer, () => closed++);
        expect(usePinsKeptOffer.getState().offer).toBe(offer);
        // Any edit: gone, and its toast told once
        await pinPoint({ db, routeId: f.routeId, pointId: f.q, count: 6 });
        expect(usePinsKeptOffer.getState().offer).toBeNull();
        expect(closed).toBe(1);
        close();
        expect(closed).toBe(1);
        // An undo: gone
        openPinsKeptOffer(offer);
        await performUndo(db);
        expect(usePinsKeptOffer.getState().offer).toBeNull();
        // Its toast closed: gone, and the command does nothing
        const closeToast = openPinsKeptOffer(offer);
        closeToast();
        const data = await dataOf(db);
        expect(await takePinsKeptOffer()).toBe(false);
        expect(await dataOf(db)).toEqual(data);
        // Taken while current: scaled once, then gone
        openPinsKeptOffer(offer);
        expect(await takePinsKeptOffer()).toBe(true);
        expect((await pinsOf(db, f.routeId)).map((p) => p.at)).toEqual([3, 7]);
        expect(usePinsKeptOffer.getState().offer).toBeNull();
    });
});

describeDbTests(
    "A pin partway through a count in the ripple (re-check nit)",
    (it) => {
        it("keeps its fraction with its count through a flag drag and a count insert", async ({
            db,
            marchersAndPages: _,
        }) => {
            const f = await groupFixture(db);
            await transactionWithHistory(db, "raw", async (tx) => {
                await tx
                    .update(schema.timeline_routes)
                    .set({
                        timing: JSON.stringify({
                            v: 1,
                            pins: [
                                { point: f.p, at: 2.5 },
                                { point: f.q, at: 5 },
                            ],
                        }),
                    })
                    .where(eq(schema.timeline_routes.id, f.routeId));
            });
            await movePageFlag({ db, pageId: 1, beat: 10 });
            expect((await pinsOf(db, f.routeId)).map((p) => p.at)).toEqual([
                1.5, 4,
            ]);
            await transactionWithHistory(db, "insertBeat", (tx) =>
                withTimelinePageRipple(tx, () =>
                    createBeatsInTransaction({
                        tx,
                        newBeats: [{ duration: 0.5, include_in_measure: true }],
                        startingPosition: 10,
                    }),
                ),
            );
            // A count inserted before the one holding beat 11.5 (the move grows to [10, 18)): that
            // count, and the pin partway through it, one later, keeping its half; the later pin too
            const move = (await db
                .select()
                .from(schema.timelines)
                .where(eq(schema.timelines.id, f.timeline.id))
                .get())!;
            expect([move.start_beat, move.end_beat]).toEqual([10, 18]);
            expect((await pinsOf(db, f.routeId)).map((p) => p.at)).toEqual([
                2.5, 5,
            ]);
        });
    },
);
