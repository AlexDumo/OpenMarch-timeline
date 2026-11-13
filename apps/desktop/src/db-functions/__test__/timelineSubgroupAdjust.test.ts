// cspell:ignore rehome rehomed
/**
 * Sub-group Adjust on the stored show, pathways step 26 (spec v0.10 AP-R12, AP-R9 step 2,
 * AP-R10, AP-H1, AP-H3, I-J1, I-J2; QA-AP-L21 to L27). On the converted `marchersAndPages` show
 * page 2's move is `[9, 17)`, one shapeless transition holding every marcher. Four marchers walk
 * one group path; three of them (a sub-group) share one tweak.
 */
import { expect } from "vitest";
import { eq, getTableName, sql } from "drizzle-orm";
import {
    createResolver,
    createTimelineOracleForTesting,
    type AdjustProfile,
    type Resolver,
    type RouteGeometry,
    type XY,
} from "@openmarch/core";
import { DbConnection, describeDbTests, schema } from "@/test/base";
import { refusalText } from "@/test/refusalText";
import { keepFixturesInPageMode } from "@/test/timelineMode";
import { convertPagesToTimeline } from "@/test/convertPages";
import { readTimelineTables } from "@/timeline/timelineRows";
import { performRedo, performUndo, transactionWithHistory } from "../history";
import { removeRoute } from "../timelineRoutes";
import {
    detachFromGroupPath,
    detachSubgroup,
    drawGroupRoute,
    rejoinGroupPath,
} from "../timelineGroupRoutes";
import { editPathPoints, refitPath } from "../timelinePathEdits";
import { acknowledgeRehomed, adjustLane } from "../timelinePathAdjust";
import {
    adjustSubgroup,
    removeSubgroupKey,
    resetSubgroup,
    setSubgroupKey,
} from "../timelineSubgroupAdjust";

keepFixturesInPageMode("its tests convert the show themselves");

const TABLES = [
    schema.timeline_transitions,
    schema.timeline_assignments,
    schema.timeline_slot_destinations,
    schema.timeline_routes,
    schema.timeline_route_adjusts,
    schema.timeline_lanes,
    schema.timeline_route_sources,
];
const dataOf = async (db: DbConnection) => {
    const out: Record<string, unknown[]> = {};
    for (const table of TABLES)
        out[getTableName(table)] = await db.select().from(table).all();
    return out;
};
const resolverOf = async (db: DbConnection): Promise<Resolver> =>
    createResolver((await readTimelineTables(db)).snapshot);
const lanesOf = async (db: DbConnection, routeId: number) =>
    await db
        .select()
        .from(schema.timeline_lanes)
        .where(eq(schema.timeline_lanes.route_id, routeId))
        .all();
const linkedRows = async (db: DbConnection) =>
    await db.select().from(schema.timeline_route_adjusts).all();
const laneRow = async (db: DbConnection, id: number) =>
    (await db
        .select()
        .from(schema.timeline_lanes)
        .where(eq(schema.timeline_lanes.id, id))
        .get())!;
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
const fileVersion = async (db: DbConnection) =>
    (
        await db
            .select({ version: sql<number>`user_version` })
            .from(sql`pragma_user_version`)
            .get()
    )?.version;

/** Every marcher at every 1/16 beat of the move */
const walk = async (db: DbConnection) => {
    const r = await resolverOf(db);
    return r
        .marcherIds()
        .map((m) =>
            Array.from({ length: 129 }, (_, i) => r.positionAt(m, 9 + i / 16)),
        );
};
const movedMarchers = (a: XY[][], b: XY[][]) =>
    a.filter((walkA, i) =>
        walkA.some(
            (p, j) =>
                !Object.is(p[0], b[i]![j]![0]) ||
                !Object.is(p[1], b[i]![j]![1]),
        ),
    ).length;

/**
 * A group path for the first four marchers on page 2 (p, q, s; the leg p..q 200 long) and its
 * lanes; `sub` are the lanes of the first three, the sub-group.
 */
async function fixture(db: DbConnection) {
    await convertPagesToTimeline(db);
    const timeline = (await db
        .select()
        .from(schema.timelines)
        .where(eq(schema.timelines.start_beat, 9))
        .get())!;
    const r0 = await resolverOf(db);
    const ms = r0.marcherIds().slice(0, 4) as [number, number, number, number];
    const A1 = r0.positionAt(ms[0], 9) as XY;
    const base: XY = [A1[0] + 100, A1[1] + 100];
    const { routeId } = await drawGroupRoute({
        db,
        timelineId: timeline.id,
        marcherIds: ms,
        points: [
            { at: [base[0], base[1]] },
            { at: [base[0] + 200, base[1]] },
            { at: [base[0] + 300, base[1]] },
        ],
    });
    const geometry = JSON.parse(
        (await db
            .select()
            .from(schema.timeline_routes)
            .where(eq(schema.timeline_routes.id, routeId))
            .get())!.geometry,
    ) as RouteGeometry;
    const lanes = await lanesOf(db, routeId);
    const assignments = await db
        .select()
        .from(schema.timeline_assignments)
        .all();
    const laneOf = (m: number) => {
        const slot = assignments.find(
            (a) => a.marcher_id === m && a.start_beat === 9,
        )!.slot_index;
        return lanes.find((l) => l.slot_index === slot)!;
    };
    const [p, q, s] = geometry.points as [
        RouteGeometry["points"][number],
        RouteGeometry["points"][number],
        RouteGeometry["points"][number],
    ];
    const placeP = Math.hypot(
        p.at[0] - geometry.from[0],
        p.at[1] - geometry.from[1],
    );
    const sub = ms.slice(0, 3).map((m) => ({
        laneId: laneOf(m).id,
        marcherId: m,
    }));
    return { timeline, routeId, geometry, ms, laneOf, p, q, s, placeP, sub };
}

const linkedProfile = async (db: DbConnection, id: number) =>
    JSON.parse(
        (await db
            .select()
            .from(schema.timeline_route_adjusts)
            .where(eq(schema.timeline_route_adjusts.id, id))
            .get())!.profile,
    ) as AdjustProfile;

describeDbTests("Sub-group Adjust (step 26)", (it) => {
    it("QA-AP-L21 (S-09): three lanes adjusted at once share one tweak; a fourth is untouched; one undo step; file version 16", async ({
        db,
        marchersAndPages: _,
    }) => {
        const f = await fixture(db);
        const before = await walk(db);
        const beforeData = await dataOf(db);
        expect(await fileVersion(db)).toBe(11);
        const { groupAdjustId } = await adjustSubgroup({
            db,
            lanes: f.sub,
            x: f.placeP + 100,
            d: [0, 30],
        });
        expect(groupAdjustId).not.toBeNull();
        expect(await linkedRows(db)).toHaveLength(1);
        for (const { laneId } of f.sub) {
            const lane = await laneRow(db, laneId);
            expect(lane.group_adjust_id).toBe(groupAdjustId);
            expect(lane.adjust).toBeNull();
        }
        expect((await laneRow(db, f.laneOf(f.ms[3]).id)).group_adjust_id).toBe(
            null,
        );
        expect(await fileVersion(db)).toBe(16);
        const after = await walk(db);
        const r = await resolverOf(db);
        const ids = r.marcherIds();
        // Each of the three moves by the same amount; the fourth and everyone else don't
        const at = (m: number, w: XY[][]) => w[ids.indexOf(m)]!;
        const mid = 64; // count 4 of the 8-count move, on the bulge
        const shift = (m: number) => [
            at(m, after)[mid]![0] - at(m, before)[mid]![0],
            at(m, after)[mid]![1] - at(m, before)[mid]![1],
        ];
        expect(shift(f.ms[0])).toEqual(shift(f.ms[1]));
        expect(shift(f.ms[1])).toEqual(shift(f.ms[2]));
        expect(movedMarchers(after, before)).toBe(3);
        expect(at(f.ms[3], after)).toEqual(at(f.ms[3], before));
        // the oracle composes the same way
        const o = createTimelineOracleForTesting(
            (await readTimelineTables(db)).snapshot,
        );
        for (const m of f.ms)
            for (let b = 9; b <= 17; b += 0.25)
                expect(r.positionAt(m, b)).toEqual(o.positionAt(m, b));
        await expectOneUndoStep(db, beforeData);
    });

    it("S-09: one of them adjusted alone on top keeps the shared tweak; dragging the three again edits the same one", async ({
        db,
        marchersAndPages: _,
    }) => {
        const f = await fixture(db);
        const { groupAdjustId } = await adjustSubgroup({
            db,
            lanes: f.sub,
            x: f.placeP + 100,
            d: [0, 30],
        });
        const shared = await walk(db);
        const [m1, m2] = f.ms;
        await adjustLane({
            db,
            laneId: f.laneOf(m2).id,
            marcherId: m2,
            x: f.placeP + 100,
            d: [0, 10],
        });
        const onTop = await walk(db);
        expect(movedMarchers(onTop, shared)).toBe(1);
        const ids = (await resolverOf(db)).marcherIds();
        const i2 = ids.indexOf(m2);
        // B3's 2 steps are B1's 1 step plus its own on top (S-09 #2): +10 at the key
        const r = await resolverOf(db);
        const xAtKey = await (async () => {
            // the count where the lane reaches the key: compare m1 and m2's displacement
            let best = 0;
            for (let j = 0; j < 129; j++) {
                const d1 =
                    onTop[ids.indexOf(m1)]![j]![1] -
                    shared[ids.indexOf(m1)]![j]![1];
                const d2 = onTop[i2]![j]![1] - shared[i2]![j]![1];
                if (d1 === 0 && Math.abs(d2) > Math.abs(best)) best = d2;
            }
            return best;
        })();
        // sampled every 1/16 count, so the peak is at most the key's 10, and near it
        expect(Math.abs(xAtKey)).toBeLessThanOrEqual(10 + 1e-9);
        expect(Math.abs(xAtKey)).toBeGreaterThan(9);
        expect(r.positionAt(m1, 9)).toEqual(shared[ids.indexOf(m1)]![0]);
        // The three dragged again: the same linked Adjust, edited; m2 keeps its own on top
        await adjustSubgroup({
            db,
            lanes: f.sub,
            x: f.placeP + 100,
            d: [0, 40],
        });
        expect((await linkedRows(db)).map((g) => g.id)).toEqual([
            groupAdjustId,
        ]);
        expect((await laneRow(db, f.laneOf(m2).id)).adjust).not.toBeNull();
    });

    it("refuses one lane, a pick mixing a sub-group with another spot, and a plain lane plus a sub-group member, writing nothing", async ({
        db,
        marchersAndPages: _,
    }) => {
        const f = await fixture(db);
        const fourth = { laneId: f.laneOf(f.ms[3]).id, marcherId: f.ms[3] };
        const refusal = async (p: Promise<unknown>) => {
            try {
                await p;
            } catch (e) {
                return refusalText(e);
            }
            throw new Error("not refused");
        };
        expect(
            await refusal(
                adjustSubgroup({
                    db,
                    lanes: f.sub.slice(0, 1),
                    x: f.placeP + 100,
                    d: [0, 30],
                }),
            ),
        ).toMatch(/E-ARGS: Pick two or more/);
        await adjustSubgroup({
            db,
            lanes: f.sub,
            x: f.placeP + 100,
            d: [0, 30],
        });
        const before = await dataOf(db);
        expect(
            await refusal(
                adjustSubgroup({
                    db,
                    lanes: [...f.sub, fourth],
                    x: f.placeP + 100,
                    d: [0, 9],
                }),
            ),
        ).toMatch(/already shares an adjustment/);
        expect(
            await refusal(
                adjustSubgroup({
                    db,
                    lanes: f.sub.slice(0, 2),
                    x: f.placeP + 100,
                    d: [0, 9],
                }),
            ),
        ).toMatch(/already shares an adjustment/);
        expect(await dataOf(db)).toEqual(before);
    });

    it("QA-AP-L22 (S-14): a reshape keeps the sub-group's tweak; a deleted anchor re-homes it with the badge; accepting it moves nobody", async ({
        db,
        marchersAndPages: _,
    }) => {
        const f = await fixture(db);
        const { groupAdjustId } = await adjustSubgroup({
            db,
            lanes: f.sub,
            x: f.placeP + 250,
            d: [0, 30],
        });
        const id = groupAdjustId!;
        const kept = await linkedProfile(db, id);
        // Drag s further out: every anchor survives, the tweak is unchanged and rides along
        await editPathPoints({
            db,
            routeId: f.routeId,
            points: [
                { id: f.p.id, at: f.p.at },
                { id: f.q.id, at: f.q.at },
                { id: f.s.id, at: [f.s.at[0] + 40, f.s.at[1] + 20] },
            ],
        });
        expect(await linkedProfile(db, id)).toEqual(kept);
        // Delete q, which the tweak is anchored on: re-homed with the badge, one undo step
        const before = await dataOf(db);
        const report = await editPathPoints({
            db,
            routeId: f.routeId,
            points: [
                { id: f.p.id, at: f.p.at },
                { id: f.s.id, at: [f.s.at[0] + 40, f.s.at[1] + 20] },
            ],
        });
        expect(report.rehomedGroups).toBe(1);
        const rehomed = await linkedProfile(db, id);
        expect(rehomed.rehomed).toBe(true);
        expect(
            rehomed.keys.every((k) => k.a !== f.q.id && k.b !== f.q.id),
        ).toBe(true);
        await expectOneUndoStep(db, before);
        const walked = await walk(db);
        await acknowledgeRehomed({ db, routeId: f.routeId });
        expect((await linkedProfile(db, id)).rehomed).toBeUndefined();
        expect(await walk(db)).toEqual(walked);
    });

    it("Re-fit stretches the path; the shared tweak follows it, kept by id; one undo step", async ({
        db,
        marchersAndPages: _,
    }) => {
        const f = await fixture(db);
        const { groupAdjustId } = await adjustSubgroup({
            db,
            lanes: f.sub,
            x: f.placeP + 100,
            d: [0, 30],
        });
        const kept = await linkedProfile(db, groupAdjustId!);
        // Every member's start moves by one amount and its end by another: Re-fit stretches
        const shift = async (m: number, beat: number, d: XY) => {
            const A = schema.timeline_assignments;
            const T = schema.timeline_transitions;
            const row = (await db
                .select({ a: A, t: T })
                .from(A)
                .innerJoin(T, eq(T.id, A.transition_id))
                .where(sql`${A.marcher_id} = ${m} AND ${T.end_beat} = ${beat}`)
                .get())!;
            await transactionWithHistory(db, "shiftForTest", async (tx) => {
                await tx.run(
                    sql`UPDATE timeline_slot_destinations SET x = x + ${d[0]}, y = y + ${d[1]} WHERE transition_id = ${row.t.id} AND slot_index = ${row.a.slot_index}`,
                );
            });
        };
        for (const m of f.ms) {
            await shift(m, 9, [16, -8]);
            await shift(m, 17, [-20, 12]);
        }
        const before = await dataOf(db);
        await refitPath({ db, routeId: f.routeId });
        // The anchors name surviving points, so the shared profile is unchanged and rides along
        expect(await linkedProfile(db, groupAdjustId!)).toEqual(kept);
        const r = await resolverOf(db);
        const o = createTimelineOracleForTesting(
            (await readTimelineTables(db)).snapshot,
        );
        for (const m of f.ms)
            for (let b = 9; b <= 17; b += 0.25)
                expect(r.positionAt(m, b)).toEqual(o.positionAt(m, b));
        await expectOneUndoStep(db, before);
    });

    it("QA-AP-L23: Reset the sub-group: the shared tweak goes; a spot's own tweak stays; one undo step", async ({
        db,
        marchersAndPages: _,
    }) => {
        const f = await fixture(db);
        const plain = await walk(db);
        const { groupAdjustId } = await adjustSubgroup({
            db,
            lanes: f.sub,
            x: f.placeP + 100,
            d: [0, 30],
        });
        const m2 = f.ms[1];
        await adjustLane({
            db,
            laneId: f.laneOf(m2).id,
            marcherId: m2,
            x: f.placeP + 100,
            d: [0, 10],
        });
        const own = (await laneRow(db, f.laneOf(m2).id)).adjust;
        const before = await dataOf(db);
        await resetSubgroup({ db, groupAdjustId: groupAdjustId! });
        expect(await linkedRows(db)).toEqual([]);
        for (const { laneId } of f.sub)
            expect((await laneRow(db, laneId)).group_adjust_id).toBeNull();
        expect((await laneRow(db, f.laneOf(m2).id)).adjust).toBe(own);
        // Only m2 differs from the plain path now: its own tweak
        expect(movedMarchers(await walk(db), plain)).toBe(1);
        await expectOneUndoStep(db, before);
    });

    it("a shared key edit and key removal are one undo step each; removing the last displacing key resets it", async ({
        db,
        marchersAndPages: _,
    }) => {
        const f = await fixture(db);
        const { groupAdjustId } = await adjustSubgroup({
            db,
            lanes: f.sub,
            x: f.placeP + 100,
            d: [0, 30],
        });
        const id = groupAdjustId!;
        let before = await dataOf(db);
        await setSubgroupKey({ db, groupAdjustId: id, index: 1, d: [4, 9] });
        expect((await linkedProfile(db, id)).keys[1]!.d).toEqual([4, 9]);
        await expectOneUndoStep(db, before);
        before = await dataOf(db);
        await removeSubgroupKey({ db, groupAdjustId: id, index: 1 });
        expect(await linkedRows(db)).toEqual([]);
        for (const { laneId } of f.sub)
            expect((await laneRow(db, laneId)).group_adjust_id).toBeNull();
        await expectOneUndoStep(db, before);
    });

    it("QA-AP-L24: Detach the sub-group: one shared copy with one shared tweak; nobody moves; Rejoin brings each spot back, tweaks dropped (Q4)", async ({
        db,
        marchersAndPages: _,
    }) => {
        const f = await fixture(db);
        const { groupAdjustId } = await adjustSubgroup({
            db,
            lanes: f.sub,
            x: f.placeP + 100,
            d: [0, 30],
        });
        const m2 = f.ms[1];
        await adjustLane({
            db,
            laneId: f.laneOf(m2).id,
            marcherId: m2,
            x: f.placeP + 250,
            d: [0, 10],
        });
        const before = await walk(db);
        const beforeData = await dataOf(db);
        const { routeId: copy } = await detachSubgroup({
            db,
            groupAdjustId: groupAdjustId!,
        });
        const copyLanes = await lanesOf(db, copy);
        expect(copyLanes.map((l) => l.id).sort()).toEqual(
            f.sub.map((l) => l.laneId).sort(),
        );
        const linked = await linkedRows(db);
        expect(linked).toHaveLength(1);
        expect(linked[0]!.route_id).toBe(copy);
        expect(new Set(copyLanes.map((l) => l.group_adjust_id))).toEqual(
            new Set([linked[0]!.id]),
        );
        // the group path keeps its fourth member
        expect((await lanesOf(db, f.routeId)).map((l) => l.id)).toEqual([
            f.laneOf(f.ms[3]).id,
        ]);
        expect(movedMarchers(await walk(db), before)).toBe(0);
        await expectOneUndoStep(db, beforeData);

        // Rejoin the three: back on the group path with their offsets, both tweaks gone (Q4)
        await rejoinGroupPath({
            db,
            timelineId: f.timeline.id,
            routeId: f.routeId,
            marcherIds: f.sub.map((l) => l.marcherId),
        });
        for (const { laneId } of f.sub) {
            const lane = await laneRow(db, laneId);
            const was = (beforeData.timeline_lanes as typeof copyLanes).find(
                (l) => l.id === laneId,
            )!;
            expect(lane.route_id).toBe(f.routeId);
            expect([lane.offset_x, lane.offset_y]).toEqual([
                was.offset_x,
                was.offset_y,
            ]);
            expect(lane.adjust).toBeNull();
            expect(lane.group_adjust_id).toBeNull();
        }
        expect(await linkedRows(db)).toEqual([]);
        expect(await lanesOf(db, copy)).toEqual([]);
    });

    it("QA-AP-L25: Detach one member of a sub-group: its copy takes a copy of the shared tweak; the others still share it; nobody moves", async ({
        db,
        marchersAndPages: _,
    }) => {
        const f = await fixture(db);
        const { groupAdjustId } = await adjustSubgroup({
            db,
            lanes: f.sub,
            x: f.placeP + 100,
            d: [0, 30],
        });
        const before = await walk(db);
        const beforeData = await dataOf(db);
        const { routes } = await detachFromGroupPath({
            db,
            timelineId: f.timeline.id,
            marcherIds: [f.ms[0]],
        });
        const copy = routes[f.ms[0]]!;
        const lane = await laneRow(db, f.sub[0]!.laneId);
        expect(lane.route_id).toBe(copy);
        const linked = await linkedRows(db);
        expect(linked.map((g) => g.route_id).sort()).toEqual(
            [f.routeId, copy].sort(),
        );
        expect(lane.group_adjust_id).not.toBe(groupAdjustId);
        expect(linked.find((g) => g.id === lane.group_adjust_id)!.profile).toBe(
            linked.find((g) => g.id === groupAdjustId)!.profile,
        );
        for (const { laneId } of f.sub.slice(1))
            expect((await laneRow(db, laneId)).group_adjust_id).toBe(
                groupAdjustId,
            );
        expect(movedMarchers(await walk(db), before)).toBe(0);
        await expectOneUndoStep(db, beforeData);
    });

    it("QA-AP-L26: Remove path and drawing a new group path over the members take the shared tweak with them; one undo step each", async ({
        db,
        marchersAndPages: _,
    }) => {
        const f = await fixture(db);
        await adjustSubgroup({
            db,
            lanes: f.sub,
            x: f.placeP + 100,
            d: [0, 30],
        });
        let before = await dataOf(db);
        await removeRoute({ db, routeId: f.routeId });
        expect(await linkedRows(db)).toEqual([]);
        await expectOneUndoStep(db, before);
        await performUndo(db);
        before = await dataOf(db);
        // A new group path for two of the three: their lanes move to it, the tweak stays with
        // the one left sharing it
        const r = await resolverOf(db);
        const A = r.positionAt(f.ms[0], 9);
        await drawGroupRoute({
            db,
            timelineId: f.timeline.id,
            marcherIds: [f.ms[0], f.ms[1]],
            points: [{ at: [A[0] + 50, A[1] - 80] }],
        });
        const linked = await linkedRows(db);
        expect(linked).toHaveLength(1);
        expect(
            (await laneRow(db, f.sub[0]!.laneId)).group_adjust_id,
        ).toBeNull();
        expect((await laneRow(db, f.sub[2]!.laneId)).group_adjust_id).toBe(
            linked[0]!.id,
        );
        await expectOneUndoStep(db, before);
    });

    it("E-J1 and E-J2 refuse at commit", async ({
        db,
        marchersAndPages: _,
    }) => {
        const f = await fixture(db);
        const G = schema.timeline_route_adjusts;
        const profile = JSON.stringify({
            v: 1,
            keys: [{ a: f.p.id, b: f.q.id, f: 0.5, d: [0, 5] }],
        });
        await expect(
            transactionWithHistory(db, "orphan", async (tx) => {
                await tx.insert(G).values({ route_id: f.routeId, profile });
            }),
        ).rejects.toThrow(/E-J2/);
        // a linked Adjust of another route than its lane's
        const other = await drawGroupRoute({
            db,
            timelineId: f.timeline.id,
            marcherIds: (await resolverOf(db)).marcherIds().slice(4, 6),
            points: [{ at: f.q.at }],
        });
        await expect(
            transactionWithHistory(db, "wrongRoute", async (tx) => {
                const g = (await tx
                    .insert(G)
                    .values({ route_id: other.routeId, profile })
                    .returning()
                    .get())!;
                await tx
                    .update(schema.timeline_lanes)
                    .set({ group_adjust_id: g.id })
                    .where(eq(schema.timeline_lanes.id, f.sub[0]!.laneId));
            }),
        ).rejects.toThrow(/E-J1|E-J3/);
    });
});
