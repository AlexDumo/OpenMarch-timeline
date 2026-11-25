import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { Rect } from "@/components/canvas/fieldLayers";
import { fieldToElement, useFieldViewStore } from "@/field/three/fieldView";
import { shapeOutline } from "../frame/gestures";
import type { AnyToolKind } from "../tool/toolKind";
import type { XY } from "../types";
import {
    covered,
    MENU_GAP_PX,
    menuPlacement,
    shapeSamples,
    menuSideProps,
    type MenuWhere,
} from "./menuPlacement";

const rectOf = (el: Element): Rect => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
};

interface Placed {
    readonly where: MenuWhere;
    readonly props: ReturnType<typeof menuSideProps>;
    readonly field: Element;
    /** Held still by a drag with the shape under it: see-through until it's let go */
    readonly faded: boolean;
}

/**
 * Watches the menu's size and the editor's spot (its spring sets its style each frame), calling
 * `then` on a change; `(null, null)` stops
 */
function watcher(then: () => void) {
    const sized =
        typeof ResizeObserver === "function" ? new ResizeObserver(then) : null;
    const moved =
        typeof MutationObserver === "function"
            ? new MutationObserver(then)
            : null;
    let menuNow: Element | null = null;
    let editorNow: Element | null = null;
    return (menu: Element | null, editor: Element | null) => {
        if (menu === menuNow && editor === editorNow) return;
        sized?.disconnect();
        moved?.disconnect();
        menuNow = menu;
        editorNow = editor;
        if (menu) sized?.observe(menu);
        if (editor)
            moved?.observe(editor, {
                attributes: true,
                attributeFilter: ["style"],
            });
    };
}

/** How see-through it is while a drag holds it over the shape */
const FADED = 0.35;

/** Whether it moved: half a pixel's change is none, so a pan doesn't redraw it every frame */
const samePlace = (a: Placed, b: Placed) =>
    a.where === b.where &&
    a.field === b.field &&
    a.faded === b.faded &&
    a.props.side === b.props.side &&
    Math.abs(a.props.sideOffset - b.props.sideOffset) < 0.5;

/** The popover content's props for where it goes. Before it's measured, under the button */
const contentProps = (placed: Placed | null) => ({
    where: placed?.where ?? "below",
    side: placed?.props.side ?? "bottom",
    align: placed?.props.align ?? "start",
    sideOffset: placed?.props.sideOffset ?? MENU_GAP_PX,
    collisionBoundary: placed?.field,
    collisionPadding: 4,
    // Unseen until it's placed, so it doesn't flash over the shape first. Not hidden: focus goes
    // into it on a keyboard open. See-through while a drag in it holds it over the shape
    style: !placed
        ? { opacity: 0 }
        : placed.faded
          ? { opacity: FADED, transition: "opacity 120ms" }
          : { transition: "opacity 120ms" },
});

interface ShapeNow {
    readonly kind: AnyToolKind;
    readonly params: unknown;
    readonly spots: number;
    readonly stepPx: number | undefined;
}

/** The shape's lines on screen: its outline (closed but for a line's) and its rows (spec #1190) */
function shapeOnScreen(
    fieldRect: Rect,
    { kind, params, spots, stepPx }: ShapeNow,
): XY[][] {
    const view = useFieldViewStore.getState();
    const toScreen = (p: XY) => {
        const at = fieldToElement(view, p.x, p.y);
        return { x: fieldRect.left + at.x, y: fieldRect.top + at.y };
    };
    const outline = shapeOutline(kind, params, spots);
    const closed =
        kind.outlineOpen?.(params, spots) === true || outline.length < 3
            ? outline
            : [...outline, outline[0]!];
    const rows = kind.rowOutlines?.(params, spots, stepPx) ?? [];
    return [closed, ...rows].map((line) => line.map(toScreen));
}

/** The menu see-through or not, as a state update */
const fadedIf =
    (faded: boolean) =>
    (was: Placed | null): Placed | null =>
        was && was.faded !== faded ? { ...was, faded } : was;

/** Whether the menu, where it is now, covers any of the shape */
const coversShape = (menu: Element, field: Element, now: ShapeNow) =>
    covered(rectOf(menu), shapeSamples(shapeOnScreen(rectOf(field), now))) > 0;

/** Where the menu goes, from where the button, the editor, the field and the shape are now */
function measured(
    button: Element,
    editor: Element,
    field: Element,
    menu: HTMLElement,
    now: ShapeNow,
    current: MenuWhere | null,
) {
    const fieldRect = rectOf(field);
    const triggerRect = rectOf(button);
    const editorRect = rectOf(editor);
    const next = menuPlacement({
        width: menu.offsetWidth,
        height: menu.offsetHeight,
        trigger: triggerRect,
        editor: editorRect,
        field: fieldRect,
        shape: shapeOnScreen(fieldRect, now),
        current,
    });
    return { next, props: menuSideProps(next, triggerRect, editorRect) };
}

/**
 * Where an open editor menu goes so it doesn't cover the shape (`menuPlacement`), worked out again
 * as the shape, the menu's size or the view changes. Spread onto the popover's content: its side,
 * offset and the field as the edge it keeps inside. Before it's measured, under the editor.
 */
export function useMenuOffShape({
    open,
    trigger,
    content,
    kind,
    params,
    spots,
    stepPx,
    hold,
}: {
    open: boolean;
    /** A number in it is being dragged: it stays put, so the number doesn't leave the pointer */
    hold: boolean;
    trigger: RefObject<HTMLElement | null>;
    content: RefObject<HTMLElement | null>;
    kind: AnyToolKind;
    params: unknown;
    spots: number;
    /** Places the rows as the shape does */
    stepPx: number | undefined;
}) {
    const [placed, setPlaced] = useState<Placed | null>(null);
    const where = useRef<MenuWhere | null>(null);
    /** Places it again: the effect below's, while the menu is open */
    const again = useRef<(() => void) | null>(null);
    const latest = useRef({ kind, params, spots, stepPx, hold });
    latest.current = { kind, params, spots, stepPx, hold };

    useLayoutEffect(() => {
        if (!open) {
            where.current = null;
            setPlaced(null);
            return;
        }
        let frame = 0;
        /** Frames waited for the menu to be in the page */
        let waited = 0;
        // Its size changing, or the editor springing to a new spot, places it again
        const watch = watcher(() => soon());
        const place = () => {
            const button = trigger.current;
            const editor = button?.closest<HTMLElement>("[data-shape-editor]");
            const field = editor?.offsetParent;
            const menu = content.current;
            if (!button || !editor || !field || !menu) {
                // The menu isn't in the page yet: tried again next frame, for a while
                if (waited++ < 10) soon();
                return;
            }
            if (latest.current.hold && where.current !== null) {
                // Held still for the drag: see-through while the shape is under it
                setPlaced(fadedIf(coversShape(menu, field, latest.current)));
                return;
            }
            watch(menu, editor);
            const { next, props } = measured(
                button,
                editor,
                field,
                menu,
                latest.current,
                where.current,
            );
            where.current = next.where;
            const now = { where: next.where, props, field, faded: false };
            setPlaced((was) => (was && samePlace(was, now) ? was : now));
        };
        // After layout and the popover's own positioning, then whenever the view moves
        function soon() {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(place);
        }
        again.current = soon;
        place();
        const unsubscribe = useFieldViewStore.subscribe(soon);
        return () => {
            again.current = null;
            cancelAnimationFrame(frame);
            watch(null, null);
            unsubscribe();
        };
    }, [open, trigger, content]);

    // The shape changed (a row added, the spacing dragged), or a drag let go: placed again on the
    // next frame
    useLayoutEffect(() => {
        again.current?.();
    }, [kind, params, spots, hold]);

    return contentProps(placed);
}
