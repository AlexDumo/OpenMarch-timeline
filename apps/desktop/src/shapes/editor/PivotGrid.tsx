import { useState } from "react";
import clsx from "clsx";
import * as Popover from "@radix-ui/react-popover";
import { CaretDownIcon } from "@phosphor-icons/react";
import {
    PIVOT_KEYS,
    isPivotKey,
    type Pivot,
    type PivotKey,
} from "../frame/frame";
import { keepFocus } from "./keepFocus";
import { Tip } from "./Tip";
import { arrowFocus, useMenuFocus } from "./menuFocus";

export const PIVOT_NAMES: Record<PivotKey, string> = {
    nw: "back left",
    n: "back",
    ne: "back right",
    w: "left",
    c: "center",
    e: "right",
    sw: "front left",
    s: "front",
    se: "front right",
};

/**
 * What turns, flips and scales go around: a corner, an edge's middle or the center. A shape's
 * pivot dragged elsewhere on the field (#350) lights none of them. In the inspector's Transform
 * section for a plain selection, and in the floating editor's pivot menu for a shape (#435).
 */
export function PivotGrid({
    pivot,
    onPick,
    testId = "transform-pivot",
}: {
    pivot: Pivot;
    onPick: (key: PivotKey) => void;
    testId?: string;
}) {
    // One stop for Tab, on the pivot picked (the center for one dragged on the field); the arrows
    // move between the nine, Enter or Space picks (review)
    const stop = isPivotKey(pivot) ? pivot : "c";
    return (
        <div
            role="radiogroup"
            aria-label="Pivot"
            onKeyDown={(e) =>
                arrowFocus(
                    e,
                    [
                        ...e.currentTarget.querySelectorAll<HTMLElement>(
                            '[role="radio"]',
                        ),
                    ],
                    3,
                )
            }
            className="rounded-4 border-stroke grid shrink-0 grid-cols-3 gap-2 border p-4"
            data-testid={testId}
        >
            {PIVOT_KEYS.map((key) => (
                <Tip
                    key={key}
                    label={`Turn and flip around the ${PIVOT_NAMES[key]}`}
                >
                    <button
                        type="button"
                        role="radio"
                        aria-checked={key === pivot}
                        tabIndex={key === stop ? 0 : -1}
                        aria-label={`Pivot: ${PIVOT_NAMES[key]}`}
                        onPointerDown={keepFocus}
                        onClick={() => onPick(key)}
                        data-testid={`${testId}-${key}`}
                        className="flex size-16 items-center justify-center"
                    >
                        <span
                            className={clsx(
                                "block rounded-full",
                                key === pivot
                                    ? "bg-accent size-8"
                                    : "bg-text/30 hover:bg-accent/60 size-6",
                            )}
                        />
                    </button>
                </Tip>
            ))}
        </div>
    );
}

/** The pivot as a small 3 × 3 of dots, the pivot's lit; a pivot dragged elsewhere lights none */
function PivotGlyph({ pivot }: { pivot: Pivot }) {
    return (
        <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden>
            {PIVOT_KEYS.map((key, i) => {
                const on = key === pivot;
                return (
                    <circle
                        key={key}
                        cx={2 + (i % 3) * 5}
                        cy={2 + Math.floor(i / 3) * 5}
                        r={on ? 2 : 1.1}
                        fill="currentColor"
                        className={on ? "text-accent" : "opacity-60"}
                    />
                );
            })}
        </svg>
    );
}

/**
 * The floating editor's pivot (#435): a small button beside the turn whose icon shows the pivot,
 * opening the 3 × 3 grid. Picking one closes it.
 */
export function PivotMenu({
    pivot,
    onPick,
    testId,
}: {
    pivot: Pivot;
    onPick: (key: PivotKey) => void;
    testId: string;
}) {
    const [open, setOpen] = useState(false);
    // Opened by keyboard, focus goes to the pivot picked now (review)
    const focus = useMenuFocus((el) =>
        el.querySelector<HTMLElement>('[role="radio"][tabindex="0"]'),
    );
    const label = isPivotKey(pivot)
        ? `Pivot: ${PIVOT_NAMES[pivot]}`
        : "Pivot: where it was dragged on the field";
    return (
        <Popover.Root open={open} onOpenChange={setOpen}>
            <Tip label={label}>
                <Popover.Trigger asChild>
                    <button
                        type="button"
                        aria-label={label}
                        {...focus.trigger}
                        data-testid={testId}
                        data-pivot={isPivotKey(pivot) ? pivot : "custom"}
                        className="rounded-4 hover:text-accent flex min-h-24 items-center justify-center gap-2 p-4"
                    >
                        <PivotGlyph pivot={pivot} />
                        <CaretDownIcon size={8} />
                    </button>
                </Popover.Trigger>
            </Tip>
            <Popover.Portal>
                <Popover.Content
                    side="bottom"
                    align="center"
                    sideOffset={6}
                    {...focus.content}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="rounded-6 border-stroke bg-bg-1 bg-modal shadow-modal z-50 border p-4"
                >
                    <PivotGrid
                        pivot={pivot}
                        onPick={(key) => {
                            onPick(key);
                            setOpen(false);
                        }}
                        testId={`${testId}-grid`}
                    />
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}
