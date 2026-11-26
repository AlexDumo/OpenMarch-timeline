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
import {
    isClosed,
    lineSpots,
    onLine,
    type LineParams,
} from "../line/lineGeometry";
import { splitCount, splitLine } from "../line/lineSplit";
import { lineTool } from "../line/lineTool";
import { frameControls } from "../frame/gestures";
import { writePlacement, type ShapePlacement } from "../tool/shapePlacement";
import type { ToolEnv, ToolMenuSection } from "../tool/toolKind";
import type { XY } from "../types";
import { boxDistribution, type BoxParams } from "../box/boxGeometry";
import { boxCutAt, boxPieces, type BoxCut, type BoxPiece } from "./boxSplit";
import { carriedOnto, storedBox } from "./commitBox";
import { isPlacedBox, UNGROUPED_KIND, type PlacedBox } from "./placedBox";
import { placedBoxesRead } from "./placedBoxStore";

/**
 * **Split here** on a placed Line, Curve or Arc (#1336, epic #1335): the shape becomes two of its
 * kind, cut in the gap between two marchers where it was right-clicked, as one undo step. Nobody
 * moves, except a hair on a cut curve (`splitLine`). A grid Box splits the same way between two
 * files or ranks, into two boxes (#1337, `boxSplit.ts`).
 */

/** The menu entry's value, the host's rather than the kind's */
export const SPLIT_VALUE = "host:split";

/** Whether `box` is a Line, Curve or Arc: all Line recipes, so it can be split along its path */
export const isLineKind = (box: PlacedBox): box is PlacedBox<LineParams> =>
    box.kind === lineTool || box.kind === arcTool;

/** Whether `box` can be split by a straight cut: a Box (#1337), in Grid only for now */
export const isBoxKind = (box: PlacedBox): box is PlacedBox<BoxParams> =>
    isPlacedBox(box);

/**
 * Where a shape splits: a line after its first `k` spots along it, or a box along a cut between
 * two files or ranks
 */
export type SplitCut = { readonly kind: "line"; readonly k: number } | BoxCut;

/** A split that can be made: the shape, where it's cut, and how to show it */
export interface SplitAt {
    readonly ok: true;
    readonly box: PlacedBox;
    readonly cut: SplitCut;
    /** The spots either side of the cut, for showing where it falls */
    readonly gap: { readonly from: XY; readonly to: XY };
    /** A box's cut drawn across it, its scissors' end last; a line's is drawn across the gap */
    readonly mark?: { readonly from: XY; readonly to: XY };
}

/** Where a split at a point falls, or why it can't be split there */
export type SplitCheck =
    | SplitAt
    | { readonly ok: false; readonly reason: string };

/** Why there's no split where the menu was opened: it wasn't between two marchers */
const notBetween = () =>
    tolgee.t(
        "shapes.placed.splitEnd",
        "Open this menu between two marchers to split there",
    );

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
    if (isBoxKind(box)) return boxSplitCheck(box, at, reach);
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
    if (k === null) return refused(notBetween());
    const spots = lineSpots(p, box.spots)
        .slice()
        .sort((a, b) => (a.s ?? 0) - (b.s ?? 0));
    return {
        ok: true,
        box,
        cut: { kind: "line", k },
        gap: { from: spots[k - 1]!, to: spots[k]! },
    };
}

/**
 * Whether placed box `box` can be split at field point `at` (#1337): a grid box, between two
 * files or ranks there, each piece a box on the spots its marchers stand on. Within `reach` of a
 * marcher is on it.
 */
function boxSplitCheck(
    box: PlacedBox<BoxParams>,
    at: XY,
    reach: number,
): SplitCheck {
    const refused = (reason: string): SplitCheck => ({ ok: false, reason });
    const mode = boxDistribution(box.params).mode;
    if (mode === "outline")
        return refused(
            tolgee.t(
                "shapes.placed.splitOutline",
                "A box in Outline can't be split yet",
            ),
        );
    if (mode === "spread")
        return refused(
            tolgee.t(
                "shapes.placed.splitSpread",
                "A box in Spread can't be split yet",
            ),
        );
    const found = boxCutAt(box, at, reach, false);
    if (!found) return refused(notBetween());
    if (!boxPieces(box, found.cut))
        return refused(
            tolgee.t(
                "shapes.placed.splitMoves",
                "Splitting here would move marchers",
            ),
        );
    return { ok: true, box, ...found };
}

/** A split the pointer is over on the selected line: where, and the scissors a click splits on */
export interface Scissors {
    readonly check: SplitAt;
    /** Just off the line, square to the gap from its middle, so it covers no dot or handle */
    readonly at: XY;
}

/**
 * The scissors for field point `at` on placed line `box` (#1336, owner's mockup): over the line in
 * a gap between two marchers, not on a dot. On a short gap, only the middle third of it counts as
 * the gap, so a press on a marcher stays the marcher's. They sit two reaches off the line, square
 * to the gap from its middle, on the side toward the back of the field (up the screen), so they
 * cover no dot or handle however short the gap. Null anywhere else, and on a shape that isn't a
 * line or can't be split.
 */
export function scissorsAt(
    box: PlacedBox,
    at: XY,
    env: Pick<ToolEnv, "stepPx" | "hitRadius" | "stemUnit">,
): Scissors | null {
    if (isBoxKind(box)) return boxScissorsAt(box, at, env);
    if (!isLineKind(box)) return null;
    if (!onLine(box.params, box.spots, at, env)) return null;
    const check = splitCheck(box, at);
    if (!check?.ok) return null;
    const { from, to } = check.gap;
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (length === 0) return null;
    const reach = env.hitRadius;
    const onDot = Math.min(reach, length / 3);
    if (
        box.recipe.members.some(
            (m) => Math.hypot(m.x - at.x, m.y - at.y) <= onDot,
        )
    )
        return null;
    let n = { x: -(to.y - from.y) / length, y: (to.x - from.x) / length };
    if (n.y > 0 || (n.y === 0 && n.x > 0)) n = { x: -n.x, y: -n.y };
    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    return {
        check,
        at: { x: mid.x + n.x * 2 * reach, y: mid.y + n.y * 2 * reach },
    };
}

/**
 * The scissors for field point `at` on placed box `box` (#1337): over the gap between two marchers
 * side by side, the cut running between their files or ranks across the whole box, the scissors
 * two reaches past its end up the screen; past the rotate knob when the cut runs up its stem (the
 * middle of an even number of files). Null anywhere else, and where the pieces wouldn't be boxes
 * on the spots their marchers stand on.
 */
function boxScissorsAt(
    box: PlacedBox<BoxParams>,
    at: XY,
    env: Pick<ToolEnv, "hitRadius" | "stemUnit">,
): Scissors | null {
    const reach = env.hitRadius;
    const found = boxCutAt(box, at, reach, true);
    if (!found || !boxPieces(box, found.cut)) return null;
    const { from, to } = found.mark;
    const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    const out = { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
    const past = (p: XY) => ({
        x: p.x + out.x * 2 * reach,
        y: p.y + out.y * 2 * reach,
    });
    let scissors = past(to);
    const { knob } = frameControls(box.kind, box.params, box.spots, env);
    // On the knob's stem or near the knob, they'd cover it: past it instead
    if (Math.hypot(knob.x - scissors.x, knob.y - scissors.y) <= 2 * reach)
        scissors = past(knob);
    return { check: { ok: true, box, ...found }, at: scissors };
}

/** Why a placed shape that isn't a line or box can't be split, until a later step of #1335 */
export const notALineReason = (): string =>
    tolgee.t(
        "shapes.placed.splitKind",
        "Only lines, curves, arcs and boxes can be split for now",
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
 * What splitting `box` along `cut` saves: each piece of two or more spots a recipe of the shape's
 * kind, with the shape's who-goes-where, its members on the same spots of it (renumbered). A piece
 * of one spot is no shape: its marcher, if it has one, is marked as in no shape
 * (`UNGROUPED_KIND`), so no earlier shape takes it back. Null where the cut doesn't fit the shape.
 */
export function splitPlacement(
    box: PlacedBox,
    cut: SplitCut,
): SplitPlacement | null {
    if (cut.kind === "line")
        return isLineKind(box) ? linePlacement(box, cut.k) : null;
    if (!isBoxKind(box)) return null;
    const pieces = boxPieces(box, cut);
    if (!pieces) return null;
    const recipeOf = (piece: BoxPiece): SplitPiece =>
        piece.params
            ? {
                  recipe: {
                      kind: box.recipe.kind,
                      kindVersion: box.recipe.kindVersion,
                      params: { ...piece.params, spots: piece.spots },
                      orderMode: box.recipe.orderMode,
                      reverse: box.recipe.reverse,
                  },
                  members: [...piece.members],
              }
            : { recipe: LOOSE, members: [...piece.members] };
    const first = recipeOf(pieces[0]);
    const second = recipeOf(pieces[1]);
    return { first, alongside: [second] };
}

type SplitPiece = Pick<ShapePlacement, "recipe" | "members">;

/** A line split after its first `k` spots along it */
function linePlacement(box: PlacedBox<LineParams>, k: number): SplitPlacement {
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
    box: PlacedBox,
    cut: SplitCut,
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
            if (stored.kind !== box.kind || stored.spots !== box.spots) return;
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
            const split = splitPlacement(stored, cut);
            if (!split) return;
            const { first, alongside } = split;
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
