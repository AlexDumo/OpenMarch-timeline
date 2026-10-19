import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from "@testing-library/react";
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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import tolgee from "@/global/singletons/Tolgee";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { useMoveCardRevealStore } from "@/stores/MoveCardRevealStore";
import { TimelineMoveCardSlot } from "../TimelineMoveCard";
import { useMoveNotesStore } from "@/stores/MoveNotesStore";

/** UI-14: the Move card, first in the inspector while the window is a move with a clip. */

const mocks = vi.hoisted(() => ({
    pages: [] as unknown[],
}));

vi.mock("@/hooks/useTimingObjects", () => ({
    useTimingObjects: () => ({ pages: mocks.pages }),
}));
vi.mock("@/hooks/queries/useHistory", () => ({
    usePerformHistoryAction: () => ({ mutate: vi.fn() }),
}));

beforeAll(async () => {
    await tolgee.run();
});
afterEach(cleanup);
beforeEach(() => {
    mocks.pages = [];
    useTimelineSelectionStore.getState().reset();
    useMoveCardRevealStore.getState().clear();
});

const renderSection = () =>
    render(
        <QueryClientProvider client={new QueryClient()}>
            <TolgeeProvider tolgee={tolgee} fallback="Loading...">
                <TimelineMoveCardSlot />
            </TolgeeProvider>
        </QueryClientProvider>,
    );

describe("the Move card while scrubbing over moves (code review)", () => {
    it("holds its move while the playhead is scrubbed, rather than going mid-scrub", () => {
        const store = twoPages();
        store.setShowEndBeat(17);
        store.selectRange(9, 12);
        renderSection();
        expect(screen.getByTestId("timeline-move-card")).toBeTruthy();
        act(() => {
            useTimelineSelectionStore.getState().beginScrub();
        });
        for (const beat of [3, 7, 9, 12, 15])
            act(() => {
                useTimelineSelectionStore.getState().seek(beat);
            });
        expect(screen.getByTestId("timeline-move-card")).toBeTruthy();
    });
});

/** Page 1 over beats [1, 9) and page 2 over [9, 17), as the store and the pages see them */
const twoPages = () => {
    const beats = (from: number, to: number) =>
        Array.from({ length: to - from }, (_, i) => ({ index: from + i }));
    mocks.pages = [
        { id: 1, name: "0", beats: beats(0, 1) },
        { id: 2, name: "1", beats: beats(1, 9) },
        { id: 3, name: "2", beats: beats(9, 17) },
    ];
    const store = useTimelineSelectionStore.getState();
    store.setPageBoxes([
        { start: 1, end: 9, name: "1" },
        { start: 9, end: 17, name: "2" },
    ]);
    store.setStoredTimelines([
        // Page 2's own move: a page box stands for it
        { id: 1, start: 9, end: 17, marcherIds: new Set([1, 2]), name: null },
        // A mid-page move, page 2 counts 1 to 3
        {
            id: 7,
            start: 9,
            end: 12,
            marcherIds: new Set([1, 2, 3]),
            name: "Company front",
        },
    ]);
    return store;
};

describe("the Move card (UI-14)", () => {
    it("shows for a move off the page boxes: its name, counts and marchers", () => {
        twoPages().selectRange(9, 12);
        renderSection();
        const card = screen.getByTestId("timeline-move-card");
        expect(
            (screen.getByTestId("timeline-move-card-name") as HTMLInputElement)
                .value,
        ).toBe("Company front");
        expect(screen.getByTestId("timeline-move-card-range").textContent).toBe(
            "Page 2, counts 1–3",
        );
        expect(screen.getByTestId("timeline-move-card-count").textContent).toBe(
            "3 marchers",
        );
        expect(within(card).getByText("Delete move")).toBeTruthy();
    });

    it("doesn't show for a page timeline, a window with no move, or home", () => {
        const store = twoPages();
        store.selectRange(9, 17);
        renderSection();
        expect(screen.queryByTestId("timeline-move-card")).toBeNull();
        cleanup();
        store.selectRange(9, 13);
        renderSection();
        expect(screen.queryByTestId("timeline-move-card")).toBeNull();
        cleanup();
        store.selectHome();
        renderSection();
        expect(screen.queryByTestId("timeline-move-card")).toBeNull();
    });

    it("Enter in the name field stays there: it never reaches the app's Enter shortcut", () => {
        twoPages().selectRange(9, 12);
        renderSection();
        const reached: string[] = [];
        const listener = (e: KeyboardEvent) => reached.push(e.key);
        window.addEventListener("keydown", listener);
        try {
            const name = screen.getByTestId("timeline-move-card-name");
            name.focus();
            fireEvent.keyDown(name, { key: "Enter" });
            fireEvent.keyDown(name, { key: "Escape" });
        } finally {
            window.removeEventListener("keydown", listener);
        }
        expect(reached).toEqual([]);
    });

    it("says when a name reaches 80 characters", () => {
        twoPages().selectRange(9, 12);
        renderSection();
        expect(
            screen.queryByTestId("timeline-move-card-name-limit"),
        ).toBeNull();
        fireEvent.change(screen.getByTestId("timeline-move-card-name"), {
            target: { value: "x".repeat(80) },
        });
        expect(
            screen.getByTestId("timeline-move-card-name-limit").textContent,
        ).toBe("80 characters at most.");
    });

    it("unnamed, its placeholder is the move's label, Move N", () => {
        const store = twoPages();
        store.setStoredTimelines([
            ...useTimelineSelectionStore
                .getState()
                .storedTimelines!.map((t) =>
                    t.id === 7 ? { ...t, name: null } : t,
                ),
        ]);
        store.selectRange(9, 12);
        renderSection();
        expect(
            (screen.getByTestId("timeline-move-card-name") as HTMLInputElement)
                .placeholder,
        ).toBe("Move 1");
    });

    it("isolated with P inside the move, it still shows and offers Go to end", () => {
        const store = twoPages();
        store.setShowEndBeat(17);
        store.isolate(7);
        store.seek(10);
        renderSection();
        expect(screen.getByTestId("timeline-move-card")).toBeTruthy();
        fireEvent.click(screen.getByTestId("timeline-move-card-go-to-end"));
        expect(useTimelineSelectionStore.getState().playheadBeat).toBe(12);
    });

    it("offers Split at playhead only while its move is isolated, and only with P inside (UI-27)", () => {
        const store = twoPages();
        // Selected, the window ends at P: P is never inside, so the card doesn't offer it
        store.selectRange(9, 12);
        renderSection();
        expect(
            screen.queryByTestId("timeline-move-card-split-at-playhead"),
        ).toBeNull();
        cleanup();
        store.isolate(7);
        store.seek(10);
        renderSection();
        const split = screen.getByTestId(
            "timeline-move-card-split-at-playhead",
        ) as HTMLButtonElement;
        expect(split.disabled).toBe(false);
        expect(
            screen.queryByText(
                "Put the playhead inside the move to split it there.",
            ),
        ).toBeNull();
        act(() => {
            store.seek(12);
        });
        expect(split.disabled).toBe(true);
        expect(
            screen.getByText(
                "Put the playhead inside the move to split it there.",
            ),
        ).toBeTruthy();
    });

    it("Edit move's request flashes the card and puts focus on its heading, not the menu button", () => {
        twoPages().selectRange(9, 12);
        renderSection();
        act(() => {
            useMoveCardRevealStore.setState({ pending: 7 });
        });
        const card = screen.getByTestId("timeline-move-card");
        expect(card.dataset.flash).toBe("true");
        expect(document.activeElement).toBe(
            screen.getByTestId("timeline-move-card-heading"),
        );
        expect(
            screen.getByTestId("timeline-move-card-heading").textContent,
        ).toBe("Company front");
        // The request is taken once
        expect(useMoveCardRevealStore.getState().pending).toBeNull();
    });
});

describe("the Move card after the round-2 review (UI-14)", () => {
    it("Enter in the name field keeps focus there", () => {
        twoPages().selectRange(9, 12);
        renderSection();
        const name = screen.getByTestId("timeline-move-card-name");
        name.focus();
        fireEvent.change(name, { target: { value: "Opener" } });
        fireEvent.keyDown(name, { key: "Enter" });
        expect(document.activeElement).toBe(name);
    });

    it("says why its clip is dashed", () => {
        twoPages().selectRange(9, 12);
        useMoveNotesStore
            .getState()
            .setOverridden(
                new Map([[7, "Overridden by Move 4 on Page 2, counts 2–3"]]),
            );
        try {
            renderSection();
            expect(
                screen.getByTestId("timeline-move-card-overridden").textContent,
            ).toBe("Overridden by Move 4 on Page 2, counts 2–3");
        } finally {
            useMoveNotesStore.getState().setOverridden(new Map());
        }
    });

    it("Space on its buttons is cancelled, so it plays instead of pressing them", () => {
        twoPages().selectRange(9, 12);
        renderSection();
        const del = screen.getByTestId("timeline-move-card-delete");
        expect(fireEvent.keyDown(del, { key: " " })).toBe(false);
        expect(fireEvent.keyUp(del, { key: " " })).toBe(false);
        // The name field keeps its Space
        expect(
            fireEvent.keyDown(screen.getByTestId("timeline-move-card-name"), {
                key: " ",
            }),
        ).toBe(true);
    });
});

describe("the Move card's name field, Esc (UI-14 round-2 review)", () => {
    it("puts the stored name back and focus on the card's heading, not the page", async () => {
        twoPages().selectRange(9, 12);
        renderSection();
        const name = screen.getByTestId(
            "timeline-move-card-name",
        ) as HTMLInputElement;
        name.focus();
        fireEvent.change(name, { target: { value: "XX" } });
        fireEvent.keyDown(name, { key: "Escape" });
        await waitFor(() =>
            expect(document.activeElement).toBe(
                screen.getByTestId("timeline-move-card-heading"),
            ),
        );
        expect(name.value).toBe("Company front");
    });
});
