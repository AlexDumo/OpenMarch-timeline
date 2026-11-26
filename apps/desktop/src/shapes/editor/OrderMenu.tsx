import clsx from "clsx";
import { useId, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import * as Tooltip from "@radix-ui/react-tooltip";
import { TooltipClassName } from "@openmarch/ui";
import { CaretDownIcon, InfoIcon, QuestionIcon } from "@phosphor-icons/react";
import tolgee from "@/global/singletons/Tolgee";
import { ORDER_CHOICES, type OrderChoice } from "../assign";
import type { OrderWhy, ShapeEditTarget } from "./editTargets";
import { arrowFocus, useEditorMenu, useMenuFocus } from "./menuFocus";
import { OrderAnimation } from "./OrderAnimation";
import { OrderPicture } from "./OrderPicture";
import { isPictured, ORDER_PICTURE_SIZE } from "./orderPictures";
import { Tip, TIP_DATA } from "@/components/ui/Tip";
import { useShapeToolStore } from "../tool/shapeToolStore";

/** A choice's name */
export function orderLabel(choice: OrderChoice): string {
    switch (choice) {
        case "nearest":
            return tolgee.t("shapes.edit.order.nearest", "Least travel");
        case "keep":
            return tolgee.t("shapes.edit.order.keep", "Keep order");
        case "reverse":
            return tolgee.t("shapes.edit.order.reverse", "Reverse order");
        case "inside":
            return tolgee.t("shapes.edit.order.inside", "Inside out");
        case "zipper":
            return tolgee.t("shapes.edit.order.zipper", "Zipper");
        case "sections":
            return tolgee.t("shapes.edit.order.sections", "Within sections");
    }
}

/** What a choice does, in words, for the tip beside it (09-who-goes-where.md) */
function orderDescription(choice: OrderChoice): string {
    switch (choice) {
        case "nearest":
            return tolgee.t(
                "shapes.edit.order.nearestHint",
                "Each marcher takes a spot that keeps everyone's walk short",
            );
        case "keep":
            return tolgee.t(
                "shapes.edit.order.keepHint",
                "The marchers' order runs along the shape, the first marcher on the first spot",
            );
        case "reverse":
            return tolgee.t(
                "shapes.edit.order.reverseHint",
                "The marchers' order runs back along the shape, the last marcher on the first spot",
            );
        case "inside":
            return tolgee.t(
                "shapes.edit.order.insideHint",
                "The middle of the line goes to the ends of the shape",
            );
        case "zipper":
            return tolgee.t(
                "shapes.edit.order.zipperHint",
                "Two lines merge into one, taking turns",
            );
        case "sections":
            return tolgee.t(
                "shapes.edit.order.sectionsHint",
                "Each section stays together, least travel inside it",
            );
    }
}

/** Why a choice is greyed out, in words */
export function orderWhyText(why: OrderWhy): string {
    switch (why) {
        case "noOrder":
            return tolgee.t(
                "shapes.edit.order.why.noOrder",
                "These marchers have no order yet (drill numbers aren't one). Use Set order on them first, or pick by hand.",
            );
        case "twoLines":
            return tolgee.t(
                "shapes.edit.order.why.twoLines",
                "These marchers come from two lines. Use Zipper, or set one order on them first.",
            );
        case "notTwoLines":
            return tolgee.t(
                "shapes.edit.order.why.notTwoLines",
                "Needs marchers from two lines, each with an order.",
            );
        case "oneSection":
            return tolgee.t(
                "shapes.edit.order.why.oneSection",
                "Everyone here is in one section.",
            );
        case "placed":
            return tolgee.t(
                "shapes.edit.order.why.placed",
                "Choose this while drawing the shape, before you place it.",
            );
    }
}

/** The menu's rows: every choice, with why it's greyed out when it is */
export function orderOptions(why: (choice: OrderChoice) => OrderWhy | null): {
    value: OrderChoice;
    label: string;
    hint: string;
    refusal: string | null;
}[] {
    return ORDER_CHOICES.map((value) => {
        const refused = why(value);
        return {
            value,
            label: orderLabel(value),
            hint: orderDescription(value),
            refusal: refused ? orderWhyText(refused) : null,
        };
    });
}

/** The picture beside a choice, or a space as wide for one without */
function ChoicePicture({
    choice,
    testId,
}: {
    choice: OrderChoice;
    testId: string;
}) {
    return isPictured(choice) ? (
        <OrderPicture choice={choice} testId={testId} />
    ) : (
        <span
            aria-hidden
            className="shrink-0"
            style={{ width: ORDER_PICTURE_SIZE.width }}
        />
    );
}

/** Whether `el` has the focus from the keys, not from a click or the menu opening */
function keyFocus(el: HTMLElement): boolean {
    try {
        return el.matches(":focus-visible");
    } catch {
        return true;
    }
}

/**
 * One answer in the menu. What it does waits in a tip beside it, a walking picture over the words,
 * shown while the row is under the pointer, has the keys or is pressed, the way the timeline menus show an unavailable entry's
 * reason; an (i) at the row's end says it's there. One that doesn't fit these marchers dims, does
 * nothing and has a **?** instead, and its tip also says why. Screen readers hear the tip as the
 * row's description. Escape closes the tip and the menu together.
 */
function OrderRow({
    option,
    current,
    onPick,
    onClose,
}: {
    option: ReturnType<typeof orderOptions>[number];
    current: boolean;
    onPick: () => void;
    /** Closes the menu: an open tip is the top layer and gets Escape first */
    onClose: () => void;
}) {
    const tipId = useId();
    const [open, setOpen] = useState(false);
    const refused = option.refusal !== null;
    const testId = `shape-order-${option.value}`;
    const Icon = refused ? QuestionIcon : InfoIcon;
    return (
        <>
            <button
                type="button"
                role="menuitemradio"
                aria-checked={current}
                aria-disabled={refused ? true : undefined}
                aria-describedby={tipId}
                // A finger's long press shows the tip too (LongPressGuard, #928)
                {...{ [TIP_DATA.label]: option.refusal ?? option.hint }}
                onClick={() => (refused ? setOpen(true) : onPick())}
                onPointerEnter={() => setOpen(true)}
                onPointerLeave={() => setOpen(false)}
                // Focus from the keys only: opening the menu focuses the current answer
                onFocus={(e) => setOpen(keyFocus(e.currentTarget))}
                onBlur={() => setOpen(false)}
                data-testid={testId}
                className={clsx(
                    "rounded-4 flex min-h-24 items-center gap-8 px-4 py-2 text-left",
                    refused
                        ? "cursor-not-allowed"
                        : current
                          ? "bg-fg-2 text-accent"
                          : "hover:text-accent",
                )}
            >
                <span
                    className={clsx(
                        "flex items-center gap-8",
                        refused && "opacity-40",
                    )}
                >
                    <ChoicePicture
                        choice={option.value}
                        testId={`${testId}-picture`}
                    />
                    <span data-label>{option.label}</span>
                </span>
                <Tooltip.Provider delayDuration={0} disableHoverableContent>
                    {/* Only the row opens and closes it, so it doesn't close as the pointer
                        crosses the icon */}
                    <Tooltip.Root open={open} onOpenChange={() => {}}>
                        <Tooltip.Trigger asChild>
                            <span
                                aria-hidden="true"
                                data-testid={`${testId}-tip-icon`}
                                data-refused={refused || undefined}
                                className="text-text/60 ml-auto pl-16"
                            >
                                <Icon size={14} />
                            </span>
                        </Tooltip.Trigger>
                        <Tooltip.Portal>
                            <Tooltip.Content
                                side="right"
                                sideOffset={8}
                                onEscapeKeyDown={onClose}
                                data-testid={`${testId}-tip`}
                                className={`${TooltipClassName} text-body flex max-w-[240px] flex-col gap-4`}
                            >
                                <OrderAnimation
                                    choice={option.value}
                                    testId={`${testId}-animation`}
                                />
                                <span>{option.hint}</span>
                                {option.refusal && (
                                    <span className="italic">
                                        {option.refusal}
                                    </span>
                                )}
                            </Tooltip.Content>
                        </Tooltip.Portal>
                    </Tooltip.Root>
                </Tooltip.Provider>
            </button>
            <span id={tipId} data-testid={`${testId}-tip-text`} hidden>
                {option.refusal
                    ? `${option.hint}. ${option.refusal}`
                    : option.hint}
            </span>
        </>
    );
}

/**
 * Who goes where on a kind with an order along it (a Line, #528; 09-who-goes-where.md): Least
 * travel, Keep order, Reverse order, Inside out, Zipper or Within sections. A choice that doesn't
 * fit these marchers is greyed out and says why in its tip. Like the kind's own menus, its button names the
 * answer the shape has, and picking another lays the marchers out again as one change. The first
 * three answers' pictures read the new line as numbers (#559); every answer says what it does in its
 * tip. On an
 * open shape a line under the answers says what the current one gives: its biggest step and how
 * many walks cross. With marchers placed by hand on top, the button says how many. None for a kind
 * without an order.
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
    // Marchers placed by hand on the open shape (Pick by hand, Swap two), on top of the answer
    const byHand = useShapeToolStore(
        (s) => new Set(s.tool?.pins?.map(([marcher]) => marcher)).size,
    );
    const order = target.order;
    if (!order) return null;
    const label = tolgee.t("shapes.edit.order.label", "Who goes where");
    const options = orderOptions(order.why);
    const currentLabel =
        byHand > 0
            ? tolgee.t(
                  "shapes.edit.order.withHandPicks",
                  "{order} · {count} by hand",
                  { order: orderLabel(order.current), count: byHand },
              )
            : orderLabel(order.current);
    const pick = (value: OrderChoice) => {
        if (order.why(value)) return;
        setOpen(false);
        if (value !== order.current) order.pick(value);
    };
    const readout = order.readout;
    return (
        <Popover.Root open={open} onOpenChange={setOpen}>
            <Tip label={label}>
                <Popover.Trigger asChild>
                    <button
                        type="button"
                        aria-label={`${label}: ${currentLabel}`}
                        {...focus.trigger}
                        data-testid="shape-order"
                        data-value={order.current}
                        className="rounded-4 hover:bg-text/10 flex min-h-24 items-center gap-4 px-4 py-2"
                    >
                        {isPictured(order.current) && (
                            <OrderPicture
                                choice={order.current}
                                testId="shape-order-picture"
                            />
                        )}
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
                            <OrderRow
                                key={option.value}
                                option={option}
                                current={option.value === order.current}
                                onPick={() => pick(option.value)}
                                onClose={() => setOpen(false)}
                            />
                        ))}
                    </div>
                    {readout && (
                        <p
                            className="border-stroke text-text/60 mt-4 border-t px-4 pt-6"
                            data-testid="shape-order-readout"
                        >
                            {readout.biggest
                                ? tolgee.t(
                                      "shapes.edit.order.readout",
                                      "Biggest step {biggest} · {crossings, plural, =0 {no paths cross} one {# pair of paths crosses} other {# pairs of paths cross}}",
                                      {
                                          biggest: readout.biggest,
                                          crossings: readout.crossings,
                                      },
                                  )
                                : tolgee.t(
                                      "shapes.edit.order.readoutNoSteps",
                                      "{crossings, plural, =0 {No paths cross} one {# pair of paths crosses} other {# pairs of paths cross}}",
                                      { crossings: readout.crossings },
                                  )}
                        </p>
                    )}
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}
