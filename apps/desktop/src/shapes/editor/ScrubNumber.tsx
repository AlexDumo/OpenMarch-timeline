import clsx from "clsx";
import { useRef, useState, type PointerEvent } from "react";
import { lockedAxis, SCRUB_SLOP_PX, type ScrubAxis } from "./scrub";

/** What a drag on a number reports, from where the press was */
export interface ScrubMove {
    readonly dx: number;
    readonly dy: number;
    /** The direction a two-way number locked to */
    readonly axis: ScrubAxis;
    readonly alt: boolean;
    readonly shift: boolean;
}

const CURSORS: Record<ScrubAxis | "both", string> = {
    x: "ew-resize",
    y: "ns-resize",
    both: "move",
};

/**
 * A number in the floating editor (08-shape-system-ux.md, "Numbers you can type or drag"):
 * click it to type over it (Enter or clicking away applies, Esc cancels), or drag it to change it.
 * It lights up while dragged, and its cursor shows which way it drags. A two-way number (a box's
 * size) locks to the first direction moved. The value itself is the parent's: it hears the drag
 * and the typing and works out what they mean.
 */
export function ScrubNumber({
    display,
    editText = display,
    axis,
    label,
    testId,
    onScrubStart,
    onScrub,
    onScrubEnd,
    onType,
}: {
    /** What the number shows */
    display: string;
    /** What typing starts from; the display by default */
    editText?: string;
    axis: ScrubAxis | "both";
    /** Its name for people and screen readers: "Side-to-side spacing" */
    label: string;
    testId?: string;
    onScrubStart: () => void;
    onScrub: (move: ScrubMove) => void;
    /** The drag ended: kept, or cancelled (the pointer was lost) */
    onScrubEnd: (keep: boolean) => void;
    /** Applies typed text; false keeps it open to fix */
    onType: (text: string) => boolean;
}) {
    const press = useRef<{
        x: number;
        y: number;
        axis: ScrubAxis | null;
        dragging: boolean;
    } | null>(null);
    const [dragging, setDragging] = useState(false);
    const [typing, setTyping] = useState<string | null>(null);

    if (typing !== null) {
        const apply = () => {
            if (onType(typing)) setTyping(null);
        };
        return (
            <input
                autoFocus
                aria-label={label}
                data-testid={testId && `${testId}-input`}
                className="rounded-4 border-accent bg-fg-1 text-sub text-text w-[5ch] border px-2 text-center tabular-nums outline-none"
                style={{ width: `${Math.max(typing.length, 3) + 1}ch` }}
                value={typing}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => setTyping(e.currentTarget.value)}
                onBlur={apply}
                onKeyDown={(e) => {
                    // The number's own keys: the shape tool doesn't see them
                    e.stopPropagation();
                    if (e.key === "Enter") apply();
                    else if (e.key === "Escape") setTyping(null);
                }}
            />
        );
    }

    const down = (e: PointerEvent<HTMLButtonElement>) => {
        if (e.button !== 0) return;
        // A press doesn't take the focus, so Enter still places the shape afterwards; Tab
        // reaches the number for typing
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        press.current = {
            x: e.clientX,
            y: e.clientY,
            axis: axis === "both" ? null : axis,
            dragging: false,
        };
    };
    const move = (e: PointerEvent<HTMLButtonElement>) => {
        const p = press.current;
        if (!p) return;
        const dx = e.clientX - p.x;
        const dy = e.clientY - p.y;
        if (!p.dragging) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) < SCRUB_SLOP_PX) return;
            p.dragging = true;
            setDragging(true);
            onScrubStart();
        }
        p.axis = lockedAxis(p.axis, dx, dy) ?? p.axis;
        if (!p.axis) return;
        onScrub({ dx, dy, axis: p.axis, alt: e.altKey, shift: e.shiftKey });
    };
    const up = (keep: boolean) => {
        const p = press.current;
        press.current = null;
        if (!p) return;
        if (p.dragging) {
            setDragging(false);
            onScrubEnd(keep);
        } else if (keep) setTyping(editText);
    };

    return (
        <button
            type="button"
            aria-label={label}
            title={`${label}: click to type, drag to change`}
            data-testid={testId}
            className={clsx(
                "rounded-4 px-2 tabular-nums select-none",
                dragging
                    ? "bg-accent text-text-invert"
                    : "hover:bg-fg-2 hover:text-accent",
            )}
            style={{ cursor: CURSORS[axis], touchAction: "none" }}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={() => up(true)}
            onPointerCancel={() => up(false)}
            onLostPointerCapture={() => up(true)}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    setTyping(editText);
                }
            }}
        >
            {display}
        </button>
    );
}
