import { SegmentedTextSwitch } from "@openmarch/ui";
import tolgee from "@/global/singletons/Tolgee";
import { MODE_LABELS, type DistributionMode } from "../distribute/distribution";
import { distributionOf, switchModes, withMode } from "../distribute/modes";
import type { ToolEnv } from "../tool/toolKind";
import type { ShapeEditTarget } from "./editTargets";

/**
 * How the shape is filled (spec #385): Grid, Outline or Spread, first on the floating editor's
 * second row (#435). Only the kind's own modes show, and nothing while it has one. Picking one is one change of the
 * shape (one undo step, or one save for a placed shape).
 */
export function ModeSwitch({
    target,
    envFor,
}: {
    target: Pick<ShapeEditTarget, "kind" | "params" | "spots" | "apply">;
    /** The field's tool environment when the mode is picked; null with no field */
    envFor: () => ToolEnv | null;
}) {
    const modes = switchModes(target.kind);
    const current = distributionOf(target.kind, target.params, target.spots);
    if (modes.length === 0 || !current) return null;
    return (
        <SegmentedTextSwitch
            ariaLabel={tolgee.t("shapes.edit.mode.label", "Fill")}
            testId="shape-mode-switch"
            // Sized for the editor's row: no inset well, 24 px targets
            className="border-0 bg-transparent p-0 shadow-none"
            itemClassName="min-h-24"
            options={modes.map((mode) => ({
                value: mode,
                label: tolgee.t(`shapes.edit.mode.${mode}`, MODE_LABELS[mode]),
                testId: `shape-mode-${mode}`,
            }))}
            selected={current.mode}
            setSelected={(value) => {
                const env = envFor();
                if (!env) return;
                const next = withMode(
                    target.kind,
                    target.params,
                    target.spots,
                    value as DistributionMode,
                    env,
                );
                if (next !== target.params) target.apply(next);
            }}
        />
    );
}
