import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TolgeeProvider } from "@tolgee/react";
import tolgee from "@/global/singletons/Tolgee";
import FileControls from "../FileControls";

/**
 * The title bar's Undo and Redo with nothing to undo: greyed out, saying so on hover and when
 * pressed, instead of a button that does nothing.
 */

const history = vi.hoisted(() => ({ canUndo: false, perform: vi.fn() }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    useQuery: (options: { queryKey?: readonly unknown[] }) => ({
        data: JSON.stringify(options.queryKey ?? []).includes("Redo")
            ? false
            : history.canUndo,
    }),
}));
vi.mock("@/hooks/queries/useHistory", () => ({
    canUndoQueryOptions: () => ({ queryKey: ["canUndo"] }),
    canRedoQueryOptions: () => ({ queryKey: ["canRedo"] }),
    usePerformHistoryAction: () => ({ mutate: history.perform }),
}));
vi.mock("@/hooks/useDatabaseReady", () => ({ useDatabaseReady: () => true }));

beforeAll(async () => {
    await tolgee.run();
});
afterEach(() => {
    cleanup();
    history.perform.mockClear();
});

const mount = () =>
    render(
        <TolgeeProvider tolgee={tolgee} fallback="Loading...">
            <FileControls />
        </TolgeeProvider>,
    );

describe("the title bar's Undo", () => {
    it("with nothing to undo is greyed out, and a press says so instead of undoing", () => {
        history.canUndo = false;
        mount();
        const undo = screen.getByRole("button", { name: "Undo" });
        expect(undo).toHaveAttribute("aria-disabled", "true");
        expect(undo.title).toMatch(/No action to undo/);
        fireEvent.click(undo);
        expect(history.perform).not.toHaveBeenCalled();
        expect(screen.getByText("No action to undo")).toBeTruthy();
    });

    it("with something to undo undoes", () => {
        history.canUndo = true;
        mount();
        const undo = screen.getByRole("button", { name: "Undo" });
        expect(undo).not.toHaveAttribute("aria-disabled");
        fireEvent.click(undo);
        expect(history.perform).toHaveBeenCalledWith("undo");
    });
});
