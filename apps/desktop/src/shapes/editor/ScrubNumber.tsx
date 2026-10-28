import clsx from "clsx";
import { isMacPlatform } from "@/shortcuts/platform";
import { Tip } from "./Tip";
import tolgee from "@/global/singletons/Tolgee";
import { useRef, useState, type PointerEvent } from "react";
import {
    lockedAxis,
    SCRUB_SLOP_PX,
    type ScrubAxis,
    type ScrubMove,
} from "./scrub";

export type { ScrubMove };

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
    const wrapper = useRef<HTMLSpanElement>(null);

    if (typing !== null) {
        const apply = () => {
            if (onType(typing)) setTyping(null);
        };
        /** Tab and Shift+Tab: apply this one and type into the next or previous number */
        const tabTo = (step: 1 | -1) => {
            if (!onType(typing)) return;
            const own = wrapper.current;
            const all = [
                ...(own
                    ?.closest("[data-shape-editor]")
                    ?.querySelectorAll<HTMLElement>("[data-scrub-number]") ??
                    []),
            ];
            const next = own ? all[all.indexOf(own) + step] : undefined;
            setTyping(null);
            // After this one closes; a click with no pointer opens the next for typing
            requestAnimationFrame(() =>
                next?.querySelector<HTMLButtonElement>("button")?.click(),
            );
        };
        return (
            <span ref={wrapper} data-scrub-number>
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
                        else if (e.key === "Tab") {
                            e.preventDefault();
                            tabTo(e.shiftKey ? -1 : 1);
                        }
                    }}
                />
            </span>
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
        onScrub({
            dx,
            dy,
            axis: p.axis,
            alt: e.altKey,
            shift: e.shiftKey,
            mod: isMacPlatform() ? e.metaKey : e.ctrlKey,
        });
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
        <span ref={wrapper} data-scrub-number>
            <Tip
                label={tolgee.t(
                    "shapes.edit.scrubTip",
                    "{label}: click to type, drag to change",
                    { label },
                )}
            >
                <button
                    type="button"
                    aria-label={label}
                    data-testid={testId}
                    className={clsx(
                        "rounded-4 min-h-24 px-4 tabular-nums select-none",
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
                    onClick={(e) => {
                        // Not a pointer (Tab from the number before, or a script): type into it
                        if (e.detail === 0) setTyping(editText);
                    }}
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
            </Tip>
        </span>
    );
}
