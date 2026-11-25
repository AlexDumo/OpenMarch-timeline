import { useQueryClient } from "@tanstack/react-query";
import tolgee from "@/global/singletons/Tolgee";
import { activeFieldEditor } from "@/field/editor/activeFieldEditor";
import { queueHistoryStep } from "@/shortcuts/handlers/historyQueue";
import { useActionHandler } from "@/shortcuts/useActionHandler";
import {
    displayedBeat,
    useTimelineSelectionStore,
} from "@/stores/TimelineSelectionStore";
import {
    planCanvasEdit,
    timelinePositionsSettled,
} from "@/timeline/timelineCoordinateWrites";
import { currentShapeField, shapeContextFor } from "../field/shapeFieldContext";
import { toolEnvFor } from "../tool/toolEnv";
import { useShapeToolStore } from "../tool/shapeToolStore";
import { useBoxSelectionStore } from "./boxSelectionStore";
import type { PlacedBox } from "./placedBox";
import { placedBoxesAt, placedBoxesRead } from "./placedBoxStore";
import { writeRemoveFromShape } from "./removeFromShape";

/** The shapes drawn now whose open spots hold any of `ids`, each with those marchers */
export function openSpotsOf(
    ids: readonly number[],
    boxes: readonly PlacedBox[] = placedBoxesAt(
        displayedBeat(useTimelineSelectionStore.getState()),
    ),
): { box: PlacedBox; marcherIds: number[] }[] {
    if (ids.length === 0) return [];
    const wanted = new Set(ids);
    return boxes.flatMap((box) => {
        const marcherIds = box.open
            .map((o) => o.marcherId)
            .filter((id) => wanted.has(id));
        return marcherIds.length > 0 ? [{ box, marcherIds }] : [];
    });
}

const selectedNow = (): readonly number[] =>
    activeFieldEditor()?.selected() ?? [];

/**
 * **Remove from shape** (`shapeRemoveFromShape`, ADR 0006 §9.1): the selected marchers whose spots
 * in one shape drawn at the playhead are open, taken out of it (`writeRemoveFromShape`), as one
 * undo step. The field's menu offers it on an open spot's ring and on such a marcher; the palette
 * has it too. Greyed out, with the reason, while no selected marcher has an open spot, or they are
 * in two shapes. Off while the Shape tool is open.
 */
export function useRemoveFromShapeAction(): void {
    const queryClient = useQueryClient();
    const toolOpen = useShapeToolStore((s) => s.tool !== null);
    const enabled = useBoxSelectionStore((s) => s.enabled);
    const ready = enabled && !toolOpen;
    useActionHandler(
        "shapeRemoveFromShape",
        () => {
            const found = openSpotsOf(selectedNow());
            if (found.length !== 1) return;
            const { box, marcherIds } = found[0]!;
            const field = currentShapeField();
            if (!field) return;
            const plan = planCanvasEdit();
            void queueHistoryStep(async () => {
                await timelinePositionsSettled();
                await placedBoxesRead();
                await writeRemoveFromShape({
                    box,
                    marcherIds,
                    env: toolEnvFor(field),
                    ctx: shapeContextFor(field),
                    queryClient,
                    plan,
                });
            }, undefined);
        },
        {
            enabled: () => ready && openSpotsOf(selectedNow()).length === 1,
            ignoreRepeat: true,
            disabledReason: () => {
                if (!ready) return undefined;
                const found = openSpotsOf(selectedNow());
                return found.length > 1
                    ? tolgee.t(
                          "shapes.placed.removeFromShape.oneShape",
                          "Select open spots in one shape at a time",
                      )
                    : tolgee.t(
                          "shapes.placed.removeFromShape.needsOpenSpot",
                          "Select a marcher whose spot in a shape is open",
                      );
            },
        },
    );
}
