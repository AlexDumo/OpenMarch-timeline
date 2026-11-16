import {
    act,
    cleanup,
    fireEvent,
    render,
    renderHook,
    screen,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TolgeeProvider } from "@tolgee/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import tolgee from "@/global/singletons/Tolgee";
import { useShapeEditorStore } from "@/shapes/frame/shapeEditorStore";
import { ACTIONS } from "../definitions";
import CommandPalette from "../palette/CommandPalette";
import { runAction } from "../registry";
import { useAlignmentActionHandlers } from "../handlers/useAlignmentActionHandlers";

/**
 * "Toggle ratio lock" (#586) flips the one lock a selection's scale handles and a box's spacings
 * share, from the command palette, the inspector's Arrange section and the box's editor. It has
 * no default key.
 */

const Providers = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={new QueryClient()}>
        <TolgeeProvider tolgee={tolgee} fallback="Loading...">
            {children}
        </TolgeeProvider>
    </QueryClientProvider>
);

const locked = () => useShapeEditorStore.getState().ratioLocked;

beforeAll(async () => {
    // jsdom has no layout, so it doesn't implement scrollIntoView.
    Element.prototype.scrollIntoView = vi.fn();
    await tolgee.run();
});

afterEach(() => {
    cleanup();
    act(() => {
        useShapeEditorStore.setState({ ratioLocked: false });
    });
    localStorage.clear();
});

describe("Toggle ratio lock", () => {
    it("has no default shortcut", () => {
        expect(ACTIONS.toggleRatioLock.defaultBindings).toEqual([]);
    });

    it("turns the shared ratio lock on and off, and leaves the Arc's sizes lock alone", () => {
        renderHook(() => useAlignmentActionHandlers(), { wrapper: Providers });
        expect(locked()).toBe(false);
        act(() => {
            runAction("toggleRatioLock");
        });
        expect(locked()).toBe(true);
        expect(useShapeEditorStore.getState().sizesLocked).toBe(false);
        act(() => {
            runAction("toggleRatioLock");
        });
        expect(locked()).toBe(false);
    });

    it("is in the command palette, found by its keywords, and flips the lock from there", async () => {
        render(
            <Providers>
                <Handlers />
                <CommandPalette />
            </Providers>,
        );
        act(() => {
            runAction("openCommandPalette");
        });
        expect(
            screen
                .getAllByRole("option")
                .some((o) =>
                    (o.textContent ?? "").startsWith("Toggle ratio lock"),
                ),
        ).toBe(true);
        const input = screen.getByRole("combobox");
        fireEvent.change(input, { target: { value: "proportion" } });
        expect(
            screen.getAllByRole("option").map((o) => o.textContent ?? ""),
        ).toEqual([expect.stringMatching(/^Toggle ratio lock/)]);
        fireEvent.keyDown(input, { key: "Enter" });
        await vi.waitFor(() => expect(locked()).toBe(true));
    });
});

function Handlers() {
    useAlignmentActionHandlers();
    return null;
}
