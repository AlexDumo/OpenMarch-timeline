import { useSidebarModalStore } from "@/stores/SidebarModalStore";
import { AssetsContents } from "./AssetsView";

/** The Assets panel's id in the sidebar */
export const ASSETS_PANEL_ID = "assets";

/**
 * Opens the Assets panel (the `openAssets` action), with Remove unused… asking at once
 * (`removeUnusedAssets`) or Add flag open (`addFlag`).
 */
let opened = 0;

export function showAssetsView({ openRemove = false, addFlag = false } = {}) {
    const { setContent, setOpen } = useSidebarModalStore.getState();
    // A fresh view each time, so asking again opens Remove unused… or Add flag again
    setContent(
        <AssetsContents
            key={++opened}
            openRemove={openRemove}
            addFlag={addFlag}
        />,
        ASSETS_PANEL_ID,
    );
    setOpen(true);
}
