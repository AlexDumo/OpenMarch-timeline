import { useUiSettingsStore } from "@/stores/UiSettingsStore";
import { useShortcutsDialogStore } from "@/stores/ShortcutsDialogStore";
import { useIsBasicMode } from "@/stores/EditorModeStore";
import { useWorkspaceViewStore } from "@/stores/WorkspaceViewStore";
import { useActionHandler } from "../useActionHandler";

export function useUiActionHandlers() {
    // Read when an action runs, so a settings change (such as a timeline zoom save) doesn't
    // re-render the handlers
    const setUiSettings = useUiSettingsStore((s) => s.setUiSettings);
    const settings = () => useUiSettingsStore.getState().uiSettings;
    const focus = (focussedComponent: "canvas" | "timeline") =>
        setUiSettings({ ...settings(), focussedComponent });

    useActionHandler("toggleNextPagePaths", () =>
        setUiSettings({ ...settings(), nextPaths: !settings().nextPaths }),
    );
    useActionHandler("togglePreviousPagePaths", () =>
        setUiSettings({
            ...settings(),
            previousPaths: !settings().previousPaths,
        }),
    );
    useActionHandler("focusCanvas", () => focus("canvas"));
    useActionHandler("exitTimelineFocus", () => focus("canvas"));
    useActionHandler("focusTimeline", () => focus("timeline"));
    useActionHandler("openView3d", () => {
        void window.electron.openView3d();
    });
    // The Editor or Visuals mode (performer-behavior.md section 7.1); Basic has no Visuals mode
    const basic = useIsBasicMode();
    useActionHandler(
        "toggleWorkspace",
        () => {
            const { view, setView } = useWorkspaceViewStore.getState();
            setView(view === "visuals" ? "editor" : "visuals");
        },
        { enabled: !basic },
    );
    // UI-17 follow-up: ? lists every shortcut
    useActionHandler("showShortcuts", () =>
        useShortcutsDialogStore.getState().setOpen(true),
    );
}
