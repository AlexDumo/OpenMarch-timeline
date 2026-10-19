import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TolgeeProvider } from "@tolgee/react";
import tolgee from "@/global/singletons/Tolgee";
import type { ShowNote, ShowNoteWhat } from "@/notes/showNotes";
import { ItemNotesView, ShowNotesListView } from "../ShowNotesList";

// Page 1 at home, then 8-count pages: page 2's flag is at 9, page 5's box is [25, 33)
const pageBoxes = [
    { start: 1, end: 9, name: "2" },
    { start: 9, end: 17, name: "3" },
    { start: 17, end: 25, name: "4" },
    { start: 25, end: 33, name: "5" },
];
const items: Record<number, string> = {
    10: "Flag",
    11: "Rifle",
    20: "Riser",
    21: "Cart",
};
const people: Record<number, string> = { 1: "Alice", 3: "Carl" };

const what = (w: Partial<ShowNoteWhat>): ShowNoteWhat => ({
    itemIds: [],
    marcherIds: [],
    cueIds: [],
    ...w,
});

const NOTES: ShowNote[] = [
    {
        id: "crew",
        kind: "crew_distance",
        source: "items",
        beat: 0,
        until: null,
        what: what({ itemIds: [20], marcherIds: [3] }),
    },
    {
        id: "drift",
        kind: "put_down_drift",
        source: "items",
        beat: 7,
        until: 8,
        what: what({ itemIds: [10], marcherIds: [1] }),
        action: { kind: "snap_to_holder", placementId: 7 },
    },
    {
        id: "crewless",
        kind: "crewless_move",
        source: "items",
        beat: 32,
        until: null,
        what: what({ itemIds: [21] }),
    },
    {
        id: "hand",
        kind: "hand_conflict",
        source: "items",
        beat: 34,
        until: null,
        what: what({ itemIds: [10, 11], marcherIds: [1] }),
        detail: { hand: "right" },
    },
    {
        id: "silk",
        kind: "silk_aspect",
        source: "cues",
        beat: 12,
        until: 13,
        what: what({ cueIds: [4], marcherIds: [1, 3] }),
    },
];

const show = (ui: React.ReactElement) =>
    render(
        <TolgeeProvider tolgee={tolgee} fallback="Loading...">
            {ui}
        </TolgeeProvider>,
    );

const props = (onSnap = vi.fn(), onPick = vi.fn()) => ({
    notes: NOTES,
    pageBoxes,
    itemName: (id: number) => items[id] ?? "",
    marcherName: (id: number) => people[id] ?? "",
    onSnap,
    onPick,
});

describe("ShowNotesListView", () => {
    it("names each check's item and count as the transport says it, every kind in one list", async () => {
        show(<ShowNotesListView {...props()} />);
        await screen.findAllByTestId("show-note");
        const lines = screen
            .getAllByTestId("show-note")
            .map((li) => li.textContent);
        expect(lines).toEqual([
            "Riser's crew is away from it, at the startOut of reach: Carl",
            "Flag put down away from its holder, Page 2 count 6Its own move puts it there, not at AliceSnap to holder",
            "Cart moves without a crew, Page 5 count 7",
            "Flag isn't drawn, count 1 after Page 5Rifle takes Alice's right hand",
            "A Silk cue's Artwork is fitted to a flag of another shape, Page 3 count 3For Alice and Carl",
        ]);
    });

    it("seeks and selects on a click, offers Snap to holder, and never a dialog", async () => {
        const onSnap = vi.fn();
        const onPick = vi.fn();
        show(<ShowNotesListView {...props(onSnap, onPick)} />);
        fireEvent.click(
            await screen.findByRole("button", { name: "Snap to holder" }),
        );
        expect(onSnap).toHaveBeenCalledWith(7);
        fireEvent.click(screen.getByText(/^Cart moves/));
        expect(onPick).toHaveBeenCalledWith(NOTES[2]);
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(screen.queryByRole("alertdialog")).toBeNull();
    });

    it("says so when there is nothing to check", async () => {
        show(<ShowNotesListView {...props()} notes={[]} />);
        expect(await screen.findByText("Nothing to check.")).toBeTruthy();
    });
});

describe("ItemNotesView", () => {
    it("shows only the item's own checks", async () => {
        show(<ItemNotesView {...props()} itemId={10} />);
        await screen.findAllByTestId("show-note");
        expect(
            screen
                .getAllByTestId("show-note")
                .map((li) => li.getAttribute("data-note-kind")),
        ).toEqual(["put_down_drift", "hand_conflict"]);
    });

    it("shows nothing for an item with no checks", () => {
        show(<ItemNotesView {...props()} itemId={11} />);
        expect(screen.queryByTestId("item-notes")).toBeNull();
    });
});
