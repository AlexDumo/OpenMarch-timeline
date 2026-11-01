import clsx from "clsx";
import type { ReactNode } from "react";
import { keepFocus } from "./keepFocus";
import { Tip } from "./Tip";

/**
 * An icon button on the floating editor: its tooltip names it or, greyed out, says why it cannot
 * act; `pressed` makes it a toggle
 */
export function IconButton({
    label,
    hint,
    shortcut,
    className,
    onClick,
    disabled,
    pressed,
    testId,
    children,
}: {
    label: string;
    /** A second, quieter line in the tooltip: why it's greyed out, say */
    hint?: string;
    /** Its keys, shown in the tooltip as keycaps */
    shortcut?: string;
    className?: string;
    onClick: () => void;
    disabled?: boolean;
    pressed?: boolean;
    testId?: string;
    children: ReactNode;
}) {
    return (
        <Tip label={label} hint={hint} shortcut={shortcut}>
            <button
                type="button"
                aria-label={label}
                aria-pressed={pressed}
                // aria-disabled, not disabled: a disabled button gets no pointer, so its tooltip
                // (which says why, as Recalculate's does) wouldn't show
                aria-disabled={disabled || undefined}
                onPointerDown={keepFocus}
                onClick={() => {
                    if (!disabled) onClick();
                }}
                data-testid={testId}
                className={clsx(
                    // At least 24 px to hit (WCAG 2.2 target size; review round r429)
                    "rounded-4 flex min-h-24 min-w-24 items-center justify-center gap-4 p-4",
                    // On: the icon in the accent on a light accent tint, so the state is plain at a
                    // glance without reading as a solid button (owner)
                    pressed ? "bg-accent/15 text-accent" : "hover:text-accent",
                    disabled && "cursor-default opacity-40 hover:text-inherit",
                    className,
                )}
            >
                {children}
            </button>
        </Tip>
    );
}
