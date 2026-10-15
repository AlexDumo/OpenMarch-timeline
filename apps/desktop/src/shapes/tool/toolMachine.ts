import { assignSlots, type AssignMarcher } from "../assign";
import type { ShapeContext, Slot, XY } from "../types";
import type { AnyToolKind, ToolEnv } from "./toolKind";

/**
 * The shape tool's state machine (docs/timeline/research/shapes/06-box-v1.md). While the tool is
 * open it owns every plain left press on the field, and each press starts exactly one gesture:
 *
 * - on a handle: drag that handle;
 * - inside the shape: move it;
 * - anywhere else: draw a new shape, which replaces the open one.
 *
 * Releasing ends the gesture as one undo step. Who goes where is held during a gesture and worked
 * out again (Nearest) when it ends, so spots don't swap under the cursor. There are no other modes.
 *
 * Every function is pure; `shapeToolStore.ts` holds the state.
 */

/** What undo steps between */
export interface ToolSnapshot {
    /** Null until a shape is drawn */
    readonly params: unknown;
    /** The slot index for each marcher, in `marchers` order; null with no shape */
    readonly assignment: readonly number[] | null;
}

export type Gesture =
    | {
          readonly type: "draw";
          readonly from: XY;
          readonly before: ToolSnapshot;
      }
    | {
          readonly type: "handle";
          readonly key: string;
          readonly base: unknown;
          readonly before: ToolSnapshot;
      }
    | {
          readonly type: "move";
          readonly grab: XY;
          readonly base: unknown;
          readonly before: ToolSnapshot;
      };

export interface ToolState extends ToolSnapshot {
    readonly kind: AnyToolKind;
    /** In selection order, with where they stand when the tool opened */
    readonly marchers: readonly AssignMarcher[];
    readonly gesture: Gesture | null;
    readonly past: readonly ToolSnapshot[];
    readonly future: readonly ToolSnapshot[];
}

const HISTORY_LIMIT = 100;

export function openTool(
    kind: AnyToolKind,
    marchers: readonly AssignMarcher[],
): ToolState {
    return {
        kind,
        marchers,
        params: null,
        assignment: null,
        gesture: null,
        past: [],
        future: [],
    };
}

const snapshot = (s: ToolState): ToolSnapshot => ({
    params: s.params,
    assignment: s.assignment,
});

/** The spots for the open shape, in the kind's order; empty before one is drawn */
export function slotsOf(state: ToolState, ctx: ShapeContext): Slot[] {
    if (state.params === null) return [];
    return state.kind.shape.generate(state.params, state.marchers.length, ctx);
}

/** Nearest assignment for the current shape */
function reassign(state: ToolState, ctx: ShapeContext): ToolState {
    if (state.params === null) return { ...state, assignment: null };
    const slots = slotsOf(state, ctx);
    const assignment = assignSlots({
        kind: state.kind.shape,
        params: state.params,
        slots,
        marchers: state.marchers,
        mode: "nearest",
        ctx,
    });
    return { ...state, assignment };
}

function pushHistory(state: ToolState, before: ToolSnapshot): ToolState {
    return {
        ...state,
        past: [...state.past.slice(-(HISTORY_LIMIT - 1)), before],
        future: [],
    };
}

/** The handle within reach of `at`, nearest first */
function handleAt(state: ToolState, at: XY, env: ToolEnv) {
    if (state.params === null) return undefined;
    let best: { key: string; d: number } | undefined;
    for (const h of state.kind.handles(state.params, state.marchers.length)) {
        const d = Math.hypot(h.at.x - at.x, h.at.y - at.y);
        if (d <= env.hitRadius && (!best || d < best.d))
            best = { key: h.key, d };
    }
    return best?.key;
}

/** What a press at `at` would do, for the hover cursor */
export function pressTarget(
    state: ToolState,
    at: XY,
    env: ToolEnv,
): { type: "handle"; key: string } | { type: "move" } | { type: "draw" } {
    const key = handleAt(state, at, env);
    if (key !== undefined) return { type: "handle", key };
    if (
        state.params !== null &&
        state.kind.contains(state.params, state.marchers.length, at)
    )
        return { type: "move" };
    return { type: "draw" };
}

export function press(state: ToolState, at: XY, env: ToolEnv): ToolState {
    if (state.gesture) return state;
    const before = snapshot(state);
    const target = pressTarget(state, at, env);
    const gesture: Gesture =
        target.type === "handle"
            ? { type: "handle", key: target.key, base: state.params, before }
            : target.type === "move"
              ? { type: "move", grab: at, base: state.params, before }
              : { type: "draw", from: env.gridSnap(at), before };
    return { ...state, gesture };
}

export function pointerMove(state: ToolState, at: XY, env: ToolEnv): ToolState {
    const g = state.gesture;
    if (!g) return state;
    const n = state.marchers.length;
    switch (g.type) {
        case "draw": {
            // What this drag drew a moment ago, not the shape it replaces
            const previous =
                state.params !== g.before.params ? state.params : undefined;
            const params = state.kind.draw(g.from, at, n, env, previous);
            // Too short to be a shape: the one being replaced shows until the drag is one
            return params === undefined
                ? { ...state, params: g.before.params }
                : { ...state, params };
        }
        case "handle":
            return {
                ...state,
                params: state.kind.dragHandle(g.base, n, g.key, at, env),
            };
        case "move":
            return {
                ...state,
                params: state.kind.move(
                    g.base,
                    n,
                    { x: at.x - g.grab.x, y: at.y - g.grab.y },
                    env,
                ),
            };
    }
}

/** Ends the gesture: one undo step if it changed anything, and who goes where worked out again */
export function release(state: ToolState, ctx: ShapeContext): ToolState {
    const g = state.gesture;
    if (!g) return state;
    const ended = { ...state, gesture: null };
    if (state.params === g.before.params) return ended;
    return reassign(pushHistory(ended, g.before), ctx);
}

/** Escape during a gesture: everything as it was at the press */
export function cancelGesture(state: ToolState): ToolState {
    const g = state.gesture;
    if (!g) return state;
    return { ...state, ...g.before, gesture: null };
}

/** A change from outside the pointer (the readout's file count): one undo step */
export function edit(
    state: ToolState,
    params: unknown,
    ctx: ShapeContext,
): ToolState {
    if (state.gesture || params === state.params) return state;
    return reassign(pushHistory({ ...state, params }, snapshot(state)), ctx);
}

export function undo(state: ToolState): ToolState {
    const previous = state.past.at(-1);
    if (state.gesture || !previous) return state;
    return {
        ...state,
        ...previous,
        past: state.past.slice(0, -1),
        future: [...state.future, snapshot(state)],
    };
}

export function redo(state: ToolState): ToolState {
    const next = state.future.at(-1);
    if (state.gesture || !next) return state;
    return {
        ...state,
        ...next,
        past: [...state.past, snapshot(state)],
        future: state.future.slice(0, -1),
    };
}

/** Where each marcher goes, in `marchers` order; empty until a shape is drawn and released */
export function targetsOf(
    state: ToolState,
    ctx: ShapeContext,
): { id: number; from: XY; to: XY; slot: number }[] {
    if (state.params === null || !state.assignment) return [];
    const slots = slotsOf(state, ctx);
    return state.marchers.map((m, i) => {
        const slot = state.assignment![i]!;
        return { id: m.id, from: m.at, to: slots[slot]!, slot };
    });
}
