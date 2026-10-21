import { formatSteps } from "../editor/format";
import { RING_SLOTS, type RingShape } from "../tool/ringMachine";
import type { ShapeToolEntry } from "../tool/shapeTools";
import type { SavedShape } from "./savedShapes";

/** The most shapes that can be starred: one star puts a shape in the ring, which holds this many */
export const MAX_STARS = RING_SLOTS;

/**
 * A shape the library lists (#352, spec #344): a star, a picture, a name and a note. Basic rows are
 * the kinds that can be drawn; saved shapes (#353) join them as a Saved group.
 */
export interface ShapeLibraryRow extends RingShape {
    readonly group: "basic" | "saved";
    /** What sets it apart, such as "2 apart"; null for nothing to say */
    readonly note: string | null;
    /**
     * A saved shape's own record, and whether it's in the user's library or only in the open
     * show; absent for basic kinds
     */
    readonly saved?: {
        readonly shape: SavedShape;
        readonly inLibrary: boolean;
    };
}

/** How far apart the spots are, in steps: "2 apart", "2 × 4 apart"; null for no spacing */
export function intervalNote(steps: readonly number[]): string | null {
    if (steps.length === 0) return null;
    const shown = steps.map(formatSteps);
    const same = shown.every((s) => s === shown[0]);
    return `${same ? shown[0] : shown.join(" × ")} apart`;
}

/** Every basic kind, in the Shapes tab's order, noted with its default spacing */
export function basicShapeRows(
    tools: readonly ShapeToolEntry[],
): ShapeLibraryRow[] {
    return tools.map(({ kind }) => ({
        id: kind.shape.id,
        group: "basic",
        label: kind.shape.label,
        kind,
        note: intervalNote(
            kind.params.flatMap((p) =>
                p.interval && p.default !== undefined ? [p.default] : [],
            ),
        ),
    }));
}

/** The starred shapes in the order they were starred, leaving out shapes that are gone */
export function starredRows(
    stars: readonly string[],
    rows: readonly ShapeLibraryRow[],
): ShapeLibraryRow[] {
    return stars.flatMap((id) => rows.find((r) => r.id === id) ?? []);
}

/**
 * Stars or unstars shape `id`. Starring when {@link MAX_STARS} shapes in `rows` are starred
 * changes nothing and says it's full, so the user unstars one first; stars on shapes that are gone
 * don't count.
 */
export function toggleStar(
    stars: readonly string[],
    id: string,
    rows: readonly ShapeLibraryRow[],
): { readonly stars: string[] } | { readonly full: true } {
    if (stars.includes(id)) return { stars: stars.filter((s) => s !== id) };
    if (starredRows(stars, rows).length >= MAX_STARS) return { full: true };
    return { stars: [...stars, id] };
}
