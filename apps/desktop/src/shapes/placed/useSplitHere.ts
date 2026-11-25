import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useFieldMenuPointStore } from "@/field/three/fieldMenuPoint";
import { useActionHandler } from "@/shortcuts/useActionHandler";
import { currentShapeField } from "../field/shapeFieldContext";
import { onLine } from "../line/lineGeometry";
import { toolEnvFor } from "../tool/toolEnv";
import { useBoxSelectionStore } from "./boxSelectionStore";
import { isLineKind, splitCheck, splitShape } from "./splitShape";

/**
 * The field menu's **Split here** (`shapeSplitHere`, #1336): offered when the menu is opened on
 * the placed Line, Curve or Arc selected whole, on its line; it splits it there (`splitShape`), or
 * is greyed with why it can't (a closed line, rows, past its last marcher). Not offered anywhere
 * else, nor from the keyboard, which opens the menu at no place.
 */
export function useSplitHere(): void {
    const queryClient = useQueryClient();
    const enabled = useBoxSelectionStore((s) => s.enabled);
    const box = useBoxSelectionStore((s) => s.selected);
    const at = useFieldMenuPointStore((s) => s.at);
    const check = useMemo(() => {
        if (!enabled || !box || !at || !isLineKind(box)) return null;
        const field = currentShapeField();
        if (!field) return null;
        if (!onLine(box.params, box.spots, at, toolEnvFor(field))) return null;
        return splitCheck(box, at);
    }, [enabled, box, at]);
    useActionHandler(
        "shapeSplitHere",
        () => {
            if (check?.ok) void splitShape(check.box, check.k, queryClient);
        },
        {
            enabled: check?.ok === true,
            ignoreRepeat: true,
            disabledReason: check && !check.ok ? check.reason : undefined,
        },
    );
}
