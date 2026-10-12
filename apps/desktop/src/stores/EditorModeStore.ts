// STUB: replaced by the B1 implementation (timeline/basic-mode-settings) on merge.
import { create } from "zustand";

export type EditorMode = "basic" | "expert";
export const EDITOR_MODE_SETTING = "editorMode";

interface EditorModeState {
    mode: EditorMode | null;
    loaded: boolean;
    setMode(mode: EditorMode): void;
}

export const useEditorModeStore = create<EditorModeState>((set) => ({
    mode: null,
    loaded: false,
    setMode: (mode) => set({ mode }),
}));

export const useEditorMode = () => useEditorModeStore((s) => s.mode);
export const useIsBasicMode = () =>
    useEditorModeStore((s) => s.mode === "basic");
export const isBasicMode = () => useEditorModeStore.getState().mode === "basic";
export function initEditorModeStore(): void {}
