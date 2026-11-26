/**
 * What the cue lanes share (fork #992, #993): their sizes, a finger's long press for a cue's
 * menu, and the width of a row's pinned name.
 */
import {
    useLayoutEffect,
    useRef,
    useState,
    type MouseEvent as ReactMouseEvent,
    type PointerEvent as ReactPointerEvent,
} from "react";

export const HEADER = 20;
export const ROW = 20;
export const SUMMARY = 24;
export const EMPTY = 22;
export const PAD = 4;
/** A mouse press on a cue moves this far before it drags, as a move's clip does */
export const DRAG_SLOP_PX = 3;

/** How long a finger holds still on a cue to open its menu. */
const LONG_PRESS_MS = 500;
/** How far a finger may drift during a long press. */
const LONG_PRESS_SLOP = 10;

/**
 * A finger held still on a cue (a bar or a mark) opens its menu, as a right-click does. `start`
 * goes in the press handler, the rest on the element.
 */
export function useLongPressMenu(
    onMenu: (clientX: number, clientY: number) => void,
) {
    const press = useRef<{
        x: number;
        y: number;
        timer: ReturnType<typeof setTimeout>;
    } | null>(null);
    const end = () => {
        if (press.current) clearTimeout(press.current.timer);
        press.current = null;
    };
    return {
        start: (e: ReactPointerEvent<HTMLElement>) => {
            if (e.pointerType === "mouse") return;
            const { clientX, clientY } = e;
            end();
            press.current = {
                x: clientX,
                y: clientY,
                timer: setTimeout(() => {
                    press.current = null;
                    onMenu(clientX, clientY);
                }, LONG_PRESS_MS),
            };
        },
        handlers: {
            onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
                const p = press.current;
                if (
                    p &&
                    Math.hypot(e.clientX - p.x, e.clientY - p.y) >
                        LONG_PRESS_SLOP
                )
                    end();
            },
            onPointerUp: end,
            onPointerCancel: end,
            onContextMenu: (e: ReactMouseEvent<HTMLElement>) => {
                e.preventDefault();
                e.stopPropagation();
                end();
                onMenu(e.clientX, e.clientY);
            },
        },
    };
}

/** The room between a row's pinned name and a bar's own name, in px */
export const ROW_NAME_GAP = 4;

/**
 * A row's name is pinned at the lane's left edge, over the start of whatever bar is there (fork
 * #985). Its width, kept current, so a bar can pin its own name just past it: a cue at the show's
 * start, or one scrolled past, still shows its whole name. 0 where nothing measures (jsdom).
 */
export function useRowNameWidth<T extends HTMLElement>() {
    const ref = useRef<T>(null);
    const [width, setWidth] = useState(0);
    useLayoutEffect(() => {
        const element = ref.current;
        if (!element) return;
        setWidth(element.offsetWidth);
        if (typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(() =>
            setWidth(element.offsetWidth),
        );
        observer.observe(element);
        return () => observer.disconnect();
    }, []);
    return { ref, width };
}
