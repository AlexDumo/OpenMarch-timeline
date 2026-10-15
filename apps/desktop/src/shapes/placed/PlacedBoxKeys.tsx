import { useQueryClient } from "@tanstack/react-query";
import { NUDGE_ACTION_IDS, type NudgeArgs } from "@/shortcuts/definitions";
import { resolveNudgeDistance } from "@/shortcuts/nudge";
import {
    useActionHandler,
    useActionHandlerGroup,
} from "@/shortcuts/useActionHandler";
import { useUiSettingsStore } from "@/stores/UiSettingsStore";
import { filesOf, moveBox } from "../box/boxGeometry";
import { currentShapeField } from "../field/shapeFieldContext";
import { toolEnvFor } from "../tool/toolEnv";
import { useBoxSelectionStore } from "./boxSelectionStore";
import { commitBox } from "./commitBox";
import { liveFiles } from "./liveBox";
import { leaveBox, selectOnField } from "./boxSelection";

const DIRECTIONS = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
} as const;

/** One fewer or more across in the selected placed box, saved at once */
export function stepPlacedBoxFiles(
    delta: number,
    queryClient: ReturnType<typeof useQueryClient>,
): void {
    const field = currentShapeField();
    const box = useBoxSelectionStore.getState().selected;
    if (!field || !box) return;
    const params = liveFiles(
        box,
        delta,
        toolEnvFor(field, { shift: false, alt: false }),
    );
    if (filesOf(params) !== filesOf(box.params))
        void commitBox(box, params, queryClient);
}

/**
 * The keys a selected placed box takes over (07-placed-boxes.md). Mounted only while a box is
 * selected or you're inside one, on top of the editor's handlers.
 *
 * - The nudge keys move the whole box, every member the same distance, so it stays a box (the
 *   plain nudge rounds each marcher on its own, which bends a box on half steps).
 * - `[` and `]`: one fewer or more across.
 * - Escape inside a box selects the whole box again, and on a box selected whole deselects it.
 */
export function PlacedBoxKeys(): null {
    const queryClient = useQueryClient();
    const selected = useBoxSelectionStore((s) => s.selected !== null);
    const inside = useBoxSelectionStore((s) => s.inside !== null);
    const rounding = useUiSettingsStore((s) => s.uiSettings.coordinateRounding);

    useActionHandlerGroup(
        NUDGE_ACTION_IDS,
        (_id, args) => {
            const field = currentShapeField();
            const box = useBoxSelectionStore.getState().selected;
            if (!field || !box) return;
            const nudge = args as unknown as NudgeArgs;
            const steps = resolveNudgeDistance(nudge, rounding);
            const d = DIRECTIONS[nudge.direction];
            const px = steps * field.fieldProperties.pixelsPerStep;
            const params = moveBox(
                box.params,
                box.spots,
                { x: d.x * px, y: d.y * px },
                toolEnvFor(field, { shift: false, alt: !nudge.snap }),
            );
            void commitBox(box, params, queryClient);
        },
        { enabled: selected },
    );
    useActionHandler(
        "shapeFewerFiles",
        () => stepPlacedBoxFiles(-1, queryClient),
        {
            enabled: selected,
        },
    );
    useActionHandler(
        "shapeMoreFiles",
        () => stepPlacedBoxFiles(1, queryClient),
        {
            enabled: selected,
        },
    );
    // On top of the app's Escape, so it must handle a box selected whole too: it deselects
    useActionHandler(
        "cancelAlignmentUpdates",
        () => (inside ? leaveBox() : selectOnField([])),
        { enabled: inside || selected },
    );
    return null;
}
