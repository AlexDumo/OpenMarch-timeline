import type {
    ShapeRecipeMember,
    StoredShapeRecipe,
} from "@/db-functions/shapeRecipes";
import { assignSlots, type AssignMarcher } from "../assign";
import {
    drawBox,
    boxFrame,
    snapToGrid,
    withBoxFrame,
    ranksOf,
    type BoxParams,
} from "../box/boxGeometry";
import { blockKind } from "../kinds/block";
import type { ToolEnv } from "../tool/toolKind";
import type { ShapeContext, XY } from "../types";
import { frameToField } from "../frame/frame";

/**
 * Placed boxes (docs/timeline/research/shapes/07-placed-boxes.md): a box's recipe, read back.
 *
 * A box is shown at the end of the move it was placed in, and at every later moment while each of
 * its members still stands on its spot (the form is held). Its members are exactly the marchers on
 * its spots: one that moves away leaves the box, leaving a hole, and moving every member the same
 * way moves the box. Everything here is pure.
 */

export type PlacedRecipe = Omit<StoredShapeRecipe, "members"> & {
    readonly members: readonly ShapeRecipeMember[];
};

/** A box recipe's params as stored: the box, plus how many spots it has (members + holes) */
export type StoredBoxParams = BoxParams & { readonly spots?: number };

export interface PlacedBox {
    readonly recipe: PlacedRecipe;
    readonly params: BoxParams;
    /** Spots in the box, holes included */
    readonly spots: number;
    /** The beat the box was placed at: its move's end (0 for homes) */
    readonly endBeat: number;
}

/** How close a marcher must stand to its spot to be on it, in field units */
const ON_SPOT = 0.01;

const same = (a: XY, b: XY) =>
    Math.abs(a.x - b.x) <= ON_SPOT && Math.abs(a.y - b.y) <= ON_SPOT;

/** The box a recipe describes, or null for another kind (or a newer version) */
function boxOf(
    recipe: PlacedRecipe,
): { params: BoxParams; spots: number } | null {
    if (
        recipe.kind !== blockKind.id ||
        recipe.kindVersion !== blockKind.version
    )
        return null;
    const stored = recipe.params as StoredBoxParams | null;
    if (!stored || typeof stored !== "object" || !stored.center) return null;
    const { spots, ...params } = stored;
    return {
        params: params as BoxParams,
        spots: Math.max(spots ?? 0, recipe.members.length),
    };
}

/**
 * The placed boxes to show at `beat`: placed at or before it, with every member on its spot. A
 * marcher is in one box at a time, the latest placed.
 *
 * @param endBeatOf the end beat of a move (`null`: homes, beat 0), undefined for a move that's gone
 * @param positionOf where a marcher stands at `beat`
 */
export function boxesAt({
    recipes,
    endBeatOf,
    beat,
    positionOf,
}: {
    recipes: readonly PlacedRecipe[];
    endBeatOf: (timelineId: number | null) => number | undefined;
    beat: number;
    positionOf: (marcherId: number) => XY | undefined;
}): PlacedBox[] {
    const candidates: PlacedBox[] = [];
    for (const recipe of recipes) {
        const box = boxOf(recipe);
        const endBeat = endBeatOf(recipe.timelineId);
        if (!box || endBeat === undefined || endBeat > beat + 1e-9) continue;
        if (recipe.members.length === 0) continue;
        const held = recipe.members.every((m) => {
            const p = positionOf(m.marcherId);
            return p !== undefined && same(p, m);
        });
        if (held) candidates.push({ recipe, ...box, endBeat });
    }
    candidates.sort((a, b) => b.endBeat - a.endBeat);
    const claimed = new Set<number>();
    const out: PlacedBox[] = [];
    for (const box of candidates) {
        if (box.recipe.members.some((m) => claimed.has(m.marcherId))) continue;
        for (const m of box.recipe.members) claimed.add(m.marcherId);
        out.push(box);
    }
    return out;
}

export type MembershipChange =
    | { readonly type: "none" }
    /** Every member moved the same way: the box moves with them */
    | { readonly type: "move"; readonly delta: XY }
    /** These members moved off their spots and leave the box */
    | { readonly type: "leave"; readonly left: readonly number[] };

/** What moving marchers to `moved` does to `box` */
export function membershipAfter(
    box: PlacedBox,
    moved: ReadonlyMap<number, XY>,
): MembershipChange {
    const off = box.recipe.members.filter((m) => {
        const to = moved.get(m.marcherId);
        return to !== undefined && !same(to, m);
    });
    if (off.length === 0) return { type: "none" };
    if (off.length === box.recipe.members.length) {
        const first = off[0]!;
        const to = moved.get(first.marcherId)!;
        const delta = { x: to.x - first.x, y: to.y - first.y };
        const together = off.every((m) => {
            const p = moved.get(m.marcherId)!;
            return same({ x: p.x - m.x, y: p.y - m.y }, delta);
        });
        if (together) return { type: "move", delta };
    }
    return { type: "leave", left: off.map((m) => m.marcherId) };
}

/** What a box's recipe saves */
export interface BoxRecipe {
    readonly params: StoredBoxParams;
    readonly spots: number;
    readonly members: readonly ShapeRecipeMember[];
}

/** `box` moved by `delta`, members and all */
export function movedBox(box: PlacedBox, delta: XY): BoxRecipe {
    return {
        params: {
            ...box.params,
            center: {
                x: box.params.center.x + delta.x,
                y: box.params.center.y + delta.y,
            },
            spots: box.spots,
        },
        spots: box.spots,
        members: box.recipe.members.map((m) => ({
            ...m,
            x: m.x + delta.x,
            y: m.y + delta.y,
        })),
    };
}

/** The recipe without the marchers in `left`: their spots stay, as holes */
export function withoutMembers(
    recipe: PlacedRecipe,
    left: readonly number[],
): PlacedRecipe {
    const gone = new Set(left);
    const spots =
        (recipe.params as StoredBoxParams | null)?.spots ??
        recipe.members.length;
    return {
        ...recipe,
        params: { ...(recipe.params as object), spots },
        members: recipe.members.filter((m) => !gone.has(m.marcherId)),
    };
}

/** `params`' spots for `marchers`, who goes where by Nearest */
function placeOn(
    params: BoxParams,
    marchers: readonly AssignMarcher[],
    ctx: ShapeContext,
): BoxRecipe {
    const n = marchers.length;
    const slots = blockKind.generate(params, n, ctx);
    const assignment = assignSlots({
        kind: blockKind,
        params,
        slots,
        marchers,
        mode: "nearest",
        ctx,
    });
    return {
        params: { ...params, spots: n },
        spots: n,
        members: marchers.map((m, i) => {
            const slot = assignment[i]!;
            return {
                marcherId: m.id,
                slot,
                x: slots[slot]!.x,
                y: slots[slot]!.y,
            };
        }),
    };
}

/**
 * **Close up**: `marchers` (the box's members after some left) fill the box from the front, at
 * the same files and intervals. The front rank stays where it was with all `spots` filled, and the
 * back rank goes short.
 */
export function closeUp(
    params: BoxParams,
    spots: number,
    marchers: readonly AssignMarcher[],
    ctx: ShapeContext,
): BoxRecipe {
    // In the box's own axes, however it's turned: the front rank is local +y
    const frame = boxFrame(params, spots);
    const ranks = ranksOf(params, marchers.length);
    const closed: BoxParams = {
        ...params,
        center: frameToField(frame, {
            x: 0,
            y: frame.halfDepth - ((ranks - 1) / 2) * params.deep,
        }),
    };
    return placeOn(closed, marchers, ctx);
}

/**
 * **Re-split**: `marchers` split again by the evenness rule, inside the edges the box had with
 * all `spots` filled
 */
export function resplit(
    params: BoxParams,
    spots: number,
    marchers: readonly AssignMarcher[],
    env: ToolEnv,
    ctx: ShapeContext,
): BoxRecipe {
    // Drawn again in the box's own axes, then turned and flipped back as it was
    const frame = boxFrame(params, spots);
    const flat = drawBox(
        { x: -frame.halfWidth, y: -frame.halfDepth },
        { x: frame.halfWidth, y: frame.halfDepth },
        marchers.length,
        { ...env, gridSnap: (p) => p },
    );
    const redrawn = flat
        ? snapToGrid(
              withBoxFrame(flat, {
                  ...frame,
                  center: frameToField(frame, flat.center),
              }),
              marchers.length,
              env,
          )
        : params;
    return placeOn(redrawn, marchers, ctx);
}
