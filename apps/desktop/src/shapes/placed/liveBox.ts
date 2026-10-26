import { assignSlots, type OrderMode } from "../assign";
import { changeFiles, type BoxParams } from "../box/boxGeometry";
import { samePivot, type ShapeFrame } from "../frame/frame";
import { pivotOf } from "../frame/pivot";
import {
    centerPivot,
    dragShape,
    startShapeGesture,
    type ShapeGesture,
} from "../frame/gestures";
import type { AnyToolKind, ToolEnv } from "../tool/toolKind";
import type { ShapeContext, XY } from "../types";
import type { PlacedBox } from "./placedBox";

/**
 * A selected placed shape, edited in place (docs/timeline/research/shapes/07-placed-boxes.md): its
 * handles resize it, its knob and corners turn it, its center dot and body move it, like the
 * shape tool's (the gestures are `frame/gestures.ts`), but each gesture is saved when it ends
 * instead of waiting for Place. Presses anywhere else belong to the canvas. A shape with holes
 * keeps them: each member keeps its spot in the shape. Any kind the shape tool draws works the same
 * way, through its tool kind (#397). Everything here is pure.
 */

export type LiveGesture = ShapeGesture;

export interface LiveBox {
    readonly box: PlacedBox;
    /** The shape as the gesture has it; the saved one when no gesture is going */
    readonly params: unknown;
    readonly gesture: LiveGesture | null;
    /** Where the pointer is during a gesture, for the guides drawn by it */
    readonly pointer?: XY;
}

export const openLive = (box: PlacedBox): LiveBox => ({
    box,
    params: box.params,
    gesture: null,
});

/** The gesture a press at `at` starts, or null when the box doesn't take it */
export function pressLive(live: LiveBox, at: XY, env: ToolEnv): LiveBox | null {
    const gesture = startShapeGesture(
        live.box.kind,
        live.box.params,
        live.box.spots,
        at,
        env,
    );
    return gesture ? { ...live, gesture, pointer: at } : null;
}

export function moveLive(live: LiveBox, at: XY, env: ToolEnv): LiveBox {
    const g = live.gesture;
    if (!g) return live;
    const params = dragShape(live.box.kind, live.box.spots, g, at, env);
    return { ...live, params, pointer: at };
}

const sameFrame = (a: ShapeFrame, b: ShapeFrame) =>
    a.center.x === b.center.x &&
    a.center.y === b.center.y &&
    a.halfWidth === b.halfWidth &&
    a.halfDepth === b.halfDepth &&
    a.rotation === b.rotation &&
    a.flipX === b.flipX &&
    a.flipY === b.flipY;

/**
 * How a closed shape is filled, as text to compare; empty for an open kind. The box's file count
 * is in it, so a change of count across reads as a new layout.
 */
const layoutOf = (kind: AnyToolKind, params: unknown, spots: number) =>
    kind.closed ? JSON.stringify(kind.closed.distribution(params, spots)) : "";

/**
 * Whether `a` and `b` are the same shape as far as anyone can see: the same frame, pivot, fill
 * and numbers. What a kind keeps besides (a recipe's old fields) doesn't count, so a press that
 * changes nothing saves nothing.
 */
function sameShape(kind: AnyToolKind, spots: number, a: unknown, b: unknown) {
    return (
        sameFrame(kind.frameOf(a, spots), kind.frameOf(b, spots)) &&
        samePivot(pivotOf(a), pivotOf(b)) &&
        layoutOf(kind, a, spots) === layoutOf(kind, b, spots) &&
        kind.params.every(
            (p) => p.value?.(a, spots, 1) === p.value?.(b, spots, 1),
        )
    );
}

/** Whether `params` lays `box` out on a new lattice, so its members are laid out again */
export const newLayout = (box: PlacedBox, params: unknown): boolean =>
    layoutOf(box.kind, params, box.spots) !==
    layoutOf(box.kind, box.params, box.spots);

/**
 * Ends the gesture: `changed` when there is something to save. A double click on the pivot sends
 * it back to the center (#350).
 */
export function releaseLive(
    live: LiveBox,
    click?: { readonly double: boolean } | null,
): {
    live: LiveBox;
    changed: boolean;
} {
    const centered =
        click?.double && live.gesture ? centerPivot(live.gesture) : null;
    const params = centered === null ? live.params : centered;
    const { kind, spots } = live.box;
    return {
        live: { ...live, params, gesture: null },
        changed: !sameShape(kind, spots, params, live.box.params),
    };
}

/** The box with `delta` more files (fewer when negative), same intervals */
export const liveFiles = (
    box: PlacedBox<BoxParams>,
    delta: number,
    env: ToolEnv,
): BoxParams => changeFiles(box.params, box.spots, delta, env);

/**
 * Where each member stands in the shape drawn with `params`, and how many spots it has. A member
 * keeps its spot in the shape (its slot), so a stretch or move keeps everyone's place and holes
 * stay holes. A new layout (a box's file count) lays the shape out again for its members, Nearest,
 * so the fewest marchers move: any holes close up (a slot number means another place in a
 * different grid).
 */
export function liveTargets(
    box: PlacedBox,
    params: unknown,
    ctx: ShapeContext,
    /** Lay the members out again in this order, even with the same count across */
    layOutAgain?: OrderMode,
    /** Where members come from, when laying out again: their spots in the shape otherwise */
    origins?: ReadonlyMap<number, XY>,
): {
    members: { marcherId: number; slot: number; x: number; y: number }[];
    spots: number;
} {
    const members = box.recipe.members;
    const shape = box.kind.shape;
    const slots = shape.generate(params, box.spots, ctx);
    // An outline's count across isn't in its distribution, so the spots are compared too (#390)
    if (
        !layOutAgain &&
        !newLayout(box, params) &&
        sameLattice(box, slots, ctx)
    ) {
        return {
            members: members.map((m) => ({
                marcherId: m.marcherId,
                slot: m.slot,
                ...xyOf(slots[m.slot]!),
            })),
            spots: box.spots,
        };
    }
    const laidOut = shape.generate(params, members.length, ctx);
    const assignment = assignSlots({
        kind: shape,
        params,
        slots: laidOut,
        marchers: members.map((m, i) => ({
            id: m.marcherId,
            at: { x: m.x, y: m.y },
            ...(origins?.has(m.marcherId) && {
                from: origins.get(m.marcherId)!,
            }),
            drillRank: i,
        })),
        mode: layOutAgain ?? orderOf(box),
        ctx,
    });
    return {
        members: members.map((m, i) => {
            const slot = assignment[i]!;
            return { marcherId: m.marcherId, slot, ...xyOf(laidOut[slot]!) };
        }),
        spots: members.length,
    };
}

const xyOf = (p: XY): XY => ({ x: p.x, y: p.y });

/**
 * Recalculate who goes where (#429): the members on the shape's own spots by least travel from
 * `origins` (where each comes from: the start flag), or null when that changes nothing. A shape
 * with holes has Close up instead, which lays it out again by least travel.
 */
export function recalculatedTargets(
    box: PlacedBox,
    ctx: ShapeContext,
    origins: ReadonlyMap<number, XY>,
): { marcherId: number; slot: number; x: number; y: number }[] | null {
    const members = box.recipe.members;
    if (members.length !== box.spots) return null;
    const next = liveTargets(box, box.params, ctx, "nearest", origins).members;
    const slotOf = new Map(members.map((m) => [m.marcherId, m.slot]));
    return next.some((m) => m.slot !== slotOf.get(m.marcherId)) ? next : null;
}

/**
 * Whether `slots` are the box's own spots moved (each keeps its row and file, or its place round
 * an outline), so members can keep theirs: not after a new count across, a new mode, or an
 * outline's gap moved (#390)
 */
function sameLattice(
    box: PlacedBox,
    slots: readonly { readonly row?: number; readonly col?: number }[],
    ctx: ShapeContext,
): boolean {
    const was = box.kind.shape.generate(box.params, box.spots, ctx);
    return (
        was.length === slots.length &&
        was.every((s, i) => s.row === slots[i]!.row && s.col === slots[i]!.col)
    );
}

/** Whether a turn or flip kept the members on their spots, so it's neither order any more */
export const keptOf = (box: PlacedBox): boolean =>
    box.recipe.orderMode === "kept";

/** How the box's members were laid out: drill order, or Least travel (the default, and "kept") */
export const orderOf = (box: PlacedBox): "nearest" | "drill" =>
    box.recipe.orderMode === "drill" ? "drill" : "nearest";
