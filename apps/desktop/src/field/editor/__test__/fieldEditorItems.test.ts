import { describe, expect, it, vi } from "vitest";
import {
    FieldEditor,
    type DropResult,
    type FieldEditorPorts,
    type FieldPoint,
    type FieldPointer,
} from "../fieldEditor";
import type { MarcherPosition } from "../moveGesture";

const ZOOM = 2;

/**
 * Marcher 1 at (100, 100), marcher 3 at (300, 100), and item 2 centered on
 * (300, 100): an Outline from x 250 to 350 and y 80 to 120, under marcher 3.
 */
function setup({ dimmed = [] as number[] } = {}) {
    const state = {
        selected: [] as readonly number[],
        drops: [] as readonly MarcherPosition[][],
    };
    const ports: FieldEditorPorts = {
        selection: {
            get: () => state.selected,
            set: vi.fn((ids: readonly number[]) => {
                state.selected = ids;
            }),
        },
        marchers: () => ({
            ids: [1, 2, 3],
            positions: Float64Array.from([100, 100, 300, 100, 300, 100]),
        }),
        isItem: (id) => id === 2,
        itemAt: (point: FieldPoint) =>
            point.x >= 250 && point.x <= 350 && point.y >= 80 && point.y <= 120
                ? 2
                : null,
        zoom: () => ZOOM,
        canSelect: (id) => !dimmed.includes(id),
        showPositions: vi.fn(),
        drop: vi.fn((positions: readonly MarcherPosition[]) => {
            state.drops = [...state.drops, [...positions]];
            return Promise.resolve<DropResult>("saved");
        }),
    };
    return { editor: new FieldEditor(ports, { now: () => 0 }), state };
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

const click = (editor: FieldEditor, x: number, y: number) => {
    editor.pointerDown(at(x, y));
    editor.pointerUp(at(x, y));
};

describe("FieldEditor with items", () => {
    it("selects an item clicked anywhere inside its Outline", () => {
        const { editor, state } = setup();
        click(editor, 340, 115);
        expect(state.selected).toEqual([2]);
    });

    it("selects a marcher standing on an item, not the item", () => {
        const { editor, state } = setup();
        click(editor, 301, 100);
        expect(state.selected).toEqual([3]);
    });

    it("passes over a dimmed item", () => {
        const { editor, state } = setup({ dimmed: [2] });
        click(editor, 340, 115);
        expect(state.selected).toEqual([]);
    });

    it("moves an item dragged from inside its Outline, through the drop", () => {
        const { editor, state } = setup();
        editor.pointerDown(at(340, 115));
        editor.pointerMove(at(360, 115));
        editor.pointerUp(at(360, 115));
        expect(state.selected).toEqual([2]);
        expect(state.drops).toEqual([[{ id: 2, x: 320, y: 100 }]]);
    });
});
