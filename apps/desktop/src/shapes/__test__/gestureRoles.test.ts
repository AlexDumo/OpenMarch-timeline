import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import FieldPropertiesTemplates from "@/global/classes/FieldProperties.templates";
import type { FieldPointer } from "@/field/editor/fieldEditor";
import * as platform from "@/shortcuts/platform";
import { NO_KEYS, type HeldKeys } from "@/input/modifierRoles";
import { boxShape } from "../box/boxShape";
import { boxHandlePoint, drawBox, type BoxParams } from "../box/boxGeometry";
import { boxTool } from "../box/boxTool";
import { pressShapeKeys } from "../field/fieldModeBase";
import { setShapeField } from "../field/shapeField";
import { shapeContextFor } from "../field/shapeFieldContext";
import { pivotPoint, rotationDegrees } from "../frame/frame";
import { frameControls } from "../frame/gestures";
import { pivotOf } from "../frame/pivot";
import { useShapeEditorStore } from "../frame/shapeEditorStore";
import { LiveBoxMode } from "../placed/liveBoxMode";
import type { PlacedBox } from "../placed/placedBox";
import { shapeToolMode } from "../tool/shapeToolMode";
import {
    closeShapeTool,
    openShapeTool,
    useShapeToolStore,
} from "../tool/shapeToolStore";
import { toolEnvFor } from "../tool/toolEnv";
import { openTool, pointerMove, press, release } from "../tool/toolMachine";
import type { XY } from "../types";

/**
 * The shape tool's gestures read held roles (version A: Shift fine, $mod constrain), follow role
 * keys pressed or released mid-drag without a pointer move, and keep the press rule: a $mod press
 * that pulls the pivot out of the center dot uses $mod, so it isn't constrain until pressed again.
 * Off a Mac here, so $mod is Ctrl.
 */

const fieldProperties =
    FieldPropertiesTemplates.COLLEGE_FOOTBALL_FIELD_NO_END_ZONES;
const STEP = fieldProperties.pixelsPerStep;
const N = 12;

const pointer = (field: XY, keys: Partial<HeldKeys> = {}): FieldPointer => ({
    field,
    screen: field,
    button: 0,
    ...NO_KEYS,
    ...keys,
});

/** A modifier key going down or up on the window, as the browser reports it */
const key = (type: "keydown" | "keyup", held: Partial<HeldKeys>) =>
    window.dispatchEvent(
        new KeyboardEvent(type, {
            shiftKey: held.shift ?? false,
            altKey: held.alt ?? false,
            ctrlKey: held.ctrl ?? false,
            metaKey: held.meta ?? false,
        }),
    );

const field = () => ({
    fieldProperties,
    zoom: () => 1,
    marchers: () => [],
    drawn: () => new Map(),
});

beforeEach(() => {
    vi.spyOn(platform, "isMacPlatform").mockReturnValue(false);
    setShapeField({
        fieldProperties: () => fieldProperties,
        zoom: () => 1,
        marchers: () => [],
        drawn: () => new Map(),
    });
});

afterEach(() => {
    shapeToolMode.cancel();
    closeShapeTool();
    setShapeField(null);
    useShapeEditorStore.setState({ ratioLocked: false });
    vi.restoreAllMocks();
});

/** An open 4 × 3 box, 4 steps apart, away from the field's lines */
function openBox(): BoxParams {
    const env = toolEnvFor(field());
    const marchers = Array.from({ length: N }, (_, i) => ({
        id: i + 1,
        at: { x: 300 + i * 7, y: 300 },
        drillRank: i,
    }));
    let t = openTool(boxTool, marchers);
    const from = { x: 30 * STEP + 1, y: 20 * STEP + 1 };
    t = press(t, from, env);
    t = pointerMove(t, { x: from.x + 12 * STEP, y: from.y + 8 * STEP }, env);
    t = release(t, shapeContextFor(field()));
    openShapeTool(t, null, null);
    return t.params as BoxParams;
}

const openParams = () => useShapeToolStore.getState().tool!.params as BoxParams;
const degreesOf = (p: BoxParams) =>
    rotationDegrees(boxTool.frameOf(p, N).rotation);

/** `p` turned `degrees` around `around` */
const turned = (p: XY, around: XY, degrees: number): XY => {
    const r = (degrees * Math.PI) / 180;
    const dx = p.x - around.x;
    const dy = p.y - around.y;
    return {
        x: around.x + dx * Math.cos(r) - dy * Math.sin(r),
        y: around.y + dx * Math.sin(r) + dy * Math.cos(r),
    };
};

describe("the open shape's frame, with role keys mid-drag", () => {
    it("turns in 15° steps, whole degrees while Shift (fine) is held, without a pointer move", () => {
        const box = openBox();
        const { knob, center } = frameControls(
            boxTool,
            box,
            N,
            toolEnvFor(field()),
        );
        shapeToolMode.press(pointer(knob));
        shapeToolMode.move(pointer(turned(knob, center, 33.4)));
        const stepped = degreesOf(openParams());
        expect(stepped % 15).toBe(0);
        expect(stepped).not.toBe(0);

        key("keydown", { shift: true });
        const fine = degreesOf(openParams());
        expect(Number.isInteger(fine)).toBe(true);
        expect(fine % 15).not.toBe(0);
        expect(Math.abs(fine - stepped)).toBe(3);

        key("keyup", {});
        expect(degreesOf(openParams())).toBe(stepped);
    });

    it("doesn't turn whole degrees with Alt, or free with $mod", () => {
        const box = openBox();
        const { knob, center } = frameControls(
            boxTool,
            box,
            N,
            toolEnvFor(field()),
        );
        shapeToolMode.press(pointer(knob));
        shapeToolMode.move(pointer(turned(knob, center, 33.4), { alt: true }));
        expect(degreesOf(openParams()) % 15).toBe(0);
        shapeToolMode.move(pointer(turned(knob, center, 33.4), { ctrl: true }));
        expect(degreesOf(openParams()) % 15).toBe(0);
    });

    it("a key before any move changes nothing, so a click stays a click", () => {
        const box = openBox();
        const { knob } = frameControls(boxTool, box, N, toolEnvFor(field()));
        shapeToolMode.press(pointer(knob));
        key("keydown", { shift: true });
        expect(openParams()).toBe(box);
    });

    it("stops following the keys once released", () => {
        const box = openBox();
        const { knob, center } = frameControls(
            boxTool,
            box,
            N,
            toolEnvFor(field()),
        );
        const to = turned(knob, center, 33.4);
        shapeToolMode.press(pointer(knob));
        shapeToolMode.move(pointer(to));
        shapeToolMode.release(pointer(to), null);
        const after = openParams();
        key("keydown", { shift: true });
        expect(openParams()).toBe(after);
    });
});

describe("the pivot pulled out with $mod (the press rule)", () => {
    it("a $mod press on the center dot takes the pivot and doesn't constrain; pressed again it's constrain", () => {
        const box = openBox();
        const { center } = boxTool.frameOf(box, N);
        const { keys, reachInside } = pressShapeKeys(
            { ...NO_KEYS, ctrl: true },
            () => ({ type: "pivot", pulled: true }),
            () => {},
        );
        try {
            expect(reachInside).toBe(true);
            expect(keys.roles().constrain).toBe(false);
            keys.update(NO_KEYS);
            keys.update({ ...NO_KEYS, ctrl: true });
            expect(keys.roles().constrain).toBe(true);
        } finally {
            keys.dispose();
        }

        // Through the tool: the pivot follows the pointer, the shape stays
        const to = { x: center.x + 2 * STEP, y: center.y - 1.5 * STEP };
        shapeToolMode.press(pointer(center, { ctrl: true }));
        expect(useShapeToolStore.getState().tool!.gesture?.type).toBe("pivot");
        shapeToolMode.move(pointer(to, { ctrl: true }));
        const moved = openParams();
        const at = pivotPoint(boxTool.frameOf(moved, N), pivotOf(moved));
        expect(at.x).toBeCloseTo(to.x, 6);
        expect(at.y).toBeCloseTo(to.y, 6);
        expect(boxTool.frameOf(moved, N)).toEqual(boxTool.frameOf(box, N));
        // Released and pressed again, $mod is constrain, which means nothing to a pivot drag
        key("keyup", {});
        key("keydown", { ctrl: true });
        expect(openParams()).toEqual(moved);
    });

    it("a $mod press anywhere else uses nothing: $mod is constrain from the press", () => {
        const { keys, reachInside } = pressShapeKeys(
            { ...NO_KEYS, ctrl: true },
            () => ({ type: "move" }),
            () => {},
        );
        try {
            expect(reachInside).toBe(true);
            expect(keys.roles().constrain).toBe(true);
        } finally {
            keys.dispose();
        }
    });

    it("a plain press on the center dot moves the shape", () => {
        const box = openBox();
        const { center } = boxTool.frameOf(box, N);
        shapeToolMode.press(pointer(center));
        expect(useShapeToolStore.getState().tool!.gesture?.type).toBe("center");
    });
});

/** A placed 2 × 2 box, 4 steps apart, away from the field's lines; marchers 1..4 */
function placed(): PlacedBox<BoxParams> {
    const env = toolEnvFor(field());
    const from = { x: 30 * STEP + 1, y: 20 * STEP + 1 };
    const params = drawBox(
        from,
        { x: from.x + 4 * STEP, y: from.y + 4 * STEP },
        4,
        env,
    )!;
    const slots = boxShape.generate(params, 4, shapeContextFor(field()));
    return {
        recipe: {
            id: 7,
            timelineId: 3,
            kind: "block",
            kindVersion: 1,
            params: { ...params, spots: 4 },
            orderMode: "nearest",
            reverse: false,
            members: slots.map((s, i) => ({
                marcherId: i + 1,
                slot: i,
                x: s.x,
                y: s.y,
            })),
        },
        kind: boxTool,
        params,
        spots: 4,
        endBeat: 8,
    };
}

describe("a placed box, with role keys mid-drag", () => {
    const queryClient = {} as QueryClient;

    it("a side handle keeps the box's proportions while $mod (constrain) flips the ratio lock, without a pointer move", () => {
        const box = placed();
        const mode = new LiveBoxMode(box, queryClient);
        const shown = () => mode.drawing()!.outline!;
        const e = boxHandlePoint(box.params, 4, "e");
        const to = { x: e.x + 3 * STEP, y: e.y };
        mode.press(pointer(e));
        mode.move(pointer(to));
        const free = shown();
        const depthOf = (outline: readonly XY[]) =>
            Math.max(...outline.map((p) => p.y)) -
            Math.min(...outline.map((p) => p.y));
        const widthOf = (outline: readonly XY[]) =>
            Math.max(...outline.map((p) => p.x)) -
            Math.min(...outline.map((p) => p.x));
        const deep = depthOf(free);
        expect(widthOf(free)).toBeGreaterThan(deep);

        key("keydown", { ctrl: true });
        const locked = shown();
        expect(depthOf(locked)).toBeGreaterThan(deep);
        expect(widthOf(locked) / depthOf(locked)).toBeCloseTo(1, 1);

        key("keyup", {});
        expect(depthOf(shown())).toBeCloseTo(deep, 6);
        mode.cancel();
    });

    it("with the ratio lock on, $mod frees the side handle for the drag", () => {
        useShapeEditorStore.setState({ ratioLocked: true });
        const box = placed();
        const mode = new LiveBoxMode(box, queryClient);
        const e = boxHandlePoint(box.params, 4, "e");
        mode.press(pointer(e));
        mode.move(pointer({ x: e.x + 3 * STEP, y: e.y }, { ctrl: true }));
        const outline = mode.drawing()!.outline!;
        const ys = outline.map((p) => p.y);
        const xs = outline.map((p) => p.x);
        expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(
            Math.max(...ys) - Math.min(...ys),
        );
        mode.cancel();
    });
});
