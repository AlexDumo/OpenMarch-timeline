import { toast } from "sonner";
import tolgee from "@/global/singletons/Tolgee";
import {
    saveShapeRecipeInTransaction,
    type ShapeRecipeMember,
} from "@/db-functions/shapeRecipes";
import type { DbTransaction } from "@/db-functions/types";
import { toastTimelineError } from "@/timeline/timelineErrorMessages";
import { currentShapeField, shapeContextFor } from "../field/shapeFieldContext";
import { toolEnvFor } from "../tool/toolEnv";
import type { BoxLeave } from "./boxMembership";
import { closeUp, resplit, type BoxRecipe } from "./placedBox";

/** One toast per box, so marchers leaving two boxes in one edit can fill either */
const leftBoxToastId = (recipeId: number) => `shape-left-box-${recipeId}`;
const LEFT_BOX_TOAST_MS = 8000;

/** Writes `moves` at the edit's moment, saving a recipe beside them in the same undo step */
export type BoxRewrite = (
    moves: readonly { marcherId: number; x: number; y: number }[],
    afterWrite: (tx: DbTransaction, timelineId: number | null) => Promise<void>,
) => Promise<unknown>;

/** A marcher's drill number, else its id */
function nameOf(marcherId: number): string {
    const m = currentShapeField()
        ?.marchers()
        .find((marcher) => marcher.id === marcherId);
    return m?.drill_number ?? `#${marcherId}`;
}

/** The box's remaining members filled in again by `fill`, as one edit */
async function refill(
    leave: BoxLeave,
    rewrite: BoxRewrite,
    fill: (
        marchers: {
            id: number;
            at: { x: number; y: number };
            drillRank: number;
        }[],
    ) => BoxRecipe,
): Promise<void> {
    const out = fill(
        leave.members.map((m: ShapeRecipeMember, i) => ({
            id: m.marcherId,
            at: { x: m.x, y: m.y },
            drillRank: i,
        })),
    );
    try {
        await rewrite(
            out.members.map((m) => ({
                marcherId: m.marcherId,
                x: m.x,
                y: m.y,
            })),
            async (tx, timelineId) => {
                await saveShapeRecipeInTransaction({
                    tx,
                    timelineId,
                    recipe: { ...leave.box.recipe, params: out.params },
                    members: out.members,
                    replaces:
                        timelineId === leave.timelineId
                            ? leave.recipeId
                            : undefined,
                });
            },
        );
    } catch (e) {
        toastTimelineError(e, "Error filling the box");
    }
}

/**
 * After marchers leave a box: "OT3 left the box", with **Close up** and **Re-split** to fill the
 * holes. Ignoring it leaves the holes, and undo puts the marchers back (docs/timeline/research/shapes/07-placed-boxes.md).
 */
export function showLeftBoxToast(
    leaves: readonly BoxLeave[],
    rewrite: BoxRewrite,
): void {
    for (const leave of leaves) showOne(leave, rewrite);
}

function showOne(leave: BoxLeave, rewrite: BoxRewrite): void {
    const field = currentShapeField();
    if (!field) return;
    const ctx = shapeContextFor(field);
    const names = leave.left.map(nameOf);
    const message =
        names.length === 1
            ? tolgee.t("shapes.box.left.one", "{name} left the box", {
                  name: names[0]!,
              })
            : tolgee.t("shapes.box.left.many", "{count} left the box", {
                  count: names.length,
              });
    toast.info(message, {
        id: leftBoxToastId(leave.recipeId),
        duration: LEFT_BOX_TOAST_MS,
        action: {
            label: tolgee.t("shapes.box.left.closeUp", "Close up"),
            onClick: () =>
                void refill(leave, rewrite, (marchers) =>
                    closeUp(leave.box.params, leave.box.spots, marchers, ctx),
                ),
        },
        cancel: {
            label: tolgee.t("shapes.box.left.resplit", "Re-split"),
            onClick: () =>
                void refill(leave, rewrite, (marchers) =>
                    resplit(
                        leave.box.params,
                        leave.box.spots,
                        marchers,
                        toolEnvFor(field, { shift: false, alt: false }),
                        ctx,
                    ),
                ),
        },
        // A toast has two buttons; Undo is the app's own
        description: tolgee.t(
            "shapes.box.left.hint",
            "Their spots stay empty. Undo puts them back.",
        ),
    });
}
