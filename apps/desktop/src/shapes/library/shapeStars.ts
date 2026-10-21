import { create } from "zustand";
import { syncFromStorage } from "@/stores/syncFromStorage";
import { SHAPE_TOOLS } from "../tool/shapeTools";
import {
    basicShapeRows,
    toggleStar,
    type ShapeLibraryRow,
} from "./shapeLibrary";

/**
 * Stars are the user's, not the show's (#344): they live with the app's other per-user settings
 * in localStorage, so they follow the user from show to show and across restarts.
 */
export const SHAPE_STARS_STORAGE_KEY = "openmarch:shapeStars";

function parseStars(raw: string): string[] {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === "string")
        : [];
}

function loadStars(): string[] {
    try {
        const stored = localStorage.getItem(SHAPE_STARS_STORAGE_KEY);
        return stored ? parseStars(stored) : [];
    } catch (error) {
        console.error("Failed to load starred shapes:", error);
        return [];
    }
}

function saveStars(stars: readonly string[]): void {
    try {
        localStorage.setItem(SHAPE_STARS_STORAGE_KEY, JSON.stringify(stars));
    } catch (error) {
        console.error("Failed to save starred shapes:", error);
    }
}

interface ShapeStarsStore {
    /** Starred shape ids, in the order they were starred */
    stars: readonly string[];
    /** The shape the user tried to star with every star taken, asking them to unstar one first */
    asking: string | null;
    /** Stars or unstars `id`, of the shapes `rows` lists; with every star taken it asks instead */
    toggle: (id: string, rows: readonly ShapeLibraryRow[]) => void;
    dismissAsk: () => void;
}

export const useShapeStarsStore = create<ShapeStarsStore>((set, get) => ({
    stars: loadStars(),
    asking: null,
    toggle: (id, rows) => {
        const next = toggleStar(get().stars, id, rows);
        if ("full" in next) {
            set({ asking: id });
            return;
        }
        set({ stars: next.stars, asking: null });
        saveStars(next.stars);
    },
    dismissAsk: () => set({ asking: null }),
}));

syncFromStorage(SHAPE_STARS_STORAGE_KEY, parseStars, (stars) =>
    useShapeStarsStore.setState({ stars }),
);

const BASIC_ROWS = basicShapeRows(SHAPE_TOOLS);

/**
 * Every shape the library lists, in its order: the basic kinds. Saved shapes (#353) join them
 * here, as the Saved group, so the ring and the Shapes tab find starred saved shapes too.
 */
export function useShapeLibraryRows(): readonly ShapeLibraryRow[] {
    return BASIC_ROWS;
}
