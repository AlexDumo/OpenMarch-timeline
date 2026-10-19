import { describe, expect, it } from "vitest";
import { FieldEditor, type FieldEditorPorts } from "@/field/editor/fieldEditor";
import type { FieldPoint } from "@/field/editor/view";
import { attachFieldPointerInput } from "../fieldPointerInput";
import { useFieldViewStore } from "../fieldView";

/**
 * The renderer's side of a lost pointer (#208): losing the pointer capture
 * the editor's press took (an OS dialog, switching windows mid-drag) cancels
 * that press, and nothing the drag drew stays. A real editor over two
 * marchers; the view is 1 CSS px per field unit from the element's corner.
 */
function setup() {
    useFieldViewStore.setState({ zoom: 1, panX: 0, panY: 0 });
    const state = {
        selected: [] as readonly number[],
        shown: null as ReadonlyMap<number, FieldPoint> | null,
        drops: 0,
        menus: 0,
    };
    const ports: FieldEditorPorts = {
        selection: {
            get: () => state.selected,
            set: (ids) => {
                state.selected = ids;
            },
        },
        marchers: () => ({
            ids: [1, 2],
            positions: Float64Array.from([100, 100, 200, 100]),
            hidden: Uint8Array.from([0, 0]),
        }),
        zoom: () => 1,
        canSelect: () => true,
        selectionBoxPadding: () => 10,
        showPositions: (positions) => {
            state.shown = positions;
        },
        drop: () => {
            state.drops++;
            return new Promise(() => {});
        },
        openMenu: () => {
            state.menus++;
        },
    };
    const editor = new FieldEditor(ports);
    const element = document.createElement("div");
    const captures = new Set<number>();
    element.setPointerCapture = (id) => void captures.add(id);
    element.releasePointerCapture = (id) => void captures.delete(id);
    element.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
    // The field's root, where navigation captures right presses (#194)
    const root = document.createElement("div");
    root.append(element);
    document.body.append(root);
    const detach = attachFieldPointerInput(element, editor);
    const fire = (
        type: string,
        {
            x = 0,
            y = 0,
            pointerId = 1,
            button = 0,
            buttons = 0,
            target = element as HTMLElement,
        } = {},
    ) => {
        const event = new MouseEvent(type, {
            clientX: x,
            clientY: y,
            button,
            buttons,
            bubbles: true,
        });
        Object.assign(event, { pointerId, pointerType: "mouse" });
        target.dispatchEvent(event);
    };
    return { editor, state, captures, fire, detach, root };
}

describe("attachFieldPointerInput, a lost pointer (#208)", () => {
    it("cancels the drag when the press's capture is lost, and the drag's release does nothing", () => {
        const { editor, state, captures, fire } = setup();
        fire("pointerdown", { x: 100, y: 100 });
        expect(captures.has(1)).toBe(true);
        fire("pointermove", { x: 100, y: 160 });
        expect(editor.activeGesture()).toBe("move");
        expect(state.shown).not.toBeNull();

        fire("lostpointercapture");
        expect(editor.activeGesture()).toBeNull();
        expect(state.shown).toBeNull();
        fire("pointermove", { x: 100, y: 200 });
        fire("pointerup", { x: 100, y: 200 });
        expect(state.shown).toBeNull();
        expect(state.drops).toBe(0);

        // The next press is a press like any other
        fire("pointerdown", { x: 200, y: 100 });
        fire("pointerup", { x: 200, y: 100 });
        expect(state.selected).toEqual([2]);
    });

    it("leaves the press alone when another pointer's capture is lost", () => {
        const { editor, fire } = setup();
        fire("pointerdown", { x: 100, y: 100 });
        fire("pointermove", { x: 100, y: 160 });
        fire("lostpointercapture", { pointerId: 7 });
        expect(editor.activeGesture()).toBe("move");
    });
});

describe("attachFieldPointerInput, the right-click menu (#315)", () => {
    it("opens the menu on a right-click whose release navigation captured", () => {
        const { state, fire, root } = setup();
        fire("pointerdown", { x: 300, y: 300, button: 2, buttons: 2 });
        fire("pointerup", { x: 300, y: 300, button: 2, target: root });
        expect(state.menus).toBe(1);
    });

    it("opens no menu after a right-drag that came back, its moves captured by navigation", () => {
        const { state, fire, root } = setup();
        fire("pointerdown", { x: 300, y: 300, button: 2, buttons: 2 });
        fire("pointermove", { x: 360, y: 300, buttons: 2, target: root });
        fire("pointermove", { x: 300, y: 300, buttons: 2, target: root });
        fire("pointerup", { x: 300, y: 300, button: 2, target: root });
        expect(state.menus).toBe(0);
    });
});

describe("attachFieldPointerInput, right presses that start off the field (#315 review)", () => {
    it("doesn't forward a right-drag that started elsewhere (the timeline): the line tool's line stays put", () => {
        const { editor, fire, root } = setup();
        editor.setLineTool([1, 2]);
        fire("pointerdown", { x: 100, y: 300 });
        fire("pointerup", { x: 100, y: 300 });
        fire("pointermove", { x: 150, y: 300 });
        expect(editor.lineToolShape()!.line!.end).toEqual({ x: 150, y: 300 });

        // A right-drag that began outside the field, moving over its root
        const outside = document.createElement("div");
        document.body.append(outside);
        fire("pointermove", { x: 400, y: 500, buttons: 2, target: outside });
        fire("pointermove", { x: 420, y: 520, buttons: 2, target: root });
        expect(editor.lineToolShape()!.line!.end).toEqual({ x: 150, y: 300 });
        outside.remove();
    });

    it("still forwards the moves of a right press that started on the field", () => {
        const { editor, fire, root } = setup();
        editor.setLineTool([1, 2]);
        fire("pointerdown", { x: 100, y: 300 });
        fire("pointerup", { x: 100, y: 300 });
        fire("pointerdown", { x: 150, y: 300, button: 2, buttons: 2 });
        fire("pointermove", { x: 420, y: 520, buttons: 2, target: root });
        expect(editor.lineToolShape()!.line!.end).toEqual({ x: 420, y: 520 });
        fire("pointerup", { x: 420, y: 520, button: 2, target: root });
        // Over: later right-button moves from elsewhere aren't the field's
        fire("pointermove", { x: 50, y: 50, buttons: 2, target: root });
        expect(editor.lineToolShape()!.line!.end).toEqual({ x: 420, y: 520 });
    });
});
