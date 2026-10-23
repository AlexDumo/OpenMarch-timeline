import { assignSlots, type OrderMode } from "../assign";
import {
    changeFiles,
    filesOf,
    sameLayout,
    type BoxParams,
} from "../box/boxGeometry";
import { boxTool } from "../box/boxTool";
import { samePivot } from "../frame/frame";
import { pivotOf } from "../frame/pivot";
import {
    centerPivot,
    dragShape,
    startShapeGesture,
    type ShapeGesture,
} from "../frame/gestures";
import { boxShape } from "../box/boxShape";
import type { ToolEnv } from "../tool/toolKind";
import type { ShapeContext, XY } from "../types";
import type { PlacedBox } from "./placedBox";

/**
 * A selected placed box, edited in place (docs/timeline/research/shapes/07-placed-boxes.md): its
 * handles stretch it, its knob and corners turn it, its center dot and body move it, like the Box
 * tool's (the gestures are `frame/gestures.ts`), but each gesture is saved when it ends instead of
 * waiting for Place. Presses anywhere else belong to the canvas. A box with holes keeps them: each
 * member keeps its spot in the box. Everything here is pure.
 */

export type LiveGesture = ShapeGesture;

export interface LiveBox {
    readonly box: PlacedBox;
    /** The box as the gesture has it; the saved one when no gesture is going */
    readonly params: BoxParams;
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
        boxTool,
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
    const params = dragShape(boxTool, live.box.spots, g, at, env) as BoxParams;
    return { ...live, params, pointer: at };
}

const sameParams = (a: BoxParams, b: BoxParams) =>
    a.center.x === b.center.x &&
    a.center.y === b.center.y &&
    a.across === b.across &&
    a.deep === b.deep &&
    a.rotation === b.rotation &&
    (a.flipX ?? false) === (b.flipX ?? false) &&
    (a.flipY ?? false) === (b.flipY ?? false) &&
    samePivot(pivotOf(a), pivotOf(b)) &&
    filesOf(a) === filesOf(b) &&
    sameLayout(a, b);

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
    const params = centered === null ? live.params : (centered as BoxParams);
    return {
        live: { ...live, params, gesture: null },
        changed: !sameParams(params, live.box.params),
    };
}

/** The box with `delta` more files (fewer when negative), same intervals */
export const liveFiles = (
    box: PlacedBox,
    delta: number,
    env: ToolEnv,
): BoxParams => changeFiles(box.params, box.spots, delta, env);

/**
 * Where each member stands in the box drawn with `params`, and how many spots it has. A member
 * keeps its spot in the box (its slot), so a stretch or move keeps everyone's place and holes stay
 * holes. A change of file count lays the box out again for its members, Nearest, so the fewest
 * marchers move: any holes close up (a slot number means another place in a different grid).
 */
export function liveTargets(
    box: PlacedBox,
    params: BoxParams,
    ctx: ShapeContext,
    /** Lay the members out again in this order, even with the same count across */
    layOutAgain?: OrderMode,
): {
    members: { marcherId: number; slot: number; x: number; y: number }[];
    spots: number;
} {
    const members = box.recipe.members;
    if (
        !layOutAgain &&
        filesOf(params) === filesOf(box.params) &&
        sameLayout(params, box.params)
    ) {
        const slots = boxShape.generate(params, box.spots, ctx);
        return {
            members: members.map((m) => ({
                marcherId: m.marcherId,
                slot: m.slot,
                ...xyOf(slots[m.slot]!),
            })),
            spots: box.spots,
        };
    }
    const slots = boxShape.generate(params, members.length, ctx);
    const assignment = assignSlots({
        kind: boxShape,
        params,
        slots,
        marchers: members.map((m, i) => ({
            id: m.marcherId,
            at: { x: m.x, y: m.y },
            drillRank: i,
        })),
        mode: layOutAgain ?? orderOf(box),
        ctx,
    });
    return {
        members: members.map((m, i) => {
            const slot = assignment[i]!;
            return { marcherId: m.marcherId, slot, ...xyOf(slots[slot]!) };
        }),
        spots: members.length,
    };
}

const xyOf = (p: XY): XY => ({ x: p.x, y: p.y });

/** Whether a turn or flip kept the members on their spots, so it's neither order any more */
export const keptOf = (box: PlacedBox): boolean =>
    box.recipe.orderMode === "kept";

/** How the box's members were laid out: drill order, or Least travel (the default, and "kept") */
export const orderOf = (box: PlacedBox): "nearest" | "drill" =>
    box.recipe.orderMode === "drill" ? "drill" : "nearest";
