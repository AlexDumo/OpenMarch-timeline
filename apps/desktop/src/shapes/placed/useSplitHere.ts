import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { PointerKind } from "@/field/editor/pointerThresholds";
import { useFieldMenuPointStore } from "@/field/three/fieldMenuPoint";
import { notifyActionHandlersChanged } from "@/shortcuts/registry";
import { useActionHandler } from "@/shortcuts/useActionHandler";
import { currentShapeField } from "../field/shapeFieldContext";
import { fieldToFrame } from "../frame/frame";
import { onLine } from "../line/lineGeometry";
import type { XY } from "../types";
import { toolEnvFor } from "../tool/toolEnv";
import { useBoxSelectionStore } from "./boxSelectionStore";
import {
    isBoxKind,
    isLineKind,
    notALineReason,
    splitCheck,
    splitShape,
    type SplitCheck,
} from "./splitShape";
import type { PlacedBox } from "./placedBox";
import { scissorsSplit } from "./splitAction";
import { showSplit } from "./splitPreview";

/** Whether field point `at` is on placed shape `box`: inside its frame, a step round it */
function onShape(box: PlacedBox, at: XY, step: number): boolean {
    const frame = box.kind.frameOf(box.params, box.spots);
    const p = fieldToFrame(frame, at);
    return (
        Math.abs(p.x) <= frame.halfWidth + step &&
        Math.abs(p.y) <= frame.halfDepth + step
    );
}

/**
 * What Split here says where the menu was opened on `box` by a press of `kind`, or null where it
 * doesn't apply. A finger's long press reaches a marcher from further than a mouse (tablet parity)
 */
export function splitCheckAt(
    box: PlacedBox,
    at: XY,
    kind: PointerKind,
): SplitCheck | null {
    const field = currentShapeField();
    if (!field) return null;
    const env = toolEnvFor(field, undefined, { kind });
    // A box splits between two files or ranks where the menu was opened on it (#1337)
    if (isBoxKind(box))
        return onShape(box, at, env.stepPx)
            ? splitCheck(box, at, env.hitRadius)
            : null;
    // A circle is offered it greyed, with why, so it's found and understood (sims, #1336)
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
 * the placed Line, Curve or Arc selected whole, on its line, or on the Box (#1337); it splits it
 * there (`splitShape`), or is greyed with why it can't (a closed line, rows, past its last
 * marcher, a box in Outline or Spread, a circle).
 * Pointed at, it marks where it would cut. Not offered off the shape, nor from the keyboard, which
 * opens the menu at no place.
 */
export function useSplitHere(): void {
    const queryClient = useQueryClient();
    const enabled = useBoxSelectionStore((s) => s.enabled);
    const box = useBoxSelectionStore((s) => s.selected);
    const at = useFieldMenuPointStore((s) => s.at);
    const kind = useFieldMenuPointStore((s) => s.kind);
    const check = useMemo(
        () => (enabled && box && at ? splitCheckAt(box, at, kind) : null),
        [enabled, box, at, kind],
    );
    // On where the menu was opened, or while the scissors or a line's own menu run it
    // (`splitThroughAction`), which say where themselves
    const ok = check?.ok === true;
    const okRef = useRef(ok);
    useLayoutEffect(() => {
        if (okRef.current === ok) return;
        okRef.current = ok;
        notifyActionHandlersChanged();
    }, [ok]);
    const isEnabled = useCallback(
        () => scissorsSplit() !== null || okRef.current,
        [],
    );
    useActionHandler(
        "shapeSplitHere",
        () => {
            const asked = scissorsSplit();
            if (asked) void splitShape(asked.box, asked.cut, queryClient);
            else if (check?.ok)
                void splitShape(check.box, check.cut, queryClient);
        },
        {
            enabled: isEnabled,
            ignoreRepeat: true,
            disabledReason: check && !check.ok ? check.reason : undefined,
            // Pointed at in the menu, the cut is marked where it falls
            preview: (on) =>
                on && check?.ok
                    ? showSplit(check.gap, null, check.mark ?? null)
                    : showSplit(null),
        },
    );
}
