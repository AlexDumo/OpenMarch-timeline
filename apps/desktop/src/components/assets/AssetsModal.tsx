import { PackageIcon } from "@phosphor-icons/react";
import { useTranslate } from "@tolgee/react";
import { SidebarModalLauncher } from "@/components/sidebar/SidebarModal";
import { AssetsContents } from "./AssetsView";
import { ASSETS_PANEL_ID } from "./openAssets";

/**
 * The show's own assets in one place (fork #985): flags, imported prop models and uniforms, with
 * Add flag at the top. Its own sidebar panel since flags joined the models.
 */
export default function AssetsModal() {
    const { t } = useTranslate();
    return (
        <SidebarModalLauncher
            name={t("sidebar.assets")}
            contents={<AssetsContents />}
            newContentId={ASSETS_PANEL_ID}
            buttonLabel={<PackageIcon size={24} />}
            testId="sidebar-assets"
        />
    );
}
