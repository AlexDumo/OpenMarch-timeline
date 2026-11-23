import { afterEach, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { FieldProperties, TICKS_PER_BEAT } from "@openmarch/core";
import type { OpenMarchShowData } from "@openmarch/schema";
import {
    createExactPathReader,
    safeValidateOpenMarchData,
} from "@openmarch/schema";
import { DbConnection, describeDbTests, schema } from "@/test/base";
import type { DB } from "@/global/database/db";
import { FieldPropertiesSchema } from "@/components/field/fieldPropertiesSchema";
import { moveMarchersInTarget } from "@/db-functions/timelineMoves";
import { setMovePath } from "@/db-functions/timelineCommands";
import { drawRoute } from "@/db-functions/timelineRoutes";
import type Page from "@/global/classes/Page";
import { readShowTiming } from "@/timeline/showTiming";
import { pageEndBeat } from "@/timeline/timelineCanvas";
import { acquireExportResolver } from "@/timeline/timelineExport";
import { readTimelinePageSnapshot } from "@/timeline/timelinePagePositions";
import { stopTimelineResolver } from "@/timeline/timelineStore";
import { toOpenMarchSchema } from "../dots-to-om";
import { hasMotionBetweenPages } from "../pageLines";
import { toSteps, type StepAxes } from "../exact-paths-export";

/**
 * Motion only a timeline show has (docs/convergence/inventory.md R1): a move that ends partway
 * through a page, and a curved path. The mobile export still writes one position per marcher per
 * page, at the page's end beat, for every page; the phone draws straight lines between them.
 * `hasMotionBetweenPages` tells the export panel the show has such motion.
 */

afterEach(() => stopTimelineResolver());

const exportShow = (db: DbConnection) => toOpenMarchSchema(db as unknown as DB);

const sortedPages = async (db: DbConnection): Promise<Page[]> => {
    const { pages } = await readShowTiming(db);
    return [...pages].sort((a, b) => a.order - b.order);
};

const fieldProperties = async (db: DbConnection) => {
    const row = await db.query.field_properties.findFirst();
    return new FieldProperties(
        FieldPropertiesSchema.parse(JSON.parse(row!.json_data)),
    );
};

const motionBetweenPages = async (db: DbConnection) =>
    hasMotionBetweenPages(await readTimelinePageSnapshot(db));

type Coordinate = OpenMarchShowData["coordinates"][number];
const coordinateOf = (
    show: OpenMarchShowData,
    marcherId: number,
    page: Page,
): Coordinate =>
    show.coordinates.find(
        (c) =>
            c.marcherId === String(marcherId) && c.pageId === String(page.id),
    )!;

/** Every page, and every performer on it, with the same pages and timing as `before`. */
const expectEveryPage = (
    show: OpenMarchShowData,
    before: OpenMarchShowData,
) => {
    expect(safeValidateOpenMarchData(show).success).toBe(true);
    expect(show.pages).toEqual(before.pages);
    expect(show.tempoSections).toEqual(before.tempoSections);
    expect(show.coordinates).toHaveLength(
        show.pages.length * show.performers.length,
    );
};

/** The stored timelines from `start` to `end`. */
const timelinesOver = async (db: DbConnection, start: number, end: number) =>
    await db
        .select({ id: schema.timelines.id })
        .from(schema.timelines)
        .where(
            and(
                eq(schema.timelines.start_beat, start),
                eq(schema.timelines.end_beat, end),
            ),
        )
        .all();

describeDbTests("dots-to-om timeline-only motion", (it) => {
    it("a move ending mid-page: the page's end position, every page kept", async ({
        db,
        marchersAndPages: _,
    }) => {
        const pages = await sortedPages(db);
        const page = pages[3]!;
        const start = pageEndBeat(pages[2]!);
        const end = pageEndBeat(page);
        const mid = start + Math.floor((end - start) / 2);
        expect(mid).toBeGreaterThan(start);
        expect(mid).toBeLessThan(end);
        expect(await motionBetweenPages(db)).toBe(false);
        const before = await exportShow(db);
        const atPrevious = coordinateOf(before, 1, pages[2]!);

        await moveMarchersInTarget({
            db,
            target: { kind: "range", start, end: mid },
            moves: [{ marcherId: 1, x: 200, y: 210 }],
        });
        const resolver = await acquireExportResolver(db);
        expect(resolver.positionAt(1, mid)).toEqual([200, 210]);
        const show = await exportShow(db);

        expectEveryPage(show, before);
        // Page 3's position is where the marcher is on the page's flag, not the mid-page spot;
        // the page before is unchanged
        const [flagX, flagY] = resolver.positionAt(1, end);
        const [previousX, previousY] = resolver.positionAt(1, start);
        const exported = coordinateOf(show, 1, page);
        const previous = coordinateOf(show, 1, pages[2]!);
        expect(previous).toEqual(atPrevious);
        const { pixelsPerStep } = await fieldProperties(db);
        expect(exported.xSteps - previous.xSteps).toBeCloseTo(
            (flagX - previousX) / pixelsPerStep,
            9,
        );
        expect(exported.ySteps - previous.ySteps).toBeCloseTo(
            -(flagY - previousY) / pixelsPerStep,
            9,
        );
        expect(await motionBetweenPages(db)).toBe(true);
    });

    it("a curved path: the same page positions as the straight move, flagged", async ({
        db,
        marchersAndPages: _,
    }) => {
        const pages = await sortedPages(db);
        const page = pages[3]!;
        const start = pageEndBeat(pages[2]!);
        const end = pageEndBeat(page);
        await moveMarchersInTarget({
            db,
            target: { kind: "range", start, end },
            moves: [{ marcherId: 1, x: 200, y: 210 }],
        });
        const straight = await exportShow(db);
        // A whole-page straight move is what the phone shows
        expect(await motionBetweenPages(db)).toBe(false);

        const timelines = await timelinesOver(db, start, end);
        expect(timelines.length).toBeGreaterThan(0);
        for (const { id } of timelines)
            await setMovePath({ db, timelineId: id, style: "arc" });
        const curved = await exportShow(db);

        expectEveryPage(curved, straight);
        expect(curved.coordinates).toEqual(straight.coordinates);
        expect(await motionBetweenPages(db)).toBe(true);

        // The curve itself is in the file as exact paths (spec M.7): a reader plays the arc
        // where the app walks it, at every tick of the move
        const arcs = curved.exactPaths!.filter((e) =>
            e.path.shapes.some((shape) => shape.kind === "arc"),
        );
        expect(arcs.map((e) => e.marcherId)).toContain("1");
        expect(arcs[0]).toMatchObject({
            startTick: start * TICKS_PER_BEAT,
            endTick: end * TICKS_PER_BEAT,
        });
        const reader = createExactPathReader(curved);
        const resolver = await acquireExportResolver(db);
        const field = await fieldProperties(db);
        const axes = stepAxesOf(field);
        let worst = 0;
        for (
            let tick = start * TICKS_PER_BEAT;
            tick <= end * TICKS_PER_BEAT;
            tick++
        ) {
            const [x, y] = resolver.positionAt(1, tick / TICKS_PER_BEAT);
            const [ex, ey] = toSteps(axes, x, y);
            const [rx, ry] = reader.positionAt("1", tick)!;
            worst = Math.max(worst, Math.hypot(rx - ex, ry - ey));
        }
        expect(worst).toBeLessThan(0.01);
    });

    it("a drawn smooth path: exported as cubics, played where the app walks it", async ({
        db,
        marchersAndPages: _,
    }) => {
        const pages = await sortedPages(db);
        const start = pageEndBeat(pages[2]!);
        const end = pageEndBeat(pages[3]!);
        const resolverBefore = await acquireExportResolver(db);
        const [x0, y0] = resolverBefore.positionAt(1, start);
        await moveMarchersInTarget({
            db,
            target: { kind: "range", start, end },
            moves: [{ marcherId: 1, x: x0 + 240, y: y0 }],
        });
        const [timeline] = await timelinesOver(db, start, end);
        await drawRoute({
            db,
            timelineId: timeline!.id,
            marcherId: 1,
            points: [
                { at: [x0 + 80, y0 - 90], tension: 1 },
                { at: [x0 + 170, y0 + 60], tension: 1 },
            ],
        });
        const show = await exportShow(db);
        expect(safeValidateOpenMarchData(show).success).toBe(true);
        const mine = show.exactPaths!.filter((e) => e.marcherId === "1");
        expect(
            mine.some((e) => e.path.shapes.some((s) => s.kind === "cubic")),
        ).toBe(true);

        const reader = createExactPathReader(show);
        const resolver = await acquireExportResolver(db);
        const axes = stepAxesOf(await fieldProperties(db));
        let worst = 0;
        for (
            let tick = start * TICKS_PER_BEAT;
            tick <= end * TICKS_PER_BEAT;
            tick++
        ) {
            const [x, y] = resolver.positionAt(1, tick / TICKS_PER_BEAT);
            const [ex, ey] = toSteps(axes, x, y);
            const [rx, ry] = reader.positionAt("1", tick)!;
            worst = Math.max(worst, Math.hypot(rx - ex, ry - ey));
        }
        expect(worst).toBeLessThan(0.01);
    });

    it("a show where nothing moves has no exact paths", async ({ db }) => {
        const show = await exportShow(db);
        expect(show.exactPaths).toBeUndefined();
        expect(safeValidateOpenMarchData(show).success).toBe(true);
    });
});

/** The export's mapping from canvas pixels to `.om` steps, for `field` */
function stepAxesOf(field: FieldProperties): StepAxes {
    const xs = field.xCheckpoints.map((c) => c.stepsFromCenterFront);
    const ys = field.yCheckpoints.map((c) => c.stepsFromCenterFront);
    return {
        centerXPixels:
            ((Math.max(...xs) - Math.min(...xs)) / 2) * field.pixelsPerStep,
        fieldHeightSteps: Math.abs(Math.max(...ys) - Math.min(...ys)),
        pixelsPerStep: field.pixelsPerStep,
    };
}
