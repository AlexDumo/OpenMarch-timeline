import * as Popover from "@radix-ui/react-popover";
import { CaretDownIcon } from "@phosphor-icons/react";
import { SegmentedTextSwitch } from "@openmarch/ui";
import tolgee from "@/global/singletons/Tolgee";
import {
    GAP_SIDES,
    type GapSide,
    type OddGap,
} from "../distribute/distribution";
import { gapAsSeen } from "../distribute/outline";
import {
    leftoverSpacing,
    outlineGapOf,
    withOddGap,
} from "../distribute/outlineGap";
import { formatSteps } from "./format";
import type { ToolEnv } from "../tool/toolKind";
import type { ShapeEditTarget } from "./editTargets";
import { useEditorMenu, useMenuFocus } from "./menuFocus";
import { Tip } from "./Tip";

const SIDE_LABELS: Readonly<Record<GapSide, string>> = {
    back: "Back",
    front: "Front",
    left: "Left",
    right: "Right",
};

const STYLE_LABELS: Readonly<Record<OddGap["style"], string>> = {
    gap: "Leaves a gap",
    spread: "Spreads evenly",
};

const sideLabel = (side: GapSide) =>
    tolgee.t(`shapes.edit.gap.side.${side}`, SIDE_LABELS[side]);

const styleLabel = (style: OddGap["style"]) =>
    tolgee.t(`shapes.edit.gap.style.${style}`, STYLE_LABELS[style]);

/**
 * Where an odd-count outline leaves its spot out (#390), beside the mode switch on the floating
 * editor's second row (#435): a small menu, "Leftover: Back", opening the side, as the field shows
 * it however the shape is flipped, and whether that side leaves a gap or spreads its marchers
 * evenly. A side starts at its middle; on an open shape a click on the field picks any spot
 * between corners (`gapPickAt`), which a tip at the bottom says. Hidden when the shape has no gap
 * (Grid, an even count, fewer than 4).
 */
export function OutlineGap({
    target,
    envFor,
    clickToMove = false,
}: {
    target: Pick<ShapeEditTarget, "kind" | "params" | "spots" | "apply">;
    envFor: () => ToolEnv | null;
    /** A click on the field moves the gap: an open shape, not a placed one (owner, #437) */
    clickToMove?: boolean;
}) {
    const { kind, params, spots } = target;
    const [open, setOpen] = useEditorMenu();
    // Opened by keyboard, focus goes to the side picked now; the arrows move along each switch
    // (Radix toggle groups) and Tab to the next (review)
    const focus = useMenuFocus((el) =>
        el.querySelector<HTMLElement>(
            '[data-testid="outline-gap-side"] [data-state="on"]',
        ),
    );
    const now = outlineGapOf(kind, params, spots);
    if (!now) return null;
    const { gap, stored, sides } = now;
    const { flipX, flipY } = kind.frameOf(params, spots);
    const seen = gapAsSeen(gap, sides, flipX, flipY);
    // The shape as it is at the pick: the floating editor doesn't redraw this for every edit
    // (#455), and the menu stays open over the bar
    const set = (next: OddGap) => {
        const env = envFor();
        if (!env) return;
        const now = target.params;
        const changed = withOddGap(target.kind, now, target.spots, next, env);
        if (changed !== now) target.apply(changed);
    };
    const side = `${tolgee.t("shapes.edit.gap.menu", "Leftover")}: ${sideLabel(seen.side)}`;
    // The leftover side's own spacing, when it spreads wider than the full sides' (owner on
    // #459): the chip shows the full sides', which can hide a clean 4 here
    const spread = leftoverSpacing(kind, params, spots);
    const stepPx = envFor()?.stepPx;
    const fullSpacing =
        gap.side === "back" || gap.side === "front"
            ? kind.closed?.intervals?.(params).across
            : kind.closed?.intervals?.(params).deep;
    const differs =
        spread !== null &&
        stepPx !== undefined &&
        fullSpacing !== undefined &&
        Math.abs(spread - fullSpacing) > 1e-9;
    const steps = differs ? spread / stepPx! : 0;
    const onHalves = Math.abs(steps * 2 - Math.round(steps * 2)) < 1e-6;
    const title = differs
        ? tolgee.t("shapes.edit.gap.withSpacing", "{side} · {spacing}", {
              side,
              spacing: `${onHalves ? "" : "≈"}${formatSteps(steps)}`,
          })
        : side;
    return (
        <Popover.Root open={open} onOpenChange={setOpen}>
            <Tip label={`${title}, ${styleLabel(gap.style).toLowerCase()}`}>
                <Popover.Trigger asChild>
                    <button
                        type="button"
                        {...focus.trigger}
                        data-testid="outline-gap-menu"
                        className="rounded-4 hover:bg-fg-2 flex min-h-24 items-center gap-4 px-4 py-2"
                    >
                        {title}
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
                    className="rounded-6 border-stroke bg-bg-1 bg-modal text-sub text-text shadow-modal z-50 border p-8"
                >
                    <div
                        className="flex flex-col gap-6"
                        data-testid="outline-gap"
                    >
                        <div className="flex items-center gap-8">
                            <span className="text-sub text-text/80 w-64">
                                {tolgee.t(
                                    "shapes.edit.gap.sideLabel",
                                    "Gap side",
                                )}
                            </span>
                            <SegmentedTextSwitch
                                ariaLabel={tolgee.t(
                                    "shapes.edit.gap.sideLabel",
                                    "Gap side",
                                )}
                                testId="outline-gap-side"
                                options={GAP_SIDES.map((side) => ({
                                    value: side,
                                    label: sideLabel(side),
                                    testId: `outline-gap-${side}`,
                                }))}
                                selected={seen.side}
                                setSelected={(value) => {
                                    if (value === seen.side) return;
                                    // The side picked as seen, back in the shape's own terms, at its middle
                                    const own = gapAsSeen(
                                        {
                                            ...stored,
                                            side: value as GapSide,
                                            at: null,
                                        },
                                        sides,
                                        flipX,
                                        flipY,
                                    );
                                    set({ ...own, at: null });
                                }}
                            />
                        </div>
                        <div className="flex items-center gap-8">
                            <span className="text-sub text-text/80 w-64">
                                {tolgee.t(
                                    "shapes.edit.gap.styleLabel",
                                    "That side",
                                )}
                            </span>
                            <SegmentedTextSwitch
                                ariaLabel={tolgee.t(
                                    "shapes.edit.gap.styleLabel",
                                    "That side",
                                )}
                                testId="outline-gap-style"
                                options={(["gap", "spread"] as const).map(
                                    (style) => ({
                                        value: style,
                                        label: styleLabel(style),
                                        testId: `outline-gap-${style}`,
                                    }),
                                )}
                                selected={gap.style}
                                setSelected={(value) =>
                                    set({
                                        ...stored,
                                        style: value as OddGap["style"],
                                    })
                                }
                            />
                        </div>
                        {clickToMove && (
                            <p
                                className="text-text/60 max-w-[18rem] text-xs"
                                data-testid="outline-gap-tip"
                            >
                                {gap.style === "gap"
                                    ? tolgee.t(
                                          "shapes.edit.gap.tipGap",
                                          "Click a marcher on the outline (not a corner) to move the gap there.",
                                      )
                                    : tolgee.t(
                                          "shapes.edit.gap.tipSpread",
                                          "Click a marcher on another side (not a corner) to spread that side instead.",
                                      )}
                            </p>
                        )}
                    </div>
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}
