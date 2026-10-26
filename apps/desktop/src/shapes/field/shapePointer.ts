import { create } from "zustand";
import { CLICK_FOCUS_ATTRIBUTE } from "@/utilities/clickFocus";

/**
 * Where the pointer and keyboard are for the shape on the field: the open shape, or the selected
 * placed one (#403, #430). One signal for both, so they calm down and come back the same way.
 * `over`: the pointer is over the shape or one of its controls. `dragging`: a placed shape's
 * gesture is under way (the open shape's own gesture is in its tool state). `editorFocus`:
 * keyboard focus is inside the floating editor, typing a number counting.
 */
export const useShapePointerStore = create<{
    over: boolean;
    dragging: boolean;
    editorFocus: boolean;
}>(() => ({ over: false, dragging: false, editorFocus: false }));

/** Notes whether the pointer is over the shape or one of its controls */
export function setShapePointerOver(over: boolean): void {
    if (useShapePointerStore.getState().over !== over)
        useShapePointerStore.setState({ over });
}

/** Notes whether a placed shape's gesture is under way */
export function setShapeDragging(dragging: boolean): void {
    if (useShapePointerStore.getState().dragging !== dragging)
        useShapePointerStore.setState({ dragging });
}

/** Another shape (or none) takes the field: the last one's pointer and gesture don't carry over */
export function resetShapePointer(): void {
    setShapePointerOver(false);
    setShapeDragging(false);
}

/**
 * Whether the shape's controls are calm: the pointer away from it, no gesture under way and no
 * keyboard focus in its editor (#403, #430)
 */
export function shapeCalm(gesture: boolean): boolean {
    const { over, dragging, editorFocus } = useShapePointerStore.getState();
    return !over && !gesture && !dragging && !editorFocus;
}

/** Keyboard focus as `ShapeEditorSurface.css` has it: not focus a click left on a button */
function editorHasKeyFocus(doc: Document): boolean {
    const el = doc.activeElement;
    return (
        !!el?.closest("[data-shape-editor]") &&
        el.matches(":focus-visible") &&
        !el.hasAttribute(CLICK_FOCUS_ATTRIBUTE)
    );
}

/**
 * Follows keyboard focus in the floating editor. A key can turn click focus into keyboard focus
 * (`clickFocus.ts`), and the click-focus mark is set as focus arrives, so it looks once the event
 * is through. Returns the cleanup.
 */
export function watchShapeEditorFocus(doc: Document = document): () => void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const check = () => {
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            const editorFocus = editorHasKeyFocus(doc);
            if (useShapePointerStore.getState().editorFocus !== editorFocus)
                useShapePointerStore.setState({ editorFocus });
        });
    };
    const events = ["focusin", "focusout", "keydown"] as const;
    for (const e of events) doc.addEventListener(e, check, true);
    check();
    return () => {
        if (timer !== null) clearTimeout(timer);
        for (const e of events) doc.removeEventListener(e, check, true);
        useShapePointerStore.setState({ editorFocus: false });
    };
}
