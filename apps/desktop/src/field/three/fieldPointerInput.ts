import type { FieldEditor, FieldPointer } from "@/field/editor/fieldEditor";
import { thresholdsFor } from "@/field/editor/pointerThresholds";
import { panBy } from "@/field/editor/view";
import { isMacPlatform } from "@/shortcuts/platform";
import { fieldPointerAt, useFieldViewStore } from "./fieldView";
import { fieldGesturesOwn } from "./fieldGestures";
import { setView } from "./fieldNavigation";

export type FieldPointerInputOptions = {
    /**
     * What a pen's press does (the pill's drag mode, tablet 1.3): null sends
     * it to the editor as a mouse press, `"lasso"` too but a drag from empty
     * field draws a lasso, and `"pan"` moves the view (a pen tap there is
     * still a click). Default: every press is the editor's.
     */
    penDrag?: (press: FieldPointer) => "pan" | "lasso" | null;
};

/**
 * Reports the pointer on the new field's canvas to the editor: positions on
 * the field and on screen, the button and the modifiers, nothing else (ADR
 * 0005 D-2). The editor decides what they do. Shows the editor's cursor.
 *
 * Mouse and pen presses come straight here. Finger presses are the field's
 * gesture adapter's (`fieldGestures.ts`): it decides whether a finger edits,
 * navigates or opens a menu, and tells the editor itself. Returns the detach.
 */
export function attachFieldPointerInput(
    element: HTMLElement,
    editor: FieldEditor,
    options: FieldPointerInputOptions = {},
): () => void {
    const pointer = (event: PointerEvent): FieldPointer =>
        fieldPointerAt(element, event);

    /** The pointer the editor's press captured; other captures (navigation's) aren't its to cancel. */
    let captured: number | null = null;
    const penPan = attachPenPan(element, editor);
    const down = (event: PointerEvent) => {
        if (fieldGesturesOwn(event)) return;
        let press = pointer(event);
        if (event.pointerType === "pen" && event.button === 0) {
            const drag = options.penDrag?.(press) ?? null;
            if (drag === "pan") {
                penPan.start(event, press);
                return;
            }
            if (drag === "lasso") press = { ...press, area: "lasso" };
        }
        if (!editor.pointerDown(press)) return;
        captured = event.pointerId;
        element.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
        if (fieldGesturesOwn(event) || penPan.move(event)) return;
        editor.pointerMove(pointer(event));
    };
    const up = (event: PointerEvent) => {
        if (fieldGesturesOwn(event) || penPan.end(event)) return;
        editor.pointerUp(pointer(event));
    };
    const cancel = (event: PointerEvent) => {
        penPan.cancel(event);
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
 * A pen press that moves the view (the pill's Pan mode, tablet 1.3): it pans
 * one to one once it leaves the pen's click slop, catching up at once, and a
 * press that never left it is a click on empty field, as a tap there is.
 */
function attachPenPan(element: HTMLElement, editor: FieldEditor) {
    let pan: {
        id: number;
        press: FieldPointer;
        x: number;
        y: number;
        moved: boolean;
    } | null = null;
    const end = (panning: boolean) => {
        pan = null;
        if (panning) useFieldViewStore.setState({ panning: false });
    };
    return {
        start(event: PointerEvent, press: FieldPointer) {
            pan = {
                id: event.pointerId,
                press,
                x: event.clientX,
                y: event.clientY,
                moved: false,
            };
            element.setPointerCapture(event.pointerId);
        },
        /** Whether the move was the pan's */
        move(event: PointerEvent): boolean {
            if (pan?.id !== event.pointerId) return false;
            const dx = event.clientX - pan.x;
            const dy = event.clientY - pan.y;
            if (!pan.moved) {
                if (Math.hypot(dx, dy) < thresholdsFor("pen").moveThreshold)
                    return true;
                pan.moved = true;
                useFieldViewStore.setState({ panning: true });
            }
            pan.x = event.clientX;
            pan.y = event.clientY;
            const { width, height, zoom, panX, panY } =
                useFieldViewStore.getState();
            setView(panBy({ width, height, zoom, panX, panY }, dx, dy));
            return true;
        },
        /** Whether the release was the pan's */
        end(event: PointerEvent): boolean {
            if (pan?.id !== event.pointerId) return false;
            const { press, moved } = pan;
            end(moved);
            if (!moved) editor.fingerTap(press);
            return true;
        },
        cancel(event: PointerEvent) {
            if (pan?.id === event.pointerId) end(pan.moved);
        },
    };
}

/**
 * Navigation captures right presses on the field's root, so their moves and
 * release don't reach the canvas: the editor hears them here (a right-click
 * clears the line tool's line, #203, or opens the menu, #315; a right-drag
 * that panned does neither). A Mac's Ctrl-press is a right press too (a
 * Line's point menu, #569). Only a right press that started on the field:
 * one from elsewhere (the timeline) moving over it isn't the field's. Returns
 * the detach.
 */
function listenForCapturedRightPresses(
    element: HTMLElement,
    editor: FieldEditor,
    pointer: (event: PointerEvent) => FieldPointer,
): () => void {
    /** The pointer and button of the right press the field saw, until its release. */
    let pressed: number | null = null;
    let button = 2;
    const down = (event: PointerEvent) => {
        if (fieldGesturesOwn(event)) return;
        const macCtrl = event.button === 0 && event.ctrlKey && isMacPlatform();
        if (event.button !== 2 && !macCtrl) return;
        pressed = event.pointerId;
        button = event.button;
    };
    const move = (event: PointerEvent) => {
        const held = button === 2 ? 2 : 1;
        if (event.pointerId !== pressed || !(event.buttons & held)) return;
        if (event.target === element) return;
        editor.pointerMove(pointer(event));
    };
    const up = (event: PointerEvent) => {
        if (event.pointerId !== pressed || event.button !== button) return;
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
