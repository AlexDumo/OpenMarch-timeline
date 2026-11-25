/**
 * What the cue lanes share (fork #992, #993): their sizes, and a finger's long press for a cue's
 * menu.
 */
import {
    useRef,
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
