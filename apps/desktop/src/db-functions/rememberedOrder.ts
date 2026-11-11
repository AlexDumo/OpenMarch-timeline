/**
 * The order the show remembers for a line of marchers (pathways step 4f, DL-21): the Follow tool
 * reads it instead of guessing the order from where the marchers stand.
 *
 * A **form** is something the show stored that puts marchers in a sequence, or that ends one:
 *
 * - a follow trail (`readTrails`): its members by slot, the order they walk in;
 * - a placed Line or Arc (a shape recipe whose spots run along it): its members by slot, with the
 *   slots of members who left by hand kept as holes;
 * - any other placed shape (a box, a circle, a group) or an ungrouped mark: it takes the marchers
 *   into something with no line order, so it ends the order they had.
 *
 * An order holds, like a placed shape, until a later form takes the marchers. Moving one marcher by
 * hand doesn't end it: the shape it leaves keeps its spot as a hole, and a shape with holes that
 * agrees with the order in force only carries it on.
 */
import { and, eq, inArray } from "drizzle-orm";
import { schema } from "@/global/database/db";
import { readShapeRecipesOf, UNGROUPED_RECIPE_KIND } from "./shapeRecipes";
import { readTimelineEndBeats } from "./timelines";
import { readTrails, type MoveTrail } from "./timelineTrails";
import type { DbConnection, DbTransaction } from "./types";

/** A form stored in the show, as the order rule reads it */
export type OrderForm =
    | {
          /** The beat the form is made at: its move's end (0 for homes) */
          readonly endBeat: number;
          readonly kind: "trail" | "line";
          /**
           * The members from one end to the other, by slot; null where a slot is a hole (a member
           * who moved off it by hand)
           */
          readonly order: readonly (number | null)[];
      }
    | {
          readonly endBeat: number;
          /** A shape with no line order, or an ungrouped mark: the order its members had ends */
          readonly kind: "clear";
          readonly marcherIds: readonly number[];
      };

const membersOf = (form: OrderForm): readonly number[] =>
    form.kind === "clear"
        ? form.marcherIds
        : form.order.filter((m): m is number => m !== null);

/** At the same beat a clear goes first, then shapes, then trails: what they walk in has the last word */
const TIE: Record<OrderForm["kind"], number> = { clear: 0, line: 1, trail: 2 };

/**
 * Whether `members` (in order) is `order` kept to just them: a copy of the form in force with some
 * members gone, which carries the order on rather than redefining it
 */
function agrees(
    order: readonly (number | null)[],
    members: readonly number[],
): boolean {
    const inOrder = new Set(order);
    if (!members.every((m) => inOrder.has(m))) return false;
    const keep = new Set(members);
    const kept = order.filter((m): m is number => m !== null && keep.has(m));
    return kept.every((m, i) => m === members[i]);
}

/**
 * The remembered order of `ids` at `beat` (the follow window's start flag), or null when the show
 * doesn't remember one and the order is guessed.
 *
 * The forms made at or before `beat` that hold any of `ids` are read oldest first; each takes the
 * marchers it holds. A form with no line order (or an ungrouped mark) ends the order; a trail or a
 * placed Line or Arc sets it, unless it has holes and agrees with the order in force, which it
 * then carries on. The order in force must hold every one of `ids`, and is returned kept to them
 * (every other marcher of a line gives the 1st, 3rd, 5th…). One of `ids` missing from it while it
 * has exactly one hole goes back in that hole only when it's known they left it: the order before
 * that form held them there, or there was no order before it and they are in no form at all (a
 * shape saved, in its own move, with the hole they left). Anyone else is a stranger to the line.
 */
export function rememberedOrder(
    forms: readonly OrderForm[],
    ids: readonly number[],
    beat: number,
): number[] | null {
    const want = new Set(ids);
    if (want.size === 0) return null;
    const relevant = forms
        .filter(
            (f) =>
                f.endBeat <= beat + 1e-9 &&
                membersOf(f).some((m) => want.has(m)),
        )
        .sort((a, b) => a.endBeat - b.endBeat || TIE[a.kind] - TIE[b.kind]);
    let order: readonly (number | null)[] | null = null;
    /** The order in force before `order` was set, which may say who left its holes */
    let before: readonly (number | null)[] | null = null;
    for (const form of relevant) {
        if (form.kind === "clear") {
            order = null;
            before = null;
            continue;
        }
        const holes = form.order.some((m) => m === null);
        if (holes && order && agrees(order, membersOf(form))) continue;
        before = order;
        order = form.order;
    }
    if (!order) return null;
    const kept = order.filter((m) => m === null || want.has(m));
    const missing = [...want].filter((m) => !order.includes(m));
    if (missing.length === 0)
        return kept.filter((m): m is number => m !== null);
    if (missing.length !== 1 || order.filter((m) => m === null).length !== 1)
        return null;
    // The one who left the one hole, back where they were, if it's known they stood there
    const back = kept.map((m) => m ?? missing[0]!);
    const left = before
        ? agrees(before, back)
        : !relevant.some((f) => membersOf(f).includes(missing[0]!));
    return left ? back : null;
}

/** The kinds of placed shape whose spots run in an order along them: a Line and an Arc */
const LINE_KINDS: ReadonlySet<string> = new Set(["line", "arc"]);

/**
 * The forms that hold any of `marcherIds`: their trails, and the shape recipes and ungrouped marks
 * they are in. A form in a move that's gone is skipped.
 */
export async function readOrderForms(
    db: DbConnection | DbTransaction,
    marcherIds: readonly number[],
): Promise<OrderForm[]> {
    if (marcherIds.length === 0) return [];
    const want = new Set(marcherIds);
    const recipes = await readShapeRecipesOf({ db, marcherIds });
    // Only the moves where any of them follows a trail
    const T = schema.timeline_transitions;
    const A = schema.timeline_assignments;
    const trailMoves = await db
        .selectDistinct({ timelineId: T.timeline_id })
        .from(A)
        .innerJoin(T, eq(T.id, A.transition_id))
        .where(
            and(
                inArray(A.marcher_id, [...want]),
                eq(T.path_style, "follow_the_leader"),
            ),
        )
        .all();
    const trails: MoveTrail[] = [];
    for (const { timelineId } of trailMoves)
        for (const trail of await readTrails(db, timelineId))
            if (trail.marcherIds.some((m) => want.has(m))) trails.push(trail);
    const ends = await readTimelineEndBeats(db, [
        ...recipes.flatMap((r) =>
            r.timelineId === null ? [] : [r.timelineId],
        ),
        ...trails.map((t) => t.timelineId),
    ]);
    const forms: OrderForm[] = [];
    for (const recipe of recipes) {
        const endBeat =
            recipe.timelineId === null ? 0 : ends.get(recipe.timelineId);
        if (endBeat === undefined || recipe.members.length === 0) continue;
        if (
            recipe.kind === UNGROUPED_RECIPE_KIND ||
            !LINE_KINDS.has(recipe.kind)
        ) {
            forms.push({
                endBeat,
                kind: "clear",
                marcherIds: recipe.members.map((m) => m.marcherId),
            });
            continue;
        }
        const stored = (recipe.params as { spots?: unknown } | null)?.spots;
        const top = Math.max(-1, ...recipe.members.map((m) => m.slot));
        const spots = Math.max(
            typeof stored === "number" && Number.isInteger(stored) ? stored : 0,
            top + 1,
        );
        const order: (number | null)[] = Array.from(
            { length: spots },
            () => null,
        );
        for (const m of recipe.members) order[m.slot] = m.marcherId;
        forms.push({ endBeat, kind: "line", order });
    }
    for (const trail of trails) {
        const endBeat = ends.get(trail.timelineId);
        if (endBeat === undefined) continue;
        forms.push({ endBeat, kind: "trail", order: trail.marcherIds });
    }
    return forms;
}

/** The remembered order of `ids` at `beat` as the show has it now (`rememberedOrder`), or null */
export async function rememberedOrderAt(
    db: DbConnection | DbTransaction,
    ids: readonly number[],
    beat: number,
): Promise<number[] | null> {
    return rememberedOrder(await readOrderForms(db, ids), ids, beat);
}
