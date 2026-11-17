import { expect } from "vitest";
import { eq, getTableName } from "drizzle-orm";
import { createResolver, type Resolver, type XY } from "@openmarch/core";
import { refusalText } from "@/test/refusalText";
import { DbConnection, describeDbTests, schema } from "@/test/base";
import { keepFixturesInPageMode } from "@/test/timelineMode";
import { convertPagesToTimeline } from "@/test/convertPages";
import { readTimelineTables } from "@/timeline/timelineRows";
import { performRedo, performUndo } from "../history";
import { TimelineWriteError } from "../timelineErrors";
import { moveMarchersInTarget } from "../timelineMoves";
import { followTrail } from "../timelineTrails";
import { readAllShapeRecipes } from "../shapeRecipes";
import { updateTimelineSlotDestinationInTransaction } from "../timelineTransitionsInTransaction";
import type { RoutePointInput } from "../timelineRoutes";
import {
    dragTrail,
    dragTrailHead,
    planTrailDrag,
    type TrailSpacing,
} from "../timelineTrailDrag";

keepFixturesInPageMode("its tests convert the show themselves");

/**
 * Dragging a dragged-out trail's head, AP-T16 (owner, 2026-11-17), on the converted
 * `marchersAndPages` show: page 2's box is `[9, 17)`, marchers 1 to 8 in a level line at its start
 * flag, two steps apart. The trail gets new points (cut back or run on) and everyone's end spot is
 * planned again as AP-T8 plans it, hand-moved spots too, in one undo step; the transition and its
 * route keep their ids. QA-HD-1 to QA-HD-5.
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

/** The show converted; the line of marchers 1 to 8 at page 2's start flag */
async function line(db: DbConnection) {
    await convertPagesToTimeline(db);
    const r = await resolverOf(db);
    const starts = new Map<number, XY>(
        [1, 2, 3, 4, 5, 6, 7, 8].map((m) => [m, r.positionAt(m, 9) as XY]),
    );
    const step = (starts.get(2)![0] - starts.get(1)![0]) / 2;
    return { starts, step };
}

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
    ) as { to: XY; points: { id: string; at: XY }[] };

/** Marchers 1 to 6 dragged out of M6's end, `out` steps right, as the Follow tool writes it */
async function dragged(db: DbConnection, out: number, spacing?: TrailSpacing) {
    const { starts, step } = await line(db);
    const ids = [1, 2, 3, 4, 5, 6];
    const lead = starts.get(6)!;
    const result = await dragTrail({
        db,
        window: WINDOW,
        marcherIds: ids,
        leaderId: 6,
        points: [{ at: [lead[0] + out * step, lead[1]] }],
        spacing: spacing ?? { kind: "keep" },
        step,
        ends: "trail",
    });
    const lineUp = ids.map((m) => starts.get(m)!);
    return { ...result, starts, step, lead, lineUp };
}

const expectRefused = async (
    db: DbConnection,
    write: () => Promise<unknown>,
    message: RegExp,
) => {
    const before = await dataOf(db);
    const error = await write().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TimelineWriteError);
    expect(refusalText(error)).toMatch(message);
    expect(await dataOf(db)).toEqual(before);
};

describeDbTests("Drag a trail's head (AP-T16)", (it) => {
    it("QA-HD-1: run on with a corner: everyone's spot is AP-T8's for the longer trail, the ids stay, the shape is saved again, one undo step", async ({
        db,
        marchersAndPages: _,
    }) => {
        const first = await dragged(db, 10);
        const { step, lead, lineUp } = first;
        const stored = await routeOf(db, first.routeId);
        const before = await dataOf(db);
        // The head kept where it was, as a corner, and on 8 steps down from it
        const points: RoutePointInput[] = [
            { id: stored.points[0]!.id, at: stored.points[0]!.at },
            { at: [lead[0] + 10 * step, lead[1] + 8 * step] },
        ];
        const result = await dragTrailHead({
            db,
            routeId: first.routeId,
            points,
            spacing: { kind: "keep" },
            step,
        });
        expect(result.transitionId).toBe(first.transitionId);
        expect(result.routeId).toBe(first.routeId);
        expect(result.marcherIds).toEqual([1, 2, 3, 4, 5, 6]);
        // Exactly what the drag would have written for this trail (the preview's plan)
        const plan = planTrailDrag(lineUp, points, { kind: "keep" }, step);
        expect(await spotsOf(db, first.transitionId)).toEqual(plan.spots);
        // 18 steps drawn: the leader at the new head, everyone 18 steps on along the way
        expect(near(plan.spots[5]!, points[1]!.at)).toBe(true);
        const route = await routeOf(db, first.routeId);
        expect(route.points[0]!.id).toBe(stored.points[0]!.id);
        expect(route.to).toEqual(points[1]!.at);
        // The resolver walks them there
        const r = await resolverOf(db);
        [1, 2, 3, 4, 5, 6].forEach((m, q) =>
            expect(near(r.positionAt(m, 17), plan.spots[q]!)).toBe(true),
        );
        // Step 4c's shape for the spots, saved again: one recipe, everyone where it's written
        const recipes = (await readAllShapeRecipes(db)).filter(
            (x) => x.kind !== "order",
        );
        expect(recipes).toHaveLength(1);
        for (const m of recipes[0]!.members) {
            const q = result.marcherIds.indexOf(m.marcherId);
            expect(near([m.x, m.y], plan.spots[q]!)).toBe(true);
        }
        // One undo step, and redo brings it back with the same ids
        const after = await dataOf(db);
        expect((await performUndo(db)).success).toBe(true);
        expect(await dataOf(db)).toEqual(before);
        expect((await performRedo(db)).success).toBe(true);
        expect(await dataOf(db)).toEqual(after);
    });

    it("QA-HD-2: cut back: the spots are AP-T8's for the shorter trail (DL-10's old line too), a spot moved by hand planned again; undo brings it back", async ({
        db,
        marchersAndPages: _,
    }) => {
        const first = await dragged(db, 20);
        const { step, lead, lineUp } = first;
        // M3's spot moved off the way by hand (AP-T7)
        const moved: XY = [lead[0] + 3 * step, lead[1] + 6 * step];
        await db.transaction((tx) =>
            updateTimelineSlotDestinationInTransaction({
                tx,
                transitionId: first.transitionId,
                slotIndex: 2,
                point: moved,
            }),
        );
        const before = await dataOf(db);
        const points: RoutePointInput[] = [
            { at: [lead[0] + 6 * step, lead[1]] },
        ];
        await dragTrailHead({
            db,
            routeId: first.routeId,
            points,
            spacing: { kind: "keep" },
            step,
        });
        const plan = planTrailDrag(lineUp, points, { kind: "keep" }, step);
        const spots = await spotsOf(db, first.transitionId);
        expect(spots).toEqual(plan.spots);
        expect(near(spots[2]!, moved)).toBe(false);
        // 6 steps: the leader at the head, the three behind it on the trail, the rest moved 6
        // steps on along the line they stand in (DL-10)
        expect(near(spots[5]!, points[0]!.at)).toBe(true);
        expect(near(spots[0]!, [lineUp[3]![0], lineUp[3]![1]])).toBe(true);
        expect((await performUndo(db)).success).toBe(true);
        expect(await dataOf(db)).toEqual(before);
        expect(near((await spotsOf(db, first.transitionId))[2]!, moved)).toBe(
            true,
        );
    });

    it("QA-HD-3: Even N stays Even N, everyone N steps apart behind the new head", async ({
        db,
        marchersAndPages: _,
    }) => {
        const spacing: TrailSpacing = { kind: "even", steps: 1 };
        const first = await dragged(db, 10, spacing);
        const { step, lead, lineUp } = first;
        const points: RoutePointInput[] = [
            { at: [lead[0] + 16 * step, lead[1]] },
        ];
        await dragTrailHead({
            db,
            routeId: first.routeId,
            points,
            spacing,
            step,
        });
        const spots = await spotsOf(db, first.transitionId);
        expect(spots).toEqual(
            planTrailDrag(lineUp, points, spacing, step).spots,
        );
        spots.forEach((s, q) =>
            expect(near(s, [lead[0] + (16 - (5 - q)) * step, lead[1]])).toBe(
                true,
            ),
        );
    });

    it("QA-HD-4: a box's snake: dragged on, more of the box comes out in snake order; dragged back, they go back in", async ({
        db,
        marchersAndPages: _,
    }) => {
        await convertPagesToTimeline(db);
        const IDS = [1, 2, 3, 4, 5, 6, 7, 8];
        const r0 = await resolverOf(db);
        const [x0, y0] = r0.positionAt(1, 9) as XY;
        const step = ((r0.positionAt(2, 9) as XY)[0] - x0) / 2;
        const at = (x: number, y: number): XY => [x0 + x * step, y0 + y * step];
        // A 2 × 4 box at page 2's start flag (QA-SN-5's): M1 to M4 on top
        const spot = new Map<number, XY>(
            IDS.map((m, i) => [m, at(2 * (i % 4), i < 4 ? -2 : 0)]),
        );
        await moveMarchersInTarget({
            db,
            target: { kind: "range", start: 1, end: 9 },
            moves: IDS.map((marcherId) => ({
                marcherId,
                x: spot.get(marcherId)![0],
                y: spot.get(marcherId)![1],
            })),
        });
        // Out of M1's corner, two spots' worth: the tail stays in the box
        const first = await dragTrail({ db, window: WINDOW, marcherIds: IDS, leaderId: 1, points: [{ at: at(-4, -2) }], spacing: { kind: "keep" }, step, ends: "trail" }); // prettier-ignore
        const snake = [1, 2, 3, 4, 8, 7, 6, 5];
        // Dragged on to 20 steps: everyone out, leader first, two steps apart (QA-SN-6's)
        await dragTrailHead({
            db,
            routeId: first.routeId,
            points: [{ at: at(-20, -2) }],
            spacing: { kind: "keep" },
            step,
        });
        let r = await resolverOf(db);
        snake.forEach((m, k) =>
            expect(near(r.positionAt(m, 17), at(-20 + 2 * k, -2))).toBe(true),
        );
        // Back to 4 steps: as the first drag left them, row ends cut straight across
        await dragTrailHead({
            db,
            routeId: first.routeId,
            points: [{ at: at(-4, -2) }],
            spacing: { kind: "keep" },
            step,
        });
        r = await resolverOf(db);
        expect(near(r.positionAt(1, 17), at(-4, -2))).toBe(true);
        expect(near(r.positionAt(2, 17), at(-2, -2))).toBe(true);
        expect(near(r.positionAt(3, 17), spot.get(1)!)).toBe(true);
        expect(near(r.positionAt(8, 17), spot.get(3)!)).toBe(true);
        expect(near(r.positionAt(5, 17), spot.get(7)!)).toBe(true);
    });

    it("QA-HD-5: refused, nothing written: a trail into end spots (no head to drag), a trail of no length, Even past its limit", async ({
        db,
        marchersAndPages: _,
    }) => {
        const first = await dragged(db, 10);
        const { step, lead } = first;
        await expectRefused(
            db,
            () =>
                dragTrailHead({
                    db,
                    routeId: first.routeId,
                    points: [{ at: [lead[0], lead[1]] }],
                    spacing: { kind: "keep" },
                    step,
                }),
            /longer trail/i,
        );
        await expectRefused(
            db,
            () =>
                dragTrailHead({
                    db,
                    routeId: first.routeId,
                    points: [{ at: [lead[0] + 2 * step, lead[1]] }],
                    spacing: { kind: "even", steps: 4 },
                    step,
                }),
            /steps/i,
        );
        // Step 4's Follow into the spots page 3's move has: no ends along the way
        const page3 = (await db
            .select()
            .from(schema.timelines)
            .where(eq(schema.timelines.start_beat, 17))
            .get())!;
        const r = await resolverOf(db);
        const at = r.positionAt(8, 17) as XY;
        const into = await followTrail({
            db,
            timelineId: page3.id,
            marcherIds: [7, 8],
            points: [{ at: [at[0] + 20, at[1] + 20] }],
        });
        await expectRefused(
            db,
            () =>
                dragTrailHead({
                    db,
                    routeId: into.routeId,
                    points: [{ at: [at[0] + 40, at[1] + 40] }],
                    spacing: { kind: "keep" },
                    step,
                }),
            /dragged out of a line/i,
        );
    });
});
