import type { FieldEditor, FieldPointer } from "@/field/editor/fieldEditor";
import { elementToField, useFieldViewStore } from "./fieldView";

/**
 * Reports the pointer on the new field's canvas to the editor: positions on
 * the field and on screen, the button and the modifiers, nothing else (ADR
 * 0005 D-2). The editor decides what they do. Shows the editor's cursor.
 *
 * Touch is navigation's (#194): touch editing is out of scope. Returns the
 * detach.
 */
export function attachFieldPointerInput(
    element: HTMLElement,
    editor: FieldEditor,
): () => void {
    const pointer = (event: PointerEvent): FieldPointer => {
        const rect = element.getBoundingClientRect();
        const screen = {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
        };
        const field = elementToField(
            useFieldViewStore.getState(),
            screen.x,
            screen.y,
        );
        return {
            field,
            screen,
            button: event.button,
            shift: event.shiftKey,
            alt: event.altKey,
            ctrl: event.ctrlKey,
            meta: event.metaKey,
        };
    };

    /** The pointer the editor's press captured; other captures (navigation's) aren't its to cancel. */
    let captured: number | null = null;
    const down = (event: PointerEvent) => {
        if (event.pointerType === "touch") return;
        if (!editor.pointerDown(pointer(event))) return;
        captured = event.pointerId;
        element.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
        if (event.pointerType === "touch") return;
        editor.pointerMove(pointer(event));
    };
    const up = (event: PointerEvent) => {
        if (event.pointerType === "touch") return;
        editor.pointerUp(pointer(event));
    };
    const cancel = (event: PointerEvent) => {
        if (event.pointerId !== captured) return;
        captured = null;
        editor.pointerCancel();
    };
    const leave = (event: PointerEvent) => {
        if (event.buttons === 0) editor.pointerLeave();
    };
    const showCursor = () => {
        element.style.cursor = editor.cursor();
    };

    element.addEventListener("pointerdown", down);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", cancel);
    // After a release, too, when the editor has nothing left to cancel
    element.addEventListener("lostpointercapture", cancel);
    element.addEventListener("pointerleave", leave);
    const detachRight = listenForCapturedRightPresses(element, editor, pointer);
    const unsubscribe = editor.subscribe(showCursor);
    showCursor();
    return () => {
        element.removeEventListener("pointerdown", down);
        element.removeEventListener("pointermove", move);
        element.removeEventListener("pointerup", up);
        element.removeEventListener("pointercancel", cancel);
        element.removeEventListener("lostpointercapture", cancel);
        element.removeEventListener("pointerleave", leave);
        detachRight();
        unsubscribe();
        editor.pointerCancel();
        element.style.cursor = "";
    };
}

/**
 * Navigation captures right presses on the field's root, so their moves and
 * release don't reach the canvas: the editor hears them here (a right-click
 * clears the line tool's line, #203, or opens the menu, #315; a right-drag
 * that panned does neither). Only a right press that started on the field:
 * one from elsewhere (the timeline) moving over it isn't the field's. Returns
 * the detach.
 */
function listenForCapturedRightPresses(
    element: HTMLElement,
    editor: FieldEditor,
    pointer: (event: PointerEvent) => FieldPointer,
): () => void {
    /** The pointer of the right press the field saw, until its release. */
    let pressed: number | null = null;
    const down = (event: PointerEvent) => {
        if (event.pointerType !== "touch" && event.button === 2)
            pressed = event.pointerId;
    };
    const move = (event: PointerEvent) => {
        if (event.pointerId !== pressed || !(event.buttons & 2)) return;
        if (event.target === element) return;
        editor.pointerMove(pointer(event));
    };
    const up = (event: PointerEvent) => {
        if (event.pointerId !== pressed || event.button !== 2) return;
        pressed = null;
        if (event.target === element) return;
        editor.pointerUp(pointer(event));
    };
    // A mouse keeps one pointer id: a press that never ends mustn't linger
    const cancel = (event: PointerEvent) => {
        if (event.pointerId === pressed) pressed = null;
    };
    element.addEventListener("pointerdown", down);
    document.addEventListener("pointermove", move, true);
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", cancel, true);
    return () => {
        element.removeEventListener("pointerdown", down);
        document.removeEventListener("pointermove", move, true);
        document.removeEventListener("pointerup", up, true);
        document.removeEventListener("pointercancel", cancel, true);
    };
}
