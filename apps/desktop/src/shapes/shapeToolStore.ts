import { create } from "zustand";
import type { AssignMarcher, OrderMode } from "./assign";
import {
    changeKind,
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
    setParams(params: unknown): void;
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

export const useShapeToolStore = create<ShapeToolState>((set, get) => ({
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
        });
    },
    setKind(kindId, ctx) {
        const { session } = get();
        if (session) set({ session: changeKind(session, kindId, ctx) });
    },
    setParams(params) {
        const { session } = get();
        if (session) set({ session: changeParams(session, params) });
    },
    setOrder(order, reverse, ctx) {
        const { session } = get();
        if (session)
            set({ session: changeOrder(session, order, reverse, ctx) });
    },
    reassign(ctx) {
        const { session } = get();
        if (session) set({ session: reassign(session, ctx) });
    },
    nudge(delta, ctx) {
        const { session, dragging } = get();
        if (session && !dragging)
            set({ session: translateSession(session, delta, ctx) });
    },
    dragging: null,
    startDrag(key) {
        const { session } = get();
        if (session) set({ dragging: { key, base: session.params } });
    },
    drag(to, shift, ctx) {
        const { session, dragging } = get();
        if (!session || !dragging) return;
        set({
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
        const { session, dragging } = get();
        if (!session || !dragging) return;
        set({ session: changeParams(session, dragging.base), dragging: null });
    },
    close() {
        const { session } = get();
        if (session) set({ session: null, last: session, dragging: null });
    },
}));
