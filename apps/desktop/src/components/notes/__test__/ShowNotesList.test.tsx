import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TolgeeProvider } from "@tolgee/react";
import tolgee from "@/global/singletons/Tolgee";
import type { ShowNote } from "@/notes/showNotes";
import { ItemNotesView, ShowNotesListView } from "../ShowNotesList";

// Page 1 at home, then 8-count pages: page 2's flag is at 9, page 5's box is [25, 33)
const pages = [
    { start: 0, end: 1, name: "1" },
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

const NOTES: ShowNote[] = [
    {
        id: "hand",
        kind: "hand_conflict",
        itemId: 10,
        beat: 34,
        until: null,
        otherItemId: 11,
        marcherIds: [1],
    },
    {
        id: "drift",
        kind: "put_down_drift",
        itemId: 10,
        beat: 2,
        until: null,
        marcherIds: [1],
        action: { kind: "snap_to_holder", placementId: 7 },
    },
    {
        id: "crew",
        kind: "crew_distance",
        itemId: 20,
        beat: 0,
        until: null,
        marcherIds: [3],
    },
    {
        id: "crewless",
        kind: "crewless_move",
        itemId: 21,
        beat: 33,
        until: null,
        marcherIds: [],
    },
];

const show = (ui: React.ReactElement) =>
    render(
        <TolgeeProvider tolgee={tolgee} fallback="Loading...">
            {ui}
        </TolgeeProvider>,
    );

const props = (onSnap = vi.fn()) => ({
    notes: NOTES,
    pages,
    itemName: (id: number) => items[id] ?? "",
    marcherName: (id: number) => people[id] ?? "",
    onSnap,
});

describe("ShowNotesListView", () => {
    it("names each note's item and count, in the designer's words", async () => {
        show(<ShowNotesListView {...props()} />);
        expect(await screen.findByText("4 notes")).toBeTruthy();
        const lines = screen
            .getAllByTestId("show-note")
            .map((li) => li.textContent);
        expect(lines).toEqual([
            "Flag not put down, 1 count after page 5Rifle takes Alice's hand",
            "Flag put down away from its holder, count 1 of page 2Alice is somewhere else nowSnap to holder",
            "Riser's crew is away from it, at the startOut of reach: Carl",
            "Cart moves without a crew, count 8 of page 5",
        ]);
    });

    it("offers Snap to holder on a put-down note, and never a dialog", async () => {
        const onSnap = vi.fn();
        show(<ShowNotesListView {...props(onSnap)} />);
        fireEvent.click(
            await screen.findByRole("button", { name: "Snap to holder" }),
        );
        expect(onSnap).toHaveBeenCalledWith(7);
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(screen.queryByRole("alertdialog")).toBeNull();
    });

    it("says so when there are no notes", async () => {
        show(<ShowNotesListView {...props()} notes={[]} />);
        expect(await screen.findByText("No notes")).toBeTruthy();
    });
});

describe("ItemNotesView", () => {
    it("shows only the item's own notes", async () => {
        show(<ItemNotesView {...props()} itemId={10} />);
        await screen.findAllByTestId("show-note");
        expect(
            screen
                .getAllByTestId("show-note")
                .map((li) => li.getAttribute("data-note-kind")),
        ).toEqual(["hand_conflict", "put_down_drift"]);
    });

    it("shows nothing for an item with no notes", () => {
        show(<ItemNotesView {...props()} itemId={11} />);
        expect(screen.queryByTestId("item-notes")).toBeNull();
    });
});
