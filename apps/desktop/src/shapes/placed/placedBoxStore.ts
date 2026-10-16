import { create } from "zustand";
import { db } from "@/global/database/db";
import { readAllShapeRecipes } from "@/db-functions/shapeRecipes";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { editingPositionAt } from "@/timeline/timelineIsolationPlan";
import { useTimelineResolverStore } from "@/timeline/timelineStore";
import { boxesAt, type PlacedBox, type PlacedRecipe } from "./placedBox";

/**
 * The show's shape recipes, read back for placed boxes
 * (docs/timeline/research/shapes/07-placed-boxes.md). Refreshed after every coordinate edit and
 * whenever the resolver takes a change (undo and redo included).
 */
export const usePlacedBoxStore = create<{
    readonly recipes: readonly PlacedRecipe[];
}>(() => ({ recipes: [] }));

let reading: Promise<void> | null = null;
let again = false;

/** Reads the recipes again; calls while a read runs fold into one more read after it */
export function invalidatePlacedBoxes(): void {
    if (reading) {
        again = true;
        return;
    }
    reading = readAllShapeRecipes(db)
        .then((recipes) => usePlacedBoxStore.setState({ recipes }))
        .catch((e: unknown) => console.error("Couldn't read shapes", e))
        .finally(() => {
            reading = null;
            if (again) {
                again = false;
                invalidatePlacedBoxes();
            }
        });
}

/** The placed boxes shown at `beat`, from the stored recipes and the resolver */
export function placedBoxesAt(
    beat: number,
    recipes: readonly PlacedRecipe[] = usePlacedBoxStore.getState().recipes,
): PlacedBox[] {
    const resolver = useTimelineResolverStore.getState().resolver;
    if (!resolver || recipes.length === 0) return [];
    const ends = new Map(
        (useTimelineSelectionStore.getState().storedTimelines ?? []).map(
            (t) => [t.id, t.end] as const,
        ),
    );
    return boxesAt({
        recipes,
        endBeatOf: (id) => (id === null ? 0 : ends.get(id)),
        beat,
        positionOf: (id) => {
            try {
                const [x, y] = editingPositionAt(resolver, id, beat);
                return { x, y };
            } catch {
                return undefined;
            }
        },
    });
}
