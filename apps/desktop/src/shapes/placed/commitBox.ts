import tolgee from "@/global/singletons/Tolgee";
import type { QueryClient } from "@tanstack/react-query";
import { orderFields, type OrderChoice, type OrderMode } from "../assign";
import type { XY } from "../types";
import { currentShapeField, shapeContextFor } from "../field/shapeFieldContext";
import {
    planCanvasEdit,
    timelinePositionsSettled,
    type CanvasEditPlan,
} from "@/timeline/timelineCoordinateWrites";
import {
    displayedBeat,
    useTimelineSelectionStore,
} from "@/stores/TimelineSelectionStore";
import { writePlacement, type LinkedPlacement } from "../tool/shapePlacement";
import type { ShapeContext } from "../types";
import type { LineParams } from "../line/lineGeometry";
import { followersOf, liveLinks, withoutDeadLinks } from "./shapeLinks";
import { liveTargets } from "./liveBox";
import type { PlacedBox } from "./placedBox";
import { placedOrderChoice } from "./placedOrder";
import { useSavingBoxStore } from "./boxSelectionStore";
import { placedBoxesAt, placedBoxesRead } from "./placedBoxStore";
import {
    historyStepsPending,
    queueHistoryStep,
} from "@/shortcuts/handlers/historyQueue";

/** Whether two recipe params say the same, whatever their key order (keys set to undefined are left out) */
export function sameParams(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== "object" || typeof b !== "object" || !a || !b)
        return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const entries = (o: object) =>
        Object.entries(o).filter(([, v]) => v !== undefined);
    const ea = entries(a);
    const eb = new Map(entries(b));
    return (
        ea.length === eb.size &&
        ea.every(([k, v]) => eb.has(k) && sameParams(v, eb.get(k)))
    );
}

/**
 * Whether `plan` edits only a page `box` is carried onto: its whole window is past the box's own
 * move. A window reaching back over that move (Expert's start flag left on an earlier page) isn't.
 * Neither are homes and isolation, whose writes never set marchers left where they are
 */
export function carriedOnto(plan: CanvasEditPlan, box: PlacedBox): boolean {
    if (!plan.ok) return false;
    const { target } = plan;
    if (target.kind !== "range" && target.kind !== "point") return false;
    const start = target.kind === "range" ? target.start : target.box.start;
    return plan.beat > box.endBeat + 1e-9 && start >= box.endBeat - 1e-9;
}

/** Saves asked for and not yet read back */
let unsaved = 0;

/**
 * Who goes where as a placed shape's recipe saves it: a Line's order (#528), Least travel
 * otherwise. Drill order is gone (#429); a kind without an order keeps its stored reverse.
 */
export const recipeOrderFields = (
    box: PlacedBox,
    order: OrderChoice,
): { orderMode: OrderMode; reverse?: boolean } =>
    box.kind.ordered ? orderFields(order) : { orderMode: "nearest" };

/**
 * Saves a selected placed shape drawn with `params` through `writePlacement`: its members move to
 * their spots in it and its recipe is saved, as one edit at the edit window (a canvas edit). A
 * shape held from an earlier move gets its own copy on this one; the earlier one stays.
 *
 * The shape is shown as saved at once (`useSavingBoxStore`), and saves run one at a time: each
 * starts from the shape as the last one read it back, so quick edits add up. Each goes to the edit
 * window it was made in, even when it waited and the timeline moved on meanwhile.
 *
 * They run in the queue undo and redo presses do (`queueHistoryStep`), in the order they were
 * pressed: an undo pressed while saves wait undoes the last of them (#513). An edit is saved as it
 * was shown, even when an undo before it hadn't run yet.
 */
export function commitBox(
    box: PlacedBox,
    params: unknown,
    queryClient: QueryClient,
    /** Lay the members out again by least travel (Recalculate, Close up) */
    layOutAgain?: boolean,
    /** Where members come from when laid out again (Recalculate: the start flag) */
    origins?: ReadonlyMap<number, XY>,
    /** Who goes where, picked anew (#528): the recipe's otherwise */
    order: OrderChoice = placedOrderChoice(box),
    /**
     * Other placed shapes changed in the same step (#1235: Detach of several links), each to its
     * params; shapes linked to `box` follow it whether or not they're listed
     */
    others: readonly LinkedEdit[] = [],
): Promise<void> {
    const field = currentShapeField();
    if (!field) return Promise.resolve();
    const shown = liveTargets(
        box,
        params,
        shapeContextFor(field),
        layOutAgain,
        origins,
        order,
    );
    const at: SaveAt = {
        plan: planCanvasEdit(),
        beat: displayedBeat(useTimelineSelectionStore.getState()),
        waits: unsaved > 0 || historyStepsPending(),
    };
    useSavingBoxStore.setState({
        // As it's stored now: a kept drag's box may be from before this page got its own copy
        box: savedAs(storedBox(box, at.beat), params, shown),
        // Isolation takes the playhead to the edit's end as it writes, so it's shown there too
        beats: at.plan.ok ? [at.beat, at.plan.beat] : [at.beat],
    });
    unsaved++;
    return queueHistoryStep(async () => {
        try {
            // What ran before it (a save, an undo) read back first, as it starts from that
            await timelinePositionsSettled();
            await placedBoxesRead();
            // Ungrouped meanwhile (or every member taken by another shape): nothing to edit
            if (!shownStill(box, at.beat)) return;
            await saveBox(
                storedBox(box, at.beat),
                params,
                at,
                queryClient,
                layOutAgain,
                origins,
                order,
                others,
            );
        } catch (e) {
            console.error("Couldn't save the shape", e);
        } finally {
            unsaved--;
            // The box read back is the one selected again
            if (unsaved === 0)
                useSavingBoxStore.setState({ box: null, beats: [] });
        }
    }, undefined);
}

/** Another placed shape saved in the same step as an edit ({@link commitBox}'s `others`) */
export interface LinkedEdit {
    readonly box: PlacedBox;
    readonly params: unknown;
}

/**
 * What linked shapes (#1235) do when `box` is saved as `params` at `beat`, among the placed shapes
 * shown there (`boxes`): the attachments of
 * `box` that link nothing now are dropped from it, and every shape linked to it whose joint moved
 * follows, its end stretched there, saved in the same step beside `others`. On a later page the
 * shapes are only carried onto (`carried`), `box` is saved as a copy of its own there, unlinked,
 * and nothing follows: a link holds only where its shapes were placed.
 */
export function linkedSave(
    box: PlacedBox,
    params: unknown,
    boxes: readonly PlacedBox[],
    beat: number,
    carried: boolean,
    others: readonly LinkedEdit[] = [],
): { params: unknown; others: LinkedEdit[] } {
    const links = carried ? [] : liveLinks(boxes, beat);
    const listed = new Set(others.map((o) => o.box.recipe.id));
    const following = followersOf(box, params, links).filter(
        (f) => !listed.has(f.box.recipe.id),
    );
    const edits = [...others, ...following];
    // Each attachment checked against the shapes as this save leaves them
    const saved = new Map<number, unknown>([
        [box.recipe.id, params],
        ...edits.map((o) => [o.box.recipe.id, o.params] as const),
    ]);
    const after = (b: PlacedBox<LineParams>) =>
        (saved.get(b.recipe.id) as LineParams | undefined) ?? b.params;
    // On a later page the copy is unlinked: nothing there counts
    const live = (b: PlacedBox, p: unknown) =>
        withoutDeadLinks(b, p, carried ? [] : boxes, beat, after);
    return {
        params: live(box, params),
        others: edits.map((o) => ({
            box: o.box,
            params: live(o.box, o.params),
        })),
    };
}

/** `others` laid out and saved as their own recipes beside an edit (`writePlacement`'s `also`) */
export function linkedPlacements(
    others: readonly LinkedEdit[],
    ctx: ShapeContext,
): LinkedPlacement[] {
    return others.map(({ box, params }) => {
        const { members, spots } = liveTargets(box, params, ctx);
        return {
            recipe: {
                ...box.recipe,
                params: { ...(params as object), spots },
                ...recipeOrderFields(box, placedOrderChoice(box)),
            },
            members,
            replaces: box.recipe,
        };
    });
}

/** Where a save goes: the edit window and beat it was made at */
interface SaveAt {
    readonly plan: CanvasEditPlan;
    readonly beat: number;
    /** It waits for an earlier save, so the timeline may have moved on by the time it runs */
    readonly waits: boolean;
}

/** `box` drawn with `params`, its members on the spots `targets` gives them */
function savedAs(
    box: PlacedBox,
    params: unknown,
    targets: ReturnType<typeof liveTargets>,
): PlacedBox {
    const { members, spots } = targets;
    return {
        ...box,
        params,
        spots,
        recipe: {
            ...box.recipe,
            params: { ...(params as object), spots },
            members,
        },
    };
}

/**
 * `box` as it's stored now: a save before this one moved it, or gave it its own copy on this move.
 * The same marchers find it; `box` itself when they don't (a save failed)
 */
export function storedBox(box: PlacedBox, beat: number): PlacedBox {
    const ids = new Set(box.recipe.members.map((m) => m.marcherId));
    return (
        placedBoxesAt(beat).find(
            (b) =>
                b.recipe.members.length === ids.size &&
                b.recipe.members.every((m) => ids.has(m.marcherId)),
        ) ?? box
    );
}

/** Whether any member of `box` is still in a shape shown at `beat` */
function shownStill(box: PlacedBox, beat: number): boolean {
    const ids = new Set(box.recipe.members.map((m) => m.marcherId));
    return placedBoxesAt(beat).some((b) =>
        b.recipe.members.some((m) => ids.has(m.marcherId)),
    );
}

async function saveBox(
    box: PlacedBox,
    params: unknown,
    at: SaveAt,
    queryClient: QueryClient,
    layOutAgain?: boolean,
    origins?: ReadonlyMap<number, XY>,
    order: OrderChoice = placedOrderChoice(box),
    others: readonly LinkedEdit[] = [],
): Promise<void> {
    const field = currentShapeField();
    if (!field) return;
    const ctx = shapeContextFor(field);
    const carried = carriedOnto(at.plan, box);
    // Shapes linked to it follow, in the same step (#1235)
    const linked = linkedSave(
        box,
        params,
        placedBoxesAt(at.beat),
        at.beat,
        carried,
        others,
    );
    params = linked.params;
    const { members: targets, spots } = liveTargets(
        box,
        params,
        ctx,
        layOutAgain,
        origins,
        order,
    );
    const next = { ...(params as object), spots };
    await writePlacement(
        {
            recipe: {
                ...box.recipe,
                params: next,
                ...recipeOrderFields(box, order),
            },
            members: targets,
            replaces: box.recipe,
            // Changed on a later page it's carried onto: that page gets its own copy, even when
            // nobody moves (a pivot change), and the earlier page keeps its own
            setAll: carried && !sameParams(next, box.recipe.params),
            also: linkedPlacements(linked.others, ctx),
        },
        queryClient,
        tolgee.t("shapes.placed.editError", "Couldn't edit the shape"),
        // Every save goes where it was made, even when the page changed before it ran (#776)
        at.plan,
        // One that waited or was overtaken leaves the playhead where it was moved to
        at.waits ||
            displayedBeat(useTimelineSelectionStore.getState()) !== at.beat,
    );
    // Read back, positions and recipe both, before the next save starts from it
    await timelinePositionsSettled();
    await placedBoxesRead();
}
