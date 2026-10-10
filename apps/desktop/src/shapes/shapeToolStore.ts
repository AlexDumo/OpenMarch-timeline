import { create } from "zustand";
import type { AssignMarcher, OrderMode } from "./assign";
import {
    changeKind,
    changeMeasure,
    changeOrder,
    changeParams,
    dragHandle,
    reassign,
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
    /** Moves the whole shape by `delta` field units (the nudge keys while the tool is open) */
    nudge(delta: XY, ctx: ShapeContext): void;
    /** The handle being dragged and the params when its drag started */
    dragging: { key: string; base: unknown } | null;
    startDrag(key: string): void;
    drag(to: XY, shift: boolean, ctx: ShapeContext): void;
    endDrag(): void;
    /** Escape during a drag: back to where the drag started, tool still open */
    cancelDrag(): void;
    close(): void;
}

export const useShapeToolStore = create<ShapeToolState>((set, get) => {
    /** Applies `change` to the open session, if any */
    const update = (change: (session: ShapeSession) => ShapeSession) => {
        const { session } = get();
        if (session) set({ session: change(session) });
    };
    return {
        session: null,
        last: null,
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
        nudge(delta, ctx) {
            if (!get().dragging) update((s) => translateSession(s, delta, ctx));
        },
        dragging: null,
        startDrag(key) {
            const { session } = get();
            if (session) set({ dragging: { key, base: session.params } });
        },
        drag(to, shift, ctx) {
            const { dragging } = get();
            if (dragging)
                update((s) =>
                    dragHandle(s, dragging.base, dragging.key, to, shift, ctx),
                );
        },
        endDrag() {
            if (get().dragging) set({ dragging: null });
        },
        cancelDrag() {
            const { session, dragging } = get();
            if (!session || !dragging) return;
            set({
                session: changeParams(session, dragging.base),
                dragging: null,
            });
        },
        close() {
            const { session } = get();
            if (session)
                set({
                    session: null,
                    last: session,
                    dragging: null,
                    inputError: null,
                });
        },
    };
});
