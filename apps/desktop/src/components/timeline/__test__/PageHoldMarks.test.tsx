import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { describeDbTests, schema } from "@/test/base";
import { timelineFixtureMode } from "@/test/timelineMode";
import {
    harnessQueryClient,
    probed,
    selectPageAndMarchers,
    mountFeature,
} from "@/test/featureHarness";
import tolgee from "@/global/singletons/Tolgee";
import { updateMarcherPages } from "@/db-functions/marcherPage";
import { stopTimelineResolver } from "@/timeline/timelineStore";
import { ExpandedTimeline } from "../TimelineVariants";
import { timelineStoryModel } from "../TimelineStoryFixtures";
import type { LabeledHoldMarks } from "../PageHoldMark";
import PageTimeline from "../PageTimeline";

/**
 * The selection's hold marks on the page boxes (docs/timeline/ui.md UI-18): drawn only with a
 * selection, a key where it moves and a bar where it holds, with the words on the page box.
 */

// Page-mode queries invalidate through the app's query client; use the harness's
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

const commonProps = {
    model: timelineStoryModel,
    positionBeat: 11,
    isPlaying: false,
    pixelsPerBeat: 16,
    showTransport: false,
};

describe("the timeline's page boxes", () => {
    it("draw no marks without a selection's marks", () => {
        const { container } = render(<ExpandedTimeline {...commonProps} />);
        expect(
            container.querySelector('[data-testid="page-hold-mark"]'),
        ).toBeNull();
        const box = screen.getByRole("button", { name: "Page 2" });
        expect(box).not.toHaveAttribute("title");
        expect(box).not.toHaveAttribute("aria-describedby");
    });

    it("draw a key where the selection moves and a bar where it holds, with the words on the box", () => {
        const holdMarks: LabeledHoldMarks = new Map([
            [
                "page-2",
                {
                    mark: { kind: "moves" },
                    label: "Selected marchers move on this page",
                },
            ],
            [
                "page-2a",
                {
                    mark: { kind: "holds", from: "2" },
                    label: "Selected marchers hold from Page 2",
                },
            ],
            [
                "page-4",
                {
                    mark: { kind: "mixed", from: "2" },
                    label: "Some selected marchers hold from Page 2",
                },
            ],
        ]);
        render(<ExpandedTimeline {...commonProps} holdMarks={holdMarks} />);
        const markOf = (name: string) => {
            const box = screen.getByRole("button", { name });
            return {
                box,
                kind: box
                    .querySelector('[data-testid="page-hold-mark"]')
                    ?.getAttribute("data-hold-mark"),
            };
        };
        // The accessible name stays the page's, so the box is found as before
        expect(markOf("Page 1").kind).toBeUndefined();
        const moves = markOf("Page 2");
        expect(moves.kind).toBe("moves");
        expect(moves.box).toHaveAccessibleDescription(
            "Selected marchers move on this page",
        );
        const holds = markOf("Page 2A");
        expect(holds.kind).toBe("holds");
        expect(holds.box).toHaveAttribute(
            "title",
            "Selected marchers hold from Page 2",
        );
        const mixed = markOf("Page 4");
        expect(mixed.kind).toBe("mixed");
        expect(mixed.box).toHaveAccessibleDescription(
            "Some selected marchers hold from Page 2",
        );
        // The initial page (home) never has one
        expect(
            screen
                .getByTestId("timeline-initial-page")
                .querySelector('[data-testid="page-hold-mark"]'),
        ).toBeNull();
    });
});

describeDbTests("page mode's page strip", (it) => {
    it("owner scenario: marks appear for the selection only, page 2 moves and pages 3–4 hold from it", async ({
        db,
        marchersAndPages,
    }) => {
        const { result, qc } = mountFeature(<PageTimeline />);
        await waitFor(() => {
            expect(probed().pages.length).toBeGreaterThan(4);
            expect(probed().marchers?.length).toBeGreaterThan(0);
        });
        const marks = () =>
            [
                ...result.container.querySelectorAll(
                    '[data-testid="page-hold-mark"]',
                ),
            ].map((el) => el.getAttribute("data-hold-mark"));
        // Timeline mode reads the resolver on the timeline's own boxes; this strip shows none
        if (timelineFixtureMode()) {
            await selectPageAndMarchers(probed().pages[1]!, [
                marchersAndPages.expectedMarchers[0]!.id,
            ]);
            expect(marks()).toEqual([]);
            return;
        }
        const pages = probed().pages;
        const id = marchersAndPages.expectedMarchers[0]!.id;
        const other = marchersAndPages.expectedMarchers[1]!.id;
        expect(marks(), "no marks with an empty selection").toEqual([]);

        // Page 2 is edited and pages 3–4 are copies of it (the carry-forward's result)
        await updateMarcherPages({
            db,
            modifiedMarcherPages: [1, 2, 3].map((i) => ({
                marcher_id: id,
                page_id: pages[i]!.id,
                x: 321,
                y: 123,
            })),
            carryForward: false,
        });
        await act(() => qc.invalidateQueries());
        expect(marks(), "still none without a selection").toEqual([]);

        await selectPageAndMarchers(pages[1]!, [id]);
        const boxOf = (index: number) =>
            result.container.querySelector(
                `[timeline-page-id="${pages[index]!.id}"] > div`,
            )!;
        await waitFor(() =>
            expect(
                boxOf(1).querySelector('[data-testid="page-hold-mark"]'),
            ).toHaveAttribute("data-hold-mark", "moves"),
        );
        expect(boxOf(1)).toHaveAttribute(
            "title",
            "Selected marchers move on this page",
        );
        for (const index of [2, 3]) {
            expect(
                boxOf(index).querySelector('[data-testid="page-hold-mark"]'),
            ).toHaveAttribute("data-hold-mark", "holds");
            expect(boxOf(index)).toHaveAccessibleDescription(
                `Selected marchers hold from Page ${pages[1]!.name}`,
            );
        }

        // A partial selection: the other marcher moves on every page of the fixture
        const [row3, row4] = await Promise.all(
            [2, 3].map((i) =>
                db
                    .select()
                    .from(schema.marcher_pages)
                    .where(
                        and(
                            eq(schema.marcher_pages.marcher_id, other),
                            eq(schema.marcher_pages.page_id, pages[i]!.id),
                        ),
                    )
                    .get(),
            ),
        );
        expect(row3!.x === row4!.x && row3!.y === row4!.y).toBe(false);
        await selectPageAndMarchers(pages[1]!, [id, other]);
        await waitFor(() =>
            expect(
                boxOf(3).querySelector('[data-testid="page-hold-mark"]'),
            ).toHaveAttribute("data-hold-mark", "mixed"),
        );
        expect(boxOf(3)).toHaveAttribute(
            "title",
            `Some selected marchers hold from Page ${pages[1]!.name}`,
        );

        // Clearing the selection clears the marks
        await act(async () => probed().setSelectedMarchers([]));
        await waitFor(() => expect(marks()).toEqual([]));
    });
});
