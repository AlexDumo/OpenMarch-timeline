import { useAlignmentActionHandlers } from "./handlers/useAlignmentActionHandlers";
import { useAppActionHandlers } from "./handlers/useAppActionHandlers";
import { useBatchEditActionHandlers } from "./handlers/useBatchEditActionHandlers";
import { useCursorActionHandlers } from "./handlers/useCursorActionHandlers";
import { useFileActionHandlers } from "./handlers/useFileActionHandlers";
import { useHistoryActionHandlers } from "./handlers/useHistoryActionHandlers";
import { useKeepActionHandlers } from "./handlers/useKeepActionHandlers";
import { useNavigationActionHandlers } from "./handlers/useNavigationActionHandlers";
import { useNudgeActionHandlers } from "./handlers/useNudgeActionHandlers";
import { useTimelineActionEffects } from "./handlers/useTimelineActionEffects";
import { useUiActionHandlers } from "./handlers/useUiActionHandlers";
import { useShapeToolActions } from "@/shapes/tool/useShapeToolActions";
import { ShapeToolKeys } from "@/shapes/tool/ShapeToolKeys";
import { useShapeToolStore } from "@/shapes/tool/shapeToolStore";
import { PlacedBoxKeys } from "@/shapes/placed/PlacedBoxKeys";
import { useBoxSelectionStore } from "@/shapes/placed/boxSelectionStore";

/** Handlers available before a show is open (launch page). */
export function FileActionHandlers() {
    useFileActionHandlers();
    return null;
}

/** Handlers that need an open show and editor contexts. */
export function EditorActionHandlers() {
    useAppActionHandlers();
    useHistoryActionHandlers();
    useNavigationActionHandlers();
    useBatchEditActionHandlers();
    useNudgeActionHandlers();
    useAlignmentActionHandlers();
    useUiActionHandlers();
    useCursorActionHandlers();
    useShapeToolActions();
    useKeepActionHandlers();
    useTimelineActionEffects();
    // Mounted after the handlers above, so the open shape tool's keys are on top, and a selected
    // placed box's below them
    const shapeToolOpen = useShapeToolStore((s) => s.tool !== null);
    const boxSelected = useBoxSelectionStore(
        (s) => s.selected !== null || s.inside !== null,
    );
    if (shapeToolOpen) return <ShapeToolKeys />;
    return boxSelected ? <PlacedBoxKeys /> : null;
}
