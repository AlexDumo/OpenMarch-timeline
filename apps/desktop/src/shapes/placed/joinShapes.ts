import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import tolgee from "@/global/singletons/Tolgee";
import type { ShapeRecipeRecord } from "@/db-functions/shapeRecipes";
import {
    planCanvasEdit,
    timelinePositionsSettled,
} from "@/timeline/timelineCoordinateWrites";
import { toastTimelineError } from "@/timeline/timelineErrorMessages";
import { queueHistoryStep } from "@/shortcuts/handlers/historyQueue";
import {
    displayedBeat,
    useTimelineSelectionStore,
} from "@/stores/TimelineSelectionStore";
import { orderFields } from "../assign";
import { arcTool } from "../arc/arcTool";
import { boxTool } from "../box/boxTool";
import { circleTool } from "../circle/circleTool";
import { currentShapeField, shapeContextFor } from "../field/shapeFieldContext";
import { isClosed, type LineParams } from "../line/lineGeometry";
import { joinLines } from "../line/lineJoin";
import { lineShape } from "../line/lineShape";
import { lineTool } from "../line/lineTool";
import { writePlacement, type ShapePlacement } from "../tool/shapePlacement";
import type { ShapeContext } from "../types";
import { carriedOnto, storedBox } from "./commitBox";
import type { PlacedBox } from "./placedBox";
import { placedBoxesRead } from "./placedBoxStore";

/**
 * **Join into one line** (#1220, epic #1216): two placed Lines, Curves or Arcs on the same move
 * become one Line, as one undo step. Their nearest ends meet (`joinLines`), and their marchers are
 * spread evenly along the whole joined line, one on the joint.
 */

/** Whether `box` is a Line, Curve or Arc: all Line recipes, so they can join */
export const isLineKind = (box: PlacedBox): box is PlacedBox<LineParams> =>
    box.kind === lineTool || box.kind === arcTool;

/**
 * Whether the selection can be joined, and why not: two placed shapes to join (`a` placed first),
 * or the reason it can't. `onShapes` says the selection is placed shapes (one with a Line among
 * them, or several), where the field's menu offers Join even while it can't run, greyed with its
 * reason; on other selections the menu leaves it out, and only the command palette lists it.
 */
export type JoinCheck =
    | {
          readonly ok: true;
          readonly a: PlacedBox<LineParams>;
          readonly b: PlacedBox<LineParams>;
      }
    | {
          readonly ok: false;
          readonly reason: string;
          readonly onShapes: boolean;
      };

const needsTwo = () =>
    tolgee.t(
        "shapes.placed.joinNeedsTwo",
        "Select two shapes to join: lines, curves or arcs",
    );

/**
 * Whether the marchers `selected` can be joined into one line, among the placed shapes `boxes`
 * shown where they're selected: exactly two shapes selected whole and nothing else, each a Line,
 * Curve or Arc, neither closed, both placed on the same move.
 */
export function joinCheck(
    selected: ReadonlySet<number>,
    boxes: readonly PlacedBox[],
): JoinCheck {
    const whole = boxes.filter(
        (b) =>
            b.recipe.members.length > 0 &&
            b.recipe.members.every((m) => selected.has(m.marcherId)),
    );
    const covered = whole.reduce((n, b) => n + b.recipe.members.length, 0);
    if (selected.size === 0 || covered !== selected.size)
        return { ok: false, reason: needsTwo(), onShapes: false };
    if (whole.length !== 2)
        return {
            ok: false,
            reason: needsTwo(),
            onShapes: whole.length > 1 || whole.some(isLineKind),
        };
    const [a, b] = [...whole].sort((x, y) => x.recipe.id - y.recipe.id) as [
        PlacedBox,
        PlacedBox,
    ];
    const refused = (reason: string): JoinCheck => ({
        ok: false,
        reason,
        onShapes: true,
    });
    if (!isLineKind(a) || !isLineKind(b)) {
        const boxOrCircle = [a, b].some(
            (s) => s.kind === boxTool || s.kind === circleTool,
        );
        return refused(
            boxOrCircle
                ? tolgee.t(
                      "shapes.placed.joinBoxOrCircle",
                      "Only lines, curves and arcs can be joined",
                  )
                : tolgee.t(
                      "shapes.placed.joinNotLine",
                      "Only lines, curves and arcs can be joined",
                  ),
        );
    }
    if (isClosed(a.params) || isClosed(b.params))
        return refused(
            tolgee.t(
                "shapes.placed.joinClosed",
                "A closed line has no ends to join",
            ),
        );
    if (a.recipe.timelineId !== b.recipe.timelineId)
        return refused(
            tolgee.t(
                "shapes.placed.joinOtherMoves",
                "These shapes were placed on different moves: join shapes from the same move",
            ),
        );
    return { ok: true, a, b };
}

/**
 * What joining `a` and `b` saves: one Line recipe (Least travel, as a Line drawn new) whose
 * members are both shapes' members, spread evenly along it in Fit, `a`'s in their order along it
 * and then `b`'s. Holes are dropped: the joined line has one spot a member.
 */
export function joinedPlacement(
    a: PlacedBox<LineParams>,
    b: PlacedBox<LineParams>,
    ctx: ShapeContext,
): Pick<ShapePlacement, "recipe" | "members"> {
    const joined = joinLines(a.params, b.params, ctx.stepPx);
    const n = a.recipe.members.length + b.recipe.members.length;
    const slots = lineShape.generate(joined.params, n, ctx);
    // Each member's place along the joined line: its spot along its own line, that line's way
    // round in the joined one, `b`'s after all of `a`'s spots
    const along = (box: PlacedBox, reversed: boolean, from: number) =>
        box.recipe.members.map((m) => ({
            marcherId: m.marcherId,
            along: from + (reversed ? box.spots - 1 - m.slot : m.slot),
        }));
    const members = [
        ...along(a, joined.reversedA, 0),
        ...along(b, joined.reversedB, a.spots),
    ].sort((x, y) => x.along - y.along);
    const spotOrder = slots
        .map((slot, index) => ({ index, s: slot.s ?? index }))
        .sort((x, y) => x.s - y.s || x.index - y.index)
        .map((entry) => entry.index);
    const recipe: ShapeRecipeRecord = {
        kind: lineShape.id,
        kindVersion: lineShape.version,
        params: { ...joined.params, spots: n },
        ...orderFields("nearest"),
    };
    return {
        recipe,
        members: members.map((m, i) => {
            const slot = spotOrder[i]!;
            return {
                marcherId: m.marcherId,
                slot,
                x: slots[slot]!.x,
                y: slots[slot]!.y,
            };
        }),
    };
}

const failure = () =>
    tolgee.t("shapes.placed.joinError", "Couldn't join the shapes");

/**
 * Joins placed shapes `a` and `b` into one line ({@link joinedPlacement}) through
 * `writePlacement`, as one undo step: the members move to their spots in it and the joined recipe
 * replaces `a`'s; `b`, left with no members, is deleted with it. It follows the rules editing a
 * shape does (`commitBox`): on a later page the shapes are only carried onto, that page gets the
 * joined line and earlier pages keep the two. Isolating a move, shapes from another move are
 * refused, as Ungroup refuses them.
 *
 * It runs in the queue undo, redo and shape saves do, after what's queued before it.
 */
export function joinShapes(
    a: PlacedBox<LineParams>,
    b: PlacedBox<LineParams>,
    queryClient: QueryClient,
): Promise<void> {
    const plan = planCanvasEdit();
    const beat = displayedBeat(useTimelineSelectionStore.getState());
    const isolated = useTimelineSelectionStore.getState().isolation?.timelineId;
    return queueHistoryStep(async () => {
        try {
            if (!plan.ok) {
                toastTimelineError(plan.error, failure());
                return;
            }
            const field = currentShapeField();
            if (!field) return;
            await timelinePositionsSettled();
            await placedBoxesRead();
            // A save just before may have moved them, or given this page its own copies
            const first = storedBox(a, beat);
            const second = storedBox(b, beat);
            const ids = new Set(
                [first, second].flatMap((s) =>
                    s.recipe.members.map((m) => m.marcherId),
                ),
            );
            const check = joinCheck(ids, [first, second]);
            if (!check.ok) {
                toast.error(check.reason);
                return;
            }
            const carried = carriedOnto(plan, check.a);
            if (
                !carried &&
                isolated !== undefined &&
                check.a.recipe.timelineId !== isolated
            ) {
                toast.error(
                    tolgee.t(
                        "shapes.placed.joinIsolated",
                        "Join these shapes outside isolation: they come from an earlier page",
                    ),
                );
                return;
            }
            const joined = joinedPlacement(
                check.a,
                check.b,
                shapeContextFor(field),
            );
            await writePlacement(
                {
                    ...joined,
                    replaces: check.a.recipe,
                    // On a later page, that page gets the joined line even if nobody moves
                    setAll: carried,
                },
                queryClient,
                failure(),
                plan,
            );
            await timelinePositionsSettled();
            await placedBoxesRead();
        } catch (e) {
            console.error("Couldn't join the shapes", e);
        }
    }, undefined);
}
