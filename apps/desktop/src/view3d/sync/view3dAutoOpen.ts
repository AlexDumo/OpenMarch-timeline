import { toast } from "sonner";
import tolgee from "@/global/singletons/Tolgee";

/**
 * What the editor does about the 3D View when a show opens, from the "Open the 3D View with the
 * show" setting: open it when on, nothing when off, and ask once while it was never set. A browser
 * blocks a window opened without a click, so the web editor never asks, and neither does a
 * Playwright session, where the question would sit over every test.
 */
export function view3dAutoOpenOnShow(
    setting: unknown,
    { canAsk }: { canAsk: boolean },
): "open" | "ask" | "none" {
    if (setting === true) return "open";
    if (setting === undefined && canAsk) return "ask";
    return "none";
}

/**
 * Asks whether the 3D View should open with every show. Either answer saves the setting (Settings
 * › General changes it later), and yes opens it now. Closing the toast without answering leaves
 * the setting unset, so the next show asks again.
 */
export function askToAutoOpenView3d({
    save,
    open,
}: {
    save: (autoOpen: boolean) => void;
    open: () => void;
}) {
    const t = (key: string) => tolgee.t(key);
    toast.info(t("view3d.autoOpenPrompt.title"), {
        id: "view3d-auto-open-prompt",
        description: t("view3d.autoOpenPrompt.description"),
        duration: Infinity,
        action: {
            label: t("view3d.autoOpenPrompt.yes"),
            onClick: () => {
                save(true);
                open();
            },
        },
        cancel: {
            label: t("view3d.autoOpenPrompt.no"),
            onClick: () => save(false),
        },
    });
}
