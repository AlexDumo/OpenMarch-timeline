import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useTolgee } from "@tolgee/react";
import { usePerformHistoryAction } from "@/hooks/queries/useHistory";
import { useDatabaseReady } from "@/hooks/useDatabaseReady";
import { isVisualsView } from "@/stores/WorkspaceViewStore";
import { useActionHandler } from "../useActionHandler";
import { historyEditWorkspace } from "./historyWorkspace";
import {
    queueHistoryAction,
    setHistoryPerformer,
    type HistoryDirection,
} from "./historyQueue";

const NOTHING_TO_DO_KEYS = {
    undo: "actions.edit.noUndoAvailable",
    redo: "actions.edit.noRedoAvailable",
} as const;

/** Where an undone or redone edit was made, when that isn't the workspace on screen */
const OTHER_WORKSPACE_KEYS = {
    undo: {
        editor: "actions.edit.undidDrillEdit",
        visuals: "actions.edit.undidCueEdit",
    },
    redo: {
        editor: "actions.edit.redidDrillEdit",
        visuals: "actions.edit.redidCueEdit",
    },
} as const;

export function useHistoryActionHandlers() {
    const { t } = useTolgee();
    const databaseReady = useDatabaseReady();
    const { mutateAsync: performHistoryAction } = usePerformHistoryAction();

    // Whether there is anything to undo or redo is decided by the action itself, in its lock turn,
    // not by the canUndo/canRedo queries: those refetch only after a write commits, so a press
    // right after an edit or another undo would read them stale (#223).
    const run = async (direction: HistoryDirection): Promise<boolean> => {
        const response = await performHistoryAction(direction);
        if (response.nothingToDo) {
            toast.warning(t(NOTHING_TO_DO_KEYS[direction]), {
                duration: 1500,
            });
            return false;
        }
        // One stack for both workspaces: an edit made in the other one says so, as nothing on
        // screen shows it changing
        const workspace = historyEditWorkspace(response.tableNames ?? []);
        const shown = isVisualsView() ? "visuals" : "editor";
        if (workspace && workspace !== shown)
            toast.info(t(OTHER_WORKSPACE_KEYS[direction][workspace]));
        return true;
    };
    const runRef = useRef(run);
    useLayoutEffect(() => {
        runRef.current = run;
    });

    // Key presses, touch gestures and toast Undo buttons share one queue (historyQueue), so every
    // press runs, in order, on the stack the previous one left
    useEffect(
        () => setHistoryPerformer((direction) => runRef.current(direction)),
        [],
    );

    // A held key's repeats are skipped while a press is still running or waiting, so holding
    // Ctrl+Z undoes as fast as the app can, with nothing left to run after release.
    const [pending] = useState(() => ({ count: 0 }));
    const press = (direction: HistoryDirection) => {
        pending.count++;
        void queueHistoryAction(direction).finally(() => {
            pending.count--;
        });
    };
    const options = {
        enabled: databaseReady,
        ignoreRepeat: () => pending.count > 0,
    };
    useActionHandler("performUndo", () => press("undo"), options);
    useActionHandler("performRedo", () => press("redo"), options);
}
