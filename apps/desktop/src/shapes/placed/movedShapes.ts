import type { Similarity } from "../frame/similarity";
import type { ShapeContext, XY } from "../types";
import {
    movedBox,
    similarityOf,
    transformedParams,
    type PlacedBox,
} from "./placedBox";
import {
    addFollowerEnds,
    stretchedFollowers,
    type FollowerEnds,
    type ShapeLink,
} from "./shapeLinks";

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
 * end at the joint stretched (`followersAll`). Returns each other shape's params, in the order
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
    return [
        ...moved,
        ...followersAll([{ box: first, params }, ...moved], links),
    ];
}

/**
 * The shapes linked to `edits` and not among them, each following them as an edit of one shape
 * makes it (`followersOf`), once: a shape linked to two of them gets both its ends moved, each to
 * its joint
 */
function followersAll(
    edits: readonly { box: PlacedBox; params: unknown }[],
    links: readonly ShapeLink[],
): { box: PlacedBox; params: unknown }[] {
    const ends: FollowerEnds = new Map();
    for (const { box, params } of edits)
        addFollowerEnds(ends, box, params, links);
    for (const { box } of edits) ends.delete(box.recipe.id);
    return stretchedFollowers(ends);
}

/**
 * The turn, even scale or mirror the placed shapes `boxes` went through when their members were
 * dropped at `positions` (#1236: a selection's handles, or a rotation typed in the inspector):
 * every member of every shape dropped, nobody else, and all of them through one. Null otherwise,
 * or when they only moved (unless `moves`: a drag of them, for the shapes linked to them to follow).
 */
export function similarityOfDrop(
    boxes: readonly PlacedBox[],
    positions: readonly {
        readonly id: number;
        readonly x: number;
        readonly y: number;
    }[],
    moves = false,
): Similarity | null {
    const at = new Map(positions.map((p) => [p.id, p] as const));
    const members = boxes.flatMap((b) => b.recipe.members);
    if (members.length !== at.size) return null;
    const pairs: { from: XY; to: XY }[] = [];
    for (const m of members) {
        const to = at.get(m.marcherId);
        if (!to) return null;
        pairs.push({ from: m, to });
    }
    return similarityOf(pairs, moves);
}

/**
 * The shapes `boxes`, selected whole, taken through `sim` together (#1236): each through its kind
 * (`transformedParams`), so each keeps its kind, count and form and every link between them holds.
 * Shapes linked to them that aren't taken follow as for a move, their end at the joint stretched.
 * Each shape's params, in the order `boxes` gives them, then the followers'; null when any of
 * `boxes` can't follow `sim`. `links` are those live where the shapes are shown.
 */
export function shapesTransformed(
    boxes: readonly PlacedBox[],
    sim: Similarity,
    links: readonly ShapeLink[],
    ctx: ShapeContext,
): { box: PlacedBox; params: unknown }[] | null {
    const edits: { box: PlacedBox; params: unknown }[] = [];
    for (const box of boxes) {
        const params = transformedParams(box, sim, ctx);
        if (params === null) return null;
        edits.push({ box, params });
    }
    return [...edits, ...followersAll(edits, links)];
}
