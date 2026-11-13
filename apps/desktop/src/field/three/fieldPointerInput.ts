import type { FieldEditor, FieldPointer } from "@/field/editor/fieldEditor";
import { isMacPlatform } from "@/shortcuts/platform";
import { GESTURE_TIMING } from "@/components/canvas/touch/touchGestures";
import { fieldPointerAt } from "./fieldView";
import { fieldGesturesOwn } from "./fieldGestures";

/**
 * Reports the pointer on the new field's canvas to the editor: positions on
 * the field and on screen, the button and the modifiers, nothing else (ADR
 * 0005 D-2). The editor decides what they do. Shows the editor's cursor.
 *
 * Mouse and pen presses come straight here. Finger presses are the field's
 * gesture adapter's (`fieldGestures.ts`): it decides whether a finger edits,
 * navigates or opens a menu, and tells the editor itself. Returns the detach.
 *
 * A pen has no right button (an Apple Pencil has no barrel button), so a pen
 * held still opens the menus a right-click would (tablet 1.5): see
 * {@link watchPenHold}. A mouse never long-presses.
 */
export function attachFieldPointerInput(
    element: HTMLElement,
    editor: FieldEditor,
): () => void {
    const pointer = (event: PointerEvent): FieldPointer =>
        fieldPointerAt(element, event);

    /** The pointer the editor's press captured; other captures (navigation's) aren't its to cancel. */
    let captured: number | null = null;
    const penHold = watchPenHold(editor, pointer);
    const down = (event: PointerEvent) => {
        if (fieldGesturesOwn(event)) return;
        if (!editor.pointerDown(pointer(event))) return;
        captured = event.pointerId;
        element.setPointerCapture(event.pointerId);
        penHold.down(event);
    };
    const move = (event: PointerEvent) => {
        if (fieldGesturesOwn(event) || penHold.move(event)) return;
        editor.pointerMove(pointer(event));
    };
    const up = (event: PointerEvent) => {
        if (fieldGesturesOwn(event) || penHold.end(event)) return;
        editor.pointerUp(pointer(event));
    };
    const cancel = (event: PointerEvent) => {
        penHold.end(event);
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
        penHold.stop();
        unsubscribe();
        editor.pointerCancel();
        element.style.cursor = "";
    };
}

/**
 * A pen's long press (tablet 1.5): a pen press the editor took that stays
 * within the long press slop for the long press time, as a finger's
 * (`GESTURE_TIMING`), asks the editor for the menus a right-click there
 * opens (`FieldEditor.longPress`). One that opens a menu has ended the press
 * in the editor; the rest of the pen's press (its moves and its lift) is then
 * nobody's. A pen that moves past the slop first is dragging, and is left
 * alone. Mouse presses are never timed.
 *
 * The timer waits a frame after it's due, as the finger's does, so moves the
 * browser has queued are counted first.
 */
export function watchPenHold(
    editor: Pick<FieldEditor, "longPress">,
    pointer: (event: PointerEvent) => FieldPointer,
) {
    let held: {
        id: number;
        x: number;
        y: number;
        last: PointerEvent;
        cancel: () => void;
    } | null = null;
    /** The pen press a long press ended, until it lifts */
    let ended: number | null = null;
    const stop = () => {
        held?.cancel();
        held = null;
    };
    const fire = () => {
        if (!held) return;
        const { id, last } = held;
        held = null;
        if (editor.longPress(pointer(last))) ended = id;
    };
    return {
        /** A press the editor took */
        down(event: PointerEvent) {
            stop();
            if (event.pointerType !== "pen" || event.button !== 0) return;
            let frame: number | null = null;
            const timer = setTimeout(() => {
                frame = requestAnimationFrame(() => {
                    frame = null;
                    fire();
                });
            }, GESTURE_TIMING.longPressMs);
            held = {
                id: event.pointerId,
                x: event.clientX,
                y: event.clientY,
                last: event,
                cancel: () => {
                    clearTimeout(timer);
                    if (frame !== null) cancelAnimationFrame(frame);
                },
            };
        },
        /** A move; true when it's no one's (the press it's part of opened a menu) */
        move(event: PointerEvent): boolean {
            if (event.pointerId === ended) return true;
            if (event.pointerId !== held?.id) return false;
            if (
                Math.hypot(event.clientX - held.x, event.clientY - held.y) >
                GESTURE_TIMING.longPressSlopPx
            )
                stop();
            else held.last = event;
            return false;
        },
        /** A lift or a lost pointer; true when it's no one's, as {@link move} */
        end(event: PointerEvent): boolean {
            if (event.pointerId === held?.id) stop();
            if (event.pointerId !== ended) return false;
            ended = null;
            return true;
        },
        stop() {
            stop();
            ended = null;
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
