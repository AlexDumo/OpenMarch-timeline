import { useUiSettingsStore } from "@/stores/UiSettingsStore";
import { useShallow } from "zustand/react/shallow";
import ToolbarSection from "@/components/toolbar/ToolbarSection";
import { CubeIcon, EyeIcon, EyeSlashIcon } from "@phosphor-icons/react";
import { T, useTolgee } from "@tolgee/react";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTriggerCompact,
} from "@openmarch/ui";
import type {
    MarcherLabelForm,
    ShapeOutlines,
    ShapeFocus,
    MarcherLabelSize,
} from "@/stores/UiSettingsStore";
import ActionButton from "@/shortcuts/ActionButton";

export default function ViewTab() {
    return (
        <div className="flex w-full flex-wrap gap-8">
            <UiSettingsToolbar />
            <View3dToolbar />
        </div>
    );
}

/** Opens the 3D View window, or focuses it (3D View UI-1). */
function View3dToolbar() {
    return (
        <ToolbarSection>
            <ActionButton
                action="openView3d"
                className="hover:text-accent flex items-center gap-8 outline-hidden duration-150 ease-out focus-visible:-translate-y-4 disabled:opacity-50"
            >
                <T keyName="view3d.open" />
                <CubeIcon size={24} />
            </ActionButton>
        </ToolbarSection>
    );
}

function UiSettingsToolbar() {
    const { t } = useTolgee();
    const setUiSettings = useUiSettingsStore((s) => s.setUiSettings);
    // Only the fields shown here; a change writes over the latest settings at that moment
    const uiSettings = useUiSettingsStore(
        useShallow((s) => ({
            previousPaths: s.uiSettings.previousPaths,
            nextPaths: s.uiSettings.nextPaths,
            stepSizeWarnings: s.uiSettings.stepSizeWarnings,
            gridLines: s.uiSettings.gridLines,
            halfLines: s.uiSettings.halfLines,
            showCollisions: s.uiSettings.showCollisions,
            marcherLabels: s.uiSettings.marcherLabels ?? "auto",
            marcherLabelSize: s.uiSettings.marcherLabelSize ?? "normal",
            marcherLabelPosition: s.uiSettings.marcherLabelPosition ?? "above",
            shapes: s.uiSettings.shapes ?? "selected",
            shapeFocus: s.uiSettings.shapeFocus ?? "rest",
        })),
    );

    return (
        <>
            <ToolbarSection aria-label={t("toolbar.view.uiSettingsToolbar")}>
                <button
                    onClick={() => {
                        setUiSettings({
                            ...useUiSettingsStore.getState().uiSettings,
                            previousPaths: !uiSettings.previousPaths,
                        });
                    }}
                    className="hover:text-accent flex items-center gap-8 outline-hidden duration-150 ease-out focus-visible:-translate-y-4 disabled:opacity-50"
                >
                    <T keyName="toolbar.view.previousPaths" />
                    {uiSettings.previousPaths ? (
                        <EyeIcon className="text-accent" size={24} />
                    ) : (
                        <EyeSlashIcon size={24} />
                    )}
                </button>
                <button
                    onClick={() => {
                        setUiSettings({
                            ...useUiSettingsStore.getState().uiSettings,
                            nextPaths: !uiSettings.nextPaths,
                        });
                    }}
                    className="hover:text-accent flex items-center gap-8 outline-hidden duration-150 ease-out focus-visible:-translate-y-4 disabled:opacity-50"
                >
                    <T keyName="toolbar.view.nextPaths" />
                    {uiSettings.nextPaths ? (
                        <EyeIcon className="text-accent" size={24} />
                    ) : (
                        <EyeSlashIcon size={24} />
                    )}
                </button>
                <button
                    onClick={() => {
                        setUiSettings({
                            ...useUiSettingsStore.getState().uiSettings,
                            stepSizeWarnings: !uiSettings.stepSizeWarnings,
                        });
                    }}
                    className="hover:text-accent flex items-center gap-8 outline-hidden duration-150 ease-out focus-visible:-translate-y-4 disabled:opacity-50"
                >
                    <T keyName="toolbar.view.stepSizeWarnings" />
                    {uiSettings.stepSizeWarnings ? (
                        <EyeIcon className="text-accent" size={24} />
                    ) : (
                        <EyeSlashIcon size={24} />
                    )}
                </button>
            </ToolbarSection>
            <ToolbarSection>
                <button
                    onClick={() => {
                        setUiSettings({
                            ...useUiSettingsStore.getState().uiSettings,
                            gridLines: !uiSettings.gridLines,
                        });
                    }}
                    className="hover:text-accent flex items-center gap-8 outline-hidden duration-150 ease-out focus-visible:-translate-y-4 disabled:opacity-50"
                >
                    <T keyName="toolbar.view.gridLines" />
                    {uiSettings.gridLines ? (
                        <EyeIcon className="text-accent" size={24} />
                    ) : (
                        <EyeSlashIcon size={24} />
                    )}
                </button>
                <button
                    onClick={() => {
                        setUiSettings({
                            ...useUiSettingsStore.getState().uiSettings,
                            halfLines: !uiSettings.halfLines,
                        });
                    }}
                    className="hover:text-accent flex items-center gap-8 outline-hidden duration-150 ease-out focus-visible:-translate-y-4 disabled:opacity-50"
                >
                    <T keyName="toolbar.view.halfLines" />
                    {uiSettings.halfLines ? (
                        <EyeIcon className="text-accent" size={24} />
                    ) : (
                        <EyeSlashIcon size={24} />
                    )}
                </button>
            </ToolbarSection>
            <ToolbarSection>
                {/* Placed boxes' outlines (docs/timeline/research/shapes/07-placed-boxes.md) */}
                <label className="flex items-center gap-8">
                    <T keyName="toolbar.view.shapes" />
                    <Select
                        value={uiSettings.shapes}
                        onValueChange={(v) =>
                            setUiSettings({
                                ...useUiSettingsStore.getState().uiSettings,
                                shapes: v as ShapeOutlines,
                            })
                        }
                    >
                        <SelectTriggerCompact
                            label={t("toolbar.view.shapes")}
                            data-testid="view-shapes"
                        />
                        <SelectContent>
                            <SelectItem value="selected">
                                {t("toolbar.view.shapesSelected")}
                            </SelectItem>
                            <SelectItem value="always">
                                {t("toolbar.view.shapesAlways")}
                            </SelectItem>
                            <SelectItem value="off">
                                {t("toolbar.view.shapesOff")}
                            </SelectItem>
                        </SelectContent>
                    </Select>
                </label>
                {/* Who fades while a shape is open (08-shape-system-ux.md, "Marcher styling") */}
                <label className="flex items-center gap-8">
                    <T keyName="toolbar.view.shapeFocus" />
                    <Select
                        value={uiSettings.shapeFocus}
                        onValueChange={(v) =>
                            setUiSettings({
                                ...useUiSettingsStore.getState().uiSettings,
                                shapeFocus: v as ShapeFocus,
                            })
                        }
                    >
                        <SelectTriggerCompact
                            label={t("toolbar.view.shapeFocus")}
                            data-testid="view-shape-focus"
                        />
                        <SelectContent>
                            <SelectItem value="rest">
                                {t("toolbar.view.shapeFocusRest")}
                            </SelectItem>
                            <SelectItem value="drawing">
                                {t("toolbar.view.shapeFocusDrawing")}
                            </SelectItem>
                        </SelectContent>
                    </Select>
                </label>
                {/* Full drill numbers crowd at 2-step intervals (shape sims, round 6) */}
                <label className="flex items-center gap-8">
                    <T keyName="toolbar.view.labels" />
                    <Select
                        value={uiSettings.marcherLabels}
                        onValueChange={(v) =>
                            setUiSettings({
                                ...useUiSettingsStore.getState().uiSettings,
                                marcherLabels: v as MarcherLabelForm,
                            })
                        }
                    >
                        <SelectTriggerCompact
                            label={t("toolbar.view.labels")}
                            data-testid="view-marcher-labels"
                        />
                        <SelectContent>
                            <SelectItem value="auto">
                                {t("toolbar.view.labelsAuto")}
                            </SelectItem>
                            <SelectItem value="names">
                                {t("toolbar.view.labelsNames")}
                            </SelectItem>
                            <SelectItem value="numbers">
                                {t("toolbar.view.labelsNumbers")}
                            </SelectItem>
                            <SelectItem value="off">
                                {t("toolbar.view.labelsOff")}
                            </SelectItem>
                        </SelectContent>
                    </Select>
                </label>
                <label className="flex items-center gap-8">
                    <T keyName="toolbar.view.labelSize" />
                    <Select
                        value={uiSettings.marcherLabelSize}
                        onValueChange={(v) =>
                            setUiSettings({
                                ...useUiSettingsStore.getState().uiSettings,
                                marcherLabelSize: v as MarcherLabelSize,
                            })
                        }
                    >
                        <SelectTriggerCompact
                            label={t("toolbar.view.labelSize")}
                            data-testid="view-marcher-label-size"
                        />
                        <SelectContent>
                            <SelectItem value="small">
                                {t("toolbar.view.labelSizeSmall")}
                            </SelectItem>
                            <SelectItem value="normal">
                                {t("toolbar.view.labelSizeNormal")}
                            </SelectItem>
                            <SelectItem value="large">
                                {t("toolbar.view.labelSizeLarge")}
                            </SelectItem>
                        </SelectContent>
                    </Select>
                </label>
                <label className="flex items-center gap-8">
                    <T keyName="toolbar.view.labelPosition" />
                    <Select
                        value={uiSettings.marcherLabelPosition}
                        onValueChange={(v) =>
                            setUiSettings({
                                ...useUiSettingsStore.getState().uiSettings,
                                marcherLabelPosition: v as "above" | "beside",
                            })
                        }
                    >
                        <SelectTriggerCompact
                            label={t("toolbar.view.labelPosition")}
                            data-testid="view-marcher-label-position"
                        />
                        <SelectContent>
                            <SelectItem value="above">
                                {t("toolbar.view.labelPositionAbove")}
                            </SelectItem>
                            <SelectItem value="beside">
                                {t("toolbar.view.labelPositionBeside")}
                            </SelectItem>
                        </SelectContent>
                    </Select>
                </label>
            </ToolbarSection>
            {/* <ToolbarSection>
                <button
                    onClick={() => {
                        setUiSettings({
                            ...useUiSettingsStore.getState().uiSettings,
                            showCollisions: !uiSettings.showCollisions,
                        });
                    }}
                    className="hover:text-accent flex items-center gap-8 outline-hidden duration-150 ease-out focus-visible:-translate-y-4 disabled:opacity-50"
                >
                    <span>Collisions</span>
                    {uiSettings.showCollisions ? (
                        <ArrowsInSimpleIcon
                            className="text-accent"
                            size={24}
                            weight="fill"
                        />
                    ) : (
                        <ArrowsInSimpleIcon size={24} />
                    )}
                </button>
            </ToolbarSection> */}
        </>
    );
}
