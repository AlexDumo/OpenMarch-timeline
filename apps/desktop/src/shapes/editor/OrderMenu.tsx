import clsx from "clsx";
import * as Popover from "@radix-ui/react-popover";
import { CaretDownIcon } from "@phosphor-icons/react";
import tolgee from "@/global/singletons/Tolgee";
import { ORDER_CHOICES, type OrderChoice } from "../assign";
import type { OrderWhy, ShapeEditTarget } from "./editTargets";
import { arrowFocus, useEditorMenu, useMenuFocus } from "./menuFocus";
import { OrderPicture } from "./OrderPicture";
import { isPictured, ORDER_PICTURE_SIZE } from "./orderPictures";
import { Tip } from "@/components/ui/Tip";

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

/**
 * What a choice without a picture does, in words (09-who-goes-where.md): four numbers can't show
 * these apart
 */
function orderDescription(choice: OrderChoice): string | null {
    switch (choice) {
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
        default:
            return null;
    }
}

/** Why a choice is greyed out, in words */
export function orderWhyText(why: OrderWhy): string {
    switch (why) {
        case "noOrder":
            return tolgee.t(
                "shapes.edit.order.why.noOrder",
                "These marchers have no order yet. Set order on them first, or pick by hand.",
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
    hint: string | null;
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

/**
 * Who goes where on a kind with an order along it (a Line, #528; 09-who-goes-where.md): Least
 * travel, Keep order, Reverse order, Inside out, Zipper or Within sections. A choice that doesn't
 * fit these marchers is greyed out and says why. Like the kind's own menus, its button names the
 * answer the shape has, and picking another lays the marchers out again as one change. The first
 * three answers' pictures read the new line as numbers (#559); the others say what they do. On an
 * open shape a line under the answers says what the current one gives: its biggest step and how
 * many walks cross. None for a kind without an order.
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
    const options = orderOptions(order.why);
    const currentLabel = orderLabel(order.current);
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
                            <button
                                key={option.value}
                                type="button"
                                role="menuitemradio"
                                aria-checked={option.value === order.current}
                                aria-disabled={
                                    option.refusal ? true : undefined
                                }
                                title={option.refusal ?? undefined}
                                onClick={() => pick(option.value)}
                                data-testid={`shape-order-${option.value}`}
                                className={clsx(
                                    "rounded-4 flex min-h-24 items-center gap-8 px-4 py-2 text-left",
                                    option.refusal
                                        ? "text-text/60 cursor-not-allowed"
                                        : option.value === order.current
                                          ? "bg-fg-2 text-accent"
                                          : "hover:text-accent",
                                )}
                            >
                                <ChoicePicture
                                    choice={option.value}
                                    testId={`shape-order-${option.value}-picture`}
                                />
                                <span className="flex max-w-[16rem] flex-col">
                                    <span data-label>{option.label}</span>
                                    {(option.refusal ?? option.hint) && (
                                        <span
                                            className={clsx(
                                                "text-text/60",
                                                option.refusal && "italic",
                                            )}
                                            data-testid={`shape-order-${option.value}-note`}
                                        >
                                            {option.refusal ?? option.hint}
                                        </span>
                                    )}
                                </span>
                            </button>
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
