import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { db } from "@/global/database/db";
import { useUpdateSelectedMarchersOnSelectedPage } from "@/hooks/queries";
import { useTimelineMode } from "@/hooks/queries/useWorkspaceSettings";
import { saveShapeRecipeInTransaction } from "@/db-functions/shapeRecipes";
import { transformMarchersInSelection } from "@/timeline/timelineCoordinateWrites";
import { toastTimelineError } from "@/timeline/timelineErrorMessages";
import { shapeKind } from "./registry";
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
 *
 * In timeline mode the shape's recipe is saved in the same edit (ADR 0004), so it can be reopened
 * and one undo takes back both. A reopened shape replaces its recipe.
 */
export function useApplyShape(): () => Promise<void> {
    const { mutateAsync } = useUpdateSelectedMarchersOnSelectedPage();
    const timelineMode = useTimelineMode();
    const queryClient = useQueryClient();
    return useCallback(async () => {
        const canvas = currentCanvas();
        const { session, close, inputError } = useShapeToolStore.getState();
        if (!canvas || !session || inputError) return;
        const preview = previewSession(session, shapeContextFor(canvas));
        if (!preview.canApply) return;
        const targets = new Map(preview.targets.map((t) => [t.id, t.to]));
        const transform = (current: readonly { marcher_id: number }[]) =>
            current.flatMap((c) => {
                const to = targets.get(c.marcher_id);
                return to
                    ? [{ marcher_id: c.marcher_id, x: to.x, y: to.y }]
                    : [];
            });
        if (!timelineMode) {
            await mutateAsync(({ currentCoordinates }) =>
                transform(currentCoordinates),
            );
            close();
            return;
        }
        const kind = shapeKind(session.kindId)!;
        try {
            await transformMarchersInSelection({
                db,
                marcherIds: session.marchers.map((m) => m.id),
                transform,
                afterWrite: async (tx, timelineId) => {
                    await saveShapeRecipeInTransaction({
                        tx,
                        timelineId,
                        recipe: {
                            kind: kind.id,
                            kindVersion: kind.version,
                            params: session.params,
                            orderMode: session.order,
                            reverse: session.reverse,
                        },
                        members: preview.targets.map((t, i) => ({
                            marcherId: t.id,
                            slot: session.assignment[i]!,
                            x: t.slot.x,
                            y: t.slot.y,
                        })),
                        replaces: session.recipeId,
                    });
                },
            });
        } catch (e) {
            toastTimelineError(e, "Error placing the shape");
            return;
        }
        void queryClient.invalidateQueries({
            queryKey: ["timeline_shape_recipes"],
        });
        close();
    }, [mutateAsync, timelineMode, queryClient]);
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
