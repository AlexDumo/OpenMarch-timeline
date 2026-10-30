import { create } from "zustand";
import { db } from "@/global/database/db";
import { readAllShapeRecipes } from "@/db-functions/shapeRecipes";
import { readTimelineEndBeats } from "@/db-functions/timelines";
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
 *
 * `ends` is the end beat of each recipe's move, read with the recipes. `storedTimelines` has them
 * too, but it's reloaded on its own after an edit: a copy saved on a new move was read back before
 * its move was, so it showed nowhere for a moment and the next save copied it again (#514).
 */
export const usePlacedBoxStore = create<{
    readonly recipes: readonly PlacedRecipe[];
    readonly ends: ReadonlyMap<number, number>;
}>(() => ({ recipes: [], ends: new Map() }));

let reading: Promise<void> | null = null;
let again = false;

/** The same recipes read back keep the array, so nothing re-renders for them (#455) */
const sameRecipes = (a: readonly PlacedRecipe[], b: readonly PlacedRecipe[]) =>
    a === b ||
    (a.length === b.length && JSON.stringify(a) === JSON.stringify(b));

const sameEnds = (
    a: ReadonlyMap<number, number>,
    b: ReadonlyMap<number, number>,
) => a.size === b.size && [...a].every(([id, end]) => b.get(id) === end);

/** The recipes, and the end beats of their moves */
async function readPlacedRecipes() {
    const recipes = await readAllShapeRecipes(db);
    const ends = await readTimelineEndBeats(
        db,
        recipes.flatMap((r) => (r.timelineId === null ? [] : [r.timelineId])),
    );
    return { recipes, ends };
}

/** Reads the recipes again; calls while a read runs fold into one more read after it */
export function invalidatePlacedBoxes(): void {
    if (reading) {
        again = true;
        return;
    }
    reading = readPlacedRecipes()
        .then(({ recipes, ends }) => {
            const now = usePlacedBoxStore.getState();
            const next = {
                ...(sameRecipes(now.recipes, recipes) ? {} : { recipes }),
                ...(sameEnds(now.ends, ends) ? {} : { ends }),
            };
            if (next.recipes || next.ends) usePlacedBoxStore.setState(next);
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

/** Settles once the recipes asked for so far are read back */
export async function placedBoxesRead(): Promise<void> {
    while (reading) await reading;
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
    const { ends } = usePlacedBoxStore.getState();
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
