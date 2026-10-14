import * as ToggleGroup from "@radix-ui/react-toggle-group";
import { T, useTranslate } from "@tolgee/react";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTriggerButton,
} from "@openmarch/ui";
import { spacePlayKey } from "@/shortcuts/playKeys";
import { useShortcutOverridesStore } from "@/stores/ShortcutOverridesStore";
import { useUiSettingsStore } from "@/stores/UiSettingsStore";
import {
    WAVEFORM_STYLES,
    type WaveformStyle,
} from "@/timeline/timelineWaveform";
import SettingRow from "@/settings/SettingRow";
import SettingsPanel from "@/settings/SettingsPanel";
import WaveformStylePreview from "./WaveformStylePreview";

export default function TimelineSettings() {
    const { uiSettings, setUiSettings } = useUiSettingsStore();
    const { t } = useTranslate();
    // UI-22: what Space does while playing, kept as the play keys' bindings
    const space = useShortcutOverridesStore((s) => spacePlayKey(s.overrides));
    const setSpacePlayKey = useShortcutOverridesStore((s) => s.setSpacePlayKey);

    return (
        <SettingsPanel>
            <SettingRow
                label={<T keyName="settings.timeline.waveformStyle" />}
                htmlFor="waveform-style"
                stacked
                description={
                    <T
                        keyName={`settings.timeline.waveformStyle.${uiSettings.timelineWaveformStyle}.description`}
                    />
                }
            >
                <ToggleGroup.Root
                    id="waveform-style"
                    type="single"
                    value={uiSettings.timelineWaveformStyle}
                    onValueChange={(style) => {
                        if (!style) return;
                        setUiSettings({
                            ...uiSettings,
                            timelineWaveformStyle: style as WaveformStyle,
                        });
                    }}
                    className="flex h-fit w-fit flex-wrap gap-8"
                >
                    {WAVEFORM_STYLES.map((style) => (
                        <ToggleGroup.Item
                            key={style}
                            value={style}
                            className="group text-text bg-fg-2 text-body border-stroke data-[state=on]:border-accent rounded-6 flex flex-col items-start gap-8 border p-12 outline-hidden duration-150 ease-out focus-visible:-translate-y-4"
                        >
                            <span className="text-text-subtitle group-data-[state=on]:text-accent">
                                <WaveformStylePreview style={style} />
                            </span>
                            <T
                                keyName={`settings.timeline.waveformStyle.${style}`}
                            />
                        </ToggleGroup.Item>
                    ))}
                </ToggleGroup.Root>
            </SettingRow>
            <SettingRow
                label={<T keyName="settings.timeline.spacePlayKey" />}
                description={
                    <T keyName="settings.timeline.spacePlayKey.description" />
                }
                htmlFor="space-play-key"
            >
                <Select
                    value={space}
                    onValueChange={(value) =>
                        setSpacePlayKey(value === "pause" ? "pause" : "stop")
                    }
                >
                    <SelectTriggerButton
                        id="space-play-key"
                        data-testid="settings-space-play-key"
                        label={t(`settings.timeline.spacePlayKey.${space}`)}
                        className="min-w-[120px]"
                    />
                    <SelectContent>
                        <SelectItem value="stop">
                            <T keyName="settings.timeline.spacePlayKey.stop" />
                        </SelectItem>
                        <SelectItem value="pause">
                            <T keyName="settings.timeline.spacePlayKey.pause" />
                        </SelectItem>
                    </SelectContent>
                </Select>
            </SettingRow>
        </SettingsPanel>
    );
}
