import { useEffect } from "react";
import { T, useTolgee } from "@tolgee/react";
import { FilmStripIcon, XIcon } from "@phosphor-icons/react";
import clsx from "clsx";
import ActionButton from "@/shortcuts/ActionButton";
import { readShortcutContext } from "@/shortcuts/context";
import { notifyActionHandlersChanged } from "@/shortcuts/registry";
import { useActionHandler } from "@/shortcuts/useActionHandler";
import {
    useIsPreviewMode,
    usePreviewModeStore,
} from "@/stores/PreviewModeStore";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { useUiSettingsStore } from "@/stores/UiSettingsStore";

/**
 * Runs Preview (`PreviewModeStore`): **Alt+P** turns it on and off and **Esc** leaves it. Going in
 * leaves anything mid-edit: an isolated move, a line drag, and the beat editor, which edits too.
 * Mount once, in the editor.
 */
export function PreviewModeHost() {
    const preview = useIsPreviewMode();
    useActionHandler("togglePreview", () =>
        usePreviewModeStore.getState().togglePreview(),
    );

    useEffect(() => {
        // Preview turns most actions off (`isActionOffInWorkspace`): buttons and the palette read again
        notifyActionHandlersChanged();
        if (!preview) return;
        const timeline = useTimelineSelectionStore.getState();
        if (timeline.lineDrag) timeline.cancelLineDrag();
        if (timeline.isolation) timeline.exitIsolation();
        const ui = useUiSettingsStore.getState();
        if (ui.uiSettings.focussedComponent === "timeline")
            ui.setUiSettings({
                ...ui.uiSettings,
                focussedComponent: "canvas",
            });

        // Esc leaves, unless a dialog or menu is open or a box is being typed in, which take it
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape" || event.defaultPrevented) return;
            const context = readShortcutContext("canvas");
            if (context.modalOpen || context.inTextInput) return;
            event.preventDefault();
            usePreviewModeStore.getState().setPreview(false);
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [preview]);

    return null;
}

/** **Preview** at the title bar's right end, or **Exit preview** while it's on */
export function PreviewButton() {
    const preview = useIsPreviewMode();
    const { t } = useTolgee();
    return (
        <ActionButton
            action="togglePreview"
            data-testid="preview-mode-toggle"
            aria-pressed={preview}
            tooltip={preview ? t("titlebar.preview.exitTooltip") : undefined}
            className={clsx(
                "text-sub flex items-center gap-6 rounded-full px-12 py-4 leading-none focus-visible:translate-y-0",
                preview
                    ? "bg-accent text-text-invert enabled:hover:text-text-invert enabled:hover:bg-accent/80"
                    : "border-stroke border",
            )}
        >
            {preview ? (
                <>
                    <XIcon size={14} />
                    <T keyName="titlebar.preview.exit" />
                </>
            ) : (
                <>
                    <FilmStripIcon size={14} />
                    <T keyName="titlebar.preview" />
                </>
            )}
        </ActionButton>
    );
}
