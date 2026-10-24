import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

/**
 * Undo and Redo refresh after every write: TanStack mutations as before, and history writes made
 * without one (drill edit dialogs, page-flag grips), which left Undo greyed out.
 */

const state = vi.hoisted(() => ({
    listeners: new Set<() => void>(),
}));

vi.mock("@/App", () => ({ queryClient: undefined }));
vi.mock("@/global/database/db", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    db: {},
}));
vi.mock("@/db-functions", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    subscribeHistoryWrites: (listener: () => void) => {
        state.listeners.add(listener);
        return () => state.listeners.delete(listener);
    },
}));

const { historyKeys, refreshHistoryOnWrites } = await import("../useHistory");

const seeded = () => {
    const qc = new QueryClient();
    qc.setQueryData(historyKeys.canUndo(), false);
    qc.setQueryData(historyKeys.canRedo(), true);
    return qc;
};
const invalidated = (qc: QueryClient) => ({
    undo: qc.getQueryState(historyKeys.canUndo())?.isInvalidated,
    redo: qc.getQueryState(historyKeys.canRedo())?.isInvalidated,
});

describe("refreshHistoryOnWrites", () => {
    it("refreshes Undo and Redo after a history write made without a mutation", () => {
        const qc = seeded();
        const stop = refreshHistoryOnWrites(qc);
        expect(invalidated(qc)).toEqual({ undo: false, redo: false });
        for (const listener of state.listeners) listener();
        expect(invalidated(qc)).toEqual({ undo: true, redo: true });
        stop();
        expect(state.listeners.size).toBe(0);
    });

    it("still refreshes after a mutation", async () => {
        const qc = seeded();
        const stop = refreshHistoryOnWrites(qc);
        await qc
            .getMutationCache()
            .build(qc, { mutationFn: async () => 1 })
            .execute(undefined);
        expect(invalidated(qc)).toEqual({ undo: true, redo: true });
        stop();
    });
});
