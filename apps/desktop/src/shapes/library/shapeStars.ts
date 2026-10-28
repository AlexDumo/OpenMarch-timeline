import { useMemo } from "react";
import { create } from "zustand";
import { useQuery } from "@tanstack/react-query";
import { allSavedShapesQueryOptions } from "@/hooks/queries/useSavedShapes";
import { SHAPE_TOOLS } from "../tool/shapeTools";
import {
    basicShapeRows,
    toggleStar,
    type ShapeLibraryRow,
} from "./shapeLibrary";
import { useSavedShapeLibrary } from "./savedShapeLibrary";
import {
    newerSavedShapes,
    savedShapeRows,
    type SavedShape,
} from "./savedShapes";
import { userList } from "./userStorage";

/**
 * Stars are the user's, not the show's (#344): they live with the app's other per-user settings
 * in localStorage, so they follow the user from show to show and across restarts.
 */
export const SHAPE_STARS_STORAGE_KEY = "openmarch:shapeStars";

const STARS = userList(
    SHAPE_STARS_STORAGE_KEY,
    (id) => (typeof id === "string" ? id : null),
    "starred shapes",
);

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
    stars: STARS.load(),
    asking: null,
    toggle: (id, rows) => {
        const next = toggleStar(get().stars, id, rows);
        if ("full" in next) {
            set({ asking: id });
            return;
        }
        set({ stars: next.stars, asking: null });
        STARS.save(next.stars);
    },
    dismissAsk: () => set({ asking: null }),
}));

STARS.sync((stars) => useShapeStarsStore.setState({ stars }));

const BASIC_ROWS = basicShapeRows(SHAPE_TOOLS);
const NONE: readonly SavedShape[] = [];

/** Every shape the library lists, in its order: the basic kinds, then the Saved group (#353) */
export function libraryRowsOf(
    library: readonly SavedShape[],
    show: readonly SavedShape[],
): ShapeLibraryRow[] {
    return [...BASIC_ROWS, ...savedShapeRows(library, show, SHAPE_TOOLS)];
}

/**
 * Every shape the library lists, in its order: the basic kinds, then the user's saved shapes and
 * those only the open show has, as the Saved group, so the ring and the Shapes tab find starred
 * saved shapes too
 */
export function useShapeLibraryRows(): readonly ShapeLibraryRow[] {
    const library = useSavedShapeLibrary((s) => s.shapes);
    const show = useQuery(allSavedShapesQueryOptions()).data ?? NONE;
    return useMemo(() => libraryRowsOf(library, show), [library, show]);
}

/** How many saved shapes the library leaves out because they need a newer app */
export function useNewerSavedShapeCount(): number {
    const library = useSavedShapeLibrary((s) => s.shapes);
    const show = useQuery(allSavedShapesQueryOptions()).data ?? NONE;
    return useMemo(
        () => newerSavedShapes(library, show, SHAPE_TOOLS),
        [library, show],
    );
}
