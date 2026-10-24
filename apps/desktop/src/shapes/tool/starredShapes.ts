import { useMemo } from "react";
import { starredRows, type ShapeLibraryRow } from "../library/shapeLibrary";
import { useShapeLibraryRows, useShapeStarsStore } from "../library/shapeStars";

/**
 * The user's starred shapes, in the order they were starred, for the ring and the Shapes tab. One
 * star puts a shape in both (#344); shapes are starred in the library (#352).
 */
export function useStarredShapes(): readonly ShapeLibraryRow[] {
    const rows = useShapeLibraryRows();
    const stars = useShapeStarsStore((s) => s.stars);
    return useMemo(() => starredRows(stars, rows), [stars, rows]);
}
