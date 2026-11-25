import {
    readShapeRecipe,
    readShapeRecipesOf,
    saveShapeRecipeInTransaction,
    type ShapeRecipeMember,
} from "@/db-functions/shapeRecipes";
import { readTimelineEndBeats } from "@/db-functions/timelines";
import type { DbTransaction } from "@/db-functions/types";
import type { ShapeContext, XY } from "../types";
import { currentShapeField, shapeContextFor } from "../field/shapeFieldContext";
import {
    boxesAt,
    membershipAfter,
    movedBox,
    transformedBox,
    withoutMembers,
    type MembershipChange,
    type PlacedBox,
    type StoredParams,
} from "./placedBox";

/** Marchers that left a box in an edit, and the box as it was saved without them */
export interface BoxLeave {
    readonly recipeId: number;
    readonly timelineId: number | null;
    readonly left: readonly number[];
    readonly box: PlacedBox;
    /** Who is still in the box, on their spots */
    readonly members: readonly ShapeRecipeMember[];
}

/**
 * Keeps placed boxes true to the field through a coordinate edit
 * (docs/timeline/research/shapes/07-placed-boxes.md): `afterWrite` runs inside the edit, after its
 * positions are written, and saves what the edit did to the boxes it touched, in the same undo
 * step.
 *
 * - Every member of a box moved the same way: the box moves.
 * - Every member went through one turn, even scale or mirror (a selection's handles, #1236): the
 *   shape goes with them, its kind, count and links kept, where its kind can follow
 *   (`transformedBox`).
 * - Some members moved off their spots: they leave, and their spots stay as holes. `leaves` lists
 *   them after the edit, for the toast that offers to fill the holes.
 *
 * A box placed in an earlier move and held to this moment is saved as a copy on this edit's move;
 * the earlier one stays as it was.
 *
 * @param beat the moment the edit writes at
 * @param positionOf where a marcher stands at `beat` before the edit (the resolver, which doesn't
 *   have the edit yet while it is inside its transaction)
 * @param ctx how shapes lay out on the field, to take one through a turn or scale; the field's
 *   when omitted, and without a field such a shape's members leave it
 */
export function boxMembershipEdit({
    moves,
    beat,
    positionOf,
    ctx = fieldContext(),
}: {
    moves: readonly { marcherId: number; x: number; y: number }[];
    beat: number;
    positionOf: (marcherId: number) => XY | undefined;
    ctx?: ShapeContext | null;
}): {
    afterWrite: (
        tx: DbTransaction,
        timelineId: number | null,
    ) => Promise<boolean>;
    readonly leaves: readonly BoxLeave[];
} {
    const leaves: BoxLeave[] = [];
    const moved = new Map(
        moves.map((m) => [m.marcherId, { x: m.x, y: m.y }] as const),
    );
    return {
        leaves,
        async afterWrite(tx, timelineId) {
            const recipes = await readShapeRecipesOf({
                db: tx,
                marcherIds: [...moved.keys()],
            });
            if (recipes.length === 0) return false;
            const ends = await readTimelineEndBeats(
                tx,
                recipes.flatMap((r) =>
                    r.timelineId === null ? [] : [r.timelineId],
                ),
            );
            const boxes = boxesAt({
                recipes,
                endBeatOf: (id) => (id === null ? 0 : ends.get(id)),
                beat,
                positionOf,
            });
            let wrote = false;
            // A member dragged by hand keeps an order set by hand (pathways step 4g)
            const into = { tx, timelineId, keepOrderMarks: true };
            for (const box of boxes) {
                const change = membershipAfter(box, moved);
                if (change.type === "none") continue;
                const own = box.recipe.timelineId === timelineId;
                const out = followed(box, change, moved, ctx);
                const recipeId = await saveShapeRecipeInTransaction({
                    ...into,
                    recipe: { ...box.recipe, params: out.params },
                    members: out.members,
                    replaces: own ? box.recipe.id : undefined,
                });
                if (out.left.length > 0) {
                    // Who is in it as saved: the save leaves out marchers not in this move,
                    // and deletes a recipe it left with no one
                    const saved = await readShapeRecipe(tx, recipeId);
                    if (saved && saved.members.length > 0)
                        leaves.push({
                            recipeId,
                            timelineId,
                            left: out.left,
                            box,
                            members: saved.members,
                        });
                }
                wrote = true;
            }
            return wrote;
        },
    };
}

/**
 * What `box` is saved as after `change`: moved with its members, or turned and scaled where its
 * kind can follow (its members where the edit wrote them, `moved`), or else without the members
 * that `left` it, their spots kept as holes
 */
function followed(
    box: PlacedBox,
    change: Exclude<MembershipChange, { type: "none" }>,
    moved: ReadonlyMap<number, XY>,
    ctx: ShapeContext | null,
): {
    params: StoredParams;
    members: readonly ShapeRecipeMember[];
    left: readonly number[];
} {
    if (change.type === "move")
        return { ...movedBox(box, change.delta), left: [] };
    const out =
        change.type === "transform" && ctx
            ? transformedBox(box, change.sim, ctx)
            : null;
    if (out)
        return {
            params: out.params,
            members: out.members.map((m) => ({
                ...m,
                ...(moved.get(m.marcherId) ?? {}),
            })),
            left: [],
        };
    const kept = withoutMembers(box.recipe, change.left);
    return {
        params: kept.params as StoredParams,
        members: kept.members,
        left: change.left,
    };
}

/** How shapes lay out on the field shown now; null without one */
function fieldContext(): ShapeContext | null {
    const field = currentShapeField();
    return field ? shapeContextFor(field) : null;
}
