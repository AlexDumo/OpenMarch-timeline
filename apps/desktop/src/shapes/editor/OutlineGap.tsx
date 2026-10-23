import { SegmentedTextSwitch } from "@openmarch/ui";
import {
    GAP_SIDES,
    type GapSide,
    type OddGap,
} from "../distribute/distribution";
import { gapAsSeen } from "../distribute/outline";
import { outlineGapOf, withOddGap } from "../distribute/outlineGap";
import type { ToolEnv } from "../tool/toolKind";
import type { ShapeEditTarget } from "./editTargets";

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

/**
 * Where an odd-count outline leaves its spot out (#390), under the mode switch: the side, as the
 * field shows it however the shape is flipped, and whether that side leaves a gap or spreads its
 * marchers evenly. A side starts at its middle; a click on the field picks any spot between
 * corners. Hidden when the shape has no gap (Files, an even count, fewer than 4).
 */
export function OutlineGap({
    target,
    envFor,
}: {
    target: Pick<ShapeEditTarget, "kind" | "params" | "spots" | "apply">;
    envFor: () => ToolEnv | null;
}) {
    const { kind, params, spots } = target;
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
    return (
        <div className="flex flex-col gap-6" data-testid="outline-gap">
            <div className="flex items-center gap-8">
                <span className="text-sub text-text/80 w-64">Gap</span>
                <SegmentedTextSwitch
                    ariaLabel="Gap side"
                    testId="outline-gap-side"
                    options={GAP_SIDES.map((side) => ({
                        value: side,
                        label: SIDE_LABELS[side],
                        testId: `outline-gap-${side}`,
                    }))}
                    selected={seen.side}
                    setSelected={(value) => {
                        if (value === seen.side) return;
                        // The side picked as seen, back in the shape's own terms, at its middle
                        const own = gapAsSeen(
                            { ...stored, side: value as GapSide, at: null },
                            sides,
                            flipX,
                            flipY,
                        );
                        set({ ...own, at: null });
                    }}
                />
            </div>
            <div className="flex items-center gap-8">
                <span className="text-sub text-text/80 w-64">That side</span>
                <SegmentedTextSwitch
                    ariaLabel="That side"
                    testId="outline-gap-style"
                    options={(["gap", "spread"] as const).map((style) => ({
                        value: style,
                        label: STYLE_LABELS[style],
                        testId: `outline-gap-${style}`,
                    }))}
                    selected={gap.style}
                    setSelected={(value) =>
                        set({ ...stored, style: value as OddGap["style"] })
                    }
                />
            </div>
        </div>
    );
}
