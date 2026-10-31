import { afterEach, describe, expect, it } from "vitest";
import type { FieldModeDrawing } from "@/field/editor/fieldEditor";
import {
    HIDE_MARCHERS_TAP_MS,
    isHiding,
    pressHide,
    pressHideMarchers,
    releaseHide,
    shapeAlone,
    SHOWN,
    toggleHide,
    toggleHideMarchers,
    useMarchersHiddenStore,
} from "../field/marchersHidden";
import { useBoxSelectionStore } from "../placed/boxSelectionStore";
import type { PlacedBox } from "../placed/placedBox";
import {
    closeShapeTool,
    openShapeTool,
    updateTool,
    useShapeToolStore,
} from "../tool/shapeToolStore";
import { openTool } from "../tool/toolMachine";
import { polyTool, rowTool } from "./fakeRowKind";

/**
 * Seeing a shape on its own (#558): hold H to hide the marchers, its spots and walks, let go to
 * show them; a tap latches them hidden until the next tap. Every shape session starts with them
 * shown (owner), and only the drawing changes.
 */

const marchers = Array.from({ length: 4 }, (_, i) => ({
    id: i + 1,
    at: { x: 300 + i * 7, y: 300 },
    drillRank: i,
}));

const hiding = () => isHiding(useMarchersHiddenStore.getState());

afterEach(() => {
    closeShapeTool();
    useBoxSelectionStore.setState({ selected: null });
    useMarchersHiddenStore.setState(SHOWN, true);
});

describe("the hide key", () => {
    it("hides while held and shows again on a long release", () => {
        const held = pressHide(SHOWN, 1000);
        expect(isHiding(held)).toBe(true);
        const letGo = releaseHide(held, 1000 + HIDE_MARCHERS_TAP_MS + 50);
        expect(isHiding(letGo)).toBe(false);
    });

    it("latches on a tap, and the next tap shows them again", () => {
        const tapped = releaseHide(pressHide(SHOWN, 1000), 1100);
        expect(tapped.latched).toBe(true);
        expect(isHiding(tapped)).toBe(true);
        // Held again while latched: still hidden, and a long hold leaves the latch on
        const holding = pressHide(tapped, 2000);
        expect(isHiding(holding)).toBe(true);
        expect(isHiding(releaseHide(holding, 3000))).toBe(true);
        const untapped = releaseHide(pressHide(tapped, 2000), 2100);
        expect(isHiding(untapped)).toBe(false);
    });

    it("ignores a repeat while held, so the press time stays the first", () => {
        const held = pressHide(SHOWN, 1000);
        expect(pressHide(held, 1200)).toBe(held);
    });

    it("lets go of a key lost to the window's focus without latching", () => {
        const lost = releaseHide(pressHide(SHOWN, 1000), 1050, true);
        expect(isHiding(lost)).toBe(false);
    });

    it("the eye button turns the latch over", () => {
        expect(isHiding(toggleHide(SHOWN))).toBe(true);
        expect(isHiding(toggleHide(toggleHide(SHOWN)))).toBe(false);
    });
});

describe("each shape session starts with the marchers shown", () => {
    it("opening a shape shows them, and closing it does too", () => {
        toggleHideMarchers();
        openShapeTool(openTool(rowTool, marchers), null, null);
        expect(hiding()).toBe(false);

        toggleHideMarchers();
        expect(hiding()).toBe(true);
        closeShapeTool();
        expect(hiding()).toBe(false);
    });

    it("a new shape at a new moment shows them again", () => {
        openShapeTool(openTool(rowTool, marchers), null, null);
        toggleHideMarchers();
        openShapeTool(openTool(rowTool, marchers), null, {
            key: "elsewhere",
        } as never);
        expect(hiding()).toBe(false);
    });

    it("turning the open shape into another kind keeps them as they were", () => {
        openShapeTool(openTool(rowTool, marchers), null, null);
        toggleHideMarchers();
        updateTool(() => openTool(polyTool, marchers));
        expect(hiding()).toBe(true);
    });

    it("selecting another placed shape, or none, shows them", () => {
        const placed = (id: number) =>
            ({ recipe: { id } }) as unknown as PlacedBox;
        useBoxSelectionStore.setState({ selected: placed(1) });
        toggleHideMarchers();
        // The same shape read back after a save keeps the state
        useBoxSelectionStore.setState({ selected: placed(1) });
        expect(hiding()).toBe(true);
        useBoxSelectionStore.setState({ selected: placed(2) });
        expect(hiding()).toBe(false);
        toggleHideMarchers();
        useBoxSelectionStore.setState({ selected: null });
        expect(hiding()).toBe(false);
    });
});

describe("only the drawing changes", () => {
    it("hiding leaves the open shape, its history and the box selection alone", () => {
        openShapeTool(openTool(rowTool, marchers), null, null);
        const before = useShapeToolStore.getState();
        const selection = useBoxSelectionStore.getState();
        pressHideMarchers(1000);
        toggleHideMarchers();
        expect(useShapeToolStore.getState()).toBe(before);
        expect(useBoxSelectionStore.getState()).toBe(selection);
    });

    it("draws the shape alone: outline, handles and guides, no spots, ghosts or walks", () => {
        const p = { x: 1, y: 2 };
        const drawing: FieldModeDrawing = {
            outline: [p, p, p],
            spots: [p],
            walks: [{ from: p, to: p }],
            handles: [p],
            rings: [p],
            ringIds: [1],
            gaps: [p],
            labels: [{ at: p, text: "A1" }],
            onGuides: [p],
            guides: [{ from: p, to: p }],
            centerDot: p,
        };
        const alone = shapeAlone(drawing);
        expect(alone.spots).toEqual([]);
        expect(alone.walks).toEqual([]);
        expect(alone.rings ?? []).toEqual([]);
        expect(alone.ringIds ?? []).toEqual([]);
        expect(alone.gaps ?? []).toEqual([]);
        expect(alone.labels ?? []).toEqual([]);
        expect(alone.onGuides ?? []).toEqual([]);
        expect(alone.outline).toBe(drawing.outline);
        expect(alone.handles).toBe(drawing.handles);
        expect(alone.guides).toBe(drawing.guides);
        expect(alone.centerDot).toBe(drawing.centerDot);
    });
});
