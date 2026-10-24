import { create } from "zustand";
import { useEditorModeStore } from "./EditorModeStore";
import { usePreviewModeStore } from "./PreviewModeStore";

/**
 * Which workspace the editor shows (performer-behavior.md section 7.1):
 * the drill Editor, or Visuals mode, where cues are authored. Switching
 * swaps the toolbar, timeline and inspector together. Not saved: every
 * session opens in the Editor.
 */
export type WorkspaceView = "editor" | "visuals";

interface WorkspaceViewState {
    view: WorkspaceView;
    setView(view: WorkspaceView): void;
}

export const useWorkspaceViewStore = create<WorkspaceViewState>((set) => ({
    view: "editor",
    setView: (view) => set({ view }),
}));

/**
 * True while Visuals mode is showing. Basic has no Visuals mode (UI-19), so
 * switching to Basic shows the Editor. Preview, the switch's third mode,
 * shows over either and keeps the one to go back to.
 */
export function useIsVisualsView(): boolean {
    const visuals = useWorkspaceViewStore((state) => state.view === "visuals");
    const basic = useEditorModeStore((state) => state.mode === "basic");
    const preview = usePreviewModeStore((state) => state.isPreview);
    return visuals && !basic && !preview;
}

/** Non-hook read of `useIsVisualsView`, for subscriptions outside React. */
export function isVisualsView(): boolean {
    return (
        useWorkspaceViewStore.getState().view === "visuals" &&
        useEditorModeStore.getState().mode !== "basic" &&
        !usePreviewModeStore.getState().isPreview
    );
}
