import MusicModal from "@/components/music/MusicModal";
import FieldModal from "@/components/field/FieldModal";
import MarchersModal from "@/components/marcher/MarchersModal";
import MetronomeModal from "@/components/music/MetronomeModal";
import WorkspaceSettingsModal from "@/components/sidebar/WorkspaceSettingsModal";
import AppearanceModal from "@/components/marcher/appearance/AppearanceModal";
import MobileExportModal from "../mobile/MobileExportModal";
import AssetsModal from "@/components/assets/AssetsModal";
import { isWebBuild } from "@/utilities/webBuild";
import PropsModal from "@/components/items/PropsModal";
import SketchesModal from "@/components/sketches/SketchesModal";

export default function Sidebar() {
    return (
        <div
            id="sidebar"
            className="bg-fg-1 border-stroke rounded-6 flex h-full w-fit flex-col justify-between border px-8 py-16"
        >
            <div className="flex flex-col gap-16">
                <MarchersModal />
                <PropsModal />
                <MusicModal />
                <FieldModal />
                {/* The Sketchpad window is Electron's for now; the web pop-up comes later. */}
                {!isWebBuild && <SketchesModal />}
                <MetronomeModal />
                <AppearanceModal />
                {/* The Library lives in main; the web build has no Library IPC. */}
                {!isWebBuild && <AssetsModal />}
            </div>
            <div className="flex flex-col gap-16">
                {/* Uploading to the mobile app needs sign-in, which needs Electron. */}
                {!isWebBuild && <MobileExportModal />}
                <WorkspaceSettingsModal />
            </div>
        </div>
    );
}
