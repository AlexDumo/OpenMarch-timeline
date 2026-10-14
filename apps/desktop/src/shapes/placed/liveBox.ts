import { assignSlots } from "../assign";
import {
    changeFiles,
    filesOf,
    insideBox,
    moveBox,
    stretchBox,
    type BoxHandleKey,
    type BoxParams,
} from "../box/boxGeometry";
import { boxTool } from "../box/boxTool";
import { blockKind } from "../kinds/block";
import type { ToolEnv } from "../tool/toolKind";
import type { ShapeContext, XY } from "../types";
import type { PlacedBox } from "./placedBox";

/**
 * A selected placed box, edited in place (docs/timeline/research/shapes/07-placed-boxes.md): its
 * handles stretch it and a drag inside moves it, like the Box tool's, but each gesture is saved
 * when it ends instead of waiting for Place. Presses anywhere else belong to the canvas. A box
 * with holes keeps them: each member keeps its spot in the box. Everything here is pure.
 */

export type LiveGesture =
    | { readonly type: "handle"; readonly key: BoxHandleKey }
    | { readonly type: "move"; readonly grab: XY };

export interface LiveBox {
    readonly box: PlacedBox;
    /** The box as the gesture has it; the saved one when no gesture is going */
    readonly params: BoxParams;
    readonly gesture: LiveGesture | null;
}

export const openLive = (box: PlacedBox): LiveBox => ({
    box,
    params: box.params,
    gesture: null,
});

/** The gesture a press at `at` starts, or null when the box doesn't take it */
export function pressLive(live: LiveBox, at: XY, env: ToolEnv): LiveBox | null {
    let best: { key: string; d: number } | null = null;
    for (const h of boxTool.handles(live.params, live.box.spots)) {
        const d = Math.hypot(h.at.x - at.x, h.at.y - at.y);
        if (d <= env.hitRadius && (!best || d < best.d))
            best = { key: h.key, d };
    }
    if (best)
        return {
            ...live,
            gesture: { type: "handle", key: best.key as BoxHandleKey },
        };
    if (insideBox(live.params, live.box.spots, at))
        return { ...live, gesture: { type: "move", grab: at } };
    return null;
}

export function moveLive(live: LiveBox, at: XY, env: ToolEnv): LiveBox {
    const g = live.gesture;
    if (!g) return live;
    const base = live.box.params;
    const spots = live.box.spots;
    const params =
        g.type === "handle"
            ? stretchBox(base, spots, g.key, at, env)
            : moveBox(
                  base,
                  spots,
                  { x: at.x - g.grab.x, y: at.y - g.grab.y },
                  env,
              );
    return { ...live, params };
}

const sameParams = (a: BoxParams, b: BoxParams) =>
    a.center.x === b.center.x &&
    a.center.y === b.center.y &&
    a.across === b.across &&
    a.deep === b.deep &&
    filesOf(a) === filesOf(b);

/** Ends the gesture: `changed` when there is something to save */
export function releaseLive(live: LiveBox): {
    live: LiveBox;
    changed: boolean;
} {
    return {
        live: { ...live, gesture: null },
        changed: !sameParams(live.params, live.box.params),
    };
}

/** The box with `delta` more files (fewer when negative), same intervals */
export const liveFiles = (
    box: PlacedBox,
    delta: number,
    env: ToolEnv,
): BoxParams => changeFiles(box.params, box.spots, delta, env);

/** The box moved by `delta`, field units, as a nudge: unsnapped, so every member moves the same */
export const liveNudge = (params: BoxParams, delta: XY): BoxParams => ({
    ...params,
    center: { x: params.center.x + delta.x, y: params.center.y + delta.y },
});

/**
 * Where each member stands in the box drawn with `params`. A member keeps its spot in the box
 * (its slot), so a stretch or move keeps everyone's place and holes stay holes. When the file
 * count changes in a box with no holes, who goes where is worked out again (Nearest), so the
 * fewest marchers move.
 */
export function liveTargets(
    box: PlacedBox,
    params: BoxParams,
    ctx: ShapeContext,
): { marcherId: number; slot: number; x: number; y: number }[] {
    const slots = blockKind.generate(params, box.spots, ctx);
    const members = box.recipe.members;
    const full = members.length === box.spots;
    if (full && filesOf(params) !== filesOf(box.params)) {
        const assignment = assignSlots({
            kind: blockKind,
            params,
            slots,
            marchers: members.map((m, i) => ({
                id: m.marcherId,
                at: { x: m.x, y: m.y },
                drillRank: i,
            })),
            mode: "nearest",
            ctx,
        });
        return members.map((m, i) => {
            const slot = assignment[i]!;
            return { marcherId: m.marcherId, slot, ...xyOf(slots[slot]!) };
        });
    }
    return members.map((m) => ({
        marcherId: m.marcherId,
        slot: m.slot,
        ...xyOf(slots[m.slot]!),
    }));
}

const xyOf = (p: XY): XY => ({ x: p.x, y: p.y });
