import { useQueryClient } from "@tanstack/react-query";
import { NUDGE_ACTION_IDS, type NudgeArgs } from "@/shortcuts/definitions";
import { resolveNudgeDistance } from "@/shortcuts/nudge";
import {
    useActionHandler,
    useActionHandlerGroup,
} from "@/shortcuts/useActionHandler";
import { useUiSettingsStore } from "@/stores/UiSettingsStore";
import { moveBox } from "../box/boxGeometry";
import { currentCanvas } from "../canvas/shapeCanvasContext";
import { toolEnvFor } from "../tool/toolEnv";
import { useBoxSelectionStore } from "./boxSelectionStore";
import { commitBox } from "./commitBox";
import { liveFiles } from "./liveBox";
import { leaveBox } from "./useBoxSelection";

const DIRECTIONS = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
} as const;

/** One file fewer or more in the selected placed box, saved at once */
export function stepPlacedBoxFiles(
    delta: number,
    queryClient: ReturnType<typeof useQueryClient>,
): void {
    const canvas = currentCanvas();
    const box = useBoxSelectionStore.getState().selected;
    if (!canvas || !box) return;
    const params = liveFiles(
        box,
        delta,
        toolEnvFor(canvas, { shift: false, alt: false }),
    );
    if (params.files !== box.params.files)
        void commitBox(box, params, queryClient);
}

/**
 * The keys a selected placed box takes over (07-placed-boxes.md). Mounted only while a box is
 * selected or you're inside one, on top of the editor's handlers.
 *
 * - The nudge keys move the whole box, every member the same distance, so it stays a box (the
 *   plain nudge rounds each marcher on its own, which bends a box on half steps).
 * - `[` and `]`: one file fewer or more.
 * - Escape inside a box selects the whole box again.
 */
export function PlacedBoxKeys(): null {
    const queryClient = useQueryClient();
    const selected = useBoxSelectionStore((s) => s.selected !== null);
    const inside = useBoxSelectionStore((s) => s.inside !== null);
    const rounding = useUiSettingsStore((s) => s.uiSettings.coordinateRounding);

    useActionHandlerGroup(
        NUDGE_ACTION_IDS,
        (_id, args) => {
            const canvas = currentCanvas();
            const box = useBoxSelectionStore.getState().selected;
            if (!canvas || !box) return;
            const nudge = args as unknown as NudgeArgs;
            const steps = resolveNudgeDistance(nudge, rounding);
            const d = DIRECTIONS[nudge.direction];
            const px = steps * canvas.fieldProperties.pixelsPerStep;
            const params = moveBox(
                box.params,
                box.spots,
                { x: d.x * px, y: d.y * px },
                toolEnvFor(canvas, { shift: false, alt: !nudge.snap }),
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
    useActionHandler(
        "cancelAlignmentUpdates",
        () => {
            const canvas = currentCanvas();
            if (canvas) leaveBox(canvas);
        },
        { enabled: inside },
    );
    return null;
}
