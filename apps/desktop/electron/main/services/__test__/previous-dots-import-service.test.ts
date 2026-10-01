import { describe, expect, it as plainIt, vi } from "vitest";
import {
    DbConnection,
    describeDbTests,
    getTempDotsPath,
    schema,
} from "@/test/base";
import { eq } from "drizzle-orm";
import { updateMarcherPages } from "@/db-functions/marcherPage";
import { moveMarchersOnPage } from "@/db-functions/timelineMoves";
import { updateWorkspaceSettingsParsed } from "@/db-functions/workspaceSettings";
import { fromDatabasePages } from "@/global/classes/Page";
import { workspaceSettingsSchema } from "@/settings/workspaceSettings";
import {
    convertPagesToTimeline,
    readShowTiming,
} from "@/timeline/convert/writePageConversion";
import { pageEndBeat } from "@/timeline/timelineCanvas";
import { acquireExportResolver } from "@/timeline/timelineExport";
import {
    isSourceInTimelineMode,
    lastPageEndBeat,
} from "@/timeline/sourceTimelinePositions";

vi.mock("electron", () => ({ dialog: {}, ipcMain: {} }));

const { readPreviousDotsFile } =
    await import("../previous-dots-import-service");

/**
 * "Import from a previous show" starts the new show from the source's last page. A timeline-mode
 * source's `marcher_pages` rows are frozen page-era data, so its positions come from the source's
 * resolver at the last page's end beat (docs/timeline/phases/07-page-parity.md P7.16). A page-mode
 * source is read as before.
 */

const setTimelineMode = (db: DbConnection, timelineMode: boolean) =>
    updateWorkspaceSettingsParsed({
        db,
        settings: workspaceSettingsSchema.parse({ timelineMode }),
    });

const lastPage = async (db: DbConnection) => {
    const { pages } = await readShowTiming(db);
    return [...pages].sort((a, b) => a.order - b.order).at(-1)!;
};

/** `drill_prefix + drill_order` to marcher id, for the source file's marchers. */
const marcherIdsByDrillNumber = async (db: DbConnection) =>
    new Map(
        (await db.select().from(schema.marchers).all()).map((m) => [
            `${m.drill_prefix}${m.drill_order}`,
            m.id,
        ]),
    );

const byMarcherId = async (
    db: DbConnection,
    coordinates: Awaited<
        ReturnType<typeof readPreviousDotsFile>
    >["coordinates"],
) => {
    const ids = await marcherIdsByDrillNumber(db);
    return new Map(
        coordinates.map((c) => [
            ids.get(`${c.drill_prefix}${c.drill_order}`)!,
            c,
        ]),
    );
};

const lastPageRows = async (db: DbConnection) => {
    const page = await lastPage(db);
    return db
        .select()
        .from(schema.marcher_pages)
        .where(eq(schema.marcher_pages.page_id, page.id))
        .all();
};

describeDbTests("readPreviousDotsFile", (it) => {
    it("page mode reads the last page's marcher_pages rows, as before", async ({
        db,
        marchersAndPages: _,
        task,
    }) => {
        const rows = await lastPageRows(db);
        expect(rows.length).toBeGreaterThan(0);

        const { coordinates } = await readPreviousDotsFile(
            getTempDotsPath(task),
        );

        const imported = await byMarcherId(db, coordinates);
        expect(imported.size).toBe(rows.length);
        for (const row of rows) {
            expect(imported.get(row.marcher_id)).toMatchObject({
                x: row.x,
                y: row.y,
            });
        }
    });

    it("a converted show with the flag off still reads marcher_pages", async ({
        db,
        marchersAndPages: _,
        task,
    }) => {
        await convertPagesToTimeline(db);
        await setTimelineMode(db, false);
        const page = await lastPage(db);
        await updateMarcherPages({
            db,
            modifiedMarcherPages: [
                { marcher_id: 1, page_id: page.id, x: 11, y: 22 },
            ],
        });

        const { coordinates } = await readPreviousDotsFile(
            getTempDotsPath(task),
        );

        expect((await byMarcherId(db, coordinates)).get(1)).toMatchObject({
            x: 11,
            y: 22,
        });
    });

    it("timeline mode samples the resolver at the last page's end beat, never marcher_pages", async ({
        db,
        marchersAndPages: _,
        task,
    }) => {
        await convertPagesToTimeline(db);
        await setTimelineMode(db, true);
        const page = await lastPage(db);
        const before = await acquireExportResolver(db);
        const [x, y] = before.positionAt(1, pageEndBeat(page));
        await moveMarchersOnPage({
            db,
            page,
            moves: [{ marcherId: 1, x: x + 24, y: y - 12 }],
        });
        // A frozen page-era row that disagrees with the timeline is ignored
        await updateMarcherPages({
            db,
            modifiedMarcherPages: [
                { marcher_id: 2, page_id: page.id, x: 1, y: 1 },
            ],
        });
        const resolver = await acquireExportResolver(db);

        const { coordinates } = await readPreviousDotsFile(
            getTempDotsPath(task),
        );

        const imported = await byMarcherId(db, coordinates);
        expect(imported.size).toBe(resolver.marcherIds().length);
        for (const id of resolver.marcherIds()) {
            const [rx, ry] = resolver.positionAt(id, pageEndBeat(page));
            expect(imported.get(id)!.x).toBeCloseTo(rx, 9);
            expect(imported.get(id)!.y).toBeCloseTo(ry, 9);
        }
        expect(imported.get(1)!.x).toBeCloseTo(x + 24, 9);
        expect(imported.get(1)!.y).toBeCloseTo(y - 12, 9);
        expect(imported.get(2)).not.toMatchObject({ x: 1, y: 1 });
    });
});

describe("isSourceInTimelineMode", () => {
    plainIt("is on only when the settings parse and turn the flag on", () => {
        expect(isSourceInTimelineMode(undefined)).toBe(false);
        expect(isSourceInTimelineMode("not json")).toBe(false);
        expect(isSourceInTimelineMode("{}")).toBe(false);
        expect(isSourceInTimelineMode('{"timelineMode":false}')).toBe(false);
        expect(isSourceInTimelineMode('{"timelineMode":true}')).toBe(true);
        expect(
            isSourceInTimelineMode('{"timelineMode":true,"defaultTempo":-1}'),
        ).toBe(false);
    });
});

describe("lastPageEndBeat", () => {
    /** The last page's end beat as the renderer computes it: `fromDatabasePages`, then `pageEndBeat`. */
    const rendererEndBeat = (
        beatCount: number,
        startBeatIndex: number,
        lastPageCounts: number,
    ) => {
        const beats = Array.from({ length: beatCount }, (_, i) => ({
            id: i + 1,
            position: i,
            duration: 0.5,
            include_in_measure: true,
            notes: null,
            index: i,
            timestamp: i * 0.5,
        }));
        const pages = fromDatabasePages({
            databasePages: [
                {
                    id: 0,
                    start_beat: 1,
                    is_subset: false,
                    notes: null,
                },
                ...(startBeatIndex > 0
                    ? [
                          {
                              id: 1,
                              start_beat: startBeatIndex + 1,
                              is_subset: false,
                              notes: null,
                          },
                      ]
                    : []),
            ],
            allMeasures: [],
            allBeats: beats,
            lastPageCounts,
        });
        return pageEndBeat(pages.at(-1)!);
    };

    for (const [beatCount, start, counts] of [
        [20, 5, 8],
        [20, 5, 15],
        [20, 5, 30],
        [20, 19, 8],
        [20, 0, 8],
        [1, 0, 8],
        [10, 9, 1],
    ] as const) {
        plainIt(
            `matches the renderer for ${beatCount} beats, a last page at ${start} and ${counts} counts`,
            () => {
                expect(
                    lastPageEndBeat({
                        startBeatIndex: start,
                        beatCount,
                        lastPageCounts: counts,
                        isFirstPage: start === 0,
                    }),
                ).toBe(rendererEndBeat(beatCount, start, counts));
            },
        );
    }
});
