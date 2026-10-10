import { create } from "zustand";
import type { AssignMarcher, OrderMode } from "./assign";
import {
    changeKind,
    changeMeasure,
    changeOrder,
    changeParams,
    dragHandle,
    insertPoint,
    reassign,
    removePoint,
    startSession,
    translateSession,
    type ShapeSession,
} from "./session";
import type { ShapeContext, XY } from "./types";

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
    setKind(kindId: string, ctx: ShapeContext): void;
    setParams(params: unknown, ctx: ShapeContext): void;
    setMeasure(key: string, value: number, ctx: ShapeContext): void;
    /** A panel field holds text that doesn't parse (an interval); Place waits until it does */
    inputError: string | null;
    setInputError(error: string | null): void;
    setOrder(order: OrderMode, reverse: boolean, ctx: ShapeContext): void;
    reassign(ctx: ShapeContext): void;
    /** Double-click on the shape: add a defining point there (curves) */
    insertPoint(at: XY, ctx: ShapeContext): void;
    /** Double-click on a handle: remove that point, if the shape allows it */
    removePoint(key: string, ctx: ShapeContext): void;
    /** Moves the whole shape by `delta` field units (the nudge keys while the tool is open) */
    nudge(delta: XY, ctx: ShapeContext): void;
    /** The handle being dragged and the params when its drag started */
    dragging: { key: string; base: unknown; cursor?: XY } | null;
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

export const useShapeToolStore = create<ShapeToolState>((set, get) => {
    /**
     * Applies `change` to the open session, if any, as one step the tool's own Undo can take
     * back. Nothing is written to the show until Place, so the show's undo isn't involved.
     */
    const update = (change: (session: ShapeSession) => ShapeSession) => {
        const { session, past } = get();
        if (!session) return;
        const next = change(session);
        if (next === session) return;
        set({
            session: next,
            past: [...past.slice(-(HISTORY_LIMIT - 1)), session],
            future: [],
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
        setKind: (kindId, ctx) => update((s) => changeKind(s, kindId, ctx)),
        setParams: (params, ctx) => update((s) => changeParams(s, params, ctx)),
        setMeasure: (key, value, ctx) =>
            update((s) => changeMeasure(s, key, value, ctx)),
        inputError: null,
        setInputError(inputError) {
            if (get().inputError !== inputError) set({ inputError });
        },
        setOrder: (order, reverse, ctx) =>
            update((s) => changeOrder(s, order, reverse, ctx)),
        reassign: (ctx) => update((s) => reassign(s, ctx)),
        insertPoint: (at, ctx) => update((s) => insertPoint(s, at, ctx)),
        removePoint: (key, ctx) => update((s) => removePoint(s, key, ctx)),
        nudge(delta, ctx) {
            if (!get().dragging) update((s) => translateSession(s, delta, ctx));
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
                dragging: { ...dragging, cursor: to },
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
            if (get().dragging) set({ dragging: null });
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
