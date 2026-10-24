import { afterEach, expect } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { DbConnection, describeDbTests, schema } from "@/test/base";
import { performUndo, transactionWithHistory } from "@/db-functions/history";
import {
    moveMarchersInTarget,
    type TimelineMarcherMove,
} from "@/db-functions/timelineMoves";
import { deleteTimelinesInTransaction } from "@/db-functions/timelines";
import type Page from "@/global/classes/Page";
import { keepFixturesInPageMode } from "@/test/timelineMode";
import { readShowTiming } from "@/timeline/showTiming";
import { convertPagesToTimeline } from "@/test/convertPages";
import { neighborPageTarget } from "../timelineCoordinateWrites";
import { pageFlags } from "../timelinePlayhead";
import {
    startTimelineResolver,
    stopTimelineResolver,
    timelineResolverSettled,
} from "../timelineStore";
import { useSelectionKeyframes } from "../useSelectionKeyframes";

/**
 * The selection's keyframes (#303) from the resolver: a count where a selected marcher is Set,
 * after an edit, for one and several marchers, and back after Undo.
 */

// The test writes its own timeline rows and starts the resolver itself
keepFixturesInPageMode("its tests write timeline rows themselves");

afterEach(() => {
    stopTimelineResolver();
});

const HOMES: TimelineMarcherMove[] = [
    { marcherId: 1, x: 100, y: 100 },
    { marcherId: 2, x: 150, y: 100 },
];

/** The `marchersAndPages` show with every marcher holding on its home; pages in show order. */
const setUp = async (db: DbConnection) => {
    await convertPagesToTimeline(db);
    await transactionWithHistory(db, "clearTimelines", async (tx) => {
        const ids = (
            await tx
                .select({ id: schema.timelines.id })
                .from(schema.timelines)
                .all()
        ).map((r) => r.id);
        await deleteTimelinesInTransaction({ tx, timelineIds: new Set(ids) });
    });
    await moveMarchersInTarget({ db, target: { kind: "home" }, moves: HOMES });
    await startTimelineResolver(db);
    const { pages } = await readShowTiming(db);
    return [...pages].sort((a, b) => a.order - b.order);
};

const editPage = async (
    db: DbConnection,
    page: Page,
    moves: TimelineMarcherMove[],
) => {
    await moveMarchersInTarget({ db, target: neighborPageTarget(page), moves });
    await timelineResolverSettled();
};

describeDbTests("the selection's keyframes from the resolver", (it) => {
    it("mark the counts a selected marcher was set on, filled where all were, until undo", async ({
        db,
        marchersAndPages: _,
    }) => {
        const pages = await setUp(db);
        const flagOf = new Map(
            pageFlags(pages).map((f) => [f.page.id, f.flag]),
        );
        const page2 = flagOf.get(pages[1]!.id)!;
        const page3 = flagOf.get(pages[2]!.id)!;
        const { result, rerender } = renderHook(
            ({ ids }: { ids: number[] }) => useSelectionKeyframes(ids),
            { initialProps: { ids: [1] } },
        );
        // Never moved: Set only on the first page, which has no keyframe
        expect(result.current).toEqual([]);

        await act(() =>
            editPage(db, pages[1]!, [
                { marcherId: 1, x: 300, y: 300 },
                { marcherId: 2, x: 350, y: 300 },
            ]),
        );
        await act(() =>
            editPage(db, pages[2]!, [{ marcherId: 1, x: 300, y: 400 }]),
        );
        await waitFor(() =>
            expect(result.current).toEqual([
                { beat: page2, set: 1, total: 1, marcherIds: [1] },
                { beat: page3, set: 1, total: 1, marcherIds: [1] },
            ]),
        );

        // Both selected: page 2 filled, page 3 hollow (only marcher 1)
        rerender({ ids: [1, 2] });
        expect(result.current).toEqual([
            { beat: page2, set: 2, total: 2, marcherIds: [1, 2] },
            { beat: page3, set: 1, total: 2, marcherIds: [1] },
        ]);

        // Nothing selected, none
        rerender({ ids: [] });
        expect(result.current).toEqual([]);

        // Undo the page 3 edit: its keyframe goes
        rerender({ ids: [1, 2] });
        await act(async () => {
            await performUndo(db);
            await timelineResolverSettled();
        });
        await waitFor(() =>
            expect(result.current).toEqual([
                { beat: page2, set: 2, total: 2, marcherIds: [1, 2] },
            ]),
        );
    });
});
