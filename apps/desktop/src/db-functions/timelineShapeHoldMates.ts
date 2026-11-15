import { and, eq, gt, inArray, isNull, lt, or } from "drizzle-orm";
import * as schema from "@om-electron/database/migrations/schema";
import type { DbTransaction } from "./types";
import { hasShapeRecipes, shapeRecipesOnly } from "./shapeRecipes";

/**
 * **A shape is Held whole** (owner, 2026-11-15: a hold links counts, a shape only arranges
 * marchers). Holding some of a placed shape's members over a stretch holds the rest of it too,
 * when the shape is carried there with them: so editing it inside the hold edits the move it
 * grows out of, members and recipe together, and never splits it across two moves
 * (`oneMoveForShape`).
 *
 * The shapes a selected marcher brings along are the placed shapes (`shapeRecipesOnly`: an
 * ungrouped mark is none)
 *
 * - its hold grows out of (the arrival's recipe, or a recipe at the starting spots for a hold
 *   from them), and
 * - on its own moves inside the stretch, which the hold takes away (a later page's own copy of
 *   the shape).
 *
 * Another member comes along only when it is carried there with the selected one: its own hold
 * would grow out of the same move (or the starting spots), from the same count, and its only rows
 * inside the stretch are in that shape's own move, which the hold takes away anyway. A member that
 * walked off since, or moves on its own inside the stretch, is left as it is, as are members a
 * hold can't be made for (the caller's own reasons, which it doesn't report for them).
 */

/** What a marcher's hold over the stretch would grow out of: a move, or the starting spots (`null`) */
export interface HoldSource {
    readonly timelineId: number | null;
    /** Where the counts the hold newly covers start */
    readonly from: number;
}

/**
 * The members of the placed shapes `selected` bring along to a hold over `range` (see the module
 * comment), ascending, none of `selected`.
 *
 * @param sourceOf what a marcher's hold over `range` would grow out of, or null when nothing
 */
export async function carriedShapeMates(
    tx: DbTransaction,
    {
        selected,
        range,
        sourceOf,
    }: {
        selected: readonly number[];
        range: { readonly start: number; readonly end: number };
        sourceOf: (marcherId: number) => Promise<HoldSource | null>;
    },
): Promise<number[]> {
    if (selected.length === 0 || !(await hasShapeRecipes(tx))) return [];
    const sources = new Map<number, HoldSource | null>();
    const source = async (id: number) => {
        if (!sources.has(id)) sources.set(id, await sourceOf(id));
        return sources.get(id)!;
    };
    const r = schema.timeline_shape_recipes;
    const m = schema.timeline_shape_recipe_marchers;
    const a = schema.timeline_assignments;
    const t = schema.timeline_transitions;

    /** Each marcher's moves with rows inside `range` */
    const movesInside = async (ids: readonly number[]) => {
        const out = new Map<number, Set<number>>();
        if (ids.length === 0) return out;
        const rows = await tx
            .selectDistinct({
                marcherId: a.marcher_id,
                timelineId: t.timeline_id,
            })
            .from(a)
            .innerJoin(t, eq(t.id, a.transition_id))
            .where(
                and(
                    inArray(a.marcher_id, [...ids]),
                    lt(a.start_beat, range.end),
                    gt(a.end_beat, range.start),
                ),
            )
            .all();
        for (const row of rows) {
            const set = out.get(row.marcherId) ?? new Set<number>();
            set.add(row.timelineId);
            out.set(row.marcherId, set);
        }
        return out;
    };

    const selectedSet = new Set(selected);
    const selectedInside = await movesInside(selected);
    const ownMoves = [
        ...new Set([...selectedInside.values()].flatMap((set) => [...set])),
    ];
    const arrivalMoves = new Set<number>();
    let fromHome = false;
    for (const id of selected) {
        const s = await source(id);
        if (!s) continue;
        if (s.timelineId === null) fromHome = true;
        else arrivalMoves.add(s.timelineId);
    }
    const wanted = [...new Set([...arrivalMoves, ...ownMoves])];
    if (wanted.length === 0 && !fromHome) return [];

    const memberRows = await tx
        .select({
            recipeId: r.id,
            timelineId: r.timeline_id,
            marcherId: m.marcher_id,
        })
        .from(m)
        .innerJoin(r, eq(r.id, m.recipe_id))
        .where(
            and(
                shapeRecipesOnly(),
                or(
                    wanted.length > 0
                        ? inArray(r.timeline_id, wanted)
                        : undefined,
                    fromHome ? isNull(r.timeline_id) : undefined,
                ),
            ),
        )
        .all();
    const recipes = new Map<
        number,
        { timelineId: number | null; members: number[] }
    >();
    for (const row of memberRows) {
        const recipe = recipes.get(row.recipeId) ?? {
            timelineId: row.timelineId,
            members: [],
        };
        recipe.members.push(row.marcherId);
        recipes.set(row.recipeId, recipe);
    }

    // Each candidate with the source it must share and the shape moves its rows inside may be in
    const candidates = new Map<
        number,
        { sources: HoldSource[]; shapeMoves: Set<number> }
    >();
    for (const recipe of recipes.values()) {
        const mates = recipe.members.filter((id) => selectedSet.has(id));
        // Linked through the selected members this shape carries: by its move being their
        // arrival, or by being their own move inside the stretch
        const links: HoldSource[] = [];
        for (const id of mates) {
            const s = await source(id);
            if (!s) continue;
            const arrives = s.timelineId === recipe.timelineId;
            const own =
                recipe.timelineId !== null &&
                (selectedInside.get(id)?.has(recipe.timelineId) ?? false);
            if (arrives || own) links.push(s);
        }
        if (links.length === 0) continue;
        for (const id of recipe.members) {
            if (selectedSet.has(id)) continue;
            const c = candidates.get(id) ?? {
                sources: [],
                shapeMoves: new Set<number>(),
            };
            c.sources.push(...links);
            if (recipe.timelineId !== null) c.shapeMoves.add(recipe.timelineId);
            candidates.set(id, c);
        }
    }
    if (candidates.size === 0) return [];

    const candidateInside = await movesInside([...candidates.keys()]);
    const out: number[] = [];
    for (const [id, c] of candidates) {
        const inside = candidateInside.get(id) ?? new Set<number>();
        if ([...inside].some((move) => !c.shapeMoves.has(move))) continue;
        const own = await source(id);
        if (
            own &&
            c.sources.some(
                (s) => s.timelineId === own.timelineId && s.from === own.from,
            )
        )
            out.push(id);
    }
    return out.sort((x, y) => x - y);
}
