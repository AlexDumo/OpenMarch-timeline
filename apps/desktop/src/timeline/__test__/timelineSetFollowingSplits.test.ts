import { expect } from "vitest";
import { createResolver, type Resolver } from "@openmarch/core";
import { eq } from "drizzle-orm";
import { DbConnection, describeDbTests, schema } from "@/test/base";
import { keepFixturesInPageMode } from "@/test/timelineMode";
import { convertPagesToTimeline } from "@/test/convertPages";
import { readTimelineTables } from "@/timeline/timelineRows";
import { splitTimelineAtBeat } from "@/db-functions/timelineSplitAtBeat";
import { splitMarchersIntoNewMove } from "@/db-functions/timelineSplitMoves";
import { marcherSetBeats } from "../timelineSetFollowing";
import { resolverSpans } from "../timelineStore";

keepFixturesInPageMode("its tests convert the show themselves");

/**
 * Set vs Following (#300) after the two splits, on the converted `marchersAndPages` show (pages
 * of 8 counts, page 2's box `[9, 17)`): a marcher split off into its own move (UI-25) reads as it
 * did, and a move cut at the playhead (UI-27) makes the cut a count everyone in it is Set on.
 */

const resolverOf = async (db: DbConnection): Promise<Resolver> =>
    createResolver((await readTimelineTables(db)).snapshot);

/** Every marcher's Set beats, by id, as the field and the timeline read them. */
const setBeatsOf = (r: Resolver) =>
    new Map(
        r
            .marcherIds()
            .map((id) => [
                id,
                marcherSetBeats(resolverSpans(r, id), (beat) =>
                    r.positionAt(id, beat),
                ),
            ]),
    );

const page2 = async (db: DbConnection) =>
    (await db
        .select()
        .from(schema.timelines)
        .where(eq(schema.timelines.start_beat, 9))
        .get())!;

describeDbTests("Set vs Following after a split", (it) => {
    it("a marcher split off into its own move is Set and Following where it was (UI-25)", async ({
        db,
        marchersAndPages: _,
    }) => {
        await convertPagesToTimeline(db);
        const before = setBeatsOf(await resolverOf(db));
        const page = await page2(db);
        const [first, second] = [...before.keys()];

        await splitMarchersIntoNewMove({
            db,
            timelineId: page.id,
            marcherIds: [first!, second!],
        });

        expect(setBeatsOf(await resolverOf(db))).toEqual(before);
    });

    it("a move cut at the playhead makes the cut a Set count for its marchers, and nothing else (UI-27)", async ({
        db,
        marchersAndPages: _,
    }) => {
        await convertPagesToTimeline(db);
        const r = await resolverOf(db);
        const before = setBeatsOf(r);
        const page = await page2(db);
        // The marchers who really move over page 2 are the ones a cut at 13 finds mid-move
        const moving = [...before.keys()].filter((id) => {
            const [x0, y0] = r.positionAt(id, 9);
            const [x1, y1] = r.positionAt(id, 17);
            return x0 !== x1 || y0 !== y1;
        });
        expect(moving.length).toBeGreaterThan(0);
        for (const id of moving) expect(before.get(id)).not.toContain(13);

        await splitTimelineAtBeat({ db, timelineId: page.id, beat: 13 });

        const after = setBeatsOf(await resolverOf(db));
        for (const [id, beats] of before)
            expect(after.get(id)).toEqual(
                moving.includes(id)
                    ? [...beats, 13].sort((a, b) => a - b)
                    : beats,
            );
    });
});
