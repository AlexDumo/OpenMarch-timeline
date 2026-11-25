import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import tolgee from "@/global/singletons/Tolgee";
import type {
    ShapeRecipeMember,
    ShapeRecipeRecord,
} from "@/db-functions/shapeRecipes";
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
import { arcTool } from "../arc/arcTool";
import { isClosed, lineSpots, type LineParams } from "../line/lineGeometry";
import { splitCount, splitLine } from "../line/lineSplit";
import { lineTool } from "../line/lineTool";
import { writePlacement, type ShapePlacement } from "../tool/shapePlacement";
import type { ToolMenuSection } from "../tool/toolKind";
import type { XY } from "../types";
import { carriedOnto, storedBox } from "./commitBox";
import { UNGROUPED_KIND, type PlacedBox } from "./placedBox";
import { placedBoxesRead } from "./placedBoxStore";

/**
 * **Split here** on a placed Line, Curve or Arc (#1336, epic #1335): the shape becomes two of its
 * kind, cut in the gap between two marchers where it was right-clicked, as one undo step. Nobody
 * moves, except a hair on a cut curve (`splitLine`).
 */

/** The menu entry's value, the host's rather than the kind's */
export const SPLIT_VALUE = "host:split";

/** Whether `box` is a Line, Curve or Arc: all Line recipes, so it can be split along its path */
export const isLineKind = (box: PlacedBox): box is PlacedBox<LineParams> =>
    box.kind === lineTool || box.kind === arcTool;

/** Where a split at a point falls: the spots in the first piece, or why it can't be split there */
export type SplitCheck =
    | {
          readonly ok: true;
          readonly box: PlacedBox<LineParams>;
          readonly k: number;
          /** The spots either side of the cut, for showing where it falls */
          readonly gap: { readonly from: XY; readonly to: XY };
      }
    | { readonly ok: false; readonly reason: string };

/**
 * Whether placed shape `box` can be split at field point `at`: an open Line, Curve or Arc without
 * rows, with marchers on both sides of the point. Null for a shape that isn't a line, which isn't
 * offered the entry at all.
 */
export function splitCheck(
    box: PlacedBox,
    at: XY,
    /** How near a marcher's spot a click is on it (`splitCount`) */
    reach = 0,
): SplitCheck | null {
    if (!isLineKind(box)) return null;
    const refused = (reason: string): SplitCheck => ({ ok: false, reason });
    const p = box.params;
    if (isClosed(p))
        return refused(
            tolgee.t(
                "shapes.placed.splitClosed",
                "A closed line can't be split yet",
            ),
        );
    if (p.rows !== undefined && p.rows.list.length > 1)
        return refused(
            tolgee.t(
                "shapes.placed.splitRows",
                "A line with rows can't be split yet",
            ),
        );
    const k = splitCount(p, box.spots, at, reach);
    if (k === null)
        return refused(
            tolgee.t(
                "shapes.placed.splitEnd",
                "Right-click between two marchers to split there",
            ),
        );
    const spots = lineSpots(p, box.spots)
        .slice()
        .sort((a, b) => (a.s ?? 0) - (b.s ?? 0));
    return { ok: true, box, k, gap: { from: spots[k - 1]!, to: spots[k]! } };
}

/** Why a placed shape that isn't a line can't be split, until step 2 of #1335 */
export const notALineReason = (): string =>
    tolgee.t(
        "shapes.placed.splitNotLine",
        "Only lines, curves and arcs can be split for now",
    );

/** The entry the menus on a placed line show: Split here, greyed with its reason when it can't */
export function splitSection(check: SplitCheck): ToolMenuSection {
    return {
        items: [
            {
                value: SPLIT_VALUE,
                // The field menu's entry's name: one action, one name (`shapeSplitHere`)
                label: tolgee.t("actions.shape.splitHere", "Shape: Split here"),
                ...(check.ok ? {} : { disabled: check.reason }),
            },
        ],
    };
}

/** What a split writes: the first piece (replacing the shape) and the pieces beside it */
export interface SplitPlacement {
    readonly first: Pick<ShapePlacement, "recipe" | "members">;
    readonly alongside: readonly Pick<ShapePlacement, "recipe" | "members">[];
}

/** What marks marchers as in no shape: a piece of one marcher */
const LOOSE: ShapeRecipeRecord = {
    kind: UNGROUPED_KIND,
    kindVersion: 1,
    params: {},
    orderMode: "nearest",
    reverse: false,
};

/**
 * What splitting `box` after its first `k` spots along it saves: each piece of two or more spots a
 * recipe of the shape's kind, with the shape's who-goes-where, its members on the same spots of it
 * (renumbered). A piece of one spot is no line: its marcher, if it has
 * one, is marked as in no shape (`UNGROUPED_KIND`), so no earlier shape takes it back.
 */
export function splitPlacement(
    box: PlacedBox<LineParams>,
    k: number,
): SplitPlacement {
    const n = box.spots;
    // Each spot's place along the line: members name spots by index, the pieces by order along it
    const along = lineSpots(box.params, n)
        .map((spot, index) => ({ index, s: spot.s ?? 0 }))
        .sort((a, b) => a.s - b.s || a.index - b.index)
        .map((entry) => entry.index);
    const rank = new Map(along.map((index, r) => [index, r]));
    const pieces = splitLine(box.params, n, k);
    const placed = pieces.map((piece, i) => {
        const from = i === 0 ? 0 : k;
        const members: ShapeRecipeMember[] = box.recipe.members.flatMap((m) => {
            const r = rank.get(m.slot);
            if (r === undefined || r < from || r >= from + piece.spots)
                return [];
            return [{ ...m, slot: r - from }];
        });
        if (!piece.params)
            return members.length > 0 ? { recipe: LOOSE, members } : null;
        // Its own spots in order along it, so a member's renumbered place is its spot there
        const spots = lineSpots(piece.params, piece.spots);
        const order = spots
            .map((spot, index) => ({ index, s: spot.s ?? 0 }))
            .sort((a, b) => a.s - b.s || a.index - b.index)
            .map((entry) => entry.index);
        return {
            recipe: {
                kind: box.recipe.kind,
                kindVersion: box.recipe.kindVersion,
                params: { ...piece.params, spots: piece.spots },
                orderMode: box.recipe.orderMode,
                reverse: box.recipe.reverse,
            },
            // On its own spot: where it stands, except on a cut curve, which its piece can only
            // nearly follow (`splitLine`), so its marchers settle onto it
            members: members.map((m) => {
                const slot = order[m.slot]!;
                const spot = spots[slot]!;
                return { ...m, slot, x: spot.x, y: spot.y };
            }),
        };
    });
    const [first, ...rest] = placed;
    const empty = { recipe: LOOSE, members: [] };
    return {
        first: first ?? empty,
        alongside: rest.flatMap((piece) => (piece ? [piece] : [])),
    };
}

const failure = () =>
    tolgee.t("shapes.placed.splitError", "Couldn't split the shape");

/**
 * Splits placed shape `box` after its first `k` spots along it ({@link splitPlacement}) through
 * `writePlacement`, as one undo step: the first piece replaces the shape's recipe, the second is a
 * new one in the same move. It follows the rules editing a shape does (`commitBox`): on a later
 * page the shape is only carried onto, that page gets the pieces and earlier pages keep the whole.
 * Isolating a move, a shape from another move is refused, as Ungroup refuses it.
 *
 * It runs in the queue undo, redo and shape saves do, after what's queued before it.
 */
export function splitShape(
    box: PlacedBox<LineParams>,
    k: number,
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
            await timelinePositionsSettled();
            await placedBoxesRead();
            // An edit saved just before may have given this page its own copy
            const stored = storedBox(box, beat);
            if (!isLineKind(stored) || stored.spots !== box.spots) return;
            const carried = carriedOnto(plan, stored);
            if (
                !carried &&
                isolated !== undefined &&
                stored.recipe.timelineId !== isolated
            ) {
                toast.error(
                    tolgee.t(
                        "shapes.placed.splitIsolated",
                        "Split this shape outside isolation: it comes from an earlier page",
                    ),
                );
                return;
            }
            const { first, alongside } = splitPlacement(stored, k);
            await writePlacement(
                {
                    ...first,
                    alongside,
                    replaces: stored.recipe,
                    // On a later page, that page gets the pieces even though nobody moves
                    setAll: carried,
                },
                queryClient,
                failure(),
                plan,
            );
            await timelinePositionsSettled();
            await placedBoxesRead();
        } catch (e) {
            console.error("Couldn't split the shape", e);
        }
    }, undefined);
}
