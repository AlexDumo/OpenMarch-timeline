import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    resetShapePointer,
    setShapeDragging,
    setShapePointerOver,
    shapeCalm,
    useShapePointerStore,
    watchShapeEditorFocus,
} from "../shapePointer";

describe("the shape's calm signal (#403, #430)", () => {
    beforeEach(() => resetShapePointer());

    it("is calm with the pointer away and no gesture", () => {
        expect(shapeCalm(false)).toBe(true);
    });

    it("shows the controls over the shape, during a gesture or a placed shape's drag", () => {
        setShapePointerOver(true);
        expect(shapeCalm(false)).toBe(false);
        resetShapePointer();
        expect(shapeCalm(true)).toBe(false);
        setShapeDragging(true);
        expect(shapeCalm(false)).toBe(false);
        resetShapePointer();
        expect(shapeCalm(false)).toBe(true);
    });

    it("is never calm on a screen that can't hover (touch, Apple Pencil): the pointer is never over", () => {
        const matchMedia = vi.fn((query: string) => ({
            matches: query !== "(hover: hover)",
        }));
        vi.stubGlobal("matchMedia", matchMedia);
        try {
            expect(shapeCalm(false)).toBe(false);
            expect(matchMedia).toHaveBeenCalledWith("(hover: hover)");
        } finally {
            vi.unstubAllGlobals();
        }
    });
});

describe("keyboard focus in the floating editor", () => {
    let stop: () => void;
    beforeEach(() => {
        vi.useFakeTimers();
        document.body.innerHTML = `
            <div data-shape-editor><input data-testid="number" /><button data-testid="button">x</button></div>
            <input data-testid="elsewhere" />`;
        stop = watchShapeEditorFocus();
    });
    afterEach(() => {
        stop();
        vi.useRealTimers();
        document.body.innerHTML = "";
    });
    const focus = (testId: string, attrs: Record<string, string> = {}) => {
        const el = document.querySelector<HTMLElement>(
            `[data-testid="${testId}"]`,
        )!;
        for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
        el.focus();
        vi.runAllTimers();
    };

    it("shows the controls while a number in the editor is typed in, and not once focus leaves", () => {
        focus("number");
        expect(useShapePointerStore.getState().editorFocus).toBe(true);
        expect(shapeCalm(false)).toBe(false);
        focus("elsewhere");
        expect(useShapePointerStore.getState().editorFocus).toBe(false);
        expect(shapeCalm(false)).toBe(true);
    });

    it("doesn't count focus a click left on one of its buttons", () => {
        focus("button", { "data-click-focus": "" });
        expect(useShapePointerStore.getState().editorFocus).toBe(false);
    });
});
