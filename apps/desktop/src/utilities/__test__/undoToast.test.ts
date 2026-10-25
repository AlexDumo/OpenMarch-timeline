import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A toast whose Undo undoes the edit that just committed closes on the next history change, so
 * its Undo can't undo a later edit instead (as UI-14's delete toast).
 */

const state = vi.hoisted(() => ({
    listeners: new Set<() => void>(),
    dismissed: [] as (string | number)[],
}));

vi.mock("@/db-functions/history", () => ({
    subscribeHistoryChanges: (listener: () => void) => {
        state.listeners.add(listener);
        return () => state.listeners.delete(listener);
    },
}));
vi.mock("sonner", () => ({
    toast: { dismiss: (id: string | number) => state.dismissed.push(id) },
}));

const { toastUntilNextHistoryChange } = await import("../undoToast");

const historyChange = () => {
    for (const listener of [...state.listeners]) listener();
};

describe("toastUntilNextHistoryChange", () => {
    beforeEach(() => {
        state.listeners.clear();
        state.dismissed = [];
    });

    it("closes the toast on the next history change, once", () => {
        toastUntilNextHistoryChange(() => "t1");
        expect(state.dismissed).toEqual([]);
        historyChange();
        expect(state.dismissed).toEqual(["t1"]);
        historyChange();
        expect(state.dismissed).toEqual(["t1"]);
        expect(state.listeners.size).toBe(0);
    });

    it("stops listening when the toast closes by itself", () => {
        let handlers: { onDismiss?: () => void; onAutoClose?: () => void } = {};
        toastUntilNextHistoryChange((h) => {
            handlers = h as typeof handlers;
            return "t2";
        });
        expect(state.listeners.size).toBe(1);
        handlers.onAutoClose?.();
        expect(state.listeners.size).toBe(0);
        historyChange();
        expect(state.dismissed).toEqual([]);
    });
});
