import clsx from "clsx";
import * as Popover from "@radix-ui/react-popover";
import { ArrowsLeftRightIcon, CaretDownIcon } from "@phosphor-icons/react";
import tolgee from "@/global/singletons/Tolgee";
import {
    isReversed,
    modeHasOrder,
    orderChoiceOf,
    orderModeOf,
    type OrderMode,
} from "../assign";
import type { ShapeEditTarget } from "./editTargets";
import { IconButton } from "./IconButton";
import { arrowFocus, useEditorMenu, useMenuFocus } from "./menuFocus";
import { OrderPicture } from "./OrderPicture";
import { Tip } from "./Tip";

/**
 * The ways to assign marchers, in the menu's order: Keep order only when offered, or when the shape
 * has it already
 */
export function orderModes(
    keepOffered: boolean,
    current: OrderMode,
): { value: OrderMode; label: string }[] {
    return [
        {
            value: "nearest",
            label: tolgee.t("shapes.edit.order.nearest", "Least travel"),
        },
        ...(keepOffered || current === "keep"
            ? [
                  {
                      value: "keep" as const,
                      label: tolgee.t("shapes.edit.order.keep", "Keep order"),
                  },
              ]
            : []),
    ];
}

/**
 * Who goes where on a kind with an order along it (a Line, #528): a menu of the ways to assign
 * marchers, Least travel or Keep order (when every marcher comes from one placed Line), and beside
 * it a Reverse toggle for a way with an order, greyed out on Least travel. Like the kind's own
 * menus, the button names the way the shape has; picking another, or toggling Reverse, lays the
 * marchers out again as one change. Each answer's picture reads the new line as numbers, Keep
 * order's turning round with Reverse. None for a kind without an order.
 */
export function OrderMenu({
    target,
}: {
    target: Pick<ShapeEditTarget, "order">;
}) {
    const [open, setOpen] = useEditorMenu();
    const focus = useMenuFocus((el) =>
        el.querySelector<HTMLElement>(
            '[role="menuitemradio"][aria-checked="true"]',
        ),
    );
    const order = target.order;
    if (!order) return null;
    const label = tolgee.t("shapes.edit.order.label", "Who goes where");
    const mode = orderModeOf(order.current);
    const reversed = isReversed(order.current);
    const options = orderModes(order.keepOffered, mode);
    const currentLabel = options.find((o) => o.value === mode)?.label ?? mode;
    // Picking the way it's on already changes nothing, Reverse included
    const pick = (value: OrderMode) => {
        setOpen(false);
        if (value !== mode) order.pick(orderChoiceOf(value, reversed));
    };
    return (
        <span className="flex items-center gap-2">
            <Popover.Root open={open} onOpenChange={setOpen}>
                <Tip label={label}>
                    <Popover.Trigger asChild>
                        <button
                            type="button"
                            aria-label={`${label}: ${currentLabel}`}
                            {...focus.trigger}
                            data-testid="shape-order"
                            data-value={mode}
                            className="rounded-4 hover:bg-fg-2 flex min-h-24 items-center gap-4 px-4 py-2"
                        >
                            <OrderPicture
                                choice={order.current}
                                testId="shape-order-picture"
                            />
                            <span>{currentLabel}</span>
                            <CaretDownIcon size={10} />
                        </button>
                    </Popover.Trigger>
                </Tip>
                <Popover.Portal>
                    <Popover.Content
                        side="bottom"
                        align="start"
                        sideOffset={6}
                        {...focus.content}
                        onPointerDown={(e) => e.stopPropagation()}
                        className="rounded-6 border-stroke bg-bg-1 bg-modal text-sub text-text shadow-modal z-50 border p-6"
                        data-testid="shape-order-content"
                    >
                        <div
                            className="flex flex-col gap-1"
                            role="menu"
                            aria-label={label}
                            onKeyDown={(e) =>
                                arrowFocus(e, [
                                    ...e.currentTarget.querySelectorAll<HTMLElement>(
                                        '[role="menuitemradio"]',
                                    ),
                                ])
                            }
                        >
                            {options.map((option) => (
                                <button
                                    key={option.value}
                                    type="button"
                                    role="menuitemradio"
                                    aria-checked={option.value === mode}
                                    onClick={() => pick(option.value)}
                                    data-testid={`shape-order-${option.value}`}
                                    className={clsx(
                                        "rounded-4 flex min-h-24 items-center gap-8 px-4 py-2 text-left",
                                        option.value === mode
                                            ? "bg-fg-2 text-accent"
                                            : "hover:text-accent",
                                    )}
                                >
                                    <OrderPicture
                                        choice={orderChoiceOf(
                                            option.value,
                                            reversed,
                                        )}
                                        testId={`shape-order-${option.value}-picture`}
                                    />
                                    <span>{option.label}</span>
                                </button>
                            ))}
                        </div>
                    </Popover.Content>
                </Popover.Portal>
            </Popover.Root>
            <ReverseToggle
                mode={mode}
                reversed={reversed}
                toggle={() => order.pick(orderChoiceOf(mode, !reversed))}
            />
        </span>
    );
}

/**
 * Reverse, beside the menu: the way picked, run from the far end. Only a way with an order has one
 * to reverse, so it's greyed out on Least travel, its tip saying why.
 */
function ReverseToggle({
    mode,
    reversed,
    toggle,
}: {
    mode: OrderMode;
    reversed: boolean;
    toggle: () => void;
}) {
    const can = modeHasOrder(mode);
    return (
        <IconButton
            label={tolgee.t("shapes.edit.order.reverse", "Reverse")}
            hint={
                can
                    ? undefined
                    : tolgee.t(
                          "shapes.edit.order.reverseNone",
                          "Least travel has no order to reverse",
                      )
            }
            pressed={can && reversed}
            disabled={!can}
            onClick={toggle}
            testId="shape-order-reverse"
        >
            <ArrowsLeftRightIcon
                size={14}
                weight={can && reversed ? "bold" : "regular"}
            />
        </IconButton>
    );
}
