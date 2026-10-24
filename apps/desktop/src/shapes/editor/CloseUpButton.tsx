import clsx from "clsx";
import tolgee from "@/global/singletons/Tolgee";
import { ArrowsInIcon } from "@phosphor-icons/react";
import type { ShapeEditTarget } from "./editTargets";
import { keepFocus } from "./keepFocus";

/**
 * Close up (#392, spec #385): a placed shape with holes laid out again for the members it has
 * left, in its mode and settings, by least travel. In the floating editor's ⋯ row and the
 * inspector; shown only while the shape has holes. One change (one undo step).
 */
export function CloseUpButton({
    target,
    className,
    testId,
}: {
    target: Pick<ShapeEditTarget, "closeUp" | "empty">;
    className?: string;
    testId: string;
}) {
    const { closeUp } = target;
    if (!closeUp) return null;
    return (
        <button
            type="button"
            title={tolgee.t(
                "shapes.edit.closeUp.title",
                "Close up: fill the {count, plural, one {# empty spot} other {# empty spots}} with the marchers left",
                { count: target.empty },
            )}
            onPointerDown={keepFocus}
            onClick={closeUp}
            data-testid={testId}
            className={clsx("flex items-center gap-4", className)}
        >
            <ArrowsInIcon size={14} />
            {tolgee.t("shapes.edit.closeUp.label", "Close up")}
        </button>
    );
}
