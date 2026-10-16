import { describe, expect, it } from "vitest";
import type { PlacementChange, XY } from "@openmarch/core";
import {
    collectShowNotes,
    noteCountAt,
    notesAt,
    notesForItem,
    type NoteItem,
    type ShowNotesInput,
} from "../showNotes";

// Performers
const ALICE = 1;
const BOB = 2;
const CREW = 3;

// Items and their marchers rows
const FLAG: NoteItem = { id: 10, marcherId: 110, kind: "equipment" };
const RIFLE: NoteItem = { id: 11, marcherId: 111, kind: "equipment" };
const RISER: NoteItem = { id: 20, marcherId: 120, kind: "prop" };
const CART: NoteItem = { id: 21, marcherId: 121, kind: "prop" };

let nextId = 1;
const change = (
    beat: number,
    patch: Partial<PlacementChange>,
): PlacementChange => ({
    id: nextId++,
    beat,
    state: "placed",
    holders: [],
    crew: [],
    groupId: null,
    ...patch,
});

/**
 * Alice holds the flag from 2 and takes the rifle in her right hand on 4 without putting the
 * flag down until 8, where it is put down; her drill then put her elsewhere at 8, so the flag sits
 * away from her. The riser has a crew that walks off from 14. The cart moves on 18 with no crew.
 */
const changesByItem = new Map<number, PlacementChange[]>([
    [
        FLAG.id,
        [
            change(2, {
                state: "held",
                holders: [{ marcherId: ALICE, hand: "both" }],
            }),
            change(8, {}),
        ],
    ],
    [
        RIFLE.id,
        [
            change(4, {
                state: "held",
                holders: [{ marcherId: ALICE, hand: "right" }],
            }),
        ],
    ],
    [RISER.id, [change(10, { crew: [CREW] })]],
    [CART.id, [change(0, {})]],
]);

const positionAt = (marcherId: number, beat: number): XY | null => {
    switch (marcherId) {
        case ALICE:
            return [50, 0];
        case BOB:
            return [0, 0];
        case CREW:
            return beat < 14 ? [100, 0] : [200, 0];
        case FLAG.marcherId:
            return [0, 0];
        case RISER.marcherId:
            return [100, 0];
        case CART.marcherId:
            return beat < 18 ? [0, 50] : [10, 50];
        default:
            return null;
    }
};

const input = (patch: Partial<ShowNotesInput> = {}): ShowNotesInput => ({
    items: [FLAG, RIFLE, RISER, CART],
    changesByItem,
    beatCount: 32,
    positionAt,
    crewReach: 16,
    warnPropMovesWithoutCrew: false,
    ...patch,
});

describe("collectShowNotes", () => {
    it("names each first producer at its count, in count order", () => {
        expect(collectShowNotes(input())).toEqual([
            {
                id: `hand_conflict:${FLAG.id}:${RIFLE.id}:${ALICE}:right:4`,
                kind: "hand_conflict",
                itemId: FLAG.id,
                beat: 4,
                until: 8,
                otherItemId: RIFLE.id,
                marcherIds: [ALICE],
            },
            {
                id: `put_down_drift:${FLAG.id}:${changesByItem.get(FLAG.id)![1]!.id}`,
                kind: "put_down_drift",
                itemId: FLAG.id,
                beat: 8,
                until: null,
                marcherIds: [ALICE],
                action: {
                    kind: "snap_to_holder",
                    placementId: changesByItem.get(FLAG.id)![1]!.id,
                },
            },
            {
                id: `crew_distance:${RISER.id}:10`,
                kind: "crew_distance",
                itemId: RISER.id,
                beat: 14,
                until: null,
                marcherIds: [CREW],
            },
        ]);
    });

    it("warns of a prop moving without a crew only when the show setting is on", () => {
        const notes = collectShowNotes(
            input({ warnPropMovesWithoutCrew: true }),
        );
        expect(notes.filter((n) => n.kind === "crewless_move")).toEqual([
            {
                id: `crewless_move:${CART.id}:0`,
                kind: "crewless_move",
                itemId: CART.id,
                beat: 18,
                until: null,
                marcherIds: [],
            },
        ]);
    });

    it("never warns of equipment moving without a crew", () => {
        const notes = collectShowNotes(
            input({
                items: [{ ...CART, kind: "equipment" }],
                warnPropMovesWithoutCrew: true,
            }),
        );
        expect(notes).toEqual([]);
    });

    it("is quiet for a crew in reach and a put-down at its holder", () => {
        const notes = collectShowNotes(
            input({
                items: [FLAG, RISER],
                crewReach: 1000,
                positionAt: (id, beat) =>
                    id === FLAG.marcherId ? [50, 0] : positionAt(id, beat),
            }),
        );
        expect(notes).toEqual([]);
    });
});

describe("note lookups", () => {
    const notes = collectShowNotes(input());

    it("shows each note on its item", () => {
        expect(notesForItem(notes, FLAG.id).map((n) => n.kind)).toEqual([
            "hand_conflict",
            "put_down_drift",
        ]);
        expect(notesForItem(notes, RIFLE.id)).toEqual([]);
    });

    it("counts the notes that apply at a moment", () => {
        expect(notesAt(notes, 3)).toEqual([]);
        expect(notesAt(notes, 5).map((n) => n.kind)).toEqual(["hand_conflict"]);
        expect(notesAt(notes, 8).map((n) => n.kind)).toEqual([
            "put_down_drift",
        ]);
        expect(notesAt(notes, 20)).toHaveLength(2);
    });
});

describe("noteCountAt", () => {
    // Page 1 at home, then 8-count pages: page 2's box is [1, 9) and its flag is at 9
    const pages = [
        { start: 0, end: 1, name: "1" },
        { start: 1, end: 9, name: "2" },
        { start: 9, end: 17, name: "3" },
    ];

    it("counts from 1 after the previous flag to N on the page's own flag", () => {
        expect(noteCountAt(pages, 2)).toEqual({ page: "2", count: 1 });
        expect(noteCountAt(pages, 9)).toEqual({ page: "2", count: 8 });
        expect(noteCountAt(pages, 10)).toEqual({ page: "3", count: 1 });
    });

    it("is the first page's count 0 at home, and past the last flag counts after it", () => {
        expect(noteCountAt(pages, 0)).toEqual({ page: "1", count: 0 });
        expect(noteCountAt(pages, 1)).toEqual({ page: "1", count: 0 });
        expect(noteCountAt(pages, 20)).toEqual({
            page: "3",
            count: 3,
            after: true,
        });
    });
});
