import { create } from "zustand";
import { SavedShapeSchema, type SavedShape } from "@/db-functions/savedShapes";
import { userList } from "./userStorage";

/**
 * The user's saved shapes (#353), kept across shows. Like stars they're the user's, not the
 * show's, so they live with the app's per-user settings in localStorage; each show that uses one
 * keeps its own copy too (`saved_shapes`, ADR 0006, saved shapes).
 */
export const SAVED_SHAPES_STORAGE_KEY = "openmarch:savedShapes";

const SAVED = userList(
    SAVED_SHAPES_STORAGE_KEY,
    (entry): SavedShape | null => {
        const shape = SavedShapeSchema.safeParse(entry);
        return shape.success ? shape.data : null;
    },
    "saved shapes",
);

interface SavedShapeLibraryStore {
    /** The user's saved shapes, in the order they were saved */
    shapes: readonly SavedShape[];
    /** Adds `shape`, or replaces the one with its id in place */
    put: (shape: SavedShape) => void;
    remove: (id: string) => void;
}

export const useSavedShapeLibrary = create<SavedShapeLibraryStore>(
    (set, get) => ({
        shapes: SAVED.load(),
        put: (shape) => {
            const shapes = get().shapes;
            const next = shapes.some((s) => s.id === shape.id)
                ? shapes.map((s) => (s.id === shape.id ? shape : s))
                : [...shapes, shape];
            set({ shapes: next });
            SAVED.save(next);
        },
        remove: (id) => {
            const next = get().shapes.filter((s) => s.id !== id);
            set({ shapes: next });
            SAVED.save(next);
        },
    }),
);

SAVED.sync((shapes) => useSavedShapeLibrary.setState({ shapes }));
