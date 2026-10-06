import { afterEach, describe, expect } from "vitest";
import { countDistinct, getTableName } from "drizzle-orm";
import { DbConnection, describeDbTests, schema } from "@/test/base";
import { keepFixturesInPageMode } from "@/test/timelineMode";
import { convertPagesToTimeline } from "@/timeline/convert/writePageConversion";
import {
    startTimelineResolver,
    stopTimelineResolver,
} from "@/timeline/timelineStore";
import { planTapTheBeat, tempoFromTaps } from "@/timeline/tempo";
import { performRedo, performUndo } from "../history";
import { applyTapTheBeat, dismissLineUpStrip } from "../tapTheBeat";
import { durationsByBeatId, readCountDurationsInTransaction } from "../tempo";
import { getWorkspaceSettingsParsed } from "../workspaceSettings";

// These tests set the flag and convert the show themselves
keepFixturesInPageMode(
    "its tests convert the show and set the flag themselves",
);

afterEach(() => stopTimelineResolver());

const TABLES = [
    schema.beats,
    schema.pages,
    schema.measures,
    schema.workspace_settings,
    schema.timelines,
    schema.timeline_transitions,
    schema.timeline_assignments,
];

const snapshot = async (db: DbConnection) => {
    const out: Record<string, unknown[]> = {};
    for (const table of TABLES)
        out[getTableName(table)] = await db.select().from(table).all();
    out.workspace_settings = (
        out.workspace_settings as { json_data: string }[]
    ).map((r) => JSON.parse(r.json_data));
    return out;
};

const setUp = async (db: DbConnection) => {
    await db.delete(schema.workspace_settings);
    await db.insert(schema.workspace_settings).values({
        id: 1,
        json_data: JSON.stringify({ timelineMode: true }),
    });
    await convertPagesToTimeline(db);
    await startTimelineResolver(db);
};

const undoEntries = async (db: DbConnection) =>
    (
        await db
            .select({ n: countDistinct(schema.history_undo.history_group) })
            .from(schema.history_undo)
            .get()
    )?.n ?? 0;

describeDbTests("tap the beat writes", (it) => {
    it("applies taps from the start as one undo entry, with the offset and the strip", async ({
        db,
        marchersAndPages,
    }) => {
        void marchersAndPages;
        await setUp(db);
        const before = await snapshot(db);
        const undoBefore = await undoEntries(db);
        const show = await db.transaction((tx) =>
            readCountDurationsInTransaction(tx),
        );
        const period = 60 / 138;
        const fit = tempoFromTaps(
            Array.from({ length: 8 }, (_, i) => 1.6 + i * period),
        )!;
        const plan = planTapTheBeat({
            durations: show.durations,
            start: { kind: "start" },
            fit,
        })!;
        await applyTapTheBeat({
            db,
            newDurationsByBeatId: durationsByBeatId(
                show.beatIds,
                plan.durations,
            ),
            originShift: plan.originShift,
        });
        expect(await undoEntries(db)).toBe(undoBefore + 1);
        const settings = await getWorkspaceSettingsParsed({ db });
        expect(settings.audioOffsetSeconds).toBeCloseTo(-1.6, 9);
        expect(settings.tempoLineUpDismissed).toBe(true);
        const after = await snapshot(db);
        // Durations only: pages, measures and drill rows are untouched
        for (const t of [
            "pages",
            "measures",
            "timelines",
            "timeline_transitions",
            "timeline_assignments",
        ])
            expect(after[t]).toEqual(before[t]);
        const durations = (
            await db.transaction((tx) => readCountDurationsInTransaction(tx))
        ).durations;
        expect(durations[5]).toBeCloseTo(period, 9);

        expect((await performUndo(db)).success).toBe(true);
        expect(await snapshot(db)).toEqual(before);
        expect((await performRedo(db)).success).toBe(true);
        expect(await snapshot(db)).toEqual(after);
    });

    it("dismisses the strip outside undo", async ({ db, marchersAndPages }) => {
        void marchersAndPages;
        await setUp(db);
        const undoBefore = await undoEntries(db);
        await dismissLineUpStrip({ db });
        expect(
            (await getWorkspaceSettingsParsed({ db })).tempoLineUpDismissed,
        ).toBe(true);
        expect(await undoEntries(db)).toBe(undoBefore);
        await dismissLineUpStrip({ db });
        expect(await undoEntries(db)).toBe(undoBefore);
    });
});
