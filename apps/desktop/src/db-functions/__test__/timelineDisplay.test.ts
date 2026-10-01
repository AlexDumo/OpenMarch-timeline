import { afterEach, describe, expect, it as plainIt } from "vitest";
import { eq } from "drizzle-orm";
import { DbConnection, describeDbTests, schema } from "@/test/base";
import { convertPagesToTimeline } from "@/timeline/convert/writePageConversion";
import {
    startTimelineResolver,
    stopTimelineResolver,
    timelineResolverSettled,
    useTimelineResolverStore,
} from "@/timeline/timelineStore";
import { performRedo, performUndo, transactionWithHistory } from "../history";
import {
    historyStatementTable,
    touchesTimelineDisplayTables,
    useTimelineDisplayStore,
} from "../timelineDisplay";

/**
 * The display signal (docs/timeline/phases/07-page-parity.md P7.15): edits to `timelines` rows
 * alone and shape renames give an empty change batch, so the resolver version stays put, but the
 * display version moves on the commit, the undo and the redo.
 */

afterEach(() => stopTimelineResolver());

const setUp = async (db: DbConnection) => {
    await db.delete(schema.workspace_settings);
    await db.insert(schema.workspace_settings).values({
        id: 1,
        json_data: JSON.stringify({ timelineMode: true }),
    });
    await convertPagesToTimeline(db);
    await startTimelineResolver(db);
    await timelineResolverSettled();
};

const versions = () => ({
    resolver: useTimelineResolverStore.getState().version,
    display: useTimelineDisplayStore.getState().version,
});

describeDbTests("timeline display version", (it) => {
    it("a timeline rename bumps the display version, not the resolver's, through undo and redo", async ({
        db,
        marchersAndPages: _,
    }) => {
        await setUp(db);
        const [timeline] = await db.select().from(schema.timelines).all();
        const start = versions();

        await transactionWithHistory(db, "renameTimeline", (tx) =>
            tx
                .update(schema.timelines)
                .set({ name: "Renamed" })
                .where(eq(schema.timelines.id, timeline!.id)),
        );
        const edited = versions();
        expect(edited.resolver).toBe(start.resolver);
        expect(edited.display).toBe(start.display + 1);

        await performUndo(db);
        const undone = versions();
        expect(undone.resolver).toBe(start.resolver);
        expect(undone.display).toBe(edited.display + 1);
        expect((await db.select().from(schema.timelines).all())[0]!.name).toBe(
            timeline!.name,
        );

        await performRedo(db);
        const redone = versions();
        expect(redone.resolver).toBe(start.resolver);
        expect(redone.display).toBe(undone.display + 1);
    });

    it("a timeline range edit alone bumps the display version through undo and redo", async ({
        db,
        marchersAndPages: _,
    }) => {
        await setUp(db);
        const [timeline] = await db.select().from(schema.timelines).all();
        const start = versions();
        await transactionWithHistory(db, "growTimeline", (tx) =>
            tx
                .update(schema.timelines)
                .set({ end_beat: timeline!.end_beat + 4 })
                .where(eq(schema.timelines.id, timeline!.id)),
        );
        expect(versions().display).toBe(start.display + 1);
        await performUndo(db);
        expect(versions().display).toBe(start.display + 2);
        await performRedo(db);
        expect(versions().display).toBe(start.display + 3);
        expect(versions().resolver).toBe(start.resolver);
    });

    it("a shape rename bumps the display version through undo and redo", async ({
        db,
        marchersAndPages: _,
    }) => {
        await setUp(db);
        await db.insert(schema.timeline_shapes).values({
            kind: "line",
            geometry: '{"points":[[0,0],[10,0]]}',
        });
        await timelineResolverSettled();
        const [shape] = await db.select().from(schema.timeline_shapes).all();
        const start = versions();
        await transactionWithHistory(db, "renameShape", (tx) =>
            tx
                .update(schema.timeline_shapes)
                .set({ name: "Front line" })
                .where(eq(schema.timeline_shapes.id, shape!.id)),
        );
        expect(versions().display).toBe(start.display + 1);
        await performUndo(db);
        expect(versions().display).toBe(start.display + 2);
        await performRedo(db);
        expect(versions().display).toBe(start.display + 3);
    });

    it("an edit outside the timeline tables leaves the display version alone", async ({
        db,
        marchersAndPages: _,
    }) => {
        await setUp(db);
        const start = versions();
        await transactionWithHistory(db, "renameMarcher", (tx) =>
            tx
                .update(schema.marchers)
                .set({ name: "Someone" })
                .where(eq(schema.marchers.id, 1)),
        );
        expect(versions().display).toBe(start.display);
    });
});

describe("history statement tables", () => {
    plainIt("names the table a statement writes", () => {
        expect(historyStatementTable('UPDATE "timelines" SET "name"=1')).toBe(
            "timelines",
        );
        expect(
            historyStatementTable('DELETE FROM "timeline_shapes" WHERE'),
        ).toBe("timeline_shapes");
        expect(historyStatementTable("nothing")).toBeUndefined();
    });
    plainIt("follows only timelines and timeline_shapes", () => {
        expect(touchesTimelineDisplayTables(["marchers", "timelines"])).toBe(
            true,
        );
        expect(touchesTimelineDisplayTables(["timeline_shapes"])).toBe(true);
        expect(
            touchesTimelineDisplayTables(["marchers", "timeline_transitions"]),
        ).toBe(false);
    });
});
