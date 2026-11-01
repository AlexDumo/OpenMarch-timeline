import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import FieldPropertiesTemplates from "@/global/classes/FieldProperties.templates";
import { lineTool } from "../../line/lineTool";
import type { LineParams } from "../../line/lineGeometry";
import { setShapeField } from "../../field/shapeField";
import { shapeContextFor } from "../../field/shapeFieldContext";
import {
    closeShapeTool,
    openShapeTool,
    updateTool,
    useShapeToolStore,
} from "../../tool/shapeToolStore";
import { toolEnvFor } from "../../tool/toolEnv";
import {
    openTool,
    pointerMove,
    press,
    release,
    undo,
} from "../../tool/toolMachine";
import { ShapeEditor } from "../ShapeEditorBar";
import { stubPointerCapture } from "./pointerEvents";

/**
 * A Line's interval lock and Offset in the real floating editor (owner decisions on #522, #527):
 * a lock button beside the interval, beside the group menu with mixed intervals, each press one
 * undo step; Offset's two numbers, each with the way it measures after it.
 */

const fieldProperties =
    FieldPropertiesTemplates.COLLEGE_FOOTBALL_FIELD_NO_END_ZONES;
const STEP = fieldProperties.pixelsPerStep;
const field = {
    fieldProperties: () => fieldProperties,
    zoom: () => 1,
    marchers: () => [],
    drawn: () => new Map(),
};
const marchers = Array.from({ length: 8 }, (_, i) => ({
    id: i + 1,
    at: { x: 300 + i * 7, y: 300 },
    drillRank: i,
}));

const tool = () => useShapeToolStore.getState().tool!;
const spacing = () => (tool().params as LineParams).spacing;

function renderEditor() {
    render(
        <QueryClientProvider client={new QueryClient()}>
            <ShapeEditor stepPx={STEP} />
        </QueryClientProvider>,
    );
}

/** Opens a number for typing, as a keyboard or screen reader does, and types `text` */
function typeInto(testId: string, text: string) {
    fireEvent.click(screen.getByTestId(testId), { detail: 0 });
    const input = screen.getByTestId(`${testId}-input`);
    act(() => input.focus());
    fireEvent.change(input, { target: { value: text } });
    fireEvent.keyDown(input, { key: "Enter" });
}

const lockButton = () => screen.getByTestId("shape-editor-interval-lock");

let restorePointerCapture: () => void;
beforeEach(() => {
    vi.stubGlobal(
        "ResizeObserver",
        class {
            observe() {}
            unobserve() {}
            disconnect() {}
        },
    );
    restorePointerCapture = stubPointerCapture();
    setShapeField(field);
    const ctx = { ...field, fieldProperties };
    const env = toolEnvFor(ctx);
    let t = openTool(lineTool, marchers);
    t = press(t, { x: 30 * STEP, y: 20 * STEP }, env);
    t = pointerMove(t, { x: 44 * STEP, y: 20 * STEP }, env);
    t = release(t, shapeContextFor(ctx));
    openShapeTool(t, null, null);
});

afterEach(() => {
    cleanup();
    closeShapeTool();
    setShapeField(null);
    restorePointerCapture();
    localStorage.clear();
    vi.unstubAllGlobals();
});

describe("a line's interval lock in the floating editor", () => {
    it("sits beside the interval, unlocked, and locks and unlocks in one undo step each", () => {
        renderEditor();
        expect(lockButton().getAttribute("aria-pressed")).toBe("false");
        expect(lockButton().getAttribute("aria-label")).toBe(
            "Lock the interval, so dragging an end keeps it",
        );
        const steps = tool().past.length;
        fireEvent.click(lockButton());
        expect(spacing().mode).toBe("keep");
        expect(tool().past.length).toBe(steps + 1);
        expect(lockButton().getAttribute("aria-pressed")).toBe("true");
        expect(lockButton().getAttribute("aria-label")).toBe(
            "Interval locked: dragging an end keeps it. Click to unlock",
        );
        fireEvent.click(lockButton());
        expect(spacing().mode).toBe("fit");
        expect(tool().past.length).toBe(steps + 2);
        act(() => updateTool(undo));
        expect(spacing().mode).toBe("keep");
    });

    it("leaves a typed interval unlocked", () => {
        renderEditor();
        typeInto("shape-editor-interval", "3");
        expect(spacing()).toEqual({
            mode: "fit",
            groups: [{ interval: 3 * STEP }],
        });
        expect(lockButton().getAttribute("aria-pressed")).toBe("false");
    });

    it("sits beside the group menu with mixed intervals, covering every group", () => {
        renderEditor();
        typeInto("shape-editor-interval", "2*3+4*2");
        expect(screen.getByTestId("shape-groups-menu")).toBeTruthy();
        fireEvent.click(lockButton());
        expect(spacing()).toEqual({
            mode: "keep",
            groups: [
                { interval: 3 * STEP, count: 2 },
                { interval: 2 * STEP, count: 4 },
            ],
        });
    });

    it("shows Offset as two numbers, each with the way it measures after it", () => {
        renderEditor();
        const t = tool();
        const measured = lineTool.choices!.find((c) => c.key === "measured")!;
        const env = toolEnvFor({ ...field, fieldProperties });
        // Turned to a diagonal first: across 14 steps, 7 deep
        const diagonal = {
            ...(t.params as LineParams),
            points: [
                { x: 30 * STEP, y: 20 * STEP, tension: 0 },
                { x: 44 * STEP, y: 27 * STEP, tension: 0 },
            ],
        };
        act(() =>
            useShapeToolStore.setState({
                tool: {
                    ...t,
                    params: measured.pick(diagonal, t.spots, "offset", env),
                },
            }),
        );
        expect(screen.queryByTestId("shape-editor-interval")).toBeNull();
        expect(screen.getByTestId("shape-editor-offsetX").textContent).toBe(
            "2",
        );
        expect(screen.getByTestId("shape-editor-offsetY").textContent).toBe(
            "1",
        );
        typeInto("shape-editor-offsetY", "1.5");
        expect((tool().params as LineParams).offset).toEqual({
            x: 2 * STEP,
            y: 1.5 * STEP,
        });
        expect(lockButton()).toBeTruthy();
    });
});
