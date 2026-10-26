import { useState } from "react";
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
import { outlineGapOf, withOddGap } from "../distribute/outlineGap";
import type { ToolEnv } from "../tool/toolKind";
import type { ShapeEditTarget } from "./editTargets";
import { useMenuFocus } from "./menuFocus";
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
 * evenly. A side starts at its middle; a click on the field picks any spot between corners.
 * Hidden when the shape has no gap (Grid, an even count, fewer than 4).
 */
export function OutlineGap({
    target,
    envFor,
}: {
    target: Pick<ShapeEditTarget, "kind" | "params" | "spots" | "apply">;
    envFor: () => ToolEnv | null;
}) {
    const { kind, params, spots } = target;
    const [open, setOpen] = useState(false);
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
    const set = (next: OddGap) => {
        const env = envFor();
        if (!env) return;
        const changed = withOddGap(kind, params, spots, next, env);
        if (changed !== params) target.apply(changed);
    };
    const title = `${tolgee.t("shapes.edit.gap.menu", "Leftover")}: ${sideLabel(seen.side)}`;
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
                    </div>
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}
