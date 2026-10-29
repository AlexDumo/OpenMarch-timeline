import { useAlignmentActionHandlers } from "./handlers/useAlignmentActionHandlers";
import { useAppActionHandlers } from "./handlers/useAppActionHandlers";
import { useEditorReadiness } from "./handlers/useEditorReadiness";
import { useBatchEditActionHandlers } from "./handlers/useBatchEditActionHandlers";
import { useCursorActionHandlers } from "./handlers/useCursorActionHandlers";
import { useFileActionHandlers } from "./handlers/useFileActionHandlers";
import { useHistoryActionHandlers } from "./handlers/useHistoryActionHandlers";
import { useKeepActionHandlers } from "./handlers/useKeepActionHandlers";
import { useNavigationActionHandlers } from "./handlers/useNavigationActionHandlers";
import { useNudgeActionHandlers } from "./handlers/useNudgeActionHandlers";
import { useTimelineActionEffects } from "./handlers/useTimelineActionEffects";
import { useUiActionHandlers } from "./handlers/useUiActionHandlers";
import { useUnsetActionHandlers } from "./handlers/useUnsetActionHandlers";
import { useUpdateCoordinates } from "./handlers/useUpdateCoordinates";

/** Handlers available before a show is open (launch page). */
export function FileActionHandlers() {
    useFileActionHandlers();
    return null;
}

/**
 * Handlers that need an open show and editor contexts. The editor's readiness and the coordinate
 * write are read once here and passed down, not set up again in each handler hook.
 */
export function EditorActionHandlers() {
    const editor = useEditorReadiness();
    const updateCoordinates = useUpdateCoordinates();
    useAppActionHandlers();
    useHistoryActionHandlers();
    useNavigationActionHandlers(editor);
    useBatchEditActionHandlers(editor);
    useNudgeActionHandlers(editor);
    useAlignmentActionHandlers(editor, updateCoordinates);
    useUiActionHandlers();
    useCursorActionHandlers(editor, updateCoordinates);
    useKeepActionHandlers(editor);
    useUnsetActionHandlers();
    useTimelineActionEffects();
    return null;
}
