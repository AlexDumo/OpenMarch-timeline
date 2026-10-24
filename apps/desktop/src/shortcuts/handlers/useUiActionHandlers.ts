import { type UiSettings, useUiSettingsStore } from "@/stores/UiSettingsStore";
import { useShapeToolStore } from "@/shapes/tool/shapeToolStore";
import { useShortcutsDialogStore } from "@/stores/ShortcutsDialogStore";
import { useIsBasicMode } from "@/stores/EditorModeStore";
import { useWorkspaceViewStore } from "@/stores/WorkspaceViewStore";
import { useActionHandler } from "../useActionHandler";

/**
 * The previous paths shortcut (N): while a shape is open it shows or hides the shape's walks and
 * start rings instead (#403), the pathways the open shape draws in their place
 */
export function togglePreviousPaths(
    settings: UiSettings,
    shapeOpen: boolean,
): UiSettings {
    return shapeOpen
        ? { ...settings, shapeWalks: !(settings.shapeWalks ?? true) }
        : { ...settings, previousPaths: !settings.previousPaths };
}

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
        setUiSettings(
            togglePreviousPaths(
                settings(),
                useShapeToolStore.getState().tool !== null,
            ),
        ),
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
