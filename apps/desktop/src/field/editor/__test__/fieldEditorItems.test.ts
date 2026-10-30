// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
    FieldEditor,
    type DropResult,
    type FieldEditorPorts,
    type FieldPoint,
    type FieldPointer,
} from "../fieldEditor";
import type { MarcherPosition } from "../moveGesture";
import type { ItemFrame, ItemSize } from "../itemTransform";

const ZOOM = 2;

/**
 * Marcher 1 at (100, 100), marcher 3 at (300, 100), and item 2 centered on
 * (300, 100): an Outline from x 250 to 350 and y 80 to 120, under marcher 3.
 */
function setup({
    dimmed = [] as number[],
    selected = [] as number[],
    rotation = 0,
    save = "saved" as DropResult,
} = {}) {
    const state = {
        selected: [...selected] as readonly number[],
        drops: [] as readonly MarcherPosition[][],
        /** The size and turn the field draws item 2 at, while one is dragged */
        preview: null as ItemSize | null,
        /** Each size and turn saved for item 2 */
        saves: [] as ItemSize[],
    };
    const frame: ItemFrame = {
        center: { x: 300, y: 100 },
        width: 100,
        depth: 40,
        rotation,
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
        itemFrame: (id) => (id === 2 ? frame : null),
        previewItem: (id, size) => {
            state.preview = size;
        },
        saveItem: vi.fn((id: number, size: ItemSize) => {
            state.saves.push(size);
            return Promise.resolve(save);
        }),
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

    it("selects every performer with Ctrl/Cmd+A, and no item", () => {
        const { editor, state } = setup();
        editor.selectAll();
        expect(state.selected).toEqual([1, 3]);
    });

    it("marquees the performers over an item, and not the item", () => {
        const { editor, state } = setup();
        editor.pointerDown(at(50, 50));
        editor.pointerMove(at(400, 150));
        editor.pointerUp(at(400, 150));
        expect(state.selected).toEqual([1, 3]);
    });

    it("marquees an item when no performer is inside", () => {
        // Marcher 3 stands on the item; dimmed, it can't be selected
        const { editor, state } = setup({ dimmed: [3] });
        editor.pointerDown(at(200, 50));
        editor.pointerMove(at(400, 150));
        editor.pointerUp(at(400, 150));
        expect(state.selected).toEqual([2]);
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

    describe("with one item selected", () => {
        const drag = (
            editor: FieldEditor,
            from: FieldPoint,
            to: FieldPoint,
            { release = true } = {},
        ) => {
            editor.pointerDown(at(from.x, from.y));
            editor.pointerMove(at(to.x, to.y));
            if (release) editor.pointerUp(at(to.x, to.y));
        };

        it("resizes it about its center from a side handle, without moving it", async () => {
            const { editor, state } = setup({ selected: [2] });
            drag(
                editor,
                { x: 350, y: 100 },
                { x: 370, y: 100 },
                {
                    release: false,
                },
            );
            expect(editor.activeGesture()).toBe("scale");
            expect(state.preview).toEqual({
                width: 140,
                depth: 40,
                rotation: 0,
            });
            editor.pointerUp(at(370, 100));
            expect(state.saves).toEqual([
                { width: 140, depth: 40, rotation: 0 },
            ]);
            expect(state.drops).toEqual([]);
            await Promise.resolve();
            expect(state.preview).toBeNull();
        });

        it("resizes both ways from a corner", () => {
            const { editor, state } = setup({ selected: [2] });
            drag(editor, { x: 350, y: 120 }, { x: 360, y: 130 });
            expect(state.saves).toEqual([
                { width: 120, depth: 60, rotation: 0 },
            ]);
        });

        it("resizes along the item's own sides when it's turned", () => {
            // Turned 90° clockwise, its east side faces down
            const { editor, state } = setup({ selected: [2], rotation: 90 });
            drag(editor, { x: 300, y: 150 }, { x: 300, y: 170 });
            expect(state.saves[0].width).toBeCloseTo(140);
            expect(state.saves[0].depth).toBeCloseTo(40);
            expect(state.saves[0].rotation).toBe(90);
        });

        it("never shrinks it past its center into nothing", () => {
            const { editor, state } = setup({ selected: [2] });
            drag(editor, { x: 350, y: 100 }, { x: 250, y: 100 });
            expect(state.saves[0].width).toBeGreaterThan(0);
        });

        it("turns it from the rotate handle, snapped to 15°", () => {
            const { editor, state } = setup({ selected: [2] });
            // The rotate handle sits 40 CSS px (20 field units) above the top middle
            drag(editor, { x: 300, y: 60 }, { x: 395, y: 103 });
            expect(editor.activeGesture()).toBeNull();
            expect(state.saves).toEqual([
                { width: 100, depth: 40, rotation: 90 },
            ]);
        });

        it("turns past 360° rather than wrapping, so the change eases the short way", () => {
            const { editor, state } = setup({ selected: [2], rotation: 350 });
            // The rotate handle of a box turned 350°: above the top middle, turned with it
            const rad = (350 * Math.PI) / 180;
            const handle = {
                x: 300 + 40 * Math.sin(rad),
                y: 100 - 40 * Math.cos(rad),
            };
            const target = (deg: number) => ({
                x: 300 + 40 * Math.sin((deg * Math.PI) / 180),
                y: 100 - 40 * Math.cos((deg * Math.PI) / 180),
            });
            editor.pointerDown(at(handle.x, handle.y));
            editor.pointerMove(at(target(0).x, target(0).y));
            editor.pointerMove(at(target(10).x, target(10).y));
            editor.pointerUp(at(target(10).x, target(10).y));
            // 20° turned, snapped to 15°
            expect(state.saves[0].rotation).toBeCloseTo(365);
        });

        it("draws it as it was when the drag is cancelled", () => {
            const { editor, state } = setup({ selected: [2] });
            drag(
                editor,
                { x: 350, y: 100 },
                { x: 370, y: 100 },
                {
                    release: false,
                },
            );
            editor.pointerCancel();
            expect(state.preview).toBeNull();
            expect(state.saves).toEqual([]);
        });

        it("draws the size it was given until a refused save, then the stored one", async () => {
            const { editor, state } = setup({ selected: [2], save: "refused" });
            drag(editor, { x: 350, y: 100 }, { x: 370, y: 100 });
            expect(state.preview).toEqual({
                width: 140,
                depth: 40,
                rotation: 0,
            });
            await Promise.resolve();
            expect(state.preview).toBeNull();
        });

        it("still moves it when dragged from inside, away from the handles", () => {
            const { editor, state } = setup({ selected: [2] });
            drag(editor, { x: 320, y: 100 }, { x: 320, y: 140 });
            expect(state.drops).toEqual([[{ id: 2, x: 300, y: 140 }]]);
            expect(state.saves).toEqual([]);
        });
    });
});
