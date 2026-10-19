import { T, useTolgee } from "@tolgee/react";
import { SegmentedTextSwitch } from "@openmarch/ui";
import {
    useWorkspaceViewStore,
    type WorkspaceView,
} from "@/stores/WorkspaceViewStore";

const options = [
    {
        value: "editor",
        label: <T keyName="visuals.workspace.editor" />,
        testId: "workspace-view-editor",
    },
    {
        value: "visuals",
        label: <T keyName="visuals.workspace.visuals" />,
        testId: "workspace-view-visuals",
    },
];

/** Editor or Visuals (performer-behavior.md section 7.1). */
export default function WorkspaceViewSwitch({
    className,
}: {
    className?: string;
}) {
    const { t } = useTolgee();
    const view = useWorkspaceViewStore((s) => s.view);
    const setView = useWorkspaceViewStore((s) => s.setView);
    return (
        <SegmentedTextSwitch
            options={options}
            selected={view}
            setSelected={(v) => setView(v as WorkspaceView)}
            ariaLabel={t("visuals.workspace.label")}
            className={className}
            testId="workspace-view-switch"
        />
    );
}
