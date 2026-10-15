import { describe, expect, it, vi } from "vitest";
import { boundsOf } from "../selectionArea";
import {
    CLICK_SLOP,
    DOUBLE_CLICK_MS,
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
    const clock = { now: 1000 };
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
        // The bounds of the selection, with no padding, around two or more marchers
        selectionBox: () =>
            state.selected.length < 2
                ? null
                : boundsOf(ports.marchers(), state.selected),
    };
    const editor = new FieldEditor(ports, { isMac, now: () => clock.now });
    return { editor, state, ports, clock };
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
        // From a marcher: a move, which is #196's
        editor.pointerDown(at(400, 100));
        editor.pointerMove(at(400 + slop, 100));
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

/** A drag from (x0, y0) through `through` to the last point, with the press's modifiers. */
const drag = (
    editor: FieldEditor,
    points: readonly (readonly [number, number])[],
    modifiers?: Parameters<typeof at>[2],
) => {
    const [first, ...rest] = points;
    editor.pointerDown(at(first[0], first[1], modifiers));
    for (const [x, y] of rest.slice(0, -1))
        editor.pointerMove(at(x, y, modifiers));
    const [x, y] = rest[rest.length - 1];
    editor.pointerMove(at(x, y, modifiers));
    editor.pointerUp(at(x, y, modifiers));
};

describe("FieldEditor marquee", () => {
    it("replaces the selection with the marchers it covers", () => {
        const { editor, state } = setup({ selected: [4] });
        drag(editor, [
            [150, 50],
            [250, 150],
        ]);
        expect(state.selected).toEqual([2]);
    });

    it("adds to the selection with Shift", () => {
        const { editor, state } = setup({ selected: [1] });
        drag(
            editor,
            [
                [250, 50],
                [350, 150],
            ],
            { shift: true },
        );
        expect(state.selected).toEqual([1, 3]);
    });

    it("takes a marcher whose dot it touches", () => {
        // The dot reaches 6 field units at zoom 2 (its click target)
        const touching = setup();
        drag(touching.editor, [
            [250, 50],
            [295, 150],
        ]);
        expect(touching.state.selected).toEqual([3]);
        const clear = setup();
        drag(clear.editor, [
            [250, 50],
            [293, 150],
        ]);
        expect(clear.state.selected).toEqual([]);
    });

    it("never takes a hidden or dimmed marcher", () => {
        const { editor, state } = setup({ hidden: [1], dimmed: [3] });
        drag(editor, [
            [50, 50],
            [450, 150],
        ]);
        expect(state.selected).toEqual([2, 4]);
    });

    it("clears the selection when it covers nothing, and keeps it with Shift", () => {
        const plain = setup({ selected: [1] });
        drag(plain.editor, [
            [150, 200],
            [250, 300],
        ]);
        expect(plain.state.selected).toEqual([]);
        const shift = setup({ selected: [1] });
        drag(
            shift.editor,
            [
                [150, 200],
                [250, 300],
            ],
            { shift: true },
        );
        expect(shift.state.selected).toEqual([1]);
    });

    it("is the gesture in progress, with its rectangle, until released", () => {
        const { editor, state } = setup();
        const listener = vi.fn();
        editor.subscribe(listener);
        editor.pointerDown(at(150, 50));
        editor.pointerMove(at(200, 120));
        expect(editor.activeGesture()).toBe("marquee");
        editor.pointerMove(at(250, 150));
        expect(editor.areaShape()).toEqual({
            kind: "marquee",
            rect: { left: 150, top: 50, right: 250, bottom: 150 },
        });
        // Selects only on release
        expect(state.selected).toEqual([]);
        expect(listener).toHaveBeenCalledTimes(2);
        editor.pointerUp(at(250, 150));
        expect(editor.activeGesture()).toBeNull();
        expect(editor.areaShape()).toBeNull();
        expect(state.selected).toEqual([2]);
    });

    it("selects nothing when the pointer is lost", () => {
        const { editor, state } = setup({ selected: [4] });
        editor.pointerDown(at(150, 50));
        editor.pointerMove(at(250, 150));
        editor.pointerCancel();
        editor.pointerUp(at(250, 150));
        expect(editor.activeGesture()).toBeNull();
        expect(state.selected).toEqual([4]);
    });

    it("doesn't start inside a multi-selection's box: that drag moves the selection (#196)", () => {
        const { editor, state, ports } = setup({ selected: [1, 3] });
        // On empty field between 2 and 3, inside the box from 1 to 3
        editor.pointerDown(at(250, 100));
        editor.pointerMove(at(250, 200));
        expect(editor.activeGesture()).not.toBe("marquee");
        editor.pointerUp(at(250, 200));
        expect(state.selected).toEqual([1, 3]);
        expect(ports.selection.set).not.toHaveBeenCalled();
    });

    it("starts outside a multi-selection's box", () => {
        const { editor, state } = setup({ selected: [1, 3] });
        drag(editor, [
            [350, 50],
            [450, 150],
        ]);
        expect(state.selected).toEqual([4]);
    });

    it("is a marquee, not a lasso, with Shift held (rules table: Shift)", () => {
        const { editor } = setup();
        editor.pointerDown(at(150, 50, { shift: true }));
        editor.pointerMove(at(250, 150, { shift: true }));
        expect(editor.activeGesture()).toBe("marquee");
    });
});

/** A lasso square around marchers 2 and 3, from (150, 50), back to 10 field units (20 screen px) from its start. */
const AROUND_2_AND_3 = [
    [150, 50],
    [350, 50],
    [350, 150],
    [150, 150],
    [150, 60],
] as const;

/** A click and then a double-click-and-drag through `points`. */
const lasso = (
    editor: FieldEditor,
    points: readonly (readonly [number, number])[],
    modifiers?: Parameters<typeof at>[2],
) => {
    click(editor, points[0][0], points[0][1], modifiers);
    drag(editor, points, modifiers);
};

describe("FieldEditor lasso", () => {
    it("starts on a double-click-and-drag on empty field", () => {
        const { editor } = setup();
        click(editor, 150, 50);
        editor.pointerDown(at(150, 50));
        editor.pointerMove(at(250, 50));
        expect(editor.activeGesture()).toBe("lasso");
    });

    it("replaces the selection with the marchers inside it", () => {
        const { editor, state } = setup({ selected: [4] });
        lasso(editor, AROUND_2_AND_3);
        expect(state.selected).toEqual([2, 3]);
    });

    it("adds to the selection with Shift", () => {
        const { editor, state } = setup({ selected: [1] });
        lasso(editor, AROUND_2_AND_3, { shift: true });
        expect(state.selected).toEqual([1, 2, 3]);
    });

    it("never takes a hidden or dimmed marcher", () => {
        const { editor, state } = setup({ hidden: [2], dimmed: [3] });
        lasso(editor, [
            [50, 50],
            [450, 50],
            [450, 150],
            [50, 150],
            [50, 60],
        ]);
        expect(state.selected).toEqual([1, 4]);
    });

    it("selects nothing, and keeps the selection, when released 50 screen px or more from its start", () => {
        const { editor, state, ports } = setup({ selected: [4] });
        // 25 field units is 50 screen px at zoom 2. With Shift, so the
        // double-click's first click keeps the selection too
        lasso(editor, [...AROUND_2_AND_3.slice(0, -1), [150, 75]], {
            shift: true,
        });
        expect(state.selected).toEqual([4]);
        expect(ports.selection.set).not.toHaveBeenCalled();
    });

    it("says when releasing would close it (the green cue)", () => {
        const { editor } = setup();
        click(editor, 150, 50);
        editor.pointerDown(at(150, 50));
        editor.pointerMove(at(160, 50));
        // Still near the start
        expect(editor.areaShape()).toMatchObject({
            kind: "lasso",
            closes: true,
        });
        editor.pointerMove(at(350, 50));
        expect(editor.areaShape()).toMatchObject({ closes: false });
        editor.pointerMove(at(150, 74));
        expect(editor.areaShape()).toMatchObject({ closes: true });
        expect(editor.areaShape()).toMatchObject({
            points: [
                { x: 150, y: 50 },
                { x: 160, y: 50 },
                { x: 350, y: 50 },
                { x: 150, y: 74 },
            ],
        });
    });

    it("is a marquee when the second press comes too late or too far from the click", () => {
        const late = setup();
        click(late.editor, 150, 50);
        late.clock.now += DOUBLE_CLICK_MS + 1;
        late.editor.pointerDown(at(150, 50));
        late.editor.pointerMove(at(250, 50));
        expect(late.editor.activeGesture()).toBe("marquee");

        const far = setup();
        click(far.editor, 150, 50);
        // 10 field units is 20 screen px
        far.editor.pointerDown(at(160, 50));
        far.editor.pointerMove(at(260, 50));
        expect(far.editor.activeGesture()).toBe("marquee");
    });

    it("is a marquee after a click on a marcher, and after a double-click", () => {
        const afterMarcher = setup();
        click(afterMarcher.editor, 100, 100);
        afterMarcher.editor.pointerDown(at(100, 110));
        afterMarcher.editor.pointerMove(at(100, 150));
        expect(afterMarcher.editor.activeGesture()).toBe("marquee");

        const triple = setup();
        click(triple.editor, 150, 50);
        click(triple.editor, 150, 50);
        triple.editor.pointerDown(at(150, 50));
        triple.editor.pointerMove(at(250, 50));
        expect(triple.editor.activeGesture()).toBe("marquee");
    });

    it("doesn't start inside a multi-selection's box", () => {
        const { editor } = setup({ selected: [1, 3] });
        click(editor, 250, 100, { shift: true });
        editor.pointerDown(at(250, 100, { shift: true }));
        editor.pointerMove(at(250, 200, { shift: true }));
        expect(editor.activeGesture()).toBeNull();
    });
});
