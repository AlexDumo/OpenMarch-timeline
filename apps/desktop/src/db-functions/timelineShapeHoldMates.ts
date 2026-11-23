import { and, eq, gt, inArray, isNull, lt, or } from "drizzle-orm";
import * as schema from "@om-electron/database/migrations/schema";
import type { DbTransaction } from "./types";
import { hasShapeRecipes, shapeRecipesOnly } from "./shapeRecipes";
import {
    HOME_ARRIVAL,
    readArrival,
    readHeldMarks,
    type HeldMark,
} from "./timelineHeldArrival";

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
 * Another member comes along when it is carried there with the selected ones: its own hold would
 * grow out of the same move (or the starting spots), from the same count, and its rows inside the
 * stretch are only in that shape's own move or in moves the selected members of the shape are in
 * there too (a page's own move, which the hold takes away from them anyway). So in a show where
 * every page has a move, holding one member of a box holds the box (owner report, fork #1015).
 * A member that walked off since is left as it is, and so is one in a move of its own inside the
 * stretch (`ownMove`, for the caller to name), as are members a hold can't be made for (the
 * caller's own reasons).
 */

/** What `carriedShapeMates` found: who comes along, and who stays out on a move of their own */
export interface CarriedShapeMates {
    /** Members held with the selected ones, ascending */
    readonly mates: number[];
    /**
     * Members that would come along but have rows inside the stretch in a move of their own (none
     * of the shape's, none the selected members share there), so they stay as they are, ascending
     */
    readonly ownMove: number[];
}

/** What a marcher's hold over the stretch would grow out of: a move, or the starting spots (`null`) */
export interface HoldSource {
    readonly timelineId: number | null;
    /** Where the counts the hold newly covers start */
    readonly from: number;
}

/**
 * The members of the placed shapes `selected` bring along to a hold over `range`, and those left
 * on a move of their own (see the module comment), none of `selected`.
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
): Promise<CarriedShapeMates> {
    const none: CarriedShapeMates = { mates: [], ownMove: [] };
    if (selected.length === 0 || !(await hasShapeRecipes(tx))) return none;
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
    if (wanted.length === 0 && !fromHome) return none;

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

    // Each candidate with the source it must share and the moves its rows inside may be in: the
    // shape's own, and those its linked selected members are in there (whose rows the hold takes
    // away anyway). Per shape, so an unrelated selected marcher changes nothing
    const candidates = new Map<
        number,
        { sources: HoldSource[]; allowedMoves: Set<number> }
    >();
    for (const recipe of recipes.values()) {
        const mates = recipe.members.filter((id) => selectedSet.has(id));
        // Linked through the selected members this shape carries: by its move being their
        // arrival, or by being their own move inside the stretch
        const links: HoldSource[] = [];
        const shared = new Set<number>();
        for (const id of mates) {
            const s = await source(id);
            if (!s) continue;
            const arrives = s.timelineId === recipe.timelineId;
            const own =
                recipe.timelineId !== null &&
                (selectedInside.get(id)?.has(recipe.timelineId) ?? false);
            if (!arrives && !own) continue;
            links.push(s);
            for (const move of selectedInside.get(id) ?? []) shared.add(move);
        }
        if (links.length === 0) continue;
        for (const id of recipe.members) {
            if (selectedSet.has(id)) continue;
            const c = candidates.get(id) ?? {
                sources: [],
                allowedMoves: new Set<number>(),
            };
            c.sources.push(...links);
            if (recipe.timelineId !== null)
                c.allowedMoves.add(recipe.timelineId);
            for (const move of shared) c.allowedMoves.add(move);
            candidates.set(id, c);
        }
    }
    if (candidates.size === 0) return none;

    const candidateInside = await movesInside([...candidates.keys()]);
    const out: number[] = [];
    const ownMove: number[] = [];
    for (const [id, c] of candidates) {
        const own = await source(id);
        // Walked off since: no longer carried there with them
        if (
            !own ||
            !c.sources.some(
                (s) => s.timelineId === own.timelineId && s.from === own.from,
            )
        )
            continue;
        const inside = candidateInside.get(id) ?? new Set<number>();
        if ([...inside].some((move) => !c.allowedMoves.has(move)))
            ownMove.push(id);
        else out.push(id);
    }
    return {
        mates: out.sort((x, y) => x - y),
        ownMove: ownMove.sort((x, y) => x - y),
    };
}

/**
 * **The same hold of the same shape** (owner, 2026-11-15: a shape is Held whole, so it stops being
 * Held whole too). For `marks`, the Held marks of the other members of the placed shapes they're
 * carried in: a mate's mark starts where one of `marks` starts and grows out of the same move (the
 * shape's, `readArrival`) or the same starting spots (a shape at the starting spots). Shortening,
 * splitting or clearing a hold changes these the same way, so the shape is never left partly Held
 * (`setHoldEdge`, `splitHoldAt`, Clear this page). By marcher and start, none of `marks`.
 */
export async function heldShapeMateMarks(
    tx: DbTransaction,
    marks: readonly HeldMark[],
): Promise<HeldMark[]> {
    if (marks.length === 0 || !(await hasShapeRecipes(tx))) return [];
    const r = schema.timeline_shape_recipes;
    const m = schema.timeline_shape_recipe_marchers;
    const given = new Set(marks.map((k) => k.id));
    const out = new Map<number, HeldMark>();
    for (const mark of marks) {
        const arrival = await readArrival(tx, mark.marcherId, mark.start);
        if (arrival === null) continue;
        const timelineId = arrival === HOME_ARRIVAL ? null : arrival.timelineId;
        const recipeIds = (
            await tx
                .select({ id: r.id })
                .from(r)
                .innerJoin(m, eq(m.recipe_id, r.id))
                .where(
                    and(
                        shapeRecipesOnly(),
                        eq(m.marcher_id, mark.marcherId),
                        timelineId === null
                            ? isNull(r.timeline_id)
                            : eq(r.timeline_id, timelineId),
                    ),
                )
                .all()
        ).map((row) => row.id);
        if (recipeIds.length === 0) continue;
        const mateIds = (
            await tx
                .selectDistinct({ marcherId: m.marcher_id })
                .from(m)
                .where(inArray(m.recipe_id, recipeIds))
                .all()
        )
            .map((row) => row.marcherId)
            .filter((id) => id !== mark.marcherId);
        for (const mate of await readHeldMarks(tx, mateIds)) {
            if (mate.start !== mark.start || given.has(mate.id)) continue;
            if (out.has(mate.id)) continue;
            const its = await readArrival(tx, mate.marcherId, mate.start);
            const same =
                its === HOME_ARRIVAL
                    ? timelineId === null
                    : its !== null && its.timelineId === timelineId;
            if (same) out.set(mate.id, mate);
        }
    }
    return [...out.values()].sort(
        (x, y) => x.marcherId - y.marcherId || x.start - y.start,
    );
}
