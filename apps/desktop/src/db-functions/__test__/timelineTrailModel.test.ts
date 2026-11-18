import { expect } from "vitest";
import { eq, getTableName } from "drizzle-orm";
import { createResolver, type Resolver, type XY } from "@openmarch/core";
import { DbConnection, describeDbTests, schema } from "@/test/base";
import { keepFixturesInPageMode } from "@/test/timelineMode";
import { convertPagesToTimeline } from "@/test/convertPages";
import { readTimelineTables } from "@/timeline/timelineRows";
import { refusalText } from "@/test/refusalText";
import { performRedo, performUndo } from "../history";
import { moveMarchersInTarget } from "../timelineMoves";
import { editTrailPoints } from "../timelineTrails";
import {
    readAllShapeRecipes,
    saveShapeRecipeInTransaction,
} from "../shapeRecipes";
import { trailShapeRecipe } from "../timelineTrailShape";
import {
    dragTrail,
    planTrailDrag,
    type TrailSpacing,
} from "../timelineTrailDrag";
import {
    convertTrailToShape,
    planTrailEdit,
    spacingBack,
} from "../timelineTrailDerive";
import type { RoutePointInput } from "../timelineRoutes";

keepFixturesInPageMode("its tests convert the show themselves");

/**
 * A trail's path is the only truth (owner, 2026-11-17, spec L.18): on the converted
 * `marchersAndPages` show (page 2's box `[9, 17)`, marchers 1 to 8 in a level line at its start
 * flag, two steps apart), every route edit of a dragged-out trail plans every end spot again on the
 * new path, spaced back from the head as before, in one undo step; an end spot moved any other way
 * takes its marcher out of the trail; no end shape is saved. QA-TM-1 to QA-TM-8.
 */

const WINDOW = { start: 9, end: 17 };
const TABLES = [
    schema.timelines,
    schema.timeline_transitions,
    schema.timeline_assignments,
    schema.timeline_slot_destinations,
    schema.timeline_routes,
    schema.timeline_shape_recipes,
    schema.timeline_shape_recipe_marchers,
];
const dataOf = async (db: DbConnection) => {
    const out: Record<string, unknown[]> = {};
    for (const table of TABLES)
        out[getTableName(table)] = await db.select().from(table).all();
    return out;
};
const resolverOf = async (db: DbConnection): Promise<Resolver> =>
    createResolver((await readTimelineTables(db)).snapshot);
const near = (a: readonly number[], b: readonly number[], eps = 1e-6) =>
    Math.abs(a[0]! - b[0]!) <= eps && Math.abs(a[1]! - b[1]!) <= eps;

/** One edit is one undo step: undo restores every row, redo the same rows and ids */
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

const spotsOf = async (db: DbConnection, transitionId: number) =>
    (
        await db
            .select()
            .from(schema.timeline_slot_destinations)
            .where(
                eq(
                    schema.timeline_slot_destinations.transition_id,
                    transitionId,
                ),
            )
            .orderBy(schema.timeline_slot_destinations.slot_index)
            .all()
    ).map((s): XY => [s.x, s.y]);

const routeOf = async (db: DbConnection, routeId: number) =>
    JSON.parse(
        (await db
            .select()
            .from(schema.timeline_routes)
            .where(eq(schema.timeline_routes.id, routeId))
            .get())!.geometry,
    ) as { to: XY; points: { id: string; at: XY; tension?: number }[] };

/** Marchers 1 to 6 dragged out of M6's end along `points` (in steps from M6), as Follow writes it */
async function dragged(
    db: DbConnection,
    points: readonly XY[],
    spacing: TrailSpacing = { kind: "keep" },
) {
    await convertPagesToTimeline(db);
    const r = await resolverOf(db);
    const starts = new Map<number, XY>(
        [1, 2, 3, 4, 5, 6, 7, 8].map((m) => [m, r.positionAt(m, 9) as XY]),
    );
    const step = (starts.get(2)![0] - starts.get(1)![0]) / 2;
    const ids = [1, 2, 3, 4, 5, 6];
    const lead = starts.get(6)!;
    const at = (p: XY): XY => [lead[0] + p[0] * step, lead[1] + p[1] * step];
    const result = await dragTrail({
        db,
        window: WINDOW,
        marcherIds: ids,
        leaderId: 6,
        points: points.map((p) => ({ at: at(p) })),
        spacing,
        step,
        ends: "trail",
    });
    const lineUp = ids.map((m) => starts.get(m)!);
    return { ...result, starts, step, lead, lineUp, ids, at };
}

/** Each member's distance back from the leader's spot along the trail now */
const backNow = async (
    db: DbConnection,
    t: Awaited<ReturnType<typeof dragged>>,
) => {
    const route = await routeOf(db, t.routeId);
    return spacingBack(
        t.lineUp,
        route.points,
        await spotsOf(db, t.transitionId),
    );
};

describeDbTests("A trail's path is the only truth (L.18)", (it) => {
    it("QA-TM-1: a point added, a point deleted and a point made Smooth each plan every spot again on the new path, one undo step each, the spacing held", async ({
        db,
        marchersAndPages: _,
    }) => {
        const t = await dragged(db, [
            [10, 0],
            [10, -10],
        ]);
        const back0 = await backNow(db, t);
        // Keep spacing: two steps apart back from the head
        back0.forEach((b, q) => expect(b).toBeCloseTo((5 - q) * 2 * t.step, 6));
        const stored = await routeOf(db, t.routeId);
        const kept = (i: number): RoutePointInput => ({
            id: stored.points[i]!.id,
            at: stored.points[i]!.at,
        });
        const edits: RoutePointInput[][] = [
            // a point added between the corner and the head
            [kept(0), { at: t.at([14, -4]) }, kept(1)],
            // the corner deleted
            [kept(1)],
            // the corner made smooth
            [{ ...kept(0), tension: 1 }, kept(1)],
        ];
        for (const points of edits) {
            const before = await dataOf(db);
            await editTrailPoints({ db, routeId: t.routeId, points });
            const plan = planTrailDrag(
                t.lineUp,
                points,
                { kind: "keep" },
                t.step,
            );
            const spots = await spotsOf(db, t.transitionId);
            spots.forEach((p, q) =>
                expect(near(p, plan.spots[q]!), `slot ${q}`).toBe(true),
            );
            // The head is the path's end; the spacing back from it holds
            expect(near(spots[5]!, t.at([10, -10]))).toBe(true);
            (await backNow(db, t)).forEach((b, q) =>
                expect(b).toBeCloseTo(back0[q]!, 6),
            );
            // The resolver walks everyone there along the path
            const r = await resolverOf(db);
            t.ids.forEach((m, q) =>
                expect(near(r.positionAt(m, 17), spots[q]!)).toBe(true),
            );
            await expectOneUndoStep(db, before);
            expect((await performUndo(db)).success).toBe(true);
        }
    });

    it("QA-TM-2: Even N and a slid tail's gaps hold through a point edit", async ({
        db,
        marchersAndPages: _,
    }) => {
        const t = await dragged(
            db,
            [
                [10, 0],
                [10, -10],
            ],
            { kind: "even", steps: 1 },
        );
        const stored = await routeOf(db, t.routeId);
        const points: RoutePointInput[] = [
            { id: stored.points[0]!.id, at: t.at([12, 3]) },
            { id: stored.points[1]!.id, at: stored.points[1]!.at },
        ];
        await editTrailPoints({ db, routeId: t.routeId, points });
        const want = planTrailDrag(
            t.lineUp,
            points,
            { kind: "even", steps: 1 },
            t.step,
        );
        const spots = await spotsOf(db, t.transitionId);
        spots.forEach((p, q) => expect(near(p, want.spots[q]!)).toBe(true));
    });

    it("QA-TM-5: a path shorter than the line: spacing holds and the tail hasn't left the form; Even N past the path keeps those behind where they start; nothing off the path", async ({
        db,
        marchersAndPages: _,
    }) => {
        const t = await dragged(db, [[10, 0]]);
        // Cut back to 4 steps: Keep spacing puts everyone 4 steps on, the tail still in the line
        const stored = await routeOf(db, t.routeId);
        await editTrailPoints({
            db,
            routeId: t.routeId,
            points: [{ id: stored.points[0]!.id, at: t.at([4, 0]) }],
        });
        const spots = await spotsOf(db, t.transitionId);
        t.lineUp.forEach((s, q) =>
            expect(near(spots[q]!, [s[0] + 4 * t.step, s[1]])).toBe(true),
        );
        // Pure: Even 2 steps on a 1-step trail would walk the tail back; it stays where it starts
        const plan = planTrailEdit(
            t.lineUp,
            [{ at: t.at([10, 0]) }],
            planTrailDrag(t.lineUp, [{ at: t.at([10, 0]) }], { kind: "even", steps: 3 }, t.step).spots, // prettier-ignore
            [{ at: t.at([1, 0]) }],
        );
        expect(plan.forward).toBe(true);
        plan.ends.forEach((e, q) =>
            expect(e).toBeGreaterThanOrEqual(plan.startDist[q]! - 1e-9),
        );
        expect(near(plan.spots[0]!, t.lineUp[0]!)).toBe(true);
        expect(near(plan.spots[5]!, t.at([1, 0]))).toBe(true);
        // Every spot is on the way
        for (const [q, p] of plan.spots.entries())
            expect(near(plan.way.at(plan.ends[q]!), p)).toBe(true);
    });

    it("QA-TM-6: a path longer than the line: the head stays at the path's end, the spacing held, empty path behind the tail", async ({
        db,
        marchersAndPages: _,
    }) => {
        const t = await dragged(db, [[10, 0]]);
        const stored = await routeOf(db, t.routeId);
        await editTrailPoints({
            db,
            routeId: t.routeId,
            points: [
                { id: stored.points[0]!.id, at: t.at([10, 0]) },
                { at: t.at([10, -30]) },
            ],
        });
        const spots = await spotsOf(db, t.transitionId);
        expect(near(spots[5]!, t.at([10, -30]))).toBe(true);
        // Ten steps of line on a 40-step path: everyone up the last leg, two steps apart
        spots.forEach((p, q) =>
            expect(near(p, t.at([10, -30 + (5 - q) * 2]))).toBe(true),
        );
    });

    it("QA-TM-3: spots moved by a field drag, typed coordinates or a shape tool (the range writer) take those marchers out of the trail; the others stay; a spot written where it is moves no one out; one undo step", async ({
        db,
        marchersAndPages: _,
    }) => {
        const t = await dragged(db, [[10, 0]]);
        const spots = await spotsOf(db, t.transitionId);
        // Written where it already is (a shape tool sets everyone, `setUnmoved`): nobody leaves
        await moveMarchersInTarget({
            db,
            target: { kind: "range", ...WINDOW },
            moves: [{ marcherId: 2, x: spots[1]![0], y: spots[1]![1] }],
        });
        expect((await resolverOf(db)).ftlEntry(t.transitionId).members).toEqual(t.ids); // prettier-ignore
        // Two moved at once
        const before = await dataOf(db);
        const r0 = await resolverOf(db);
        await moveMarchersInTarget({
            db,
            target: { kind: "range", ...WINDOW },
            moves: [
                { marcherId: 2, x: spots[1]![0], y: spots[1]![1] + 4 * t.step },
                { marcherId: 5, x: spots[4]![0], y: spots[4]![1] - 4 * t.step },
            ],
        });
        const r = await resolverOf(db);
        expect(r.ftlEntry(t.transitionId).members).toEqual([1, 3, 4, 6]);
        expect(near(r.positionAt(2, 17), [spots[1]![0], spots[1]![1] + 4 * t.step])).toBe(true); // prettier-ignore
        expect(near(r.positionAt(5, 17), [spots[4]![0], spots[4]![1] - 4 * t.step])).toBe(true); // prettier-ignore
        for (const m of [1, 3, 4, 6])
            expect(near(r.positionAt(m, 17), r0.positionAt(m, 17))).toBe(true);
        await expectOneUndoStep(db, before);
        // A later point edit plans the four left again, the gaps where the two stood kept
        const stored = await routeOf(db, t.routeId);
        await editTrailPoints({
            db,
            routeId: t.routeId,
            points: [{ id: stored.points[0]!.id, at: t.at([14, 0]) }],
        });
        const after = await resolverOf(db);
        for (const m of [1, 3, 4, 6]) {
            const [x0, y0] = r.positionAt(m, 17);
            const [x, y] = after.positionAt(m, 17);
            expect(x - x0).toBeCloseTo(4 * t.step, 6);
            expect(y).toBeCloseTo(y0, 6);
        }
        // The two who left are where they were put
        expect(near(after.positionAt(2, 17), [spots[1]![0], spots[1]![1] + 4 * t.step])).toBe(true); // prettier-ignore
    });

    it("QA-TM-4: an end shape left from step 4c is unlinked on the trail's next edit; Convert to shape is refused while the tail is still in the line", async ({
        db,
        marchersAndPages: _,
    }) => {
        const t = await dragged(db, [[10, 0]]);
        // A file from before L.18: the drag-out's Line saved for the spots
        const transition = (await db
            .select()
            .from(schema.timeline_transitions)
            .where(eq(schema.timeline_transitions.id, t.transitionId))
            .get())!;
        const plan = planTrailDrag(t.lineUp, [{ at: t.at([10, 0]) }], { kind: "keep" }, t.step); // prettier-ignore
        const { recipe, members } = trailShapeRecipe(plan, t.ids);
        await db.transaction((tx) =>
            saveShapeRecipeInTransaction({
                tx,
                timelineId: transition.timeline_id,
                recipe,
                members,
            }),
        );
        const shapes = async () =>
            (await readAllShapeRecipes(db)).filter((r) => r.kind !== "order");
        expect(await shapes()).toHaveLength(1);
        const stored = await routeOf(db, t.routeId);
        await editTrailPoints({
            db,
            routeId: t.routeId,
            points: [{ id: stored.points[0]!.id, at: t.at([12, 0]) }],
        });
        expect(await shapes()).toHaveLength(0);
        // Cut back to 4 steps: the tail is still in the line it stands in
        await editTrailPoints({
            db,
            routeId: t.routeId,
            points: [{ id: stored.points[0]!.id, at: t.at([4, 0]) }],
        });
        const error = await convertTrailToShape({ db, routeId: t.routeId }).catch((e: unknown) => e); // prettier-ignore
        expect(refusalText(error)).toMatch(/line|longer/i);
    });

    it("QA-TM-7: the spacing is read back exactly for spots Keep spacing put, and by projection, in trail order, for others", () => {
        const starts: XY[] = [0, 1, 2, 3].map((i): XY => [i * 10, 0]);
        const points: RoutePointInput[] = [{ at: [60, 0] }];
        const keep = planTrailDrag(starts, points, { kind: "keep" }, 1);
        expect(spacingBack(starts, points, keep.spots)).toEqual([
            30, 20, 10, 0,
        ]);
        // A spot a little off the way reads back by its projection; the leader's is 0
        const off = keep.spots.map(
            (p, q): XY => (q === 1 ? [p[0], p[1] + 2] : p),
        );
        expect(spacingBack(starts, points, off)[1]).toBeCloseTo(20, 9);
        // The same back on a bent route: each spot that far back from the new head
        const bent: RoutePointInput[] = [{ at: [40, 0] }, { at: [40, 20] }];
        const moved = planTrailEdit(starts, points, keep.spots, bent);
        const want: XY[] = [
            [30, 0],
            [40, 0],
            [40, 10],
            [40, 20],
        ];
        moved.spots.forEach((p, q) => expect(near(p, want[q]!)).toBe(true));
    });
});
