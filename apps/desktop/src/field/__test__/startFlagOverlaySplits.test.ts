import { expect } from "vitest";
import { eq } from "drizzle-orm";
import { createResolver } from "@openmarch/core";
import FieldPropertiesTemplates from "@/global/classes/FieldProperties.templates";
import { DbConnection, describeDbTests, schema } from "@/test/base";
import { keepFixturesInPageMode } from "@/test/timelineMode";
import { convertPagesToTimeline } from "@/test/convertPages";
import { readTimelineTables } from "@/timeline/timelineRows";
import { splitTimelineAtBeat } from "@/db-functions/timelineSplitAtBeat";
import { splitMarchersIntoNewMove } from "@/db-functions/timelineSplitMoves";
import type { StrokePlan } from "../timelineOverlays";
import {
    planStartFlagOverlay,
    type StartFlagOverlay,
} from "../startFlagOverlay";

keepFixturesInPageMode("its tests convert the show themselves");

/**
 * Start flag positions (#331) over moves split by marchers (UI-25) and at the playhead (UI-27):
 * a split changes which move a marcher is in, not where it walks, so the dots and routes drawn
 * over a window across the split are the same as before it.
 *
 * The converted `marchersAndPages` show: pages of 8 counts, page 2's box `[9, 17)`. The window
 * `[5, 21)` runs from inside page 1 to inside page 3, across a split of page 2 at beat 13.
 */

const fieldProperties =
    FieldPropertiesTemplates.HIGH_SCHOOL_FOOTBALL_FIELD_WITH_END_ZONES;

const planOf = async (
    db: DbConnection,
    stepSizeWarnings: boolean,
): Promise<StartFlagOverlay> => {
    const resolver = createResolver((await readTimelineTables(db)).snapshot);
    return planStartFlagOverlay({
        resolver,
        marcherIds: resolver.marcherIds(),
        selectedIds: new Set(),
        fromBeat: 5,
        toBeat: 21,
        levels: { dots: "all", paths: "all" },
        stepSizeWarnings,
        fieldProperties,
    });
};

const lengthOf = (stroke: StrokePlan) =>
    stroke.points
        .slice(1)
        .reduce(
            (sum, p, i) =>
                sum +
                Math.hypot(
                    p.x - stroke.points[i]!.x,
                    p.y - stroke.points[i]!.y,
                ),
            0,
        );

/** Strokes drawn over the same ground: same count, ends, color, dash and length. */
const expectSameStrokes = (
    a: readonly StrokePlan[],
    b: readonly StrokePlan[],
) => {
    expect(b).toHaveLength(a.length);
    a.forEach((stroke, i) => {
        const other = b[i]!;
        expect(other.color).toEqual(stroke.color);
        expect(other.dash).toEqual(stroke.dash);
        expect(other.width).toBe(stroke.width);
        for (const end of [0, -1] as const) {
            const p = stroke.points.at(end)!;
            const q = other.points.at(end)!;
            expect(q.x).toBeCloseTo(p.x, 6);
            expect(q.y).toBeCloseTo(p.y, 6);
        }
        expect(lengthOf(other)).toBeCloseTo(lengthOf(stroke), 3);
    });
};

const expectSamePlan = (a: StartFlagOverlay, b: StartFlagOverlay) => {
    expect(b.dots.dots).toHaveLength(a.dots.dots.length);
    a.dots.dots.forEach((dot, i) => {
        expect(b.dots.dots[i]!.x).toBeCloseTo(dot.x, 9);
        expect(b.dots.dots[i]!.y).toBeCloseTo(dot.y, 9);
    });
    expectSameStrokes(a.dots.strokes, b.dots.strokes);
    expectSameStrokes(a.paths.strokes, b.paths.strokes);
};

/** Page 2's timeline, over [9, 17), and its marchers. */
const page2 = async (db: DbConnection) => {
    const timeline = (await db
        .select()
        .from(schema.timelines)
        .where(eq(schema.timelines.start_beat, 9))
        .get())!;
    const transition = (await db
        .select()
        .from(schema.timeline_transitions)
        .where(eq(schema.timeline_transitions.timeline_id, timeline.id))
        .get())!;
    const rows = await db
        .select()
        .from(schema.timeline_assignments)
        .where(eq(schema.timeline_assignments.transition_id, transition.id))
        .all();
    return { timeline, marcherIds: rows.map((r) => r.marcher_id) };
};

describeDbTests("Start flag positions over split moves", (it) => {
    it("draw the same over a move split at the playhead (UI-27)", async ({
        db,
        marchersAndPages: _,
    }) => {
        await convertPagesToTimeline(db);
        const before = [await planOf(db, false), await planOf(db, true)];
        expect(before[0]!.dots.dots.length).toBeGreaterThan(0);
        expect(before[0]!.paths.strokes.length).toBeGreaterThan(0);

        const { timeline } = await page2(db);
        await splitTimelineAtBeat({ db, timelineId: timeline.id, beat: 13 });

        expectSamePlan(before[0]!, await planOf(db, false));
        expectSamePlan(before[1]!, await planOf(db, true));
    });

    it("draw the same over a move split off by marchers (UI-25), then split at the playhead", async ({
        db,
        marchersAndPages: _,
    }) => {
        await convertPagesToTimeline(db);
        const before = [await planOf(db, false), await planOf(db, true)];

        const { timeline, marcherIds } = await page2(db);
        const off = await splitMarchersIntoNewMove({
            db,
            timelineId: timeline.id,
            marcherIds: marcherIds.slice(0, 2),
        });
        expectSamePlan(before[0]!, await planOf(db, false));
        expectSamePlan(before[1]!, await planOf(db, true));

        await splitTimelineAtBeat({
            db,
            timelineId: off.timeline.id,
            beat: 13,
        });
        expectSamePlan(before[0]!, await planOf(db, false));
        expectSamePlan(before[1]!, await planOf(db, true));
    });
});
