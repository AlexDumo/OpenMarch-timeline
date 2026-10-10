import { useCallback } from "react";
import { useUpdateSelectedMarchersOnSelectedPage } from "@/hooks/queries";
import {
    useActionHandler,
    useActionHandlerGroup,
} from "@/shortcuts/useActionHandler";
import type { ActionId } from "@/shortcuts/definitions";
import { useEditorReadiness } from "@/shortcuts/handlers/useEditorReadiness";
import {
    currentCanvas,
    marchersOnCanvas,
    shapeContextFor,
} from "./canvas/shapeCanvasContext";
import { previewSession } from "./session";
import { useShapeToolStore } from "./shapeToolStore";

/** The action that opens the tool on each kind, in kind picker order. */
export const SHAPE_KIND_ACTIONS = {
    line: "shapeLine",
    arc: "shapeArc",
    circle: "shapeCircle",
    curve: "shapeCurve",
    block: "shapeBlock",
} as const satisfies Record<string, ActionId>;

const KIND_ACTION_IDS = Object.values(SHAPE_KIND_ACTIONS);

/**
 * Places the session's marchers on its shape as one edit, through the same path as a canvas drag
 * (timeline mode: they leave the start flag and arrive at the playhead), then closes the tool.
 */
export function useApplyShape(): () => Promise<void> {
    const { mutateAsync } = useUpdateSelectedMarchersOnSelectedPage();
    return useCallback(async () => {
        const canvas = currentCanvas();
        const { session, close, inputError } = useShapeToolStore.getState();
        if (!canvas || !session || inputError) return;
        const preview = previewSession(session, shapeContextFor(canvas));
        if (!preview.canApply) return;
        const targets = new Map(preview.targets.map((t) => [t.id, t.to]));
        await mutateAsync(({ currentCoordinates }) =>
            currentCoordinates.flatMap((c) => {
                const to = targets.get(c.marcher_id);
                return to
                    ? [{ marcher_id: c.marcher_id, x: to.x, y: to.y }]
                    : [];
            }),
        );
        close();
    }, [mutateAsync]);
}

/** Opens, applies and closes the shape tool from shortcuts, buttons and the command palette. */
export function useShapeToolActions(): void {
    const { ready, selectedMarchers } = useEditorReadiness();
    const open = useShapeToolStore((s) => s.session !== null);
    const dragging = useShapeToolStore((s) => s.dragging !== null);
    const inputError = useShapeToolStore((s) => s.inputError !== null);
    const apply = useApplyShape();

    useActionHandlerGroup(
        KIND_ACTION_IDS,
        (_id, args) => {
            const canvas = currentCanvas();
            const kind = args?.kind;
            if (!canvas || typeof kind !== "string") return;
            const ctx = shapeContextFor(canvas);
            const store = useShapeToolStore.getState();
            if (store.session) store.setKind(kind, ctx);
            else {
                const ids = selectedMarchers.map((m) => m.id);
                store.open(kind, marchersOnCanvas(canvas, ids), ctx);
            }
        },
        { enabled: ready && selectedMarchers.length > 0 },
    );

    useActionHandler(
        "applyShape",
        () => {
            void apply();
        },
        { enabled: open && !dragging && !inputError },
    );
}
