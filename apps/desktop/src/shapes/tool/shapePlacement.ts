import type { QueryClient } from "@tanstack/react-query";
import { db } from "@/global/database/db";
import { transactionWithHistory } from "@/db-functions/history";
import {
    leftOutByOtherCounts,
    moveHoldsAnyOf,
    saveShapeRecipeInTransaction,
    type ShapeRecipeMember,
    type ShapeRecipeRecord,
} from "@/db-functions/shapeRecipes";
import { historyKeys } from "@/hooks/queries/useHistory";
import { samePosition } from "@/db-functions/timelineMoves";
import {
    planCanvasEdit,
    timelineCoordinateRecords,
    transformMarchersInSelection,
    type CanvasEditPlan,
} from "@/timeline/timelineCoordinateWrites";
import { withoutLockedMarchers } from "@/timeline/basicLocks";
import { toastTimelineError } from "@/timeline/timelineErrorMessages";
import { TimelineEditRefusedError } from "@/timeline/timelineEditRefusals";
import { isInsideHeldMark } from "@/db-functions/timelineHeldArrival";
import type { HeldMark } from "@/db-functions/timelineHeldArrival";
import { windowWinsOverHold } from "@/timeline/heldRules";
import { showLeftOutToast } from "../placed/leftOutToast";
import { invalidatePlacedBoxes, placedBoxesAt } from "../placed/placedBoxStore";
import type { ShapeContext } from "../types";
import { orderOf, targetsOf, type ToolState } from "./toolMachine";

/**
 * What placing a shape writes: its recipe, and where each member stands in it (ADR 0006). Spots
 * and who goes where are separate: `recipe.params.spots` counts the spots, `members` says who
 * stands on which.
 */
export interface ShapePlacement {
    readonly recipe: ShapeRecipeRecord;
    readonly members: readonly ShapeRecipeMember[];
    /**
     * The recipe this placement edits (a placed shape changed again): replaced when it belongs to
     * the move being written, kept as the earlier move's own otherwise
     */
    readonly replaces?: {
        readonly id: number;
        readonly timelineId: number | null;
    };
    /**
     * Set every member even when nobody moves. The caller decides when: a shape changed on a later
     * page it's only carried onto (`commitBox`), so that page gets its own copy for a change that
     * moves no one (its pivot), and the earlier page keeps its own
     */
    readonly setAll?: boolean;
    /**
     * Save no recipe (a kind that's `loose`, #961): the members go to their spots as a plain move
     * of marchers does, and any shape they stood in loses them
     */
    readonly plain?: boolean;
}

/**
 * A shape's positions go to one move: its recipe is saved with that move (ADR 0006), so a shape
 * can't be split across two. An edit writes Held marchers to the moves arriving at their holds and
 * the rest to the window's move, calling its after-write step once per move
 * (`TimelineAfterWrite`). Returns, for each call, the members whose positions went there (none:
 * nothing to save there), and throws `shapePartlyHeld` once a second move gets some, so the edit
 * rolls back and says why: a shape is Held whole or not at all.
 */
export function oneMoveForShape(
    memberIds: readonly number[],
): (written: readonly number[]) => number[] {
    let moves = 0;
    return (written) => {
        const here = new Set(written);
        const mine = memberIds.filter((id) => here.has(id));
        if (mine.length === 0) return mine;
        if (++moves > 1)
            throw new TimelineEditRefusedError("shapePartlyHeld", {
                marcherIds: [...memberIds].sort((a, b) => a - b),
            });
        return mine;
    };
}

/**
 * Whether an edit at `plan` would write some of `memberIds` to the moves their holds grow out of
 * and the rest elsewhere: some are inside a Held mark at the edit's count and some aren't (an Expert
 * window starting inside a hold wins over it, `windowWinsOverHold`, as the write decides). The
 * shape tool asks before it shows an edit as saved, so it can refuse at once rather than snap back;
 * `oneMoveForShape` is the write's own check.
 */
export function partlyHeldAt(
    memberIds: readonly number[],
    plan: CanvasEditPlan,
    marks: readonly HeldMark[],
): boolean {
    if (!plan.ok || memberIds.length < 2) return false;
    const { target } = plan;
    if (target.kind !== "range" && target.kind !== "point") return false;
    const beat = target.kind === "range" ? target.end : target.beat;
    const heldIds = new Set(
        marks
            .filter(
                (m) =>
                    isInsideHeldMark(m, beat) &&
                    (target.kind !== "range" ||
                        !windowWinsOverHold(target.start, m)),
            )
            .map((m) => m.marcherId),
    );
    const held = memberIds.filter((id) => heldIds.has(id)).length;
    return held > 0 && held < memberIds.length;
}

/** What placing the open shape would write; null while there is nothing to place */
export function placementOf(
    tool: ToolState,
    ctx: ShapeContext,
): ShapePlacement | null {
    if (tool.gesture || tool.params === null) return null;
    const targets = targetsOf(tool, ctx);
    if (targets.length === 0) return null;
    const kind = tool.kind.shape;
    return {
        recipe: {
            kind: kind.id,
            kindVersion: kind.version,
            // The spot count keeps holes when members leave later
            params: {
                ...((tool.kind.forPlacing?.(tool.params) ??
                    tool.params) as object),
                spots: tool.spots,
            },
            // Least travel, or a Line's order (#528); drill order is gone (#429)
            ...orderOf(tool),
        },
        members: targets.map((t) => ({
            marcherId: t.id,
            slot: t.slot,
            x: t.to.x,
            y: t.to.y,
        })),
        ...(tool.kind.loose && { plain: true }),
    };
}

/**
 * Whether writing `placement` at `beat` would change nothing: nobody moves, and its members are
 * plain dots placed plain or already stand as one placed shape of its kind (a paste onto the same
 * marchers again). Placing it then writes nothing, so it costs no undo step.
 */
export function placesNothing(
    placement: ShapePlacement,
    beat: number,
): boolean {
    const ids = placement.members.map((m) => m.marcherId);
    let now: readonly { marcher_id: number; x: number; y: number }[];
    try {
        now = timelineCoordinateRecords(beat, ids);
    } catch {
        return false;
    }
    const to = new Map(placement.members.map((m) => [m.marcherId, m]));
    const nobodyMoves =
        now.length === ids.length &&
        now.every((c) => {
            const spot = to.get(c.marcher_id);
            return (
                spot !== undefined && samePosition([c.x, c.y], [spot.x, spot.y])
            );
        });
    if (!nobodyMoves) return false;
    if (placement.plain) return true;
    return placedBoxesAt(beat).some(
        (box) =>
            box.recipe.kind === placement.recipe.kind &&
            box.recipe.members.length === to.size &&
            box.recipe.members.every((m) => to.has(m.marcherId)),
    );
}

/**
 * Writes a placement: the one write behind every shape placed (#344), a new one (`placeShape`)
 * or an edit of a placed one (`commitBox`). Its members move to their spots through the same path as a canvas drag (they
 * leave the start flag and arrive at the playhead), and the recipe is saved in the same edit, so
 * the two are one undo step. False when the write failed (a toast says why).
 *
 * In Basic, a marcher whose last mid-page position on the page is at another count than the
 * others' arrives at the flag in a move of its own, so the recipe can't list it (ADR 0006): it
 * is set on its spot, and a toast names it, since Basic shows no moves (`showLeftOutToast`).
 */
export async function writePlacement(
    placement: ShapePlacement,
    queryClient: QueryClient,
    /** The toast's title if the write fails */
    failure: string,
    /**
     * The edit window to write to, the current one unless given: a shape placed because the
     * moment moved on goes where it was drawn, and the playhead stays where it was moved to
     */
    plan: CanvasEditPlan | null = null,
    /** Inside isolation, leave the playhead where it is; always with a `plan`, unless told */
    keepPlayhead: boolean = plan !== null,
): Promise<boolean> {
    const { members, replaces } = placement;
    const to = new Map(members.map((m) => [m.marcherId, m]));
    const marcherIds = members.map((m) => m.marcherId);
    let saved = false;
    let skippedSome = false;
    const inThisMove = oneMoveForShape(marcherIds);
    const spotsOf = (current: readonly { readonly marcher_id: number }[]) =>
        current.flatMap((c) => {
            const spot = to.get(c.marcher_id);
            return spot
                ? [{ marcher_id: c.marcher_id, x: spot.x, y: spot.y }]
                : [];
        });
    let leftOut: number[] = [];
    try {
        if (placement.plain) {
            // Plain marchers moved to their spots: no recipe, and nobody set who doesn't move
            await transformMarchersInSelection({
                db,
                marcherIds,
                transform: spotsOf,
                ...(plan ? { plan } : {}),
                keepPlayhead,
            });
            void queryClient.invalidateQueries({ queryKey: historyKeys.all() });
            return true;
        }
        const edit = plan ?? planCanvasEdit();
        const basic = edit.ok && edit.target.kind === "point";
        // Locked marchers aren't moved (V-203) and have their own toast, so aren't named as left out
        const locked = new Set(
            edit.ok
                ? withoutLockedMarchers(
                      edit.target,
                      marcherIds.map((marcherId) => ({ marcherId })),
                  ).locked
                : [],
        );
        await transformMarchersInSelection({
            db,
            marcherIds,
            transform: spotsOf,
            plan: edit,
            keepPlayhead,
            writesShapes: true,
            // Every member is set where the shape is, the one at its pivot included, so each
            // is in the move its recipe keeps; a change that moves nobody sets no one, unless
            // `setAll`
            setUnmoved: true,
            setAll: placement.setAll,
            onWritten: (result) => {
                skippedSome = result.skipped !== undefined;
            },
            afterWrite: async (tx, timelineId, written) => {
                if (inThisMove(written).length === 0) return false;
                // A move none of the members are in would keep no one: the edit moved nobody there,
                // and is saved below instead (#485)
                if (!(await moveHoldsAnyOf(tx, timelineId, marcherIds)))
                    return false;
                saved = true;
                await saveShapeRecipeInTransaction({
                    tx,
                    timelineId,
                    recipe: placement.recipe,
                    members,
                    replaces:
                        replaces && replaces.timelineId === timelineId
                            ? replaces.id
                            : undefined,
                });
                if (basic && timelineId !== null)
                    leftOut = await leftOutByOtherCounts(
                        tx,
                        timelineId,
                        marcherIds.filter((id) => !locked.has(id)),
                    );
            },
        });
        showLeftOutToast(leftOut);
        // Nobody moved and no move here holds the shape's members (a change without `setAll`):
        // the change goes to the recipe shown, in its own move. Not when the edit left members
        // alone (a hold growing out of a follow-the-leader move): their shape didn't change
        if (!saved && replaces && !skippedSome) {
            await transactionWithHistory(db, "editShapeRecipe", (tx) =>
                saveShapeRecipeInTransaction({
                    tx,
                    timelineId: replaces.timelineId,
                    recipe: placement.recipe,
                    members,
                    replaces: replaces.id,
                }),
            );
            invalidatePlacedBoxes();
        }
    } catch (e) {
        toastTimelineError(e, failure);
        return false;
    }
    // Not a React Query mutation, so refresh what one would
    void queryClient.invalidateQueries({ queryKey: historyKeys.all() });
    return true;
}
