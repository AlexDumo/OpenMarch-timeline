/**
 * Detach parity, pathways step 3c (spec J.8 AP-R9: "positions are bit-identical"): on the
 * converted `marchersAndPages` show (76 marchers, 6 pages), a 16-member group path with a smooth
 * point, a corner and an arc leg, three spots adjusted, then:
 *
 * - Detach one member, Detach all 16 at once, and Rejoin every unadjusted member after Detach:
 *   every marcher's position at every sixteenth of a beat of the whole show is the same float64
 *   pair (`Object.is` on both coordinates) as before;
 * - each is one undo step that puts the positions back the same way.
 *
 * Rejoin drops an Adjust (owner Q4), so an adjusted member is checked to move and only it.
 */
import { expect } from "vitest";
import { eq } from "drizzle-orm";
import {
    createResolver,
    groupSchedule,
    type Resolver,
    type RouteGeometry,
    type XY,
} from "@openmarch/core";
import { DbConnection, describeDbTests, schema } from "@/test/base";
import { keepFixturesInPageMode } from "@/test/timelineMode";
import { convertPagesToTimeline } from "@/test/convertPages";
import { readTimelineTables } from "@/timeline/timelineRows";
import { performUndo } from "../history";
import {
    detachFromGroupPath,
    drawGroupRoute,
    meanOf,
    rejoinGroupPath,
} from "../timelineGroupRoutes";
import { adjustLane } from "../timelinePathAdjust";

keepFixturesInPageMode("its tests convert the show themselves");

const STEPS_PER_BEAT = 16;

const resolverOf = async (db: DbConnection): Promise<Resolver> =>
    createResolver((await readTimelineTables(db)).snapshot);

/** Every marcher's position at every sixteenth of a beat of the show, by marcher id */
async function walkOf(db: DbConnection) {
    const r = await resolverOf(db);
    const end = Math.max(
        ...(await db.select().from(schema.timelines).all()).map(
            (t) => t.end_beat,
        ),
    );
    const ids = [...r.marcherIds()].sort((a, b) => a - b);
    return {
        ids,
        rows: ids.map((id) =>
            Array.from({ length: end * STEPS_PER_BEAT + 1 }, (_, i) =>
                r.positionAt(id, i / STEPS_PER_BEAT),
            ),
        ),
    };
}

type Walk = Awaited<ReturnType<typeof walkOf>>;

/** The marchers whose walk differs from `base` anywhere, bit for bit; and how many pairs were compared */
function differ(base: Walk, now: Walk) {
    expect(now.ids).toEqual(base.ids);
    const moved: number[] = [];
    let compared = 0;
    base.rows.forEach((row, i) => {
        const other = now.rows[i]!;
        let same = row.length === other.length;
        row.forEach((p, k) => {
            compared++;
            const q = other[k]!;
            if (!Object.is(p[0], q[0]) || !Object.is(p[1], q[1])) same = false;
        });
        if (!same) moved.push(base.ids[i]!);
    });
    return { moved, compared };
}

const report: string[] = [];

describeDbTests("Detach parity (AP-R9)", (it) => {
    it("Detach one, Detach all 16 in one step, Rejoin: every marcher, every 1/16 beat, bit for bit", async ({
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
        const members = [...r0.marcherIds()].sort((a, b) => a - b).slice(0, 16);
        const F = meanOf(members.map((m) => r0.positionAt(m, 9) as XY));
        const G = meanOf(members.map((m) => r0.positionAt(m, 17) as XY));
        const drawn = await drawGroupRoute({
            db,
            timelineId: timeline.id,
            marcherIds: members,
            points: [
                { at: [F[0] + 24, F[1] - 32], tension: 1 },
                { at: [F[0] + 60, F[1] - 10] },
                { at: [G[0] - 30, G[1] + 28], bulge: 0.25 },
            ],
        });
        // Three spots adjusted, in the middle of the shared part
        const geometry = JSON.parse(
            (await db
                .select()
                .from(schema.timeline_routes)
                .where(eq(schema.timeline_routes.id, drawn.routeId))
                .get())!.geometry,
        ) as RouteGeometry;
        const { W } = groupSchedule(geometry);
        const mid = (W.D[1]! + W.D[W.V.length - 2]!) / 2;
        const lanes = await db
            .select()
            .from(schema.timeline_lanes)
            .where(eq(schema.timeline_lanes.route_id, drawn.routeId))
            .all();
        const rows = await db
            .select()
            .from(schema.timeline_assignments)
            .where(eq(schema.timeline_assignments.start_beat, 9))
            .all();
        const laneOfMarcher = (m: number) => {
            const row = rows.find((a) => a.marcher_id === m)!;
            return lanes.find(
                (l) =>
                    l.transition_id === row.transition_id &&
                    l.slot_index === row.slot_index,
            )!;
        };
        const adjusted = [members[2]!, members[7]!, members[11]!];
        for (const [i, m] of adjusted.entries())
            await adjustLane({
                db,
                laneId: laneOfMarcher(m).id,
                marcherId: m,
                x: mid,
                d: [0, 6 + 3 * i],
            });

        const base = await walkOf(db);
        const pairs = (w: Walk) => w.rows.length * w.rows[0]!.length;

        // Detach one adjusted member
        await detachFromGroupPath({
            db,
            timelineId: timeline.id,
            marcherIds: [adjusted[0]!],
        });
        const one = differ(base, await walkOf(db));
        expect(one.moved).toEqual([]);
        report.push(
            `Detach one adjusted member: ${one.compared} pairs, 0 moved`,
        );
        expect((await performUndo(db)).success).toBe(true);
        expect(differ(base, await walkOf(db)).moved).toEqual([]);

        // Detach all 16 in one edit: one undo step
        await detachFromGroupPath({
            db,
            timelineId: timeline.id,
            marcherIds: members,
        });
        const all = differ(base, await walkOf(db));
        expect(all.moved).toEqual([]);
        report.push(
            `Detach all 16 in one edit: ${all.compared} pairs, 0 moved`,
        );
        expect((await performUndo(db)).success).toBe(true);
        expect(differ(base, await walkOf(db)).moved).toEqual([]);
        report.push(`Undo of Detach all 16 (one step): 0 moved`);

        // Detach the 16, Rejoin all but the adjusted ones: nobody moves
        await detachFromGroupPath({
            db,
            timelineId: timeline.id,
            marcherIds: members.slice(0, 15),
        });
        const plain = members.slice(0, 15).filter((m) => !adjusted.includes(m));
        await rejoinGroupPath({
            db,
            timelineId: timeline.id,
            routeId: drawn.routeId,
            marcherIds: plain,
        });
        const rejoined = differ(base, await walkOf(db));
        expect(rejoined.moved).toEqual([]);
        report.push(
            `Detach 15, Rejoin the ${plain.length} unadjusted: ${rejoined.compared} pairs, 0 moved`,
        );
        // Rejoin the adjusted ones: they drop their Adjust (Q4) and only they move
        await rejoinGroupPath({
            db,
            timelineId: timeline.id,
            routeId: drawn.routeId,
            marcherIds: adjusted,
        });
        expect(differ(base, await walkOf(db)).moved).toEqual(
            [...adjusted].sort((a, b) => a - b),
        );
        expect((await performUndo(db)).success).toBe(true);
        expect(differ(base, await walkOf(db)).moved).toEqual([]);
        report.push(
            `Rejoin the 3 adjusted: only those 3 move (Adjust dropped); undo: 0 moved`,
        );
        expect(pairs(base)).toBeGreaterThan(70 * 16 * 16);
        // Printed for the PR (vitest run without --silent)
        // eslint-disable-next-line no-console
        console.log(
            `Detach parity (${base.ids.length} marchers x ${base.rows[0]!.length} samples):\n  ${report.join("\n  ")}`,
        );
    });
});
