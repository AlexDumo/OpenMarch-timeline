import { T, useTolgee } from "@tolgee/react";
import { ToggleGroup, ToggleGroupItem } from "@openmarch/ui";
import {
    useWorkspaceViewStore,
    type WorkspaceView,
} from "@/stores/WorkspaceViewStore";

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
        <ToggleGroup
            type="single"
            value={view}
            // Radix sends "" when the pressed item is clicked again: keep it
            onValueChange={(v) => v && setView(v as WorkspaceView)}
            aria-label={t("visuals.workspace.label")}
            className={className}
            data-testid="workspace-view-switch"
        >
            <ToggleGroupItem
                value="editor"
                className="text-sub px-12"
                data-testid="workspace-view-editor"
            >
                <T keyName="visuals.workspace.editor" />
            </ToggleGroupItem>
            <ToggleGroupItem
                value="visuals"
                className="text-sub px-12"
                data-testid="workspace-view-visuals"
            >
                <T keyName="visuals.workspace.visuals" />
            </ToggleGroupItem>
        </ToggleGroup>
    );
}
