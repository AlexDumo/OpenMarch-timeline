import { SegmentedTextSwitch } from "@openmarch/ui";
import { MODE_LABELS, type DistributionMode } from "../distribute/distribution";
import { distributionOf, switchModes, withMode } from "../distribute/modes";
import type { ToolEnv } from "../tool/toolKind";
import type { ShapeEditTarget } from "./editTargets";

/**
 * How the shape is filled (spec #385): Files, Outline or Spread, in the inspector's shape section.
 * Only the kind's own modes show, and nothing while it has one. Picking one is one change of the
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
            ariaLabel="Fill"
            testId="shape-mode-switch"
            className="self-start"
            options={modes.map((mode) => ({
                value: mode,
                label: MODE_LABELS[mode],
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
