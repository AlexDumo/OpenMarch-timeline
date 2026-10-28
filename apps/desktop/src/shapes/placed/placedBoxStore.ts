import { create } from "zustand";
import { db } from "@/global/database/db";
import { readAllShapeRecipes } from "@/db-functions/shapeRecipes";
import { subscribeHistoryChanges } from "@/db-functions/history";
import {
    displayedBeat,
    useTimelineSelectionStore,
} from "@/stores/TimelineSelectionStore";
import { editingPositionAt } from "@/timeline/timelineIsolationPlan";
import { useTimelineResolverStore } from "@/timeline/timelineStore";
import { boxesAt, type PlacedBox, type PlacedRecipe } from "./placedBox";

/**
 * The show's shape recipes, read back for placed boxes
 * (docs/timeline/research/shapes/07-placed-boxes.md). Refreshed after every coordinate edit,
 * whenever the resolver takes a change, and after every undoable edit, undo and redo
 * (`followPlacedBoxChanges`).
 */
export const usePlacedBoxStore = create<{
    readonly recipes: readonly PlacedRecipe[];
}>(() => ({ recipes: [] }));

let reading: Promise<void> | null = null;
let again = false;

/** The same recipes read back keep the array, so nothing re-renders for them (#455) */
const sameRecipes = (a: readonly PlacedRecipe[], b: readonly PlacedRecipe[]) =>
    a === b ||
    (a.length === b.length && JSON.stringify(a) === JSON.stringify(b));

/** Reads the recipes again; calls while a read runs fold into one more read after it */
export function invalidatePlacedBoxes(): void {
    if (reading) {
        again = true;
        return;
    }
    reading = readAllShapeRecipes(db)
        .then((recipes) => {
            if (!sameRecipes(usePlacedBoxStore.getState().recipes, recipes))
                usePlacedBoxStore.setState({ recipes });
        })
        .catch((e: unknown) => console.error("Couldn't read shapes", e))
        .finally(() => {
            reading = null;
            if (again) {
                again = false;
                invalidatePlacedBoxes();
            }
        });
}

/**
 * Reads the recipes again after every undoable edit, undo and redo, until the returned function
 * stops it: one that changes only a recipe (a pivot drag) moves no one, so the resolver never
 * hears of it
 */
export function followPlacedBoxChanges(): () => void {
    const stop = subscribeHistoryChanges(invalidatePlacedBoxes);
    return () => {
        stop();
    };
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

/**
 * The displayed beat, for what shows placed shapes: 0 while the show has none, so scrubbing the
 * timeline doesn't re-render them for nothing (#455)
 */
export function usePlacedBoxBeat(): number {
    const any = usePlacedBoxStore((s) => s.recipes.length > 0);
    return useTimelineSelectionStore((s) => (any ? displayedBeat(s) : 0));
}
