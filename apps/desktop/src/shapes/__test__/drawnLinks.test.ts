import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FieldPropertiesTemplates from "@/global/classes/FieldProperties.templates";
import type { FieldModePress, FieldPointer } from "@/field/editor/fieldEditor";
import { NO_KEYS } from "@/input/modifierRoles";
import * as platform from "@/shortcuts/platform";
import { setShapeField } from "../field/shapeField";
import { shapeContextFor } from "../field/shapeFieldContext";
import { lineShape } from "../line/lineShape";
import { lineSpots, type LineParams } from "../line/lineGeometry";
import { endPoint } from "../line/lineLinks";
import { lineTool } from "../line/lineTool";
import { useLinkDragStore } from "../placed/linkDragStore";
import { boxesAt, type PlacedBox } from "../placed/placedBox";
import { removeLastShapePoint, shapeToolMode } from "../tool/shapeToolMode";
import { placementOf } from "../tool/shapePlacement";
import {
    closeShapeTool,
    openShapeTool,
    updateTool,
    useShapeToolStore,
} from "../tool/shapeToolStore";
import { finishPoints, openTool } from "../tool/toolMachine";
import type { XY } from "../types";

/**
 * Linking a new Line while it's drawn (#1235): through the shape tool's field mode, a drag that
 * starts on a placed line's free end, or an end handle dragged onto one before Place, lands
 * exactly on it with a ring there and the readout saying letting go links them; the open shape
 * then holds the attachment Place saves, and loses it once its end leaves the joint.
 */

const placed: { boxes: PlacedBox[] } = { boxes: [] };
vi.mock("../placed/placedBoxStore", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../placed/placedBoxStore")>()),
    placedBoxesAt: () => placed.boxes,
}));

const fieldProperties =
    FieldPropertiesTemplates.COLLEGE_FOOTBALL_FIELD_NO_END_ZONES;
const STEP = fieldProperties.pixelsPerStep;
const OFF_MAC: FieldModePress = { reachesInside: () => false, isMac: false };

const pointer = (field: XY, keys = NO_KEYS): FieldPointer => ({
    field,
    screen: field,
    button: 0,
    kind: "mouse",
    ...keys,
});

/** The placed line: straight down from (30, 20) steps to (30, 28), its bottom end free */
const TOP = { x: 30 * STEP, y: 20 * STEP };
const BOTTOM = { x: 30 * STEP, y: 28 * STEP };
function placeLine(): void {
    const params: LineParams = {
        points: [
            { ...TOP, tension: 0 },
            { ...BOTTOM, tension: 0 },
        ],
        spacing: { mode: "fit" },
    };
    const spots = lineSpots(params, 4);
    const at = new Map(spots.map((p, i) => [101 + i, { x: p.x, y: p.y }]));
    placed.boxes = boxesAt({
        recipes: [
            {
                id: 7,
                timelineId: 5,
                kind: lineShape.id,
                kindVersion: lineShape.version,
                params: { ...params, spots: 4 },
                orderMode: "nearest",
                reverse: false,
                members: spots.map((p, slot) => ({
                    marcherId: 101 + slot,
                    slot,
                    x: p.x,
                    y: p.y,
                })),
            },
        ],
        endBeatOf: () => 0,
        beat: 0,
        positionOf: (id) => at.get(id),
    });
}

const marchers = Array.from({ length: 5 }, (_, i) => ({
    id: i + 1,
    at: { x: 600 + i * 12, y: 300 },
}));

const openParams = () =>
    useShapeToolStore.getState().tool!.params as LineParams;
const tipText = () => {
    const drawing = shapeToolMode.drawing();
    return drawing?.tip?.text ?? "";
};

/** A new line drawn by a drag from `from` to `to` through the field mode */
function drag(from: XY, to: XY, keys = NO_KEYS): void {
    shapeToolMode.press(pointer(from, keys), OFF_MAC);
    shapeToolMode.move(pointer(to, keys));
}

beforeEach(() => {
    vi.spyOn(platform, "isMacPlatform").mockReturnValue(false);
    setShapeField({
        fieldProperties: () => fieldProperties,
        zoom: () => 1,
        marchers: () => [],
        drawn: () => new Map(),
    });
    placeLine();
    openShapeTool(openTool(lineTool, marchers), null, null);
});

afterEach(() => {
    shapeToolMode.cancel();
    closeShapeTool();
    setShapeField(null);
    placed.boxes = [];
    vi.restoreAllMocks();
});

describe("drawing a new line from a placed line's end", () => {
    it("starts exactly on it, rings it, and says releasing links them", () => {
        const far = { x: 40 * STEP, y: 28 * STEP };
        drag({ x: BOTTOM.x + 3, y: BOTTOM.y - 2 }, far);
        expect(endPoint(openParams(), "start")).toEqual(BOTTOM);
        expect(openParams().attach).toEqual({
            start: { recipe: 7, end: "end" },
        });
        expect(useLinkDragStore.getState().ring).toEqual(BOTTOM);
        expect(tipText()).toBe("Release to link to Line");

        shapeToolMode.release(pointer(far), null);
        expect(useLinkDragStore.getState().ring).toBeNull();
        expect(tipText()).not.toContain("link");
        // Place saves the link: the new line's start holds no marcher
        const placement = placementOf(
            useShapeToolStore.getState().tool!,
            shapeContextFor({
                fieldProperties: () => fieldProperties,
                zoom: () => 1,
                marchers: () => [],
                drawn: () => new Map(),
            }),
        )!;
        expect((placement.recipe.params as LineParams).attach).toEqual({
            start: { recipe: 7, end: "end" },
        });
        expect(
            placement.members.some(
                (m) => Math.hypot(m.x - BOTTOM.x, m.y - BOTTOM.y) < 1e-6,
            ),
        ).toBe(false);
    });

    it("ends exactly on it when the drag ends there", () => {
        drag(
            { x: 40 * STEP, y: 28 * STEP },
            { x: BOTTOM.x + 4, y: BOTTOM.y + 3 },
        );
        expect(endPoint(openParams(), "end")).toEqual(BOTTOM);
        expect(openParams().attach).toEqual({
            end: { recipe: 7, end: "end" },
        });
    });

    it("doesn't link out of reach", () => {
        drag({ x: BOTTOM.x + 30, y: BOTTOM.y }, { x: 40 * STEP, y: 28 * STEP });
        expect(useShapeToolStore.getState().tool!.gesture?.type).toBe("draw");
        expect(openParams().attach).toBeUndefined();
        expect(useLinkDragStore.getState().ring).toBeNull();
    });

    it("doesn't link with constrain ($mod) held, a way to draw without linking", () => {
        drag(
            { x: BOTTOM.x + 3, y: BOTTOM.y },
            { x: 40 * STEP, y: 28 * STEP },
            { ...NO_KEYS, ctrl: true },
        );
        expect(useShapeToolStore.getState().tool!.gesture?.type).toBe("draw");
        expect(openParams().attach).toBeUndefined();
        expect(useLinkDragStore.getState().ring).toBeNull();
    });

    it("links an end handle dragged onto it before Place, and drops the link once the end leaves", () => {
        const from = { x: 40 * STEP, y: 30 * STEP };
        const to = { x: 40 * STEP, y: 36 * STEP };
        drag(from, to);
        shapeToolMode.release(pointer(to), null);
        expect(openParams().attach).toBeUndefined();
        // The start's handle dragged to just off the placed line's end
        shapeToolMode.press(pointer(from), OFF_MAC);
        expect(useShapeToolStore.getState().tool!.gesture?.type).toBe("handle");
        shapeToolMode.move(pointer({ x: BOTTOM.x + 2, y: BOTTOM.y + 3 }));
        expect(tipText()).toBe("Release to link to Line");
        shapeToolMode.release(
            pointer({ x: BOTTOM.x + 2, y: BOTTOM.y + 3 }),
            null,
        );
        expect(endPoint(openParams(), "start")).toEqual(BOTTOM);
        expect(openParams().attach).toEqual({
            start: { recipe: 7, end: "end" },
        });
        // Moved off by anything else (a key, a number): it holds its marcher again
        updateTool((t) => ({
            ...t,
            params: {
                ...(t.params as LineParams),
                points: (t.params as LineParams).points.map((q) => ({
                    ...q,
                    x: q.x + STEP,
                })),
            },
        }));
        expect(openParams().attach).toBeUndefined();
    });
});

describe("drawing a new line by clicking its points from or to a placed line's end", () => {
    const FAR = { x: 40 * STEP, y: 28 * STEP };
    const NEAR = { x: BOTTOM.x + 3, y: BOTTOM.y - 2 };

    /** A click at `at`: the press and its release where it was */
    function click(at: XY, keys = NO_KEYS, double = false): void {
        shapeToolMode.press(pointer(at, keys), OFF_MAC);
        shapeToolMode.release(pointer(at, keys), { double });
    }
    /** The pointer resting at `at` between clicks, as the field asks for the cursor there */
    const hover = (at: XY, keys = NO_KEYS) =>
        shapeToolMode.cursorAt(pointer(at, keys));
    /** Enter: the clicked points finished */
    const enter = () =>
        updateTool((t) =>
            finishPoints(
                t,
                shapeContextFor({
                    fieldProperties: () => fieldProperties,
                    zoom: () => 1,
                    marchers: () => [],
                    drawn: () => new Map(),
                }),
            ),
        );
    const gesture = () => useShapeToolStore.getState().tool!.gesture;

    it("rings the end before the first click and says a click links them", () => {
        hover(NEAR);
        expect(useLinkDragStore.getState().ring).toEqual(BOTTOM);
        expect(tipText()).toBe("Click to link to Line");
        // Off it, nothing
        hover(FAR);
        expect(useLinkDragStore.getState().ring).toBeNull();
        expect(tipText()).not.toContain("link");
    });

    it("starts exactly on it when the first point is clicked there, and Place saves the link", () => {
        click(NEAR);
        expect(gesture()?.type).toBe("points");
        click(FAR);
        enter();
        expect(gesture()).toBeNull();
        expect(endPoint(openParams(), "start")).toEqual(BOTTOM);
        expect(openParams().attach).toEqual({
            start: { recipe: 7, end: "end" },
        });
        const placement = placementOf(
            useShapeToolStore.getState().tool!,
            shapeContextFor({
                fieldProperties: () => fieldProperties,
                zoom: () => 1,
                marchers: () => [],
                drawn: () => new Map(),
            }),
        )!;
        expect((placement.recipe.params as LineParams).attach).toEqual({
            start: { recipe: 7, end: "end" },
        });
        // The joint holds the placed line's marcher, not one of the new line's
        expect(
            placement.members.some(
                (m) => Math.hypot(m.x - BOTTOM.x, m.y - BOTTOM.y) < 1e-6,
            ),
        ).toBe(false);
    });

    it("ends exactly on it when the last point is clicked there, ringing it first", () => {
        click(FAR);
        hover({ x: BOTTOM.x - 2, y: BOTTOM.y + 3 });
        expect(useLinkDragStore.getState().ring).toEqual(BOTTOM);
        expect(tipText()).toBe("Click to link to Line");
        // The preview already lands there
        expect(endPoint(openParams(), "end")).toEqual(BOTTOM);
        click({ x: BOTTOM.x - 2, y: BOTTOM.y + 3 });
        // A double-click there finishes the line
        click({ x: BOTTOM.x - 2, y: BOTTOM.y + 3 }, NO_KEYS, true);
        expect(gesture()).toBeNull();
        expect(endPoint(openParams(), "end")).toEqual(BOTTOM);
        expect(openParams().attach).toEqual({
            end: { recipe: 7, end: "end" },
        });
        expect(useLinkDragStore.getState().ring).toBeNull();
    });

    it("finishes linked with Enter after the last point, too", () => {
        click(FAR);
        click(NEAR);
        enter();
        expect(openParams().attach).toEqual({
            end: { recipe: 7, end: "end" },
        });
    });

    it("doesn't link a middle point clicked on it, only the line's ends", () => {
        click(FAR);
        click(NEAR);
        click({ x: 30 * STEP, y: 36 * STEP });
        enter();
        expect(openParams().points).toHaveLength(3);
        expect(openParams().attach).toBeUndefined();
    });

    it("links a point that's the last again once the one after it is taken back", () => {
        click(FAR);
        click(NEAR);
        click({ x: 30 * STEP, y: 36 * STEP });
        expect(removeLastShapePoint()).toBe(true);
        enter();
        expect(openParams().attach).toEqual({
            end: { recipe: 7, end: "end" },
        });
    });

    it("doesn't link with constrain ($mod) held, a way to click without linking", () => {
        const ctrl = { ...NO_KEYS, ctrl: true };
        hover(NEAR, ctrl);
        expect(useLinkDragStore.getState().ring).toBeNull();
        click(NEAR, ctrl);
        click(FAR);
        enter();
        expect(openParams().attach).toBeUndefined();
        expect(endPoint(openParams(), "start")).not.toEqual(BOTTOM);
    });

    it("doesn't link out of reach", () => {
        click({ x: BOTTOM.x + 30, y: BOTTOM.y });
        hover(FAR);
        click(FAR);
        enter();
        expect(openParams().attach).toBeUndefined();
        expect(useLinkDragStore.getState().ring).toBeNull();
    });

    it("never links a closed line: a click on the first point closes it", () => {
        click(NEAR);
        click(FAR);
        click({ x: 36 * STEP, y: 36 * STEP });
        // On the first point, which is on the placed line's end
        click(BOTTOM);
        expect(gesture()).toBeNull();
        expect(openParams().closed).toBe(true);
        expect(openParams().attach).toBeUndefined();
    });
});
