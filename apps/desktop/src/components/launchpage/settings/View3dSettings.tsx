import { useState } from "react";
import * as ToggleGroup from "@radix-ui/react-toggle-group";
import { T } from "@tolgee/react";
import { Switch } from "@openmarch/ui";
import SettingRow from "@/settings/SettingRow";
import SettingsPanel from "@/settings/SettingsPanel";
import {
    QUALITY_MODES,
    loadQualityMode,
    saveQualityMode,
} from "@/view3d/window/qualityPreference";
import {
    loadPowerPrefs,
    savePowerPrefs,
    type PowerPrefs,
} from "@/view3d/window/drawPolicy";
import {
    RESOLUTIONS,
    loadDrawWithoutGpu,
    loadResolution,
    saveDrawWithoutGpu,
    saveResolution,
} from "@/view3d/window/renderPrefs";

/**
 * How the 3D View draws on this computer. Each choice is saved in local
 * storage, which the 3D window shares and listens to, so an open 3D View
 * follows a change at once. These modules are plain TypeScript: nothing here
 * loads three.js.
 */
export default function View3dSettings() {
    const [quality, setQuality] = useState(() => loadQualityMode());
    const [resolution, setResolution] = useState(() => loadResolution());
    const [power, setPower] = useState(() => loadPowerPrefs());
    const [drawWithoutGpu, setDrawWithoutGpu] = useState(() =>
        loadDrawWithoutGpu(),
    );

    const changePower = (prefs: PowerPrefs) => {
        savePowerPrefs(prefs);
        setPower(prefs);
    };

    return (
        <SettingsPanel>
            <SettingRow
                label={<T keyName="settings.view3d.quality" />}
                htmlFor="view3d-quality"
                stacked
                description={
                    <T
                        keyName={`settings.view3d.quality.${quality}.description`}
                    />
                }
            >
                <Choices
                    id="view3d-quality"
                    value={quality}
                    options={QUALITY_MODES}
                    keyPrefix="settings.view3d.quality"
                    onChange={(mode) => {
                        saveQualityMode(mode);
                        setQuality(mode);
                    }}
                />
            </SettingRow>

            <SettingRow
                label={<T keyName="settings.view3d.resolution" />}
                htmlFor="view3d-resolution"
                stacked
                description={
                    <T
                        keyName={`settings.view3d.resolution.${resolution}.description`}
                    />
                }
            >
                <Choices
                    id="view3d-resolution"
                    value={resolution}
                    options={RESOLUTIONS}
                    keyPrefix="settings.view3d.resolution"
                    onChange={(value) => {
                        saveResolution(value);
                        setResolution(value);
                    }}
                />
            </SettingRow>

            <SettingRow
                label={<T keyName="settings.view3d.pauseWhenIdle" />}
                htmlFor="view3d-pause-when-idle"
                description={
                    <T keyName="settings.view3d.pauseWhenIdle.description" />
                }
            >
                <Switch
                    id="view3d-pause-when-idle"
                    checked={power.pauseWhenIdle}
                    onCheckedChange={(pauseWhenIdle) =>
                        changePower({ ...power, pauseWhenIdle })
                    }
                />
            </SettingRow>

            <SettingRow
                label={<T keyName="settings.view3d.saveOnBattery" />}
                htmlFor="view3d-save-on-battery"
                description={
                    <T keyName="settings.view3d.saveOnBattery.description" />
                }
            >
                <Switch
                    id="view3d-save-on-battery"
                    checked={power.saveOnBattery}
                    onCheckedChange={(saveOnBattery) =>
                        changePower({ ...power, saveOnBattery })
                    }
                />
            </SettingRow>

            <SettingRow
                label={<T keyName="settings.view3d.drawWithoutGpu" />}
                htmlFor="view3d-draw-without-gpu"
                description={
                    <T keyName="settings.view3d.drawWithoutGpu.description" />
                }
            >
                <Switch
                    id="view3d-draw-without-gpu"
                    checked={drawWithoutGpu}
                    onCheckedChange={(on) => {
                        saveDrawWithoutGpu(on);
                        setDrawWithoutGpu(on);
                    }}
                />
            </SettingRow>
        </SettingsPanel>
    );
}

/** One choice of a few, as pills: the Appearance section's theme picker. */
function Choices<V extends string>({
    id,
    value,
    options,
    keyPrefix,
    onChange,
}: {
    id: string;
    value: V;
    options: readonly V[];
    keyPrefix: string;
    onChange: (value: V) => void;
}) {
    return (
        <ToggleGroup.Root
            id={id}
            type="single"
            value={value}
            onValueChange={(next) => {
                if (next) onChange(next as V);
            }}
            className="flex h-fit w-fit flex-wrap gap-8"
        >
            {options.map((option) => (
                <ToggleGroup.Item
                    key={option}
                    value={option}
                    className="text-text bg-fg-2 text-body border-stroke data-[state=on]:border-accent rounded-full border px-12 py-8 outline-hidden duration-150 ease-out focus-visible:-translate-y-4"
                >
                    <T keyName={`${keyPrefix}.${option}`} />
                </ToggleGroup.Item>
            ))}
        </ToggleGroup.Root>
    );
}
