import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useFieldMenuPointStore } from "@/field/three/fieldMenuPoint";
import { useActionHandler } from "@/shortcuts/useActionHandler";
import { currentShapeField } from "../field/shapeFieldContext";
import { fieldToFrame } from "../frame/frame";
import { onLine } from "../line/lineGeometry";
import type { XY } from "../types";
import { toolEnvFor } from "../tool/toolEnv";
import { useBoxSelectionStore } from "./boxSelectionStore";
import {
    isLineKind,
    notALineReason,
    splitCheck,
    splitShape,
    type SplitCheck,
} from "./splitShape";
import type { PlacedBox } from "./placedBox";
import { useSplitPreviewStore } from "./splitPreview";

/** Whether field point `at` is on placed shape `box`: inside its frame, a step round it */
function onShape(box: PlacedBox, at: XY, step: number): boolean {
    const frame = box.kind.frameOf(box.params, box.spots);
    const p = fieldToFrame(frame, at);
    return (
        Math.abs(p.x) <= frame.halfWidth + step &&
        Math.abs(p.y) <= frame.halfDepth + step
    );
}

/** What Split here says where the menu was opened on `box`, or null where it doesn't apply */
function checkAt(box: PlacedBox, at: XY): SplitCheck | null {
    const field = currentShapeField();
    if (!field) return null;
    const env = toolEnvFor(field);
    // A box or circle is offered it greyed, with why, so it's found and understood (sims, #1336)
    if (!isLineKind(box))
        return onShape(box, at, env.stepPx)
            ? { ok: false, reason: notALineReason() }
            : null;
    if (!onLine(box.params, box.spots, at, env)) return null;
    // A right-click on a marcher splits just after it (sims, #1336)
    return splitCheck(box, at, env.hitRadius);
}

/**
 * The field menu's **Split here** (`shapeSplitHere`, #1336): offered when the menu is opened on
 * the placed Line, Curve or Arc selected whole, on its line; it splits it there (`splitShape`), or
 * is greyed with why it can't (a closed line, rows, past its last marcher, a box or circle).
 * Pointed at, it marks where it would cut. Not offered off the shape, nor from the keyboard, which
 * opens the menu at no place.
 */
export function useSplitHere(): void {
    const queryClient = useQueryClient();
    const enabled = useBoxSelectionStore((s) => s.enabled);
    const box = useBoxSelectionStore((s) => s.selected);
    const at = useFieldMenuPointStore((s) => s.at);
    const check = useMemo(
        () => (enabled && box && at ? checkAt(box, at) : null),
        [enabled, box, at],
    );
    useActionHandler(
        "shapeSplitHere",
        () => {
            if (check?.ok) void splitShape(check.box, check.k, queryClient);
        },
        {
            enabled: check?.ok === true,
            ignoreRepeat: true,
            disabledReason: check && !check.ok ? check.reason : undefined,
            // Pointed at in the menu, the cut is marked where it falls
            preview: (on) =>
                useSplitPreviewStore.setState({
                    gap: on && check?.ok ? check.gap : null,
                }),
        },
    );
}
