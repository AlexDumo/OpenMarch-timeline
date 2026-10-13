/**
 * Which Artwork sits on each of an item's slots, count by count (ADR 0002 D-10, props-spec
 * section 4, "Artwork slot assignments").
 *
 * Assignments are a sparse list of changes keyed by (slot, beat). The value of a slot on a count
 * is its latest change at or before it; a change is a hard cut on the click of its beat, with no
 * transition. A change may clear the slot (`artwork` null) from its count on.
 *
 * An item's slots come from its model's declarations, or, with no model, from its Outline: a
 * prop has a top, plus a front and a back while it has height. Assignments are stored by slot id
 * and never rewritten when the slots change, so one whose slot is gone (an update renamed or
 * dropped it, or the prop is flat) is **dormant**: kept, not drawn, and live again when the slot
 * comes back, as it does when the update is reverted.
 *
 * Moments are beat positions, fractional between clicks, as in `itemGeometryAt` and
 * `placementAt`. Everything here is pure.
 */

/** A Library Version, as a show references one (ADR 0002 D-12). */
export interface LibraryVersionRef {
    itemId: string;
    versionHash: string;
}

/** Fill crops to cover the slot (centered, can pan); fit pads to show the whole Artwork. */
export type ArtworkFit = "fill" | "fit";

/**
 * Where a filled Artwork's crop sits: -1 to 1 along each axis as a fraction of the overflow
 * from center, 0 centered. Only the axis that overflows moves the crop.
 */
export interface ArtworkPan {
    x: number;
    y: number;
}

/** A slot an item offers: an id unique within the item, and its printable size in meters. */
export interface ArtworkSlot {
    id: string;
    widthM: number;
    heightM: number;
}

/** One row of `item_artwork_slots`, with its beat as a position. */
export interface ArtworkAssignment {
    /** The row id: of two changes on one slot and beat, the higher id is newer */
    id: number;
    slot: string;
    /** The position of the beat the change is on */
    beat: number;
    /** The Artwork Version from this count on, or null to leave the slot bare */
    artwork: LibraryVersionRef | null;
    fit: ArtworkFit;
    pan: ArtworkPan;
    /** `#rrggbb` padding for fit, or null for transparent where the surface allows, else its base color */
    padColor: string | null;
}

/** The slots of a prop with no model, in display order. */
export const NO_MODEL_SLOT_IDS = ["top", "front", "back"] as const;

/**
 * The slots an item offers. A model item has the slots its model declares. With no model, a prop
 * has a top (width by depth), plus a front and a back (width by height) when its height is above
 * zero; equipment with no model, or a prop with no Outline, has none. `geometry` is the Outline at
 * the moment in question (`itemGeometryAt`), in meters.
 */
export function slotsForItem({
    kind,
    model,
    geometry,
}: {
    kind: "prop" | "equipment";
    model: { slots: readonly ArtworkSlot[] } | null;
    geometry: { width: number; depth: number; height: number } | null;
}): ArtworkSlot[] {
    if (model) return [...model.slots];
    if (kind !== "prop" || !geometry) return [];
    const slots: ArtworkSlot[] = [
        { id: "top", widthM: geometry.width, heightM: geometry.depth },
    ];
    if (geometry.height > 0)
        slots.push(
            { id: "front", widthM: geometry.width, heightM: geometry.height },
            { id: "back", widthM: geometry.width, heightM: geometry.height },
        );
    return slots;
}

const newerThan = (a: ArtworkAssignment, b: ArtworkAssignment) =>
    a.beat > b.beat || (a.beat === b.beat && a.id > b.id);

/**
 * The change in effect on `slot` at `position`: its newest at or before it, or null before its
 * first. A returned change with `artwork` null means the slot is bare.
 */
export function assignmentAt(
    assignments: readonly ArtworkAssignment[],
    slot: string,
    position: number,
): ArtworkAssignment | null {
    let current: ArtworkAssignment | null = null;
    for (const a of assignments) {
        if (
            a.slot === slot &&
            a.beat <= position &&
            (!current || newerThan(a, current))
        )
            current = a;
    }
    return current;
}

/** The change in effect on each of `slots` at `position`, in slot order. Dormant rows are left out. */
export function slotAssignmentsAt(
    assignments: readonly ArtworkAssignment[],
    slots: readonly ArtworkSlot[],
    position: number,
): Map<string, ArtworkAssignment | null> {
    return new Map(
        slots.map((s) => [s.id, assignmentAt(assignments, s.id, position)]),
    );
}

/**
 * The stored assignments whose slot isn't among `slots`: kept, not drawn, and live again when
 * their slot comes back. The quiet note and the "update available" remap offer list these.
 */
export function dormantAssignments(
    assignments: readonly ArtworkAssignment[],
    slots: readonly ArtworkSlot[],
): ArtworkAssignment[] {
    const live = new Set(slots.map((s) => s.id));
    return assignments.filter((a) => !live.has(a.slot));
}

/** Slot sizes within this many meters count as the same size (about 1/25 in). */
export const SAME_SIZE_TOLERANCE_M = 0.001;

/**
 * The slots a dormant assignment's slot can be remapped to: those of the same size, in the same
 * orientation, within `tolerance` meters on each side.
 */
export function sameSizeSlots(
    dropped: Pick<ArtworkSlot, "widthM" | "heightM">,
    slots: readonly ArtworkSlot[],
    tolerance: number = SAME_SIZE_TOLERANCE_M,
): ArtworkSlot[] {
    return slots.filter(
        (s) =>
            Math.abs(s.widthM - dropped.widthM) <= tolerance &&
            Math.abs(s.heightM - dropped.heightM) <= tolerance,
    );
}

const METERS_PER_INCH = 0.0254;

/**
 * The pixels per inch an Artwork prints at on a slot. Fill enlarges the image to cover the slot,
 * so the tighter axis sets it (the lower density); fit shows the whole image, so the looser axis
 * does (the higher). Null when the image or slot has no size.
 */
export function effectiveDpi(
    pixels: { width: number; height: number },
    slot: Pick<ArtworkSlot, "widthM" | "heightM">,
    fit: ArtworkFit,
): number | null {
    if (
        !(pixels.width > 0 && pixels.height > 0) ||
        !(slot.widthM > 0 && slot.heightM > 0)
    )
        return null;
    const across = pixels.width / (slot.widthM / METERS_PER_INCH);
    const down = pixels.height / (slot.heightM / METERS_PER_INCH);
    return fit === "fill" ? Math.min(across, down) : Math.max(across, down);
}

/**
 * Where the item slot picker writes: the whole show while the slot has no changes, otherwise
 * from the current count on. The picker shows the scope on its button and can switch it.
 */
export type AssignmentScope = "show" | "from_count";

export function defaultAssignmentScope(
    assignments: readonly ArtworkAssignment[],
    slot: string,
): AssignmentScope {
    return assignments.some((a) => a.slot === slot) ? "from_count" : "show";
}
