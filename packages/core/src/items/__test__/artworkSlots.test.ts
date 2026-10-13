import { describe, expect, it } from "vitest";
import {
    NO_MODEL_SLOT_IDS,
    assignmentAt,
    defaultAssignmentScope,
    dormantAssignments,
    effectiveDpi,
    sameSizeSlots,
    slotAssignmentsAt,
    slotsForItem,
    type ArtworkAssignment,
    type ArtworkSlot,
} from "../artworkSlots";

const BANNER = {
    itemId: "11111111-1111-4111-8111-111111111111",
    versionHash: "a".repeat(64),
};
const SUNSET = {
    itemId: "22222222-2222-4222-8222-222222222222",
    versionHash: "b".repeat(64),
};

let nextId = 1;
const assign = (
    slot: string,
    beat: number,
    artwork: ArtworkAssignment["artwork"] = BANNER,
    extra: Partial<ArtworkAssignment> = {},
): ArtworkAssignment => ({
    id: nextId++,
    slot,
    beat,
    artwork,
    fit: "fill",
    pan: { x: 0, y: 0 },
    padColor: null,
    ...extra,
});

const ids = (slots: readonly ArtworkSlot[]) => slots.map((s) => s.id);

describe("slotsForItem", () => {
    const geometry = { width: 2.4384, depth: 1.2192, height: 0 };

    it("gives a flat no-model prop only its top, sized by its footprint", () => {
        expect(slotsForItem({ kind: "prop", model: null, geometry })).toEqual([
            { id: "top", widthM: 2.4384, heightM: 1.2192 },
        ]);
    });

    it("adds front and back, sized by width and height, once the prop has height", () => {
        const slots = slotsForItem({
            kind: "prop",
            model: null,
            geometry: { ...geometry, height: 0.6 },
        });
        expect(ids(slots)).toEqual([...NO_MODEL_SLOT_IDS]);
        expect(slots[1]).toEqual({ id: "front", widthM: 2.4384, heightM: 0.6 });
        expect(slots[2]).toEqual({ id: "back", widthM: 2.4384, heightM: 0.6 });
    });

    it("gives a prop with no Outline yet, or equipment with no model, no slots", () => {
        expect(
            slotsForItem({ kind: "prop", model: null, geometry: null }),
        ).toEqual([]);
        expect(
            slotsForItem({ kind: "equipment", model: null, geometry }),
        ).toEqual([]);
    });

    it("gives a model item the slots its model declares, whatever its Outline", () => {
        const declared = [
            { id: "panel_L", widthM: 1, heightM: 2 },
            { id: "panel_R", widthM: 1, heightM: 2 },
        ];
        expect(
            slotsForItem({
                kind: "prop",
                model: { slots: declared },
                geometry: { ...geometry, height: 3 },
            }),
        ).toEqual(declared);
        expect(
            slotsForItem({
                kind: "equipment",
                model: { slots: [] },
                geometry: null,
            }),
        ).toEqual([]);
    });
});

describe("assignmentAt", () => {
    it("has nothing before the slot's first change", () => {
        expect(assignmentAt([assign("top", 4)], "top", 3.99)).toBeNull();
    });

    it("cuts to the latest change at or before the moment, with no transition", () => {
        const first = assign("top", 4, BANNER);
        const second = assign("top", 10, SUNSET);
        const changes = [second, first];
        expect(assignmentAt(changes, "top", 4)).toBe(first);
        expect(assignmentAt(changes, "top", 9.99)).toBe(first);
        expect(assignmentAt(changes, "top", 10)).toBe(second);
        expect(assignmentAt(changes, "top", 400)).toBe(second);
    });

    it("reads only its own slot", () => {
        const front = assign("front", 0, SUNSET);
        const top = assign("top", 2, BANNER);
        expect(assignmentAt([front, top], "front", 5)).toBe(front);
        expect(assignmentAt([front, top], "back", 5)).toBeNull();
    });

    it("lets the newer row win two on one beat, and keeps a cleared slot as a change", () => {
        const older = assign("top", 3, BANNER);
        const newer = assign("top", 3, SUNSET);
        expect(assignmentAt([newer, older], "top", 3)).toBe(newer);

        const cleared = assign("top", 8, null);
        expect(assignmentAt([older, cleared], "top", 8)?.artwork).toBeNull();
    });
});

describe("dormant assignments", () => {
    const v1Slots: ArtworkSlot[] = [
        { id: "front", widthM: 1, heightM: 2 },
        { id: "back", widthM: 1, heightM: 2 },
    ];
    // An update renames "front" to "face"
    const v2Slots: ArtworkSlot[] = [
        { id: "face", widthM: 1, heightM: 2 },
        { id: "back", widthM: 1, heightM: 2 },
    ];

    it("keeps an assignment whose slot an update dropped, dormant, and restores it on revert", () => {
        const front = assign("front", 0, BANNER);
        const back = assign("back", 0, SUNSET);
        const assignments = [front, back];

        const before = slotAssignmentsAt(assignments, v1Slots, 6);
        expect(before.get("front")).toBe(front);
        expect(dormantAssignments(assignments, v1Slots)).toEqual([]);

        // Update: the renamed slot has nothing, the old assignment is dormant
        const updated = slotAssignmentsAt(assignments, v2Slots, 6);
        expect([...updated.keys()]).toEqual(["face", "back"]);
        expect(updated.get("face")).toBeNull();
        expect(updated.get("back")).toBe(back);
        expect(dormantAssignments(assignments, v2Slots)).toEqual([front]);

        // Revert: the same rows read as before
        expect(slotAssignmentsAt(assignments, v1Slots, 6)).toEqual(before);
        expect(dormantAssignments(assignments, v1Slots)).toEqual([]);
    });

    it("makes a no-model prop's front and back dormant while it is flat", () => {
        const front = assign("front", 0);
        const geometry = { width: 2, depth: 1, height: 0.5 };
        const tall = slotsForItem({ kind: "prop", model: null, geometry });
        const flat = slotsForItem({
            kind: "prop",
            model: null,
            geometry: { ...geometry, height: 0 },
        });
        expect(dormantAssignments([front], tall)).toEqual([]);
        expect(dormantAssignments([front], flat)).toEqual([front]);
    });

    it("offers the remaining slots of the same size as a remap", () => {
        const dropped: ArtworkSlot = { id: "front", widthM: 1, heightM: 2 };
        expect(
            ids(
                sameSizeSlots(dropped, [
                    ...v2Slots,
                    { id: "rotated", widthM: 2, heightM: 1 },
                    { id: "close", widthM: 1.0004, heightM: 1.9996 },
                    { id: "bigger", widthM: 1.1, heightM: 2 },
                ]),
            ),
        ).toEqual(["face", "back", "close"]);
    });
});

describe("effectiveDpi", () => {
    // A 36 x 54 in silk-sized slot
    const slot = { widthM: 36 * 0.0254, heightM: 54 * 0.0254 };

    it("is the artwork's pixels over the slot's inches when the aspects match", () => {
        const dpi = effectiveDpi({ width: 5400, height: 8100 }, slot, "fill");
        expect(dpi).toBeCloseTo(150, 9);
        expect(
            effectiveDpi({ width: 5400, height: 8100 }, slot, "fit"),
        ).toBeCloseTo(150, 9);
    });

    it("takes the lower density when filling, since the image is enlarged to cover", () => {
        // Square art: 100 px/in across, 66.7 down
        const art = { width: 3600, height: 3600 };
        expect(effectiveDpi(art, slot, "fill")).toBeCloseTo(3600 / 54, 9);
        // Fit leaves pad above and below, so it prints at the wider density
        expect(effectiveDpi(art, slot, "fit")).toBeCloseTo(3600 / 36, 9);
        const wide = { width: 7200, height: 3600 };
        expect(effectiveDpi(wide, slot, "fill")).toBeCloseTo(3600 / 54, 9);
        expect(effectiveDpi(wide, slot, "fit")).toBeCloseTo(7200 / 36, 9);
    });

    it("has no value for a slot or image with no size", () => {
        expect(effectiveDpi({ width: 0, height: 10 }, slot, "fill")).toBeNull();
        expect(
            effectiveDpi(
                { width: 10, height: 10 },
                { widthM: 0, heightM: 1 },
                "fit",
            ),
        ).toBeNull();
    });
});

describe("defaultAssignmentScope", () => {
    it("is the whole show while the slot has no changes, else from the current count", () => {
        expect(defaultAssignmentScope([], "top")).toBe("show");
        expect(defaultAssignmentScope([assign("front", 3)], "top")).toBe(
            "show",
        );
        expect(defaultAssignmentScope([assign("top", 3)], "top")).toBe(
            "from_count",
        );
    });
});
