import clsx from "clsx";
import { Tip } from "./Tip";
import tolgee from "@/global/singletons/Tolgee";
import { ShuffleIcon } from "@phosphor-icons/react";
import { distributionOf, reshuffle } from "../distribute/modes";
import type { ToolEnv } from "../tool/toolKind";
import type { ShapeEditTarget } from "./editTargets";
import { keepFocus } from "./keepFocus";

/**
 * Reshuffle (spec #385): a spread's next layout, in the floating editor and the inspector. Shown
 * only while the shape is an even spread. One change of the shape (one undo step, or one save for
 * a placed shape).
 */
export function ReshuffleButton({
    target,
    envFor,
    className,
    testId,
}: {
    target: Pick<ShapeEditTarget, "kind" | "params" | "spots" | "apply">;
    /** The field's tool environment when it's pressed; null with no field */
    envFor: () => ToolEnv | null;
    className?: string;
    testId: string;
}) {
    const d = distributionOf(target.kind, target.params, target.spots);
    if (d?.mode !== "spread") return null;
    return (
        <Tip
            label={tolgee.t(
                "shapes.edit.reshuffle.title",
                "Reshuffle: a new layout",
            )}
        >
            <button
                type="button"
                onPointerDown={keepFocus}
                onClick={() => {
                    const env = envFor();
                    if (!env) return;
                    const next = reshuffle(
                        target.kind,
                        target.params,
                        target.spots,
                        env,
                    );
                    if (next !== null) target.apply(next);
                }}
                data-testid={testId}
                data-seed={d.seed}
                className={clsx("flex items-center gap-4", className)}
            >
                <ShuffleIcon size={14} />
                {tolgee.t("shapes.edit.reshuffle.label", "Reshuffle")}
            </button>
        </Tip>
    );
}
