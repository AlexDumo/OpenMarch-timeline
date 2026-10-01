import { afterEach, describe, expect, it as plainIt } from "vitest";
import { FieldProperties } from "@openmarch/core";
import type { OpenMarchShowData } from "@openmarch/schema";
import { safeValidateOpenMarchData } from "@openmarch/schema";
import { DbConnection, describeDbTests, schema } from "@/test/base";
import { FieldPropertiesSchema } from "@/components/field/fieldPropertiesSchema";
import type { DB } from "@/global/database/db";
import { updateMarcherPages } from "@/db-functions/marcherPage";
import { moveMarchersOnPage } from "@/db-functions/timelineMoves";
import { updateWorkspaceSettingsParsed } from "@/db-functions/workspaceSettings";
import type Page from "@/global/classes/Page";
import { workspaceSettingsSchema } from "@/settings/workspaceSettings";
import {
    convertPagesToTimeline,
    readShowTiming,
} from "@/timeline/convert/writePageConversion";
import { pageEndBeat } from "@/timeline/timelineCanvas";
import { acquireExportResolver } from "@/timeline/timelineExport";
import { sampleTimelinePagePositions } from "@/timeline/timelinePagePositions";
import {
    startTimelineResolver,
    stopTimelineResolver,
} from "@/timeline/timelineStore";
import { toOpenMarchSchema } from "../dots-to-om";

/**
 * The mobile app payload in timeline mode (docs/timeline/phases/07-page-parity.md P7.12): page
 * positions come from the resolver at each page's end beat, never from `marcher_pages`.
 */

afterEach(() => stopTimelineResolver());

const setTimelineMode = (db: DbConnection, timelineMode: boolean) =>
    updateWorkspaceSettingsParsed({
        db,
        settings: workspaceSettingsSchema.parse({ timelineMode }),
    });

const exportShow = (db: DbConnection) => toOpenMarchSchema(db as unknown as DB);

const sortedPages = async (db: DbConnection): Promise<Page[]> => {
    const { pages } = await readShowTiming(db);
    return [...pages].sort((a, b) => a.order - b.order);
};

type Coordinate = OpenMarchShowData["coordinates"][number];
const key = (c: Pick<Coordinate, "marcherId" | "pageId">) =>
    `${c.marcherId}:${c.pageId}`;
const byKey = (coordinates: readonly Coordinate[]) =>
    new Map(coordinates.map((c) => [key(c), c]));

/** Every coordinate in `actual` matches `expected` (same pages and marchers, x/y within 1e-9). */
const expectSameCoordinates = (
    actual: readonly Coordinate[],
    expected: readonly Coordinate[],
) => {
    expect(actual).toHaveLength(expected.length);
    const want = byKey(expected);
    for (const c of actual) {
        const w = want.get(key(c));
        expect(w, key(c)).toBeDefined();
        expect(c.xSteps).toBeCloseTo(w!.xSteps, 9);
        expect(c.ySteps).toBeCloseTo(w!.ySteps, 9);
    }
};

describe("sampleTimelinePagePositions", () => {
    plainIt("samples every marcher at every page's end beat", () => {
        const calls: [number, number][] = [];
        const resolver = {
            marcherIds: () => [7, 9],
            positionAt: (m: number, b: number): [number, number] => {
                calls.push([m, b]);
                return [m * 10, b];
            },
        };
        const pages = [
            { id: 0, beats: [{ index: 0 }] },
            { id: 4, beats: [{ index: 1 }, { index: 2 }, { index: 3 }] },
        ] as unknown as Page[];

        expect(sampleTimelinePagePositions(resolver, pages)).toEqual([
            { marcher_id: 7, page_id: 0, x: 70, y: 1 },
            { marcher_id: 9, page_id: 0, x: 90, y: 1 },
            { marcher_id: 7, page_id: 4, x: 70, y: 4 },
            { marcher_id: 9, page_id: 4, x: 90, y: 4 },
        ]);
        expect(calls.map(([, b]) => b)).toEqual([1, 1, 4, 4]);
    });
});

describeDbTests("dots-to-om in timeline mode", (it) => {
    it("gives a freshly converted show the same page positions as page mode", async ({
        db,
        marchersAndPages: _,
    }) => {
        const pageMode = await exportShow(db);
        await convertPagesToTimeline(db);
        await setTimelineMode(db, true);

        const timeline = await exportShow(db);

        expect(safeValidateOpenMarchData(timeline).success).toBe(true);
        expectSameCoordinates(timeline.coordinates, pageMode.coordinates);
        expect(timeline.pages).toEqual(pageMode.pages);
        expect(timeline.performers).toEqual(pageMode.performers);
        expect(timeline.tempoSections).toEqual(pageMode.tempoSections);
    });

    it("samples the resolver at each page's end beat", async ({
        db,
        marchersAndPages: _,
    }) => {
        await convertPagesToTimeline(db);
        await setTimelineMode(db, true);
        const pages = await sortedPages(db);
        const resolver = await acquireExportResolver(db);

        const { coordinates } = await exportShow(db);
        const steps = byKey(coordinates);

        // Compare offsets from one page-0 coordinate, so the field's origin cancels out
        const row = await db.query.field_properties.findFirst();
        const { pixelsPerStep } = new FieldProperties(
            FieldPropertiesSchema.parse(JSON.parse(row!.json_data)),
        );
        const m = resolver.marcherIds()[0]!;
        const c0 = steps.get(key({ marcherId: String(m), pageId: "0" }))!;
        const [x0, y0] = resolver.positionAt(m, pageEndBeat(pages[0]!));

        expect(coordinates).toHaveLength(
            pages.length * resolver.marcherIds().length,
        );
        for (const page of pages) {
            for (const id of resolver.marcherIds()) {
                const [x, y] = resolver.positionAt(id, pageEndBeat(page));
                const c = steps.get(
                    key({ marcherId: String(id), pageId: String(page.id) }),
                )!;
                expect(c).toBeDefined();
                expect(c.xSteps - c0.xSteps).toBeCloseTo(
                    (x - x0) / pixelsPerStep,
                    9,
                );
                expect(c.ySteps - c0.ySteps).toBeCloseTo(
                    -(y - y0) / pixelsPerStep,
                    9,
                );
                expect(c.rotation_degrees).toBeUndefined();
            }
        }
    });

    it("exports a timeline edit and never reads marcher_pages", async ({
        db,
        marchersAndPages: _,
    }) => {
        const before = await exportShow(db);
        await convertPagesToTimeline(db);
        await setTimelineMode(db, true);
        const pages = await sortedPages(db);
        const page = pages[2]!;
        const resolver = await acquireExportResolver(db);
        const [x, y] = resolver.positionAt(1, pageEndBeat(page));
        await moveMarchersOnPage({
            db,
            page,
            moves: [{ marcherId: 1, x: x + 24, y }],
        });
        // Frozen page-era rows that disagree with the timeline are ignored
        await updateMarcherPages({
            db,
            modifiedMarcherPages: [
                { marcher_id: 2, page_id: page.id, x: 1, y: 1 },
            ],
        });

        const after = await exportShow(db);

        const moved = key({ marcherId: "1", pageId: String(page.id) });
        const untouched = key({ marcherId: "2", pageId: String(page.id) });
        const old = byKey(before.coordinates);
        const now = byKey(after.coordinates);
        const pixelsPerStep =
            24 / (now.get(moved)!.xSteps - old.get(moved)!.xSteps);
        expect(pixelsPerStep).toBeGreaterThan(0);
        expect(now.get(moved)!.ySteps).toBeCloseTo(old.get(moved)!.ySteps, 9);
        expect(now.get(untouched)!.xSteps).toBeCloseTo(
            old.get(untouched)!.xSteps,
            9,
        );
        expect(now.get(untouched)!.ySteps).toBeCloseTo(
            old.get(untouched)!.ySteps,
            9,
        );

        // Page mode still reads the page-era rows, which the timeline edit didn't touch
        await setTimelineMode(db, false);
        const pageMode = byKey((await exportShow(db)).coordinates);
        expect(pageMode.get(moved)!.xSteps).toBe(old.get(moved)!.xSteps);
        expect(pageMode.get(untouched)!.xSteps).not.toBe(
            old.get(untouched)!.xSteps,
        );
    });

    it("leaves out per-page appearance overrides, which timeline mode dropped", async ({
        db,
        marchersAndPages,
    }) => {
        const firstPageId = marchersAndPages.expectedPages[0].id;
        await updateMarcherPages({
            db,
            modifiedMarcherPages: [
                { marcher_id: 1, page_id: firstPageId, shape_type: "x" },
            ],
        });
        await convertPagesToTimeline(db);
        const isOverride = (p: { marcherId: string; pageId: string }) =>
            p.marcherId === "1" && p.pageId === String(firstPageId);

        const pageMode = await exportShow(db);
        await setTimelineMode(db, true);
        const timeline = await exportShow(db);

        expect(pageMode.performerAppearance.performers.some(isOverride)).toBe(
            true,
        );
        expect(timeline.performerAppearance.performers.some(isOverride)).toBe(
            false,
        );
    });

    it("waits for a timeline write still in flight", async ({
        db,
        marchersAndPages: _,
    }) => {
        await convertPagesToTimeline(db);
        await setTimelineMode(db, true);
        await startTimelineResolver(db);
        const pages = await sortedPages(db);
        const page = pages[1]!;
        const before = byKey((await exportShow(db)).coordinates);
        const resolver = await acquireExportResolver(db);
        const [x, y] = resolver.positionAt(3, pageEndBeat(page));

        // A nudge is still being written when the export starts
        const nudge = moveMarchersOnPage({
            db,
            page,
            moves: [{ marcherId: 3, x: x + 12, y }],
        });
        const exported = exportShow(db);
        await nudge;
        const after = byKey((await exported).coordinates);

        const moved = key({ marcherId: "3", pageId: String(page.id) });
        expect(after.get(moved)!.xSteps).toBeGreaterThan(
            before.get(moved)!.xSteps,
        );
    });

    it("reads no marcher_pages rows for a show with none", async ({
        db,
        marchersAndPages: _,
    }) => {
        await convertPagesToTimeline(db);
        await setTimelineMode(db, true);
        const expected = (await exportShow(db)).coordinates;
        await db.delete(schema.marcher_pages);

        const { coordinates } = await exportShow(db);

        expectSameCoordinates(coordinates, expected);
    });
});
