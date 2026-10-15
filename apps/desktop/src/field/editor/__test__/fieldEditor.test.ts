import { describe, expect, it, vi } from "vitest";
import {
    CLICK_SLOP,
    FieldEditor,
    type FieldEditorPorts,
    type FieldPointer,
} from "../fieldEditor";

/**
 * Marchers 1 to 4 in a row 100 field units apart, at zoom 2 (2 CSS px per
 * field unit, so 4 screen px is 2 field units).
 */
function setup({
    selected = [] as number[],
    dimmed = [] as number[],
    hidden = [] as number[],
    isMac = false,
} = {}) {
    const state = { selected: [...selected] as readonly number[] };
    const ports: FieldEditorPorts = {
        selection: {
            get: () => state.selected,
            set: vi.fn((ids: readonly number[]) => {
                state.selected = ids;
            }),
        },
        marchers: () => ({
            ids: [1, 2, 3, 4],
            positions: Float64Array.from([
                100, 100, 200, 100, 300, 100, 400, 100,
            ]),
            hidden: Uint8Array.from([1, 2, 3, 4], (id) =>
                hidden.includes(id) ? 1 : 0,
            ),
        }),
        zoom: () => 2,
        canSelect: (id) => !dimmed.includes(id),
    };
    const editor = new FieldEditor(ports, { isMac });
    return { editor, state, ports };
}

const ZOOM = 2;

/** A pointer at field point (x, y), with the screen point the view puts it at. */
const at = (
    x: number,
    y: number,
    modifiers: Partial<Omit<FieldPointer, "field" | "screen">> = {},
): FieldPointer => ({
    field: { x, y },
    screen: { x: x * ZOOM, y: y * ZOOM },
    button: 0,
    shift: false,
    alt: false,
    ctrl: false,
    meta: false,
    ...modifiers,
});

const click = (
    editor: FieldEditor,
    x: number,
    y: number,
    modifiers?: Parameters<typeof at>[2],
) => {
    editor.pointerDown(at(x, y, modifiers));
    editor.pointerUp(at(x, y, modifiers));
};

const EMPTY = { x: 250, y: 300 };

describe("FieldEditor click selection", () => {
    it("selects only the marcher clicked", () => {
        const { editor, state } = setup({ selected: [2] });
        click(editor, 100, 101);
        expect(state.selected).toEqual([1]);
    });

    it("adds a marcher with Shift+click, and removes a selected one", () => {
        const { editor, state } = setup({ selected: [1] });
        click(editor, 300, 100, { shift: true });
        expect(state.selected).toEqual([1, 3]);
        click(editor, 100, 100, { shift: true });
        expect(state.selected).toEqual([3]);
    });

    it("clears the selection on a click on empty field", () => {
        const { editor, state } = setup({ selected: [1, 2] });
        click(editor, EMPTY.x, EMPTY.y);
        expect(state.selected).toEqual([]);
    });

    it("keeps the selection on a Shift+click on empty field", () => {
        const { editor, state, ports } = setup({ selected: [1, 2] });
        click(editor, EMPTY.x, EMPTY.y, { shift: true });
        expect(state.selected).toEqual([1, 2]);
        expect(ports.selection.set).not.toHaveBeenCalled();
    });

    it("narrows a selection to the selected marcher clicked (user story 23)", () => {
        const { editor, state } = setup({ selected: [1, 2, 3] });
        click(editor, 200, 100);
        expect(state.selected).toEqual([2]);
    });

    it("doesn't write a selection that hasn't changed", () => {
        const { editor, ports } = setup({ selected: [1] });
        click(editor, 100, 100);
        click(editor, EMPTY.x, EMPTY.y, { shift: true });
        expect(ports.selection.set).not.toHaveBeenCalled();
    });

    it("can't select a dimmed marcher: a click on one is a click on empty field", () => {
        const { editor, state } = setup({ selected: [1], dimmed: [2] });
        click(editor, 200, 100, { shift: true });
        expect(state.selected).toEqual([1]);
        click(editor, 200, 100);
        expect(state.selected).toEqual([]);
    });

    it("selects at release, not at press", () => {
        const { editor, state } = setup();
        editor.pointerDown(at(100, 100));
        expect(state.selected).toEqual([]);
        editor.pointerUp(at(100, 100));
        expect(state.selected).toEqual([1]);
    });
});

describe("FieldEditor click vs drag", () => {
    const slop = CLICK_SLOP / ZOOM;

    it("counts a press that moves under 4 screen px as a click, however long it takes", () => {
        const { editor, state } = setup();
        editor.pointerDown(at(100, 100));
        editor.pointerMove(at(100 + slop * 0.6, 100 + slop * 0.6));
        editor.pointerUp(at(100 + slop * 0.6, 100 + slop * 0.6));
        expect(state.selected).toEqual([1]);
    });

    it("doesn't click once a press has moved 4 screen px, even if it comes back", () => {
        const { editor, state, ports } = setup({ selected: [2] });
        editor.pointerDown(at(100, 100));
        editor.pointerMove(at(100 + slop, 100));
        editor.pointerMove(at(100, 100));
        editor.pointerUp(at(100, 100));
        expect(state.selected).toEqual([2]);
        expect(ports.selection.set).not.toHaveBeenCalled();
    });

    it("leaves the cursor alone while a drag that does nothing is held", () => {
        const { editor } = setup();
        editor.pointerDown(at(EMPTY.x, EMPTY.y));
        editor.pointerMove(at(EMPTY.x + slop, EMPTY.y));
        editor.pointerMove(at(100, 100));
        expect(editor.cursor()).toBe("default");
        editor.pointerUp(at(100, 100));
        editor.pointerMove(at(100, 101));
        expect(editor.cursor()).toBe("pointer");
    });

    it("drops a press that's cancelled", () => {
        const { editor, state } = setup();
        editor.pointerDown(at(100, 100));
        editor.pointerCancel();
        editor.pointerUp(at(100, 100));
        expect(state.selected).toEqual([]);
    });

    it("has no gesture in progress during a click", () => {
        const { editor } = setup();
        editor.pointerDown(at(100, 100));
        expect(editor.activeGesture()).toBeNull();
        editor.pointerUp(at(100, 100));
        expect(editor.activeGesture()).toBeNull();
    });
});

describe("FieldEditor buttons", () => {
    it("leaves the right and middle buttons to navigation", () => {
        const { editor, state } = setup();
        expect(editor.pointerDown(at(100, 100, { button: 2 }))).toBe(false);
        editor.pointerUp(at(100, 100, { button: 2 }));
        expect(editor.pointerDown(at(100, 100, { button: 1 }))).toBe(false);
        editor.pointerUp(at(100, 100, { button: 1 }));
        expect(state.selected).toEqual([]);
    });

    it("leaves Ctrl+press on a Mac to navigation (it pans)", () => {
        const mac = setup({ isMac: true });
        expect(mac.editor.pointerDown(at(100, 100, { ctrl: true }))).toBe(
            false,
        );
        mac.editor.pointerUp(at(100, 100, { ctrl: true }));
        expect(mac.state.selected).toEqual([]);

        const pc = setup();
        expect(pc.editor.pointerDown(at(100, 100, { ctrl: true }))).toBe(true);
        pc.editor.pointerUp(at(100, 100, { ctrl: true }));
        expect(pc.state.selected).toEqual([1]);
    });
});

describe("FieldEditor hover", () => {
    it("shows the pointer cursor over a marcher it can select", () => {
        const { editor } = setup({ dimmed: [2] });
        expect(editor.cursor()).toBe("default");
        editor.pointerMove(at(100, 103));
        expect(editor.cursor()).toBe("pointer");
        editor.pointerMove(at(200, 100));
        expect(editor.cursor()).toBe("default");
        editor.pointerMove(at(300, 100));
        editor.pointerLeave();
        expect(editor.cursor()).toBe("default");
    });

    it("tells subscribers when the cursor changes, and only then", () => {
        const { editor } = setup();
        const listener = vi.fn();
        const unsubscribe = editor.subscribe(listener);
        editor.pointerMove(at(100, 100));
        editor.pointerMove(at(101, 100));
        expect(listener).toHaveBeenCalledTimes(1);
        unsubscribe();
        editor.pointerMove(at(EMPTY.x, EMPTY.y));
        expect(listener).toHaveBeenCalledTimes(1);
    });
});

describe("FieldEditor select all", () => {
    it("selects every marcher it can select", () => {
        const { editor, state } = setup({ dimmed: [3], hidden: [1] });
        editor.selectAll();
        expect(state.selected).toEqual([2, 4]);
    });
});
