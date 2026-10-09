import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import { TolgeeProvider } from "@tolgee/react";
import type { Resolver, SpanInfo } from "@openmarch/core";
import tolgee from "@/global/singletons/Tolgee";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { useTimelineResolverStore } from "@/timeline/timelineStore";
import TimelineHoldLine from "../TimelineHoldLine";

/**
 * UI-18: the marcher inspector's line for the selected marchers on the current page, "Moves on
 * this page" or "Hold from Page X →", a link to that page's flag, only where they agree, and only
 * in timeline mode (worded by defined-coordinates 08).
 */

/** A page whose beats run from `first` to `last` (`pageEndBeat` is `last + 1`). */
const page = (id: number, name: string, first: number, last: number) => ({
    id,
    name,
    beats: Array.from({ length: last - first + 1 }, (_, i) => ({
        index: first + i,
    })),
});
// Flags: page 1 at 0 (home), page 2 at 9, page 3 at 17, page 4 at 25
const PAGES = [
    page(1, "1", 0, 0),
    page(2, "2", 1, 8),
    page(3, "3", 9, 16),
    page(4, "4", 17, 24),
];

const mocks = vi.hoisted(() => ({
    timelineMode: true,
    selectedPage: null as unknown,
    pages: [] as unknown[],
}));

vi.mock("@/hooks/queries/useWorkspaceSettings", () => ({
    useTimelineMode: () => mocks.timelineMode,
}));
vi.mock("@/context/SelectedPageContext", () => ({
    useSelectedPage: () => ({ selectedPage: mocks.selectedPage }),
}));
vi.mock("@/hooks", () => ({
    useTimingObjects: () => ({ pages: mocks.pages }),
}));

const span = (
    marcherId: number,
    start: number,
    end: number,
    kind: SpanInfo["kind"],
): SpanInfo => ({
    marcherId,
    start,
    end,
    kind,
    assignmentId: null,
    transitionId: null,
    slot: null,
});

/** Marcher 1 moves on page 2 and holds; marcher 2 also moves on page 3; marcher 3 never moves. */
const SPANS: Record<number, SpanInfo[]> = {
    1: [
        span(1, -Infinity, 1, "hold"),
        span(1, 1, 9, "founding"),
        span(1, 9, Infinity, "hold"),
    ],
    2: [
        span(2, -Infinity, 1, "hold"),
        span(2, 1, 9, "founding"),
        span(2, 9, 17, "founding"),
        span(2, 17, Infinity, "hold"),
    ],
    3: [span(3, -Infinity, Infinity, "hold")],
};

const resolver = {
    marcherIds: () => [1, 2, 3],
    spanInfos: (id: number) => SPANS[id] ?? [],
} as unknown as Resolver;

beforeAll(async () => {
    await tolgee.run();
});
afterEach(cleanup);
beforeEach(() => {
    mocks.timelineMode = true;
    mocks.pages = PAGES;
    mocks.selectedPage = PAGES[2];
    useTimelineResolverStore.setState({ resolver, version: 1 });
    useTimelineSelectionStore.getState().reset();
});

const show = (marcherIds: number[]) =>
    render(
        <TolgeeProvider tolgee={tolgee} fallback="Loading...">
            <TimelineHoldLine marcherIds={marcherIds} />
        </TolgeeProvider>,
    );

const line = () => screen.queryByTestId("timeline-hold-line");

describe("TimelineHoldLine", () => {
    it("says a marcher holding on the page has held since its last move, and jumps there", () => {
        mocks.selectedPage = PAGES[3];
        show([1]);
        expect(line()?.textContent).toBe("Hold from Page 2");
        fireEvent.click(line()!);
        expect(useTimelineSelectionStore.getState().playheadBeat).toBe(9);
    });

    it("says a marcher that never moved holds from the start, not from the first page by name, and jumps there", () => {
        mocks.selectedPage = PAGES[3];
        useTimelineSelectionStore.getState().seek(17);
        show([3]);
        expect(line()?.textContent).toBe("Hold from the start");
        expect(line()).toHaveAttribute("title", "Go to the start");
        fireEvent.click(line()!);
        expect(useTimelineSelectionStore.getState().playheadBeat).toBe(0);
    });

    it("is a real button styled as a link, in the normal text color, with a focus ring", () => {
        mocks.selectedPage = PAGES[3];
        show([1]);
        const link = line()!;
        expect(link.tagName).toBe("BUTTON");
        expect(link.getAttribute("type")).toBe("button");
        expect(link.className).toMatch(/\bunderline\b/);
        expect(link.className).toMatch(/focus-visible:ring/);
        expect(link.className).toMatch(/\btext-text\b/);
        expect(link.className).not.toMatch(/text-text\/60/);
        // The arrow is drawn, not read
        expect(link.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
            "true",
        );
    });

    it("says a marcher whose own move ends on the page moves on this page, as plain text", () => {
        show([2]);
        expect(line()?.textContent).toBe("Moves on this page");
        expect(line()?.tagName).toBe("P");
        expect(line()?.className).not.toMatch(/text-text\/60/);
    });

    it("shows a multi-selection's state only where every marcher agrees", () => {
        mocks.selectedPage = PAGES[3];
        show([1, 2]);
        expect(line()).toBeNull();
        cleanup();
        mocks.selectedPage = PAGES[2];
        show([1, 3]);
        // Marcher 1 holds since page 2, marcher 3 since page 1
        expect(line()).toBeNull();
        cleanup();
        show([1]);
        expect(line()?.textContent).toBe("Hold from Page 2");
    });

    it("renders nothing on the first page, with nothing selected, or out of timeline mode", () => {
        mocks.selectedPage = PAGES[0];
        show([1]);
        expect(line()).toBeNull();
        cleanup();
        mocks.selectedPage = PAGES[2];
        show([]);
        expect(line()).toBeNull();
        cleanup();
        mocks.timelineMode = false;
        show([1]);
        expect(line()).toBeNull();
    });
});
