/**
 * A line's order set by hand (pathways step 4g, DL-26..DL-29): Set order, Reverse and Clear order.
 *
 * The order is stored as an **order mark**, a shape recipe of kind `order` (or `orderClear` for
 * Clear) in the move whose end is the displayed beat, so `rememberedOrder` reads it as any other
 * form, by the beat its move ends at. A mark stores no shape and moves no one: placed shapes don't
 * show it, and it doesn't take its marchers out of the shapes they're in. A shape placed later at
 * its beat takes them out of it (the later form wins), and so does another mark there.
 *
 * Reusing the recipe tables needs no schema change (v0.1.7 files have none of them; the app's own
 * migrations add them), and an older build skips a kind it doesn't know.
 */
import { and, asc, desc, eq, inArray, lte } from "drizzle-orm";
import { schema } from "@/global/database/db";
import { transactionWithHistory } from "./history";
import {
    ORDER_CLEAR_RECIPE_KIND,
    ORDER_RECIPE_KIND,
    saveShapeRecipeInTransaction,
    type ShapeRecipeRecord,
} from "./shapeRecipes";
import type { DbConnection, DbTransaction } from "./types";

type XY = { readonly x: number; readonly y: number };

/** What an order mark stores: its slots (no holes when made) and nothing else */
const orderRecipe = (kind: string, spots: number): ShapeRecipeRecord => ({
    kind,
    kindVersion: 1,
    params: { spots },
    orderMode: "keep",
    reverse: false,
});

/**
 * The move an order said about the field at `beat` is made in: the latest move ending at or before
 * `beat` (the one ending at it when the playhead is on a page flag) that holds any of
 * `marcherIds`, so the mark sits with their positions; the first of those ending together. Only
 * when no such move holds any of them, the latest move ending by then. The homes (null) when none
 * ends by then.
 */
export async function orderMoveAt(
    tx: DbConnection | DbTransaction,
    beat: number,
    marcherIds: readonly number[],
): Promise<number | null> {
    const T = schema.timelines;
    if (marcherIds.length > 0) {
        const A = schema.timeline_assignments;
        const TR = schema.timeline_transitions;
        const holding = await tx
            .selectDistinct({ id: T.id, end: T.end_beat })
            .from(T)
            .innerJoin(TR, eq(TR.timeline_id, T.id))
            .innerJoin(A, eq(A.transition_id, TR.id))
            .where(
                and(
                    lte(T.end_beat, beat),
                    inArray(A.marcher_id, [...marcherIds]),
                ),
            )
            .orderBy(desc(T.end_beat), asc(T.id))
            .limit(1)
            .get();
        if (holding) return holding.id;
    }
    const last = await tx
        .select({ id: T.id })
        .from(T)
        .where(lte(T.end_beat, beat))
        .orderBy(desc(T.end_beat), asc(T.id))
        .limit(1)
        .get();
    return last?.id ?? null;
}

/**
 * Sets the order of `order`'s marchers (leader first) at `beat`: an order mark in the move it's
 * made in (`orderMoveAt`). `at` is where each stands, kept with the mark for reference.
 *
 * @returns the mark's recipe id
 */
export async function setMarcherOrderInTransaction(
    tx: DbTransaction,
    {
        beat,
        order,
        at,
    }: {
        beat: number;
        order: readonly number[];
        at?: ReadonlyMap<number, XY>;
    },
): Promise<number> {
    const ids = [...new Set(order)];
    if (ids.length < 2) throw new Error("An order needs two or more marchers");
    return await saveShapeRecipeInTransaction({
        tx,
        timelineId: await orderMoveAt(tx, beat, ids),
        recipe: orderRecipe(ORDER_RECIPE_KIND, ids.length),
        members: ids.map((marcherId, slot) => ({
            marcherId,
            slot,
            x: at?.get(marcherId)?.x ?? 0,
            y: at?.get(marcherId)?.y ?? 0,
        })),
    });
}

/**
 * Ends the order of `marcherIds` at `beat` (Clear order): a clearing mark in the move it's made
 * in, so their order is guessed again from there on, until a later form sets one
 */
export async function clearMarcherOrderInTransaction(
    tx: DbTransaction,
    { beat, marcherIds }: { beat: number; marcherIds: readonly number[] },
): Promise<number> {
    const ids = [...new Set(marcherIds)];
    if (ids.length === 0) throw new Error("No marchers to clear");
    return await saveShapeRecipeInTransaction({
        tx,
        timelineId: await orderMoveAt(tx, beat, ids),
        recipe: orderRecipe(ORDER_CLEAR_RECIPE_KIND, ids.length),
        members: ids.map((marcherId, slot) => ({
            marcherId,
            slot,
            x: 0,
            y: 0,
        })),
    });
}

/** Set order (and Reverse, which sets the order shown, turned round) as one undo step */
export async function setMarcherOrder(
    db: DbConnection,
    args: Parameters<typeof setMarcherOrderInTransaction>[1] & {
        /** The history entry's name */
        operation?: "setMarcherOrder" | "reverseMarcherOrder";
    },
): Promise<number> {
    const { operation = "setMarcherOrder", ...rest } = args;
    return await transactionWithHistory(db, operation, (tx) =>
        setMarcherOrderInTransaction(tx, rest),
    );
}

/** Clear order as one undo step */
export async function clearMarcherOrder(
    db: DbConnection,
    args: Parameters<typeof clearMarcherOrderInTransaction>[1],
): Promise<number> {
    return await transactionWithHistory(db, "clearMarcherOrder", (tx) =>
        clearMarcherOrderInTransaction(tx, args),
    );
}

/** Every marcher's id, for reading every form in the show (Show order's Always) */
export async function readAllMarcherIds(
    db: DbConnection | DbTransaction,
): Promise<number[]> {
    return (
        await db.select({ id: schema.marchers.id }).from(schema.marchers).all()
    ).map((m) => m.id);
}
