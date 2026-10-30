import type { MutationOptions, QueryClient } from "@tanstack/react-query";
import {
    createSavedShapeMutationOptions,
    deleteSavedShapeMutationOptions,
    savedShapeKeys,
} from "@/hooks/queries/useSavedShapes";
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
    queryClient.getQueryData<SavedShape[]>(savedShapeKeys.all()) ?? [];

/**
 * Runs a mutation outside a component, as `useMutation` would: its own invalidation and error
 * toast included. Resolves either way; a failure is the mutation's toast.
 */
async function mutate<V>(
    queryClient: QueryClient,
    options: MutationOptions<void, Error, V>,
    variables: V,
): Promise<void> {
    await queryClient
        .getMutationCache()
        .build(queryClient, options)
        .execute(variables)
        .catch(() => {});
}

/**
 * Saves `shape` under `name`, with `description` when there is one: its kind, intervals and
 * distribution join the user's library and the open show, dated now, and it's starred so it shows
 * up in the Shapes tab and the ring straight away. With every star taken the library opens,
 * asking to unstar one first.
 */
export async function saveShape(
    shape: SavableShape,
    named: { readonly name: string; readonly description?: string },
    stepPx: number,
    queryClient: QueryClient,
): Promise<SavedShape> {
    const saved = savedShapeOf(shape.kind, shape.params, shape.spots, stepPx, {
        ...named,
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
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
    await mutate(
        queryClient,
        createSavedShapeMutationOptions(queryClient),
        saved,
    );
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
    await mutate(
        queryClient,
        deleteSavedShapeMutationOptions(queryClient),
        saved.id,
    );
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
    await mutate(
        queryClient,
        createSavedShapeMutationOptions(queryClient),
        kind.saved,
    );
}
