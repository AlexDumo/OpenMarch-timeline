import type { XY } from "../types";
import { movedBox, type PlacedBox } from "./placedBox";
import { followersOf, type ShapeLink } from "./shapeLinks";

/**
 * Several placed shapes selected whole and moved together (#1236): a linked figure selected with
 * Select linked shapes, or shapes Shift-clicked one by one. They move as one, each the same
 * distance through its kind, so each keeps its form and the links between them hold. Pure.
 */

/**
 * The placed shapes among `boxes` that the selection `selected` is made of, whole, when it's two
 * or more of them on one move: every selected marcher is in one of them, and every member of each
 * is selected. Empty otherwise (one shape is `useBoxSelectionStore.selected`'s).
 */
export function wholeShapesOf(
    selected: ReadonlySet<number>,
    boxes: readonly PlacedBox[],
): PlacedBox[] {
    if (selected.size === 0) return [];
    const shapes = boxes.filter((b) =>
        b.recipe.members.some((m) => selected.has(m.marcherId)),
    );
    if (shapes.length < 2) return [];
    const timelineId = shapes[0]!.recipe.timelineId;
    if (shapes.some((b) => b.recipe.timelineId !== timelineId)) return [];
    let count = 0;
    for (const box of shapes) {
        if (!box.recipe.members.every((m) => selected.has(m.marcherId)))
            return [];
        count += box.recipe.members.length;
    }
    // Each member once: shapes on one move share no marcher
    return count === selected.size
        ? [...shapes].sort((a, b) => a.recipe.id - b.recipe.id)
        : [];
}

/** How far `params` moved `box`'s frame from where it is */
function frameShift(box: PlacedBox, params: unknown): XY {
    const was = box.kind.frameOf(box.params, box.spots).center;
    const now = box.kind.frameOf(params, box.spots).center;
    return { x: now.x - was.x, y: now.y - was.y };
}

/**
 * The shapes `boxes`, moved together as the first of them is moved to `params` (a nudge of it
 * through its kind, snapped as a nudge of that shape alone is): every other the same distance.
 * Shapes linked to them that aren't moved follow as an edit of one shape makes them follow, their
 * end at the joint stretched (`followersOf`). Returns each other shape's params, in the order
 * `boxes` gives them, then the followers'; `links` are those live where the shapes are shown.
 */
export function shapesMoved(
    boxes: readonly PlacedBox[],
    params: unknown,
    links: readonly ShapeLink[],
): { box: PlacedBox; params: unknown }[] {
    const [first, ...rest] = boxes;
    if (!first) return [];
    const by = frameShift(first, params);
    const moved = rest.map((box) => ({
        box,
        params: movedBox(box, by).params as unknown,
    }));
    const taken = new Set(boxes.map((b) => b.recipe.id));
    const followers: { box: PlacedBox; params: unknown }[] = [];
    for (const { box, params: p } of [{ box: first, params }, ...moved]) {
        for (const follower of followersOf(box, p, links)) {
            if (taken.has(follower.box.recipe.id)) continue;
            taken.add(follower.box.recipe.id);
            followers.push(follower);
        }
    }
    return [...moved, ...followers];
}
