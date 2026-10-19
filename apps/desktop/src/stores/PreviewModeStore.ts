import { create } from "zustand";

/**
 * Preview: watch the show without editing it. The toolbar, sidebar and inspector go away, the
 * timeline shows only the music, the pages and the playhead, nothing on the field or the timeline
 * edits, and Play always plays on (`timelineTransport`). Not saved: every session opens editing.
 */
interface PreviewModeState {
    readonly isPreview: boolean;
    readonly setPreview: (preview: boolean) => void;
    readonly togglePreview: () => void;
}

export const usePreviewModeStore = create<PreviewModeState>((set) => ({
    isPreview: false,
    setPreview: (isPreview) => set({ isPreview }),
    togglePreview: () => set((state) => ({ isPreview: !state.isPreview })),
}));

/** Whether Preview is on: a hook */
export const useIsPreviewMode = (): boolean =>
    usePreviewModeStore((state) => state.isPreview);

/** Whether Preview is on, for code outside React */
export const isPreviewMode = (): boolean =>
    usePreviewModeStore.getState().isPreview;
