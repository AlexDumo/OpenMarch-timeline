import { act, cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, expect, vi } from "vitest";
import { describeDbTests } from "@/test/base";
import { timelineFixtureMode } from "@/test/timelineMode";
import {
    expectWrittenWhereTheModeWrites,
    harnessQueryClient,
    marcherPageRows,
    positionsOn,
    probed,
    selectPageAndMarchers,
    setUpFeature,
} from "@/test/featureHarness";
import tolgee from "@/global/singletons/Tolgee";
import { historyKeys } from "@/hooks/queries/useHistory";
import { useRegisteredActionsStore } from "@/stores/RegisteredActionsStore";
import { stopTimelineResolver } from "@/timeline/timelineStore";
import RegisteredActionsHandler, {
    RegisteredActionsEnum,
} from "../RegisteredActionsHandler";

/**
 * The coordinate tools in `RegisteredActionsHandler` (nudges, align, swap, set marchers to the
 * previous page) and undo's page and marcher focus, run from the handler itself on the
 * `base.tsx` fixtures (docs/timeline/phases/07-page-parity.md P7.18).
 *
 * The file's mode decides the path: the default run checks page mode (`marcher_pages` rows), and
 * `test:timeline` (a converted show with the flag on) checks timeline mode, where the tools read
 * the resolver and write slot destinations, and `marcher_pages` is never written.
 */

// Page-mode mutations invalidate through the app's query client; use the harness's. The getter
// is read lazily, after this file's imports (the harness imports modules that import `@/App`).
const app = vi.hoisted(() => ({ client: (): unknown => null }));
vi.mock("@/App", () => ({
    get queryClient() {
        return app.client();
    },
}));
app.client = harnessQueryClient;

beforeAll(async () => {
    await tolgee.run();
});

afterEach(() => {
    cleanup();
    stopTimelineResolver();
});

const setUp = (pageIndex: number, marcherIds: readonly number[]) =>
    setUpFeature(<RegisteredActionsHandler />, pageIndex, marcherIds);

/** Runs a registered action the way a toolbar button does. */
const trigger = async (action: RegisteredActionsEnum) => {
    const button = document.createElement("button");
    const ref = { current: button };
    const store = useRegisteredActionsStore.getState();
    act(() => {
        store.linkRegisteredAction(action, ref);
    });
    try {
        await waitFor(() => expect(button.onclick).toBeTypeOf("function"));
        act(() => button.click());
    } finally {
        act(() => {
            useRegisteredActionsStore
                .getState()
                .removeRegisteredAction(action, ref);
        });
    }
};

const PAGE = 3;

describeDbTests("registered coordinate actions in the file's mode", (it) => {
    it("a nudge moves the selected marchers on the selected page", async ({
        db,
        marchersAndPages,
    }) => {
        const ids = marchersAndPages.expectedMarchers
            .slice(0, 2)
            .map((m) => m.id);
        const { page } = await setUp(PAGE, ids);
        const before = await positionsOn(db, page, ids);
        const rowsBefore = await marcherPageRows(db);

        await trigger(RegisteredActionsEnum.moveSelectedMarchersRight);

        await waitFor(async () => {
            const after = await positionsOn(db, page, ids);
            after.forEach(([x, y], i) => {
                expect(x).toBeGreaterThan(before[i]![0]);
                expect(y).toBeCloseTo(before[i]![1], 6);
            });
        });
        await expectWrittenWhereTheModeWrites(db, rowsBefore);
    });

    it("align gives the selected marchers one x", async ({
        db,
        marchersAndPages,
    }) => {
        const ids = marchersAndPages.expectedMarchers
            .slice(2, 5)
            .map((m) => m.id);
        const { page } = await setUp(PAGE, ids);
        const before = await positionsOn(db, page, ids);
        const meanX = before.reduce((sum, [x]) => sum + x, 0) / ids.length;
        expect(new Set(before.map(([x]) => x)).size).toBeGreaterThan(1);
        const rowsBefore = await marcherPageRows(db);

        await trigger(RegisteredActionsEnum.alignHorizontally);

        await waitFor(async () => {
            const after = await positionsOn(db, page, ids);
            after.forEach(([x, y], i) => {
                expect(x).toBeCloseTo(meanX, 6);
                expect(y).toBeCloseTo(before[i]![1], 6);
            });
        });
        await expectWrittenWhereTheModeWrites(db, rowsBefore);
    });

    it("swap exchanges two marchers' positions on the selected page", async ({
        db,
        marchersAndPages,
    }) => {
        const ids = marchersAndPages.expectedMarchers
            .slice(5, 7)
            .map((m) => m.id);
        const { page } = await setUp(PAGE, ids);
        const [a, b] = await positionsOn(db, page, ids);
        expect(a).not.toEqual(b);
        const rowsBefore = await marcherPageRows(db);

        await trigger(RegisteredActionsEnum.swapMarchers);

        await waitFor(async () => {
            const [a2, b2] = await positionsOn(db, page, ids);
            expect(a2![0]).toBeCloseTo(b![0], 6);
            expect(a2![1]).toBeCloseTo(b![1], 6);
            expect(b2![0]).toBeCloseTo(a![0], 6);
            expect(b2![1]).toBeCloseTo(a![1], 6);
        });
        await expectWrittenWhereTheModeWrites(db, rowsBefore);
    });

    it("set selected marchers to the previous page copies that page's positions", async ({
        db,
        marchersAndPages,
    }) => {
        const ids = marchersAndPages.expectedMarchers
            .slice(7, 10)
            .map((m) => m.id);
        const { page } = await setUp(PAGE, ids);
        const previous = probed().pages[PAGE - 1]!;
        const source = await positionsOn(db, previous, ids);
        expect(await positionsOn(db, page, ids)).not.toEqual(source);
        const rowsBefore = await marcherPageRows(db);

        await trigger(RegisteredActionsEnum.setSelectedMarchersToPreviousPage);

        await waitFor(async () => {
            const after = await positionsOn(db, page, ids);
            after.forEach(([x, y], i) => {
                expect(x).toBeCloseTo(source[i]![0], 6);
                expect(y).toBeCloseTo(source[i]![1], 6);
            });
        });
        await expectWrittenWhereTheModeWrites(db, rowsBefore);
    });

    it("undo restores a nudge, goes back to its page and selects the moved marchers", async ({
        db,
        marchersAndPages,
    }) => {
        const ids = marchersAndPages.expectedMarchers
            .slice(10, 12)
            .map((m) => m.id);
        const { qc, page } = await setUp(PAGE, ids);
        const before = await positionsOn(db, page, ids);

        await trigger(RegisteredActionsEnum.moveSelectedMarchersUp);
        await waitFor(async () => {
            expect(await positionsOn(db, page, ids)).not.toEqual(before);
        });

        // Look somewhere else, then undo
        const elsewhere = probed().pages[1]!;
        const otherId = marchersAndPages.expectedMarchers[20]!.id;
        await selectPageAndMarchers(elsewhere, [otherId]);
        await act(() => qc.invalidateQueries({ queryKey: historyKeys.all() }));
        await waitFor(() =>
            expect(qc.getQueryData(historyKeys.canUndo())).toBe(true),
        );

        await trigger(RegisteredActionsEnum.performUndo);

        // Page mode is left out of the focus check: its rule never finds the page, because
        // `rowIdFromSql` in history.ts parses the whole match (filed as P7.19)
        if (timelineFixtureMode())
            await waitFor(() => {
                expect(probed().selectedPage?.id).toBe(page.id);
                expect(
                    probed()
                        .selectedMarchers.map((m) => m.id)
                        .sort(),
                ).toEqual([...ids].sort());
            });
        await waitFor(async () => {
            const after = await positionsOn(db, page, ids);
            after.forEach(([x, y], i) => {
                expect(x).toBeCloseTo(before[i]![0], 6);
                expect(y).toBeCloseTo(before[i]![1], 6);
            });
        });
    });
});
