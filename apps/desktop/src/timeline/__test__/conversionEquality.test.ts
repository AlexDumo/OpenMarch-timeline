import { afterEach, expect } from "vitest";
import { describeDbTests } from "@/test/base";
import { keepFixturesInPageMode } from "@/test/timelineMode";
import { convertPagesToTimeline } from "../convert/writePageConversion";
import {
    startTimelineResolver,
    stopTimelineResolver,
    useTimelineResolverStore,
} from "../timelineStore";
import { compareConversion, lossReportCounts } from "./conversionEquality";
import { buildConversionShow } from "./conversionShow";

// The show is built in page mode and converted by the test itself
keepFixturesInPageMode("the test builds a page show and converts it itself");

afterEach(() => stopTimelineResolver());

/**
 * Conversion equality on the generated show (docs/timeline/phases/06-converter.md P6.6): the
 * converted show plays back like the page show. Exact at every page end; at sampled beats inside
 * each page it matches page-mode playback at the same beat position (C-7), and the millisecond
 * difference on pages with uneven tempo is only reported. Pathways (C-8) and the damaged-file gap
 * are reported in their own buckets.
 */
describeDbTests("conversion equality", (it) => {
    it("plays the generated show back like page mode", async ({ db }) => {
        const show = await buildConversionShow(db);
        const { report } = await convertPagesToTimeline(db);
        await startTimelineResolver(db);
        expect(useTimelineResolverStore.getState().resolver).not.toBeNull();
        const equality = await compareConversion(db, { interiorSamples: 5 });
        const what = JSON.stringify(
            { ...equality, perPage: undefined, samples: undefined },
            null,
            1,
        );

        expect(equality.marchers, what).toBe(14);
        expect(equality.pages, what).toBe(10);

        // Exact (bit for bit) at every page end, page 0 included
        expect(equality.pageEnd.samples, what).toBeGreaterThan(9 * 13);
        expect(equality.pageEnd.exact, what).toBe(equality.pageEnd.samples);
        expect(equality.pageEnd.max, what).toBe(0);

        // Inside pages, straight moves match page mode at the same beat
        expect(equality.plain.samples, what).toBeGreaterThan(400);
        expect(equality.plain.max, what).toBeLessThan(1e-9);

        // C-7: millisecond playback agrees on even-tempo pages and differs on the uneven ones
        expect(equality.maxMsDifferenceEvenTempo, what).toBeLessThan(1e-9);
        expect(equality.unevenTempoPages, what).toBe(2);
        expect(
            equality.perPage.filter((p) => p.unevenTempo).map((p) => p.order),
        ).toEqual(show.unevenPageOrders);
        for (const page of equality.perPage.filter((p) => p.unevenTempo))
            expect(page.maxMsDifference, `page ${page.order}`).toBeGreaterThan(
                0.1,
            );

        // C-8: the pathway is kept only at its page end, so it differs inside the page
        expect(equality.pathway.samples, what).toBe(5);
        expect(equality.pathway.max, what).toBeGreaterThan(1);

        // Damaged file: no row on page 5 for one marcher, which changes pages 5 and 6 (page mode
        // glides across the gap, the converter holds), and no page-0 row for another (page mode
        // has no position before its first row)
        expect(equality.missingRow.samples, what).toBe(10);
        expect(equality.missingRow.max, what).toBeGreaterThan(1);
        expect(equality.beforeFirstRow, what).toBe(5);

        // Coincident marchers stay together, and the deleted marcher is gone
        const r = useTimelineResolverStore.getState().resolver!;
        const page4End = equality.perPage.find((p) => p.order === 4)!.endBeat;
        expect(r.positionAt(show.coincident[0], page4End)).toEqual(
            r.positionAt(show.coincident[1], page4End),
        );
        expect(show.marcherIds).not.toContain(show.deletedMarcherId);
        for (const id of show.addedMarcherIds)
            expect(show.marcherIds).toContain(id);

        // The loss report covers what the comparison saw
        expect(lossReportCounts(report)).toEqual({
            pagesWithPathways: 1,
            pathways: 1,
            midsets: 1,
            curvedShapes: 1,
            droppedRotation: 0,
            droppedNotes: 0,
            droppedAppearance: 0,
            missingMarcherRows: 2,
            skippedPages: 0,
            homesFromLaterPage: 1,
            marchersWithoutRows: 0,
        });

        // Samples for the judgment step: the same marchers in the same order in both modes
        expect(equality.samples.length).toBe(6);
        for (const s of equality.samples) {
            expect(s.pageMode.length).toBe(s.marcherIds.length);
            expect(s.converted.length).toBe(s.marcherIds.length);
        }
    });
});
