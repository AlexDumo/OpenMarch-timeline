import { create } from "zustand";
import type { AssignMarcher, OrderMode } from "./assign";
import {
    changeKind,
    changeMeasure,
    changeOrder,
    changeParams,
    dragHandle,
    drawShape,
    insertPoint,
    openRecipe as openRecipeSession,
    type RecipeToOpen,
    reassign,
    removePoint,
    startSession,
    translateSession,
    type ShapeSession,
} from "./session";
import type { ShapeContext, XY } from "./types";
import {
    DRAGGED_HANDLE,
    GESTURES,
    paramsFromClicks,
    paramsFromDrag,
    type StrokeSample,
} from "./draw/gestures";

/**
 * The shape tool's state: the open session, if any. Nothing here writes the show; Apply goes
 * through the canvas edit path (`useApplyShape`).
 */
interface ShapeToolState {
    session: ShapeSession | null;
    /** The last closed session, so spacing and order carry over to the next one */
    last: ShapeSession | null;
    open(
        kindId: string,
        marchers: readonly AssignMarcher[],
        ctx: ShapeContext,
    ): void;
    /** Reopens a placed shape from its stored recipe (ADR 0004) */
    openRecipe(recipe: RecipeToOpen, marchers: readonly AssignMarcher[]): void;
    /** Whether marchers moved by hand keep their offsets when the shape is placed again */
    setKeepOverrides(keep: boolean): void;
    setKind(kindId: string, ctx: ShapeContext): void;
    setParams(params: unknown, ctx: ShapeContext): void;
    setMeasure(key: string, value: number, ctx: ShapeContext): void;
    /** A panel field holds text that doesn't parse (an interval); Place waits until it does */
    inputError: string | null;
    setInputError(error: string | null): void;
    setOrder(order: OrderMode, reverse: boolean, ctx: ShapeContext): void;
    reassign(ctx: ShapeContext): void;
    /**
     * The session Place was pressed on while walks collide: pressing Place again on the same
     * session places it anyway (sims, round 9: Enter placed a form with a red warning)
     */
    placeAsked: ShapeSession | null;
    askPlace(session: ShapeSession | null): void;
    /** Slots of the warning pointed at in the panel, whose walks alone the canvas draws */
    highlight: readonly number[] | null;
    setHighlight(slots: readonly number[] | null): void;
    /**
     * A drawing gesture in progress (owner decisions, 2026-10-11: draw the shape on the field):
     * where it began, the session as it was, and the pointer samples so far
     */
    drawing: {
        from: XY;
        base: ShapeSession;
        samples: StrokeSample[];
        t0: number;
    } | null;
    /** Points clicked so far for a kind drawn by clicks (a curve) */
    clicked: XY[] | null;
    /** Recent finished strokes, kept for recognizing drawn shapes later */
    strokes: { kindId: string; samples: StrokeSample[] }[];
    beginDraw(at: XY): boolean;
    drawTo(at: XY, ctx: ShapeContext): void;
    endDraw(): void;
    clickPoint(at: XY, ctx: ShapeContext): void;
    finishClicks(): void;
    /** Opens a session again as it was (going back to a shape dropped by leaving its set) */
    restore(session: ShapeSession): void;
    /** Double-click on the shape: add a defining point there (curves) */
    insertPoint(at: XY, ctx: ShapeContext): void;
    /** Double-click on a handle: remove that point, if the shape allows it */
    removePoint(key: string, ctx: ShapeContext): void;
    /** Moves the whole shape by `delta` field units (the nudge keys while the tool is open) */
    nudge(delta: XY, ctx: ShapeContext): void;
    /** The handle being dragged and the params when its drag started */
    dragging: {
        key: string;
        base: unknown;
        cursor?: XY;
        /** The last move's context, to apply the order with when the drag ends */
        ctx?: ShapeContext;
    } | null;
    startDrag(key: string): void;
    drag(to: XY, shift: boolean, ctx: ShapeContext): void;
    endDrag(): void;
    /** Escape during a drag: back to where the drag started, tool still open */
    cancelDrag(): void;
    close(): void;
    /** Earlier and undone states of the open session, for the tool's own Undo and Redo */
    past: ShapeSession[];
    future: ShapeSession[];
    undo(): void;
    redo(): void;
}

const HISTORY_LIMIT = 100;
/** Finished strokes kept for recognizing drawn shapes later */
const STROKES_KEPT = 50;

export const useShapeToolStore = create<ShapeToolState>((set, get) => {
    /**
     * Applies `change` to the open session, if any, as one step the tool's own Undo can take
     * back. Nothing is written to the show until Place, so the show's undo isn't involved.
     * With `ctx`, the order is applied again to the changed shape, so the Order setting always
     * says who goes where (sims, round 6: Nearest went stale after typing an interval).
     */
    const update = (
        change: (session: ShapeSession) => ShapeSession,
        ctx?: ShapeContext,
    ) => {
        const { session, past } = get();
        if (!session) return;
        const changed = change(session);
        const next =
            ctx && changed !== session ? reassign(changed, ctx) : changed;
        if (next === session) return;
        set({
            session: next,
            past: [...past.slice(-(HISTORY_LIMIT - 1)), session],
            future: [],
            // A pointed-at warning may be gone now (its mouse leave never comes): draw all walks
            highlight: null,
        });
    };
    return {
        session: null,
        last: null,
        past: [],
        future: [],
        ...historyActions(get, set),
        open(kindId, marchers, ctx) {
            const { session, last } = get();
            set({
                session: startSession({
                    kindId,
                    marchers,
                    ctx,
                    previous: session ?? last,
                }),
                inputError: null,
                past: [],
                future: [],
            });
        },
        drawing: null,
        clicked: null,
        strokes: [],
        beginDraw(at) {
            const { session, past, dragging } = get();
            if (!session || dragging || GESTURES[session.kindId] !== "drag")
                return false;
            set({
                drawing: {
                    from: at,
                    base: session,
                    samples: [{ x: at.x, y: at.y, t: 0 }],
                    t0: performance.now(),
                },
                // The whole gesture is one step back
                past: [...past.slice(-(HISTORY_LIMIT - 1)), session],
                future: [],
                highlight: null,
            });
            return true;
        },
        drawTo(at, ctx) {
            const { drawing } = get();
            if (!drawing) return;
            const { base } = drawing;
            const params = paramsFromDrag(
                base.kindId,
                base.params,
                drawing.from,
                at,
                base.marchers.length,
            );
            drawing.samples.push({
                x: at.x,
                y: at.y,
                t: performance.now() - drawing.t0,
            });
            if (params === undefined) return;
            set({
                session: reassign(
                    drawShape(base, params, DRAGGED_HANDLE[base.kindId], ctx),
                    ctx,
                ),
            });
        },
        endDraw() {
            const { drawing, session, past, strokes } = get();
            if (!drawing) return;
            const moved = session !== drawing.base;
            set({
                drawing: null,
                strokes: [
                    ...strokes.slice(-(STROKES_KEPT - 1)),
                    { kindId: drawing.base.kindId, samples: drawing.samples },
                ],
                // A press without a drag leaves nothing to undo
                ...(moved ? {} : { past: past.slice(0, -1) }),
            });
        },
        clickPoint(at, ctx) {
            const { session, clicked } = get();
            if (!session || GESTURES[session.kindId] !== "clicks") return;
            const points = [...(clicked ?? []), at];
            set({ clicked: points });
            const params = paramsFromClicks(
                session.kindId,
                session.params,
                points,
            );
            if (params !== undefined)
                update((s) => drawShape(s, params, undefined, ctx), ctx);
        },
        finishClicks() {
            if (get().clicked) set({ clicked: null });
        },
        placeAsked: null,
        askPlace(placeAsked) {
            if (get().placeAsked !== placeAsked) set({ placeAsked });
        },
        highlight: null,
        setHighlight(highlight) {
            if (get().highlight !== highlight) set({ highlight });
        },
        restore(session) {
            set({ session, inputError: null, past: [], future: [] });
        },
        openRecipe(recipe, marchers) {
            const session = openRecipeSession(recipe, marchers);
            if (session)
                set({ session, inputError: null, past: [], future: [] });
        },
        setKeepOverrides: (keep) =>
            update((s) => ({ ...s, keepOverrides: keep })),
        setKind: (kindId, ctx) => update((s) => changeKind(s, kindId, ctx)),
        setParams: (params, ctx) =>
            update((s) => changeParams(s, params, ctx), ctx),
        setMeasure: (key, value, ctx) =>
            update((s) => changeMeasure(s, key, value, ctx), ctx),
        inputError: null,
        setInputError(inputError) {
            if (get().inputError !== inputError) set({ inputError });
        },
        setOrder: (order, reverse, ctx) =>
            update((s) => changeOrder(s, order, reverse, ctx)),
        reassign: (ctx) => update((s) => reassign(s, ctx)),
        insertPoint: (at, ctx) => update((s) => insertPoint(s, at, ctx), ctx),
        removePoint: (key, ctx) => update((s) => removePoint(s, key, ctx), ctx),
        nudge(delta, ctx) {
            if (!get().dragging)
                update((s) => translateSession(s, delta, ctx), ctx);
        },
        ...dragActions(get, set),
        close() {
            const { session } = get();
            if (session)
                set({
                    session: null,
                    last: session,
                    dragging: null,
                    inputError: null,
                    highlight: null,
                    drawing: null,
                    clicked: null,
                    past: [],
                    future: [],
                });
        },
    };
});

type Get = () => ShapeToolState;
type Set = (partial: Partial<ShapeToolState>) => void;

/** Undo and Redo through the open session's own edits (not the show's history) */
function historyActions(
    get: Get,
    set: Set,
): Pick<ShapeToolState, "undo" | "redo"> {
    return {
        undo() {
            const { session, past, future, dragging } = get();
            const previous = past.at(-1);
            if (!session || !previous || dragging) return;
            set({
                session: previous,
                past: past.slice(0, -1),
                future: [...future, session],
            });
        },
        redo() {
            const { session, past, future, dragging } = get();
            const next = future.at(-1);
            if (!session || !next || dragging) return;
            set({
                session: next,
                past: [...past, session],
                future: future.slice(0, -1),
            });
        },
    };
}

/** Dragging a handle: one undo step per drag, Escape puts it back */
function dragActions(
    get: Get,
    set: Set,
): Pick<
    ShapeToolState,
    "dragging" | "startDrag" | "drag" | "endDrag" | "cancelDrag"
> {
    return {
        dragging: null,
        startDrag(key) {
            const { session, past } = get();
            if (!session) return;
            set({
                dragging: { key, base: session.params },
                // The whole drag is one step back
                past: [...past.slice(-(HISTORY_LIMIT - 1)), session],
                future: [],
            });
        },
        drag(to, shift, ctx) {
            const { session, dragging } = get();
            if (!session || !dragging) return;
            set({
                dragging: { ...dragging, cursor: to, ctx },
                session: dragHandle(
                    session,
                    dragging.base,
                    dragging.key,
                    to,
                    shift,
                    ctx,
                ),
            });
        },
        endDrag() {
            const { session, dragging } = get();
            if (!dragging) return;
            // The order holds during the drag, so spots don't swap under the cursor, and is
            // applied again when it ends
            set({
                dragging: null,
                session:
                    session && dragging.ctx
                        ? reassign(session, dragging.ctx)
                        : session,
            });
        },
        cancelDrag() {
            const { session, dragging, past } = get();
            if (!session || !dragging) return;
            set({
                session: changeParams(session, dragging.base),
                dragging: null,
                // A cancelled drag leaves nothing to undo
                past: past.slice(0, -1),
            });
        },
    };
}
