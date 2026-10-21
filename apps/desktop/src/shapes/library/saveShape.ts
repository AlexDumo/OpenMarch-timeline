import type { QueryClient } from "@tanstack/react-query";
import {
    copySavedShapeToShow,
    deleteSavedShapeFromShow,
    showSavedShapeKeys,
} from "@/hooks/queries/useShowSavedShapes";
import { conToastError } from "@/utilities/utils";
import type { AnyToolKind } from "../tool/toolKind";
import { showShapeLibrary } from "./ShapeLibraryPanel";
import { useSavedShapeLibrary } from "./savedShapeLibrary";
import { isSavedKind, savedShapeOf, type SavedShape } from "./savedShapes";
import { libraryRowsOf, useShapeStarsStore } from "./shapeStars";

/**
 * The host's saved-shape actions (#353): ☆ Save in the chip and the inspector, deleting a saved
 * shape in the library, and keeping a copy in each show that uses one.
 */

/** A shape that can be saved: the open shape, or the selected placed one */
export interface SavableShape {
    readonly kind: AnyToolKind;
    readonly params: unknown;
    readonly spots: number;
}

const showShapes = (queryClient: QueryClient): readonly SavedShape[] =>
    queryClient.getQueryData<SavedShape[]>(showSavedShapeKeys.all()) ?? [];

/**
 * Saves `shape` under `name`: its kind and intervals join the user's library and the open show,
 * and it's starred so it shows up in the Shapes tab and the ring straight away. With every star
 * taken the library opens, asking to unstar one first.
 */
export async function saveShape(
    shape: SavableShape,
    name: string,
    stepPx: number,
    queryClient: QueryClient,
): Promise<SavedShape> {
    const saved = savedShapeOf(shape.kind, shape.params, shape.spots, stepPx, {
        id: crypto.randomUUID(),
        name,
    });
    const library = useSavedShapeLibrary.getState();
    library.put(saved);
    const stars = useShapeStarsStore.getState();
    stars.toggle(
        saved.id,
        libraryRowsOf(
            useSavedShapeLibrary.getState().shapes,
            showShapes(queryClient),
        ),
    );
    if (useShapeStarsStore.getState().asking === saved.id) showShapeLibrary();
    try {
        await copySavedShapeToShow(saved, queryClient);
    } catch (error) {
        conToastError("Couldn't copy the saved shape into the show", error);
    }
    return saved;
}

/**
 * Deletes saved shape `saved` from the user's library and from the open show's copies. Other
 * shows keep their own copy, as they keep the shapes placed from it.
 */
export async function deleteSavedShape(
    saved: SavedShape,
    queryClient: QueryClient,
): Promise<void> {
    useSavedShapeLibrary.getState().remove(saved.id);
    const stars = useShapeStarsStore.getState();
    if (stars.stars.includes(saved.id)) stars.toggle(saved.id, []);
    try {
        await deleteSavedShapeFromShow(saved.id, queryClient);
    } catch (error) {
        conToastError("Couldn't delete the saved shape from the show", error);
    }
}

/** A saved shape only the open show has joins the user's library, for every show */
export function addSavedShapeToLibrary(saved: SavedShape): void {
    useSavedShapeLibrary.getState().put(saved);
}

/**
 * A shape just placed: when it came from a saved shape, the show keeps a copy of that, so it
 * opens with it on a machine whose library doesn't have it
 */
export async function keepSavedShapeInShow(
    kind: AnyToolKind,
    queryClient: QueryClient,
): Promise<void> {
    if (!isSavedKind(kind)) return;
    try {
        await copySavedShapeToShow(kind.saved, queryClient);
    } catch (error) {
        conToastError("Couldn't copy the saved shape into the show", error);
    }
}
