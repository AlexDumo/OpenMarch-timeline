import { T } from "@tolgee/react";
import { Switch } from "@openmarch/ui";
import {
    FIELD_VENUE_AROUND,
    useUiSettingsStore,
    type EquipmentIconPlace,
    type FieldVenueLook,
    type MarcherLabelSize,
    type UiSettings,
} from "@/stores/UiSettingsStore";
import SettingRow from "@/settings/SettingRow";
import SettingsPanel from "@/settings/SettingsPanel";
import SettingChoices from "@/settings/SettingChoices";

const LABEL_SIZES: readonly MarcherLabelSize[] = [
    "auto",
    "small",
    "normal",
    "large",
];
const LABEL_POSITIONS = ["above", "beside"] as const;
const ICON_PLACES: readonly EquipmentIconPlace[] = ["beside", "dot", "label"];
const VENUE_LOOKS: readonly Exclude<FieldVenueLook, "off">[] = [
    "faint",
    "soft",
    "markings",
    "full",
];

export default function FieldSettings() {
    const uiSettings = useUiSettingsStore((s) => s.uiSettings);
    const setUiSettings = useUiSettingsStore((s) => s.setUiSettings);
    const change = (patch: Partial<UiSettings>) =>
        setUiSettings({
            ...useUiSettingsStore.getState().uiSettings,
            ...patch,
        });

    return (
        <>
            <SettingsPanel>
                <SettingRow
                    label={<T keyName="settings.field.gridLines" />}
                    htmlFor="field-grid-lines"
                >
                    <Switch
                        id="field-grid-lines"
                        checked={uiSettings.gridLines}
                        onCheckedChange={(gridLines) => change({ gridLines })}
                    />
                </SettingRow>

                <SettingRow
                    label={<T keyName="settings.field.halfLines" />}
                    htmlFor="field-half-lines"
                >
                    <Switch
                        id="field-half-lines"
                        checked={uiSettings.halfLines}
                        onCheckedChange={(halfLines) => change({ halfLines })}
                    />
                </SettingRow>

                <SettingRow
                    label={<T keyName="settings.field.stepSizeWarnings" />}
                    htmlFor="field-step-size-warnings"
                    description={
                        <T keyName="settings.field.stepSizeWarnings.description" />
                    }
                >
                    <Switch
                        id="field-step-size-warnings"
                        checked={uiSettings.stepSizeWarnings}
                        onCheckedChange={(stepSizeWarnings) =>
                            change({ stepSizeWarnings })
                        }
                    />
                </SettingRow>

                {/* Pathways M2 (#1095): trails and line orders, off until turned on */}
                <SettingRow
                    label={<T keyName="settings.field.followTheLeader" />}
                    htmlFor="field-follow-the-leader"
                    description={
                        <T keyName="settings.field.followTheLeader.description" />
                    }
                >
                    <Switch
                        id="field-follow-the-leader"
                        checked={uiSettings.followTheLeader === true}
                        onCheckedChange={(followTheLeader) =>
                            change({ followTheLeader })
                        }
                    />
                </SettingRow>
            </SettingsPanel>

            <SettingsPanel heading={<T keyName="fieldDisplay.labels" />}>
                <SettingRow
                    label={<T keyName="settings.field.labelSize" />}
                    htmlFor="field-label-size"
                >
                    <SettingChoices
                        id="field-label-size"
                        value={uiSettings.marcherLabelSize ?? "auto"}
                        options={LABEL_SIZES}
                        keyPrefix="settings.field.labelSize"
                        onChange={(marcherLabelSize) =>
                            change({ marcherLabelSize })
                        }
                    />
                </SettingRow>

                <SettingRow
                    label={<T keyName="settings.field.labelPosition" />}
                    htmlFor="field-label-position"
                >
                    <SettingChoices
                        id="field-label-position"
                        value={uiSettings.marcherLabelPosition ?? "above"}
                        options={LABEL_POSITIONS}
                        keyPrefix="settings.field.labelPosition"
                        onChange={(marcherLabelPosition) =>
                            change({ marcherLabelPosition })
                        }
                    />
                </SettingRow>
            </SettingsPanel>

            <SettingsPanel
                heading={<T keyName="fieldDisplay.equipmentIcons" />}
            >
                <SettingRow
                    label={<T keyName="settings.field.iconPlace" />}
                    htmlFor="field-icon-place"
                >
                    <SettingChoices
                        id="field-icon-place"
                        value={uiSettings.equipmentIconPlace ?? "beside"}
                        options={ICON_PLACES}
                        keyPrefix="settings.field.iconPlace"
                        onChange={(equipmentIconPlace) =>
                            change({ equipmentIconPlace })
                        }
                    />
                </SettingRow>
            </SettingsPanel>

            {/* The show's 3D venue under the grid (#1207), when Show on field's Venue is on */}
            <SettingsPanel heading={<T keyName="toolbar.view.venue" />}>
                <SettingRow
                    label={<T keyName="fieldDisplay.venueLook" />}
                    htmlFor="field-venue-look"
                >
                    <SettingChoices
                        id="field-venue-look"
                        value={uiSettings.fieldVenueLast ?? "faint"}
                        options={VENUE_LOOKS}
                        keyPrefix="settings.field.venueLook"
                        onChange={(look) =>
                            change({
                                fieldVenueLast: look,
                                // Showing now: it changes at once
                                ...((uiSettings.fieldVenue ?? "off") !== "off"
                                    ? { fieldVenue: look }
                                    : {}),
                            })
                        }
                    />
                </SettingRow>

                <SettingRow
                    label={<T keyName="toolbar.view.venueAround" />}
                    htmlFor="field-venue-around"
                    description={
                        <T keyName="toolbar.view.venueEdgeStadiumOnly" />
                    }
                >
                    <SettingChoices
                        id="field-venue-around"
                        value={uiSettings.fieldVenueAround ?? "edge"}
                        options={FIELD_VENUE_AROUND}
                        keyPrefix="settings.field.venueAround"
                        onChange={(fieldVenueAround) =>
                            change({ fieldVenueAround })
                        }
                    />
                </SettingRow>
            </SettingsPanel>
        </>
    );
}
