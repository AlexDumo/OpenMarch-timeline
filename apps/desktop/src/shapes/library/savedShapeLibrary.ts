import * as z from "zod";
import { create } from "zustand";
import { syncFromStorage } from "@/stores/syncFromStorage";
import type { SavedShape } from "./savedShapes";

/**
 * The user's saved shapes (#353), kept across shows. Like stars they're the user's, not the
 * show's, so they live with the app's per-user settings in localStorage; each show that uses one
 * keeps its own copy too (`saved_shapes`, ADR 0006, saved shapes).
 */
export const SAVED_SHAPES_STORAGE_KEY = "openmarch:savedShapes";

const SavedShapeSchema = z.object({
    id: z.string().min(1),
    name: z.string(),
    kind: z.string(),
    kindVersion: z.number().int(),
    intervals: z.record(z.string(), z.number().finite()),
});

/** The saved shapes in `raw`, leaving out any that don't read */
function parseSaved(raw: string): SavedShape[] {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
        const shape = SavedShapeSchema.safeParse(entry);
        return shape.success ? [shape.data] : [];
    });
}

function loadSaved(): SavedShape[] {
    try {
        const stored = localStorage.getItem(SAVED_SHAPES_STORAGE_KEY);
        return stored ? parseSaved(stored) : [];
    } catch (error) {
        console.error("Failed to load saved shapes:", error);
        return [];
    }
}

function storeSaved(shapes: readonly SavedShape[]): void {
    try {
        localStorage.setItem(SAVED_SHAPES_STORAGE_KEY, JSON.stringify(shapes));
    } catch (error) {
        console.error("Failed to save the saved shapes:", error);
    }
}

interface SavedShapeLibraryStore {
    /** The user's saved shapes, in the order they were saved */
    shapes: readonly SavedShape[];
    /** Adds `shape`, or replaces the one with its id in place */
    put: (shape: SavedShape) => void;
    remove: (id: string) => void;
}

export const useSavedShapeLibrary = create<SavedShapeLibraryStore>(
    (set, get) => ({
        shapes: loadSaved(),
        put: (shape) => {
            const shapes = get().shapes;
            const next = shapes.some((s) => s.id === shape.id)
                ? shapes.map((s) => (s.id === shape.id ? shape : s))
                : [...shapes, shape];
            set({ shapes: next });
            storeSaved(next);
        },
        remove: (id) => {
            const next = get().shapes.filter((s) => s.id !== id);
            set({ shapes: next });
            storeSaved(next);
        },
    }),
);

syncFromStorage(SAVED_SHAPES_STORAGE_KEY, parseSaved, (shapes) =>
    useSavedShapeLibrary.setState({ shapes }),
);
