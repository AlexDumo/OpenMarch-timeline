import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
    type MockInstance,
} from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import FieldPropertiesTemplates from "@/global/classes/FieldProperties.templates";
import type { FieldModePress, FieldPointer } from "@/field/editor/fieldEditor";
import * as gestureKeys from "@/input/gestureKeys";
import { NO_KEYS, type HeldKeys } from "@/input/modifierRoles";
import * as platform from "@/shortcuts/platform";
import { runAction } from "@/shortcuts/registry";
import { boxShape } from "../box/boxShape";
import {
    boxHandlePoint,
    drawBox,
    type BoxHandleKey,
    type BoxParams,
} from "../box/boxGeometry";
import { boxTool } from "../box/boxTool";
import { setShapeField } from "../field/shapeField";
import { shapeContextFor } from "../field/shapeFieldContext";
import { pivotPoint, rotationDegrees } from "../frame/frame";
import { frameControls } from "../frame/gestures";
import { pivotOf } from "../frame/pivot";
import { useShapeEditorStore } from "../frame/shapeEditorStore";
import * as commit from "../placed/commitBox";
import { LiveBoxMode } from "../placed/liveBoxMode";
import type { PlacedBox } from "../placed/placedBox";
import { ShapeToolKeys } from "../tool/ShapeToolKeys";
import { shapeToolMode } from "../tool/shapeToolMode";
import {
    closeShapeTool,
    openShapeTool,
    useShapeToolStore,
} from "../tool/shapeToolStore";
import { toolEnvFor } from "../tool/toolEnv";
import type { AnyToolKind } from "../tool/toolKind";
import { openTool, pointerMove, press, release } from "../tool/toolMachine";
import type { XY } from "../types";
import { rowTool, type RowParams } from "./fakeRowKind";
import { watchKeyListeners } from "./keyListeners";

/**
 * The shape tool's gestures read held roles (version A: Shift fine, $mod constrain), follow role
 * keys pressed or released mid-drag without a pointer move, and keep the press rule: a $mod press
 * that pulls the pivot out of the center dot uses $mod, so it isn't constrain until pressed again.
 * A key changes nothing until the pointer has gone past the click slop, and the keyboard stops
 * being followed when the gesture ends however it ends. Host behavior runs on the fake row kind;
 * what only a box does (equal spacings, the ratio lock) on the box. Off a Mac here, so $mod is Ctrl.
 */

const fieldProperties =
    FieldPropertiesTemplates.COLLEGE_FOOTBALL_FIELD_NO_END_ZONES;
const STEP = fieldProperties.pixelsPerStep;
const N = 12;
/** Away from the field's lines */
const FROM = { x: 30 * STEP + 1, y: 20 * STEP + 1 };

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

/** What the field editor tells a mode of a press, off a Mac */
const OFF_MAC: FieldModePress = { reachesInside: () => false, isMac: false };

/** The key listeners on window that haven't been taken off */
let keyListeners: () => number;

beforeEach(() => {
    vi.spyOn(platform, "isMacPlatform").mockReturnValue(false);
    setShapeField({
        fieldProperties: () => fieldProperties,
        zoom: () => 1,
        marchers: () => [],
        drawn: () => new Map(),
    });
    keyListeners = watchKeyListeners();
});

afterEach(() => {
    cleanup();
    shapeToolMode.cancel();
    closeShapeTool();
    setShapeField(null);
    useShapeEditorStore.setState({ ratioLocked: false });
    vi.restoreAllMocks();
});

const marchers = Array.from({ length: N }, (_, i) => ({
    id: i + 1,
    at: { x: 300 + i * 7, y: 300 },
    drillRank: i,
}));

/** `kind` drawn from {@link FROM} to `to` and opened */
function openDrawn<P>(kind: AnyToolKind, to: XY): P {
    const env = toolEnvFor(field());
    let t = openTool(kind, marchers);
    t = press(t, FROM, env);
    t = pointerMove(t, to, env);
    t = release(t, shapeContextFor(field()));
    openShapeTool(t, null, null);
    return t.params as P;
}

/** An open row of 12, 2 steps apart */
const openRow = () =>
    openDrawn<RowParams>(rowTool, { x: FROM.x + 22 * STEP, y: FROM.y });

/** An open 4 × 3 box, 4 steps across and 3 deep */
const openBox = () =>
    openDrawn<BoxParams>(boxTool, {
        x: FROM.x + 12 * STEP,
        y: FROM.y + 6 * STEP,
    });

const openParams = <P = BoxParams>() =>
    useShapeToolStore.getState().tool!.params as P;
const gestureType = () => useShapeToolStore.getState().tool!.gesture?.type;
const degreesOf = (p: RowParams) =>
    rotationDegrees(rowTool.frameOf(p, N).rotation);

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

/** The open row's knob, and where it is turned 33.4° */
function knobTurn(row: RowParams) {
    const { knob, center } = frameControls(
        rowTool,
        row,
        N,
        toolEnvFor(field()),
    );
    return { knob, to: turned(knob, center, 33.4) };
}

describe("the open shape's frame, with role keys mid-drag", () => {
    it("turns in 15° steps, whole degrees while Shift (fine) is held, without a pointer move", () => {
        const { knob, to } = knobTurn(openRow());
        shapeToolMode.press(pointer(knob), OFF_MAC);
        shapeToolMode.move(pointer(to));
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
        const { knob, to } = knobTurn(openRow());
        shapeToolMode.press(pointer(knob), OFF_MAC);
        shapeToolMode.move(pointer(to, { alt: true }));
        expect(degreesOf(openParams()) % 15).toBe(0);
        shapeToolMode.move(pointer(to, { ctrl: true }));
        expect(degreesOf(openParams()) % 15).toBe(0);
    });
});

describe("drawing a box, with role keys mid-drag", () => {
    it("$mod (constrain) makes the spacings equal without a pointer move, and letting go undoes it", () => {
        openShapeTool(openTool(boxTool, marchers), null, null);
        shapeToolMode.press(pointer(FROM), OFF_MAC);
        expect(gestureType()).toBe("draw");
        shapeToolMode.move(
            pointer({ x: FROM.x + 12 * STEP, y: FROM.y + 6 * STEP }),
        );
        const drawn = openParams();
        expect(drawn.across).not.toBeCloseTo(drawn.deep, 6);

        key("keydown", { ctrl: true });
        const equal = openParams();
        expect(equal.across).toBeCloseTo(equal.deep, 6);

        key("keyup", {});
        expect(openParams()).toEqual(drawn);
    });
});

describe("a role key before the pointer has gone past the click slop", () => {
    it("on the open box's corner, with no move: nothing changes, so a click stays a click", () => {
        const box = openBox();
        expect(box.across).not.toBeCloseTo(box.deep, 6);
        const corner = boxHandlePoint(box, N, "se");
        shapeToolMode.press(pointer(corner), OFF_MAC);
        key("keydown", { ctrl: true });
        expect(openParams()).toBe(box);
    });

    it("on the open box's corner, after a jitter: the release is a click, and nothing changes", () => {
        const box = openBox();
        expect(box.across).not.toBeCloseTo(box.deep, 6);
        const corner = boxHandlePoint(box, N, "se");
        shapeToolMode.press(pointer(corner), OFF_MAC);
        shapeToolMode.move(pointer({ x: corner.x + 1, y: corner.y }));
        expect(openParams()).toEqual(box);
        // Released with $mod still down: its keyup would undo it
        key("keydown", { ctrl: true });
        shapeToolMode.release(pointer(corner), { double: false });
        key("keyup", {});
        expect(openParams()).toEqual(box);
    });
});

describe("the press rule, through the tool", () => {
    /** The keys used by the last press, as handed to the gesture's keys */
    const watchPress = () => {
        const start = vi.spyOn(gestureKeys, "startGestureKeys");
        return () => start.mock.calls.at(-1)![0].usedByPress;
    };

    it("a $mod press on the center dot takes the pivot and uses $mod; pressed again it's constrain, which a pivot drag ignores", () => {
        const row = openRow();
        const usedByPress = watchPress();
        const { center } = rowTool.frameOf(row, N);
        shapeToolMode.press(pointer(center, { ctrl: true }), OFF_MAC);
        expect(gestureType()).toBe("pivot");
        expect(usedByPress()).toEqual(["$mod"]);

        // The pivot follows the pointer, the shape stays
        const to = { x: center.x + 2 * STEP, y: center.y - 1.5 * STEP };
        shapeToolMode.move(pointer(to, { ctrl: true }));
        const moved = openParams<RowParams>();
        const at = pivotPoint(rowTool.frameOf(moved, N), pivotOf(moved));
        expect(at.x).toBeCloseTo(to.x, 6);
        expect(at.y).toBeCloseTo(to.y, 6);
        expect(rowTool.frameOf(moved, N)).toEqual(rowTool.frameOf(row, N));
        key("keyup", {});
        key("keydown", { ctrl: true });
        expect(openParams()).toEqual(moved);
    });

    it("a $mod press anywhere else uses nothing: it moves the shape, $mod constrain from the press", () => {
        const row = openRow();
        const usedByPress = watchPress();
        const spot = rowTool.shape.generate(
            row,
            N,
            shapeContextFor(field()),
        )[3]!;
        shapeToolMode.press(pointer(spot, { ctrl: true }), OFF_MAC);
        expect(gestureType()).toBe("move");
        expect(usedByPress()).toEqual([]);
    });

    it("a $mod press on a box corner leaves $mod constrain: the first move makes the spacings equal", () => {
        const box = openBox();
        const usedByPress = watchPress();
        const corner = boxHandlePoint(box, N, "se");
        shapeToolMode.press(pointer(corner, { ctrl: true }), OFF_MAC);
        expect(usedByPress()).toEqual([]);
        shapeToolMode.move(
            pointer({ x: corner.x + 2 * STEP, y: corner.y }, { ctrl: true }),
        );
        const equal = openParams();
        expect(equal.across).toBeCloseTo(equal.deep, 6);
    });

    it("a plain press on the center dot moves the shape", () => {
        const row = openRow();
        shapeToolMode.press(pointer(rowTool.frameOf(row, N).center), OFF_MAC);
        expect(gestureType()).toBe("center");
    });
});

describe("the open shape's keys stop being followed when its gesture ends", () => {
    it.each([
        ["released", (to: XY) => shapeToolMode.release(pointer(to), null)],
        // The pointer lost, or the tool closed mid-drag: the field editor cancels the mode
        ["cancelled", () => shapeToolMode.cancel()],
        [
            "Escaped, the pointer still down",
            () => expect(runAction("cancelAlignmentUpdates")).toBe(true),
        ],
    ])("%s", (_, end) => {
        renderHook(() => ShapeToolKeys());
        const { knob, to } = knobTurn(openRow());
        shapeToolMode.press(pointer(knob), OFF_MAC);
        shapeToolMode.move(pointer(to));
        expect(keyListeners()).toBeGreaterThan(0);
        end(to);
        expect(keyListeners()).toBe(0);
        expect(gestureType()).toBeUndefined();
        const after = openParams();
        key("keydown", { shift: true });
        expect(openParams()).toBe(after);
    });
});

/** A placed 2 × 2 box, `across` × `deep` steps apart, away from the field's lines; marchers 1..4 */
function placed(across = 4, deep = across): PlacedBox<BoxParams> {
    const env = toolEnvFor(field());
    const square = drawBox(
        FROM,
        { x: FROM.x + across * STEP, y: FROM.y + across * STEP },
        4,
        env,
    )!;
    const params = { ...square, deep: deep * STEP };
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

const depthOf = (outline: readonly XY[]) =>
    Math.max(...outline.map((p) => p.y)) - Math.min(...outline.map((p) => p.y));
const widthOf = (outline: readonly XY[]) =>
    Math.max(...outline.map((p) => p.x)) - Math.min(...outline.map((p) => p.x));

describe("a placed box, with role keys mid-drag", () => {
    let queryClient: QueryClient;
    let saved: MockInstance<typeof commit.commitBox>;
    beforeEach(() => {
        queryClient = new QueryClient();
        saved = vi.spyOn(commit, "commitBox").mockResolvedValue(undefined);
    });

    /** The box open in its field mode, its handle `at` pressed */
    function pressed(box: PlacedBox<BoxParams>, at: BoxHandleKey) {
        const mode = new LiveBoxMode(box, queryClient);
        const handle = boxHandlePoint(box.params, 4, at);
        mode.press(pointer(handle), OFF_MAC);
        return { mode, handle, shown: () => mode.drawing()!.outline! };
    }

    it("a side handle keeps the box's proportions while $mod (constrain) flips the ratio lock, without a pointer move", () => {
        const { mode, handle, shown } = pressed(placed(), "e");
        mode.move(pointer({ x: handle.x + 3 * STEP, y: handle.y }));
        const free = shown();
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
        const { mode, handle, shown } = pressed(placed(), "e");
        mode.move(
            pointer({ x: handle.x + 3 * STEP, y: handle.y }, { ctrl: true }),
        );
        expect(widthOf(shown())).toBeGreaterThan(depthOf(shown()));
        mode.cancel();
    });

    it("a key before any move changes nothing, and the release saves nothing", () => {
        const box = placed(4, 2);
        const { mode, handle, shown } = pressed(box, "se");
        const before = shown();
        key("keydown", { ctrl: true });
        expect(shown()).toEqual(before);
        mode.release(pointer(handle), { double: false });
        expect(saved).not.toHaveBeenCalled();
    });

    it("a jitter under the click slop, then $mod: the release is a click, and saves nothing", () => {
        const box = placed(4, 2);
        const { mode, handle, shown } = pressed(box, "se");
        const before = shown();
        mode.move(pointer({ x: handle.x + 1, y: handle.y }));
        expect(shown()).toEqual(before);
        // Released with $mod still down: its keyup would undo it
        key("keydown", { ctrl: true });
        expect(shown()).toEqual(before);
        mode.release(pointer(handle), { double: false });
        key("keyup", {});
        expect(saved).not.toHaveBeenCalled();
    });

    it("past the click slop, a $mod tap is a change the release saves", () => {
        const box = placed(4, 2);
        const { mode, handle } = pressed(box, "se");
        mode.move(pointer({ x: handle.x + 5, y: handle.y }));
        key("keydown", { ctrl: true });
        mode.release(pointer({ x: handle.x + 5, y: handle.y }), null);
        expect(saved).toHaveBeenCalledTimes(1);
        const params = saved.mock.calls[0]![1] as BoxParams;
        expect(params.across).toBeCloseTo(params.deep, 6);
    });

    // Escape and closing the box mid-drag reach the mode as `cancel` (the field editor's setMode)
    it.each([
        [
            "released",
            (mode: LiveBoxMode, to: XY) => mode.release(pointer(to), null),
        ],
        ["cancelled", (mode: LiveBoxMode) => mode.cancel()],
    ])("stops following the keys once %s", (_, end) => {
        const { mode, handle, shown } = pressed(placed(), "e");
        const to = { x: handle.x + 3 * STEP, y: handle.y };
        mode.move(pointer(to));
        expect(keyListeners()).toBeGreaterThan(0);
        end(mode, to);
        expect(keyListeners()).toBe(0);
        const after = shown();
        key("keydown", { ctrl: true });
        expect(shown()).toEqual(after);
    });
});
