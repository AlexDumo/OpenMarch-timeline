import { describe, expect, it, vi } from "vitest";
import {
    CLICK_SLOP,
    FieldEditor,
    type DropResult,
    type FieldEditorPorts,
    type FieldPoint,
    type FieldPointer,
} from "../fieldEditor";
import type { MarcherPosition, MoveTransform } from "../moveGesture";

/**
 * Marchers 1 to 4 in a row 100 field units apart, at zoom 2 (2 CSS px per
 * field unit, so 4 screen px is 2 field units).
 */
function setup({
    selected = [] as number[],
    dimmed = [] as number[],
    hidden = [] as number[],
    isMac = false,
    takePress = undefined as (() => boolean) | undefined,
    moveTransform = undefined as MoveTransform | undefined,
} = {}) {
    const state = {
        selected: [...selected] as readonly number[],
        /** What the field draws instead of the show, as the editor last said */
        shown: null as ReadonlyMap<number, FieldPoint> | null,
        /** Each drop handed to the timeline, with the answer to give it */
        drops: [] as {
            positions: readonly MarcherPosition[];
            answer: (result: DropResult) => void;
        }[],
    };
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
        takePress,
        selectionBoxPadding: () => 10,
        showPositions: vi.fn((positions) => {
            state.shown = positions;
        }),
        drop: vi.fn(
            (positions) =>
                new Promise<DropResult>((answer) => {
                    state.drops.push({ positions, answer });
                }),
        ),
    };
    const editor = new FieldEditor(ports, { isMac, moveTransform });
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
        editor.pointerDown(at(EMPTY.x, EMPTY.y));
        editor.pointerMove(at(EMPTY.x + slop, EMPTY.y));
        editor.pointerMove(at(EMPTY.x, EMPTY.y));
        editor.pointerUp(at(EMPTY.x, EMPTY.y));
        expect(state.selected).toEqual([2]);
        expect(ports.selection.set).not.toHaveBeenCalled();
    });

    it("moves nothing on a press on a marcher that moves under 4 screen px", () => {
        const { editor, state, ports } = setup();
        editor.pointerDown(at(100, 100));
        editor.pointerMove(at(100 + slop * 0.9, 100));
        expect(editor.activeGesture()).toBeNull();
        editor.pointerUp(at(100 + slop * 0.9, 100));
        expect(ports.showPositions).not.toHaveBeenCalled();
        expect(state.drops).toEqual([]);
        expect(state.selected).toEqual([1]);
    });

    it("starts a move once a press on a marcher moves 4 screen px, however quickly", () => {
        const { editor, state } = setup();
        editor.pointerDown(at(100, 100));
        editor.pointerUp(at(100 + slop, 100));
        expect(state.drops.map((d) => d.positions)).toEqual([
            [{ id: 1, x: 100 + slop, y: 100 }],
        ]);
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

describe("FieldEditor presses the app takes (#202)", () => {
    /** Takes the first `count` presses, as the app does the first press after a paused preview. */
    const takeFirst = (count: number) => vi.fn(() => count-- > 0);

    it("selects nothing on a press the app takes, and the next press clicks as usual", () => {
        const takePress = takeFirst(1);
        const { editor, state } = setup({ selected: [2], takePress });
        expect(editor.pointerDown(at(100, 100))).toBe(true);
        editor.pointerUp(at(100, 100));
        expect(state.selected).toEqual([2]);
        click(editor, 100, 100);
        expect(state.selected).toEqual([1]);
        expect(takePress).toHaveBeenCalledTimes(2);
    });

    it("starts no drag from a press the app takes", () => {
        const startDrag = vi.fn();
        class Recording extends FieldEditor {
            protected startDrag() {
                startDrag();
                return null;
            }
        }
        const { ports } = setup({ takePress: takeFirst(1) });
        const editor = new Recording(ports);
        editor.pointerDown(at(100, 100));
        editor.pointerMove(at(150, 100));
        expect(editor.cursor()).toBe("default");
        editor.pointerUp(at(150, 100));
        expect(startDrag).not.toHaveBeenCalled();
        expect(editor.activeGesture()).toBeNull();

        editor.pointerDown(at(100, 100));
        editor.pointerMove(at(150, 100));
        expect(startDrag).toHaveBeenCalledTimes(1);
    });

    it("doesn't ask about presses that are navigation's", () => {
        const takePress = vi.fn(() => true);
        const { editor } = setup({ takePress });
        expect(editor.pointerDown(at(100, 100, { button: 2 }))).toBe(false);
        expect(editor.pointerDown(at(100, 100, { button: 1 }))).toBe(false);
        expect(takePress).not.toHaveBeenCalled();
    });
});

/** Presses at `from`, drags to `to` in two moves and releases there. */
const drag = (
    editor: FieldEditor,
    from: { x: number; y: number },
    to: { x: number; y: number },
    modifiers?: Parameters<typeof at>[2],
) => {
    editor.pointerDown(at(from.x, from.y, modifiers));
    editor.pointerMove(at((from.x + to.x) / 2, (from.y + to.y) / 2, modifiers));
    editor.pointerMove(at(to.x, to.y, modifiers));
    editor.pointerUp(at(to.x, to.y, modifiers));
};

const shown = (state: ReturnType<typeof setup>["state"]) =>
    state.shown && Object.fromEntries(state.shown);

describe("FieldEditor moving marchers", () => {
    it("drags a marcher with the pointer and drops it where it's released", () => {
        const { editor, state } = setup();
        editor.pointerDown(at(100, 100));
        editor.pointerMove(at(130, 110));
        expect(editor.activeGesture()).toBe("move");
        expect(shown(state)).toEqual({ 1: { x: 130, y: 110 } });
        editor.pointerUp(at(150, 140));
        expect(editor.activeGesture()).toBeNull();
        expect(state.drops.map((d) => d.positions)).toEqual([
            [{ id: 1, x: 150, y: 140 }],
        ]);
    });

    it("keeps the offset from the dot to where it was pressed", () => {
        const { editor, state } = setup();
        drag(editor, { x: 103, y: 98 }, { x: 203, y: 298 });
        expect(state.drops[0].positions).toEqual([{ id: 1, x: 200, y: 300 }]);
    });

    it("selects the marcher dragged when it isn't selected", () => {
        const { editor, state } = setup({ selected: [2, 3] });
        drag(editor, { x: 100, y: 100 }, { x: 100, y: 150 });
        expect(state.selected).toEqual([1]);
        expect(state.drops[0].positions).toEqual([{ id: 1, x: 100, y: 150 }]);
    });

    it("adds the marcher dragged with Shift, and moves the whole selection", () => {
        const { editor, state } = setup({ selected: [2] });
        drag(editor, { x: 100, y: 100 }, { x: 100, y: 150 }, { shift: true });
        expect(state.selected).toEqual([2, 1]);
        expect(state.drops[0].positions).toEqual([
            { id: 1, x: 100, y: 150 },
            { id: 2, x: 200, y: 150 },
        ]);
    });

    it("moves the whole selection from one of its marchers, without narrowing it", () => {
        const { editor, state, ports } = setup({ selected: [1, 3] });
        drag(editor, { x: 300, y: 100 }, { x: 320, y: 90 });
        expect(ports.selection.set).not.toHaveBeenCalled();
        expect(state.selected).toEqual([1, 3]);
        expect(state.drops[0].positions).toEqual([
            { id: 1, x: 120, y: 90 },
            { id: 3, x: 320, y: 90 },
        ]);
    });

    it("moves a multi-selection from empty field inside its box (owner decision, #196)", () => {
        const { editor, state, ports } = setup({ selected: [1, 3] });
        // Between marchers 1 and 3, on the box's padding below them
        drag(editor, { x: 250, y: 108 }, { x: 250, y: 158 });
        expect(ports.selection.set).not.toHaveBeenCalled();
        expect(state.drops[0].positions).toEqual([
            { id: 1, x: 100, y: 150 },
            { id: 3, x: 300, y: 150 },
        ]);
    });

    it("moves nothing from empty field outside the box, or around a single marcher", () => {
        const outside = setup({ selected: [1, 3] });
        drag(outside.editor, { x: 250, y: 115 }, { x: 250, y: 165 });
        drag(outside.editor, { x: 350, y: 100 }, { x: 350, y: 150 });
        expect(outside.state.drops).toEqual([]);
        expect(outside.editor.activeGesture()).toBeNull();

        const single = setup({ selected: [1] });
        drag(single.editor, { x: 105, y: 108 }, { x: 105, y: 158 });
        expect(single.state.drops).toEqual([]);
    });

    it("can't drag a dimmed marcher", () => {
        const { editor, state } = setup({ dimmed: [2] });
        drag(editor, { x: 200, y: 100 }, { x: 200, y: 150 });
        expect(state.drops).toEqual([]);
        expect(state.selected).toEqual([]);
    });

    it("leaves hidden selected marchers where they are", () => {
        const { editor, state } = setup({ selected: [1, 2], hidden: [2] });
        drag(editor, { x: 100, y: 100 }, { x: 100, y: 150 });
        expect(state.drops[0].positions).toEqual([{ id: 1, x: 100, y: 150 }]);
    });

    it("drops nothing when the pointer comes back to where it started", () => {
        const { editor, state } = setup();
        drag(editor, { x: 100, y: 100 }, { x: 100, y: 100 });
        expect(state.drops).toEqual([]);
        expect(state.shown).toBeNull();
    });

    it("puts the marchers back when the drag is cancelled", () => {
        const { editor, state } = setup();
        editor.pointerDown(at(100, 100));
        editor.pointerMove(at(100, 150));
        expect(shown(state)).toEqual({ 1: { x: 100, y: 150 } });
        editor.pointerCancel();
        expect(editor.activeGesture()).toBeNull();
        expect(state.shown).toBeNull();
        editor.pointerUp(at(100, 150));
        expect(state.drops).toEqual([]);
    });

    it("leaves the right button to navigation mid-drag", () => {
        const { editor, state } = setup();
        editor.pointerDown(at(100, 100));
        editor.pointerMove(at(100, 150));
        editor.pointerUp(at(100, 150, { button: 2 }));
        expect(editor.activeGesture()).toBe("move");
        editor.pointerUp(at(100, 160));
        expect(state.drops[0].positions).toEqual([{ id: 1, x: 100, y: 160 }]);
    });

    it("hands the pointer delta to the move transform (#197's seam)", () => {
        // Whole tens across, and no movement down
        const moveTransform = vi.fn<MoveTransform>((delta, _pointer, starts) =>
            starts.map((s) => ({
                id: s.id,
                x: s.x + Math.round(delta.x / 10) * 10,
                y: s.y,
            })),
        );
        const { editor, state } = setup({ moveTransform });
        drag(editor, { x: 100, y: 100 }, { x: 137, y: 120 }, { alt: true });
        expect(moveTransform).toHaveBeenLastCalledWith(
            { x: 37, y: 20 },
            expect.objectContaining({ alt: true }),
            [{ id: 1, x: 100, y: 100 }],
        );
        expect(state.drops[0].positions).toEqual([{ id: 1, x: 140, y: 100 }]);
    });
});

describe("FieldEditor drops waiting to be saved", () => {
    it("keeps the marchers where they were dropped until the save settles (user story 42)", async () => {
        const { editor, state } = setup();
        drag(editor, { x: 100, y: 100 }, { x: 100, y: 150 });
        expect(shown(state)).toEqual({ 1: { x: 100, y: 150 } });
        state.drops[0].answer("saved");
        await Promise.resolve();
        expect(state.shown).toBeNull();
    });

    it("snaps the marchers back when the drop is refused", async () => {
        const { editor, state } = setup();
        drag(editor, { x: 100, y: 100 }, { x: 100, y: 150 });
        state.drops[0].answer("refused");
        await Promise.resolve();
        expect(state.shown).toBeNull();
    });

    it("keeps an earlier drop drawn while a later one is dragged, until it's saved", async () => {
        const { editor, state } = setup();
        drag(editor, { x: 100, y: 100 }, { x: 100, y: 150 });
        editor.pointerDown(at(200, 100));
        editor.pointerMove(at(200, 130));
        expect(shown(state)).toEqual({
            1: { x: 100, y: 150 },
            2: { x: 200, y: 130 },
        });
        // The first drop is saved mid-drag: the field draws it from the show,
        // and the marcher dragged stays under the pointer
        state.drops[0].answer("saved");
        await Promise.resolve();
        expect(shown(state)).toEqual({ 2: { x: 200, y: 130 } });
        editor.pointerUp(at(200, 140));
        expect(shown(state)).toEqual({ 2: { x: 200, y: 140 } });
        state.drops[1].answer("saved");
        await Promise.resolve();
        expect(state.shown).toBeNull();
    });

    it("draws an earlier drop still saving when a later drag is cancelled", () => {
        const { editor, state } = setup();
        drag(editor, { x: 100, y: 100 }, { x: 100, y: 150 });
        editor.pointerDown(at(200, 100));
        editor.pointerMove(at(200, 130));
        editor.pointerCancel();
        expect(shown(state)).toEqual({ 1: { x: 100, y: 150 } });
    });

    it("logs a drop that hasn't settled after 30 s, and keeps it drawn", () => {
        vi.useFakeTimers();
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const { editor, state } = setup();
            drag(editor, { x: 100, y: 100 }, { x: 100, y: 150 });
            vi.advanceTimersByTime(29_000);
            expect(error).not.toHaveBeenCalled();
            vi.advanceTimersByTime(2_000);
            expect(error).toHaveBeenCalledTimes(1);
            expect(shown(state)).toEqual({ 1: { x: 100, y: 150 } });
        } finally {
            error.mockRestore();
            vi.useRealTimers();
        }
    });
});
