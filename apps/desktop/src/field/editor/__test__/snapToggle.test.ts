import { describe, expect, it, vi } from "vitest";
import {
    FieldEditor,
    type DropResult,
    type FieldEditorPorts,
    type FieldPointer,
} from "../fieldEditor";
import type { MarcherPosition } from "../moveGesture";
import { ruledMove } from "../moveRules";

/**
 * The Snap toggle (modifier roles, version A) on the field editor: read on every pointer event
 * (`FieldEditorOptions.snap`), off it frees a rotation from its 15° steps, and with it a marcher
 * drag isn't rounded (`MoveRules.snap`). Marchers 1 to 4 sit in a row 100 field units apart at
 * zoom 2; the selection box runs from (100, 100) to (400, 100) and its rotate handle is 20 units
 * above it.
 */

const ZOOM = 2;
const ROTATE_HANDLE = { x: 250, y: 70 };

function setup(toggle: { on: boolean }) {
    const drops: (readonly MarcherPosition[])[] = [];
    const ports: FieldEditorPorts = {
        selection: { get: () => [1, 2, 3, 4], set: vi.fn() },
        marchers: () => ({
            ids: [1, 2, 3, 4],
            positions: Float64Array.from([
                100, 100, 200, 100, 300, 100, 400, 100,
            ]),
            hidden: new Uint8Array(4),
        }),
        zoom: () => ZOOM,
        canSelect: () => true,
        selectionBoxPadding: () => 10,
        openMenu: vi.fn(),
        showPositions: vi.fn(),
        drop: vi.fn((positions) => {
            drops.push(positions);
            return new Promise<DropResult>(() => {});
        }),
    };
    const snap = () => toggle.on;
    const editor = new FieldEditor(ports, {
        snap,
        // Rounding to whole steps of 10 units
        moveTransform: ruledMove(() => ({
            rounding: { nearestXSteps: 1, nearestYSteps: 1 },
            lockX: false,
            lockY: false,
            grid: {
                centerFrontPoint: { xPixels: 0, yPixels: 0 },
                pixelsPerStep: 10,
            },
            snap: snap(),
        })),
    });
    return { editor, drops };
}

const at = (x: number, y: number): FieldPointer => ({
    field: { x, y },
    screen: { x: x * ZOOM, y: y * ZOOM },
    button: 0,
    shift: false,
    alt: false,
    ctrl: false,
    meta: false,
});

/** The pointer turned `degrees` clockwise about the box's center (250, 100), 30 units out */
const turnedTo = (degrees: number) => {
    const radians = ((degrees - 90) * Math.PI) / 180;
    return at(250 + 30 * Math.cos(radians), 100 + 30 * Math.sin(radians));
};

describe("rotating the selection with the Snap toggle", () => {
    it("off, turns freely", () => {
        const { editor } = setup({ on: false });
        editor.pointerDown(at(ROTATE_HANDLE.x, ROTATE_HANDLE.y));
        editor.pointerMove(turnedTo(37));
        expect(editor.rotationFrame()?.angle).toBeCloseTo(37, 6);
        editor.pointerCancel();
    });

    it("on, turns in 15° steps", () => {
        const { editor } = setup({ on: true });
        editor.pointerDown(at(ROTATE_HANDLE.x, ROTATE_HANDLE.y));
        editor.pointerMove(turnedTo(37));
        expect(editor.rotationFrame()?.angle).toBe(30);
        editor.pointerCancel();
    });

    it("turned off mid-drag, turns freely from the next move, and drops what's drawn", () => {
        const toggle = { on: true };
        const { editor, drops } = setup(toggle);
        editor.pointerDown(at(ROTATE_HANDLE.x, ROTATE_HANDLE.y));
        editor.pointerMove(turnedTo(37));
        expect(editor.rotationFrame()?.angle).toBe(30);
        toggle.on = false;
        editor.pointerMove(turnedTo(38));
        expect(editor.rotationFrame()?.angle).toBeCloseTo(38, 6);
        editor.pointerUp(turnedTo(38));
        // Marcher 1, 150 units left of the center, turned 38° clockwise
        const [first] = drops[0]!;
        const r = (38 * Math.PI) / 180;
        expect(first!.x).toBeCloseTo(250 - 150 * Math.cos(r), 2);
        expect(first!.y).toBeCloseTo(100 - 150 * Math.sin(r), 2);
    });
});

describe("dragging a marcher with the Snap toggle", () => {
    it("off, isn't rounded", () => {
        const { editor, drops } = setup({ on: false });
        editor.pointerDown(at(200, 100));
        editor.pointerMove(at(213, 104));
        editor.pointerUp(at(213, 104));
        // The four selected move together, each by exactly the pointer's delta
        expect(drops[0]![1]).toEqual({ id: 2, x: 213, y: 104 });
    });

    it("on, moves in whole rounding steps", () => {
        const { editor, drops } = setup({ on: true });
        editor.pointerDown(at(200, 100));
        editor.pointerMove(at(213, 104));
        editor.pointerUp(at(213, 104));
        expect(drops[0]![1]).toEqual({ id: 2, x: 210, y: 100 });
    });
});
