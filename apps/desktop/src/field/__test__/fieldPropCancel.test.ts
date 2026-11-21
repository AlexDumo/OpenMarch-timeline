import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { FieldEditor } from "@/field/editor/fieldEditor";
import { runAction } from "@/shortcuts/registry";
import { useItemDrawingStore } from "@/stores/ItemDrawingStore";
import { useFieldPropTool } from "../fieldPropTool";

/**
 * The drawing card's Cancel (#873) runs an action, as its Undo point and Finish do
 * (docs/conventions/tablet-parity.md section 1): it turns the prop tool off, and can't run while
 * the tool is off.
 */

const editor = () =>
    ({
        subscribe: () => () => {},
        propToolShape: () => null,
        setPropTool: vi.fn(),
        finishPropTool: vi.fn(),
        removeLastPropPoint: vi.fn(),
    }) as unknown as FieldEditor;

afterEach(() => {
    cleanup();
    useItemDrawingStore.getState().resetDrawingState();
});

describe("propCancelDrawing", () => {
    it("turns the prop tool off while it's drawing", () => {
        renderHook(() => useFieldPropTool(editor(), () => null));
        act(() => {
            useItemDrawingStore.getState().setDrawingMode("polygon");
        });
        let ran = false;
        act(() => {
            ran = runAction("propCancelDrawing");
        });
        expect(ran).toBe(true);
        expect(useItemDrawingStore.getState().drawingMode).toBeNull();
    });

    it("doesn't run with the tool off", () => {
        renderHook(() => useFieldPropTool(editor(), () => null));
        expect(runAction("propCancelDrawing")).toBe(false);
    });
});
