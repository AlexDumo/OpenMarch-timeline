import {
    assignSlots,
    orderFields,
    type AssignMarcher,
    type OrderChoice,
} from "../assign";
import { carryPivot } from "../frame/pivot";
import {
    centerPivot,
    dragShape,
    shapeTargetAt,
    startShapeGesture,
    type ShapeGesture,
    type ShapeTarget,
} from "../frame/gestures";
import { gapPickAt } from "../distribute/outlineGap";
import type { ShapeContext, Slot, XY } from "../types";
import type { AnyToolKind, ToolEnv } from "./toolKind";

/**
 * The shape tool's state machine (docs/timeline/research/shapes/06-box-v1.md,
 * 08-shape-system-ux.md). While the tool is open it owns every plain left press on the field, and
 * each press starts exactly one gesture:
 *
 * - on the shape (a handle, the rotate knob, just outside a corner, the center dot, its body):
 *   that gesture, the same as on a selected placed shape (`frame/gestures.ts`);
 * - anywhere else: draw a new shape, which replaces the open one.
 *
 * Releasing ends the gesture as one undo step. Who goes where is held during every gesture. Only
 * a fresh draw, a change in how many spots there are across or deep, or Recalculate (#429) works
 * it out again, by least travel (or, on a Line, the order picked: #528): stretching, moving, turning and flipping keep each marcher on
 * their own spot, so a turned or flipped form is the same form (owner, 2026-10-16).
 *
 * Every function is pure; `shapeToolStore.ts` holds the state.
 */

/** What undo steps between */
export interface ToolSnapshot {
    /** The kind of shape: picking another kind is a step too */
    readonly kind: AnyToolKind;
    /** Null until a shape is drawn */
    readonly params: unknown;
    /** The slot index for each marcher, in `marchers` order; null with no shape */
    readonly assignment: readonly number[] | null;
    /**
     * Who goes where on a kind with an order along it (#528): Least travel, Keep order or Reverse.
     * Kept through other kinds, which go by least travel.
     */
    readonly order: OrderChoice;
}

export type Gesture =
    | {
          readonly type: "draw";
          readonly from: XY;
          readonly before: ToolSnapshot;
      }
    /** A number in the floating editor being dragged: the shape follows it live */
    | { readonly type: "edit"; readonly before: ToolSnapshot }
    | (ShapeGesture & {
          readonly before: ToolSnapshot;
          /**
           * What a click here does instead of nothing: on an outline's spot between corners, the
           * shape with its gap moved there (#390)
           */
          readonly click?: unknown;
      });

export interface ToolState extends ToolSnapshot {
    /** In selection order, with where they stand when the tool opened */
    readonly marchers: readonly AssignMarcher[];
    /**
     * How many spots the shape has, which the host gives every kind function as `n`: a kind
     * never reads the selection. One per marcher for now; spots and who goes where stay separate
     * steps so a shape can later have spots nobody stands on (#358).
     */
    readonly spots: number;
    readonly gesture: Gesture | null;
    /** Where the pointer is during a gesture, for the guides drawn by it */
    readonly pointer?: XY;
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
        spots: marchers.length,
        params: null,
        assignment: null,
        // Keep order when the marchers all come from one placed Line (#528)
        order: keepsOrder(marchers) ? "keep" : "nearest",
        gesture: null,
        past: [],
        future: [],
    };
}

const snapshot = (s: ToolState): ToolSnapshot => ({
    kind: s.kind,
    params: s.params,
    assignment: s.assignment,
    order: s.order,
});

/** Whether every marcher has a place along one placed Line, so their order there can be kept */
const keepsOrder = (marchers: readonly AssignMarcher[]) =>
    marchers.length > 0 && marchers.every((m) => m.along !== undefined);

/**
 * Whether Keep order is offered (#528): every selected marcher is a member of one placed Line.
 * Reverse is offered on any line.
 */
export const keepOrderOffered = (state: ToolState): boolean =>
    keepsOrder(state.marchers);

/** Who goes where as the open shape works it out: least travel unless its kind has an order */
export const orderOf = (state: Pick<ToolState, "kind" | "order">) =>
    state.kind.ordered ? orderFields(state.order) : orderFields("nearest");

/** The spots for the open shape, in the kind's order; empty before one is drawn */
export function slotsOf(state: ToolState, ctx: ShapeContext): Slot[] {
    if (state.params === null) return [];
    // Mid-gesture the spots only show where the shape is going: a spread drafts them (#439)
    return state.kind.shape.generate(
        state.params,
        state.spots,
        state.gesture ? { ...ctx, draft: true } : ctx,
    );
}

/**
 * Each assignment worked out by least travel, with the shape and marchers it was worked out for:
 * {@link canRecalculate} knows it can't change without solving again (#455)
 */
const solvedFor = new WeakMap<
    readonly number[],
    {
        params: unknown;
        marchers: ToolState["marchers"];
        ctx: ShapeContext;
        order: OrderChoice;
    }
>();

/**
 * Who goes where on the current shape: by least travel from where the marchers start, or in the
 * order picked on a kind with one ({@link orderOf})
 */
function reassign(state: ToolState, ctx: ShapeContext): ToolState {
    if (state.params === null) return { ...state, assignment: null };
    const slots = slotsOf(state, ctx);
    const { orderMode, reverse } = orderOf(state);
    const assignment = assignSlots({
        kind: state.kind.shape,
        params: state.params,
        slots,
        marchers: state.marchers,
        mode: orderMode,
        reverse,
        ctx,
    });
    if (assignment && !state.gesture)
        solvedFor.set(assignment, {
            params: state.params,
            marchers: state.marchers,
            ctx,
            order: state.order,
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

/** What a press at `at` would do, for the hover cursor */
export function pressTarget(
    state: ToolState,
    at: XY,
    env: ToolEnv,
): ShapeTarget | { type: "draw" } {
    if (state.params === null) return { type: "draw" };
    return (
        shapeTargetAt(state.kind, state.params, state.spots, at, env) ?? {
            type: "draw",
        }
    );
}

export function press(state: ToolState, at: XY, env: ToolEnv): ToolState {
    if (state.gesture) return state;
    const before = snapshot(state);
    const onShape =
        state.params === null
            ? null
            : startShapeGesture(state.kind, state.params, state.spots, at, env);
    const click =
        onShape && (onShape.type === "move" || onShape.type === "handle")
            ? gapPickAt(state.kind, state.params, state.spots, at, env)
            : null;
    const gesture: Gesture = onShape
        ? { ...onShape, before, ...(click !== null ? { click } : {}) }
        : // fine and the Snap toggle off draw from where the press is (owner on #453)
          { type: "draw", from: env.snap ? env.gridSnap(at) : at, before };
    return { ...state, gesture, pointer: at };
}

export function pointerMove(state: ToolState, at: XY, env: ToolEnv): ToolState {
    const g = state.gesture;
    if (!g || g.type === "edit") return state;
    const n = state.spots;
    state = { ...state, pointer: at };
    if (g.type === "draw") {
        // What this drag drew a moment ago, not the shape it replaces
        const previous =
            state.params !== g.before.params ? state.params : undefined;
        const params = state.kind.draw(g.from, at, n, env, previous);
        // Too short to be a shape: the one being replaced shows until the drag is one
        return params === undefined
            ? { ...state, params: g.before.params }
            : { ...state, params };
    }
    return { ...state, params: dragShape(state.kind, n, g, at, env) };
}

/**
 * Ends the gesture: one undo step if it changed anything, and who goes where worked out again. A
 * double click on the pivot sends it back to the center (#350); a click on an outline's spot
 * between corners moves its gap there (#390).
 */
export function release(
    state: ToolState,
    ctx: ShapeContext,
    click?: { readonly double: boolean } | null,
): ToolState {
    const g = state.gesture;
    if (!g) return state;
    if (click?.double && g.type !== "draw" && g.type !== "edit") {
        const centered = centerPivot(g);
        if (centered !== null) state = { ...state, params: centered };
    } else if (click && "click" in g && g.click !== undefined)
        // A click moves nothing else, even if the pointer slipped a little
        state = { ...state, params: g.click };
    const ended = { ...state, gesture: null };
    if (state.params === g.before.params) return ended;
    const next = pushHistory(ended, g.before);
    return g.type === "draw" || !holdsSpots(state, g.before.params, ctx)
        ? reassign(next, ctx)
        : next;
}

/**
 * Whether each marcher can keep their spot going from `before` to the open shape: there is an
 * assignment, and the spots are the same ones, moved (the same count, laid out the same way)
 */
function holdsSpots(
    state: ToolState,
    before: unknown,
    ctx: ShapeContext,
): boolean {
    if (!state.assignment || before === null || state.params === null)
        return false;
    const n = state.spots;
    const was = state.kind.shape.generate(before, n, ctx);
    const now = slotsOf(state, ctx);
    if (was.length !== now.length) return false;
    // The same lattice: each spot keeps its row and file
    return was.every((s, i) => s.row === now[i]!.row && s.col === now[i]!.col);
}

/** Escape during a gesture: everything as it was at the press */
export function cancelGesture(state: ToolState): ToolState {
    const g = state.gesture;
    if (!g) return state;
    return { ...state, ...g.before, gesture: null };
}

/**
 * A change from outside the pointer (the floating editor, the ⋯ row, the nudge keys): one undo
 * step. Who goes where is kept when the spots are the same ones moved (a spacing, a turn, a
 * flip) and worked out again when they aren't (a new count across)
 */
export function edit(
    state: ToolState,
    params: unknown,
    ctx: ShapeContext,
): ToolState {
    if (state.gesture || params === state.params) return state;
    params = carryPivot(state.params, params);
    const next = pushHistory({ ...state, params }, snapshot(state));
    return holdsSpots(next, state.params, ctx) ? next : reassign(next, ctx);
}

/** A number's drag starts: the shape follows {@link previewEdit} until {@link release} */
export function beginEdit(state: ToolState): ToolState {
    if (state.gesture || state.params === null) return state;
    return { ...state, gesture: { type: "edit", before: snapshot(state) } };
}

/** The shape as the dragged number has it, who goes where held */
export function previewEdit(state: ToolState, params: unknown): ToolState {
    if (state.gesture?.type !== "edit" || params === state.params) return state;
    return { ...state, params: carryPivot(state.params, params) };
}

/**
 * Picking `kind` with the tool open (#344): before anything is drawn it is simply the kind drawn
 * next. A drawn shape turns into `kind` keeping its frame (center, size, turn, flip and pivot),
 * so forms can be compared in place, and who goes where is worked out again on the new spots. One
 * undo step.
 */
export function switchKind(
    state: ToolState,
    kind: AnyToolKind,
    ctx: ShapeContext,
    env: ToolEnv,
): ToolState {
    if (state.gesture || kind === state.kind) return state;
    if (state.params === null) return { ...state, kind };
    const n = state.spots;
    // The pivot too: it sits on the frame
    const params = carryPivot(
        state.params,
        kind.fromFrame(state.kind.frameOf(state.params, n), n, env),
    );
    return reassign(
        pushHistory({ ...state, kind, params }, snapshot(state)),
        ctx,
    );
}

/**
 * Picks who goes where on a kind with an order (#528): Least travel, Keep order or Reverse, worked
 * out at once as one undo step. Nothing happens for the choice there already.
 */
export function setOrder(
    state: ToolState,
    order: OrderChoice,
    ctx: ShapeContext,
): ToolState {
    if (state.gesture || order === state.order) return state;
    return reassign(pushHistory({ ...state, order }, snapshot(state)), ctx);
}

/**
 * Recalculate who goes where (#429): the shape's marchers on its spots by least travel from where
 * they come from (or in the order picked, #528), as one undo step. Moving, turning and flipping keep the assignment (the
 * default); this is the one button that works it out again. Unchanged when it's already that.
 */
export function recalculate(state: ToolState, ctx: ShapeContext): ToolState {
    if (state.gesture || !canRecalculate(state, ctx)) return state;
    return reassign(pushHistory(state, snapshot(state)), ctx);
}

/** Whether {@link recalculate} would change who goes where */
export function canRecalculate(state: ToolState, ctx: ShapeContext): boolean {
    if (state.params === null || !state.assignment) return false;
    const solved = solvedFor.get(state.assignment);
    if (
        solved !== undefined &&
        solved.params === state.params &&
        solved.marchers === state.marchers &&
        solved.ctx === ctx &&
        solved.order === state.order
    )
        return false;
    const fresh = reassign(state, ctx).assignment;
    return !!fresh && fresh.some((slot, i) => slot !== state.assignment![i]);
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

/**
 * Where each marcher starts the move, in `marchers` order: their position at the start flag, or
 * where they stand when that's the same (at home, beat 0, the home spots). The open shape is
 * measured from here (spec #344): the hollow rings, the walks and least travel all start here.
 */
export function startsOf(state: ToolState): XY[] {
    return state.marchers.map(startOf);
}

const startOf = (m: AssignMarcher): XY => m.from ?? m.at;

/**
 * Where each marcher goes, from their start (`startsOf`), in `marchers` order; empty until a
 * shape is drawn and released
 */
export function targetsOf(
    state: ToolState,
    ctx: ShapeContext,
): { id: number; from: XY; to: XY; slot: number }[] {
    if (state.params === null || !state.assignment) return [];
    const slots = slotsOf(state, ctx);
    return state.marchers.map((m, i) => {
        const slot = state.assignment![i]!;
        return { id: m.id, from: startOf(m), to: slots[slot]!, slot };
    });
}
