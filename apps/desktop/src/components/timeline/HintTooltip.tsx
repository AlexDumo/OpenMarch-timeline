import { useCallback, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { TooltipClassName } from "@openmarch/ui";

// cspell:ignore Hoverable

/*
 * A label with an optional muted hint line, as the transport's `ShortcutTooltip` (fork branch
 * timeline/transport-keys, UI-17) draws it. That branch isn't merged here, so this is its
 * equivalent: swap both for the shared one once it lands.
 */

/** The timings for `HintTooltip`s below it: a short hover, and a quicker one moving along a row. */
export function HintTooltipProvider({ children }: { children: ReactNode }) {
    return (
        <Tooltip.Provider
            delayDuration={500}
            skipDelayDuration={300}
            disableHoverableContent
        >
            {children}
        </Tooltip.Provider>
    );
}

/**
 * Wraps one element (that forwards its ref and spreads pointer and focus handlers) in a tooltip:
 * `label`, then an optional `hint` line. Opens after a hover, or on keyboard focus; never while
 * a pointer is down on it, so a click, drag, scrub or right-click goes on undisturbed: a press
 * closes it (and cancels a pending open), and it stays closed until the pointer leaves. Without a
 * `label` it never opens. Needs a `HintTooltipProvider` above it.
 */
export function HintTooltip({
    label,
    hint,
    side = "top",
    children,
}: {
    label: string | undefined;
    hint?: string;
    side?: "top" | "bottom" | "left" | "right";
    children: ReactElement;
}) {
    const [open, setOpen] = useState(false);
    // Set by a press, cleared when the pointer leaves: an open the hover's delay asks for while
    // the pointer is down (or after it's released over the box) is ignored
    const pressed = useRef(false);
    const onOpenChange = useCallback((next: boolean) => {
        setOpen(next && !pressed.current);
    }, []);
    return (
        <Tooltip.Root open={open && !!label} onOpenChange={onOpenChange}>
            <Tooltip.Trigger
                asChild
                onPointerDown={() => {
                    pressed.current = true;
                    setOpen(false);
                }}
                onPointerLeave={() => {
                    pressed.current = false;
                }}
            >
                {children}
            </Tooltip.Trigger>
            {label && (
                <Tooltip.Portal>
                    <Tooltip.Content
                        side={side}
                        sideOffset={4}
                        className={TooltipClassName}
                    >
                        <span className="block text-[12px]">{label}</span>
                        {hint && (
                            <span className="text-text-subtitle block text-[11px]">
                                {hint}
                            </span>
                        )}
                    </Tooltip.Content>
                </Tooltip.Portal>
            )}
        </Tooltip.Root>
    );
}
