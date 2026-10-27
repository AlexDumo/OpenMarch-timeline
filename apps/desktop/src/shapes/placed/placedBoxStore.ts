import { create } from "zustand";
import { db } from "@/global/database/db";
import { readAllShapeRecipes } from "@/db-functions/shapeRecipes";
import {
    displayedBeat,
    useTimelineSelectionStore,
} from "@/stores/TimelineSelectionStore";
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
/** The resolver version the last read started at */
let readAt: number | null = null;

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
    readAt = useTimelineResolverStore.getState().version;
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
 * Whether no placed shape has any of `marcherIds` as a member, known without reading: the
 * recipes were read since the resolver's last change and no read is under way. A coordinate
 * edit of only such marchers can't touch a shape (#455)
 */
export function inNoPlacedBox(marcherIds: readonly number[]): boolean {
    if (
        reading ||
        again ||
        readAt !== useTimelineResolverStore.getState().version
    )
        return false;
    const ids = new Set(marcherIds);
    return usePlacedBoxStore
        .getState()
        .recipes.every((r) => r.members.every((m) => !ids.has(m.marcherId)));
}

/**
 * The displayed beat, for what shows placed shapes: 0 while the show has none, so scrubbing the
 * timeline doesn't re-render them for nothing (#455)
 */
export function usePlacedBoxBeat(): number {
    const any = usePlacedBoxStore((s) => s.recipes.length > 0);
    return useTimelineSelectionStore((s) => (any ? displayedBeat(s) : 0));
}
